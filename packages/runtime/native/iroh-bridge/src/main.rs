use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use data_encoding::HEXLOWER;
use iroh::{Endpoint, EndpointAddr, SecretKey, endpoint::presets};
use serde::{Deserialize, Serialize};

const OPENSCOUT_MESH_PROTOCOL_VERSION: u8 = 1;
const OPENSCOUT_IROH_MESH_ALPN: &[u8] = b"openscout/mesh/1";
const MAX_MESH_FRAME_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(name = "openscout-iroh-bridge")]
#[command(about = "Iroh sidecar for OpenScout Mesh")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Load or create the node's Iroh identity and print public metadata.
    Identity {
        #[arg(long)]
        identity_path: PathBuf,
    },
    /// Bind an Iroh endpoint, print its current address, and wait until stopped.
    Serve {
        #[arg(long)]
        identity_path: PathBuf,
        #[arg(long)]
        broker_url: String,
        #[arg(long, default_value_t = 5_000)]
        online_timeout_ms: u64,
    },
    /// Dial a remote Iroh endpoint and forward one mesh bundle from stdin.
    Forward {
        #[arg(long)]
        identity_path: PathBuf,
        #[arg(long)]
        endpoint_addr_json: String,
        #[arg(long)]
        route: MeshRoute,
        #[arg(long, default_value_t = 5_000)]
        timeout_ms: u64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityOutput {
    bridge_protocol_version: u8,
    alpn: String,
    endpoint_id: String,
    identity_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServeOutput {
    bridge_protocol_version: u8,
    alpn: String,
    endpoint_id: String,
    endpoint_addr: serde_json::Value,
    identity_path: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum MeshRoute {
    #[serde(rename = "messages")]
    Messages,
    #[serde(rename = "invocations")]
    Invocations,
    #[serde(rename = "collaboration/records")]
    CollaborationRecords,
    #[serde(rename = "collaboration/events")]
    CollaborationEvents,
}

impl std::str::FromStr for MeshRoute {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "messages" => Ok(Self::Messages),
            "invocations" => Ok(Self::Invocations),
            "collaboration/records" => Ok(Self::CollaborationRecords),
            "collaboration/events" => Ok(Self::CollaborationEvents),
            _ => Err(anyhow::anyhow!("unsupported mesh route {value}")),
        }
    }
}

impl MeshRoute {
    fn broker_path(self) -> &'static str {
        match self {
            Self::Messages => "/v1/mesh/messages",
            Self::Invocations => "/v1/mesh/invocations",
            Self::CollaborationRecords => "/v1/mesh/collaboration/records",
            Self::CollaborationEvents => "/v1/mesh/collaboration/events",
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct BridgeRequest {
    route: MeshRoute,
    body: String,
    headers: PeerProofHeaders,
}

/// Only the Scout proof crosses the local hop. Never forward caller-selected
/// local-admin, forwarding, host, or arbitrary HTTP headers.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PeerProofHeaders {
    #[serde(rename = "x-openscout-peer")]
    peer: String,
    #[serde(rename = "x-openscout-ts")]
    ts: String,
    #[serde(rename = "x-openscout-nonce")]
    nonce: String,
    #[serde(rename = "x-openscout-signature")]
    signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignedEnvelope {
    body: String,
    headers: PeerProofHeaders,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    status: u16,
    body: serde_json::Value,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Identity { identity_path } => {
            let secret_key = load_or_create_secret_key(&identity_path)?;
            print_json(&IdentityOutput {
                bridge_protocol_version: OPENSCOUT_MESH_PROTOCOL_VERSION,
                alpn: alpn_string(),
                endpoint_id: secret_key.public().to_string(),
                identity_path: identity_path.display().to_string(),
            })?;
        }
        Command::Serve {
            identity_path,
            broker_url,
            online_timeout_ms,
        } => {
            let secret_key = load_or_create_secret_key(&identity_path)?;
            let endpoint = Endpoint::builder(presets::N0)
                .secret_key(secret_key.clone())
                .alpns(vec![OPENSCOUT_IROH_MESH_ALPN.to_vec()])
                .bind()
                .await
                .context("bind iroh endpoint")?;

            let _ =
                tokio::time::timeout(Duration::from_millis(online_timeout_ms), endpoint.online())
                    .await;

            print_json(&ServeOutput {
                bridge_protocol_version: OPENSCOUT_MESH_PROTOCOL_VERSION,
                alpn: alpn_string(),
                endpoint_id: secret_key.public().to_string(),
                endpoint_addr: serde_json::to_value(endpoint.addr())
                    .context("serialize endpoint address")?,
                identity_path: identity_path.display().to_string(),
            })?;

            let client = broker_client()?;
            let accept_endpoint = endpoint.clone();
            tokio::spawn(async move {
                while let Some(incoming) = accept_endpoint.accept().await {
                    let broker_url = broker_url.clone();
                    let client = client.clone();
                    tokio::spawn(async move {
                        if let Err(error) = handle_incoming(incoming, broker_url, client).await {
                            eprintln!("openscout-iroh-bridge: incoming request failed: {error:#}");
                        }
                    });
                }
            });

            tokio::signal::ctrl_c().await.context("wait for shutdown")?;
            endpoint.close().await;
        }
        Command::Forward {
            identity_path,
            endpoint_addr_json,
            route,
            timeout_ms,
        } => {
            let envelope: SignedEnvelope = serde_json::from_value(read_stdin_json()?)
                .context("read signed mesh envelope from stdin")?;
            let endpoint_addr: EndpointAddr =
                serde_json::from_str(&endpoint_addr_json).context("parse endpoint address JSON")?;
            let response = tokio::time::timeout(
                Duration::from_millis(timeout_ms),
                forward_once(&identity_path, endpoint_addr, route, envelope),
            )
            .await
            .context("Iroh forward timed out")??;
            print_json(&response)?;
        }
    }

    Ok(())
}

async fn forward_once(
    identity_path: &Path,
    endpoint_addr: EndpointAddr,
    route: MeshRoute,
    envelope: SignedEnvelope,
) -> Result<BridgeResponse> {
    let secret_key = load_or_create_secret_key(identity_path)?;
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(secret_key)
        .bind()
        .await
        .context("bind iroh forwarding endpoint")?;

    let connection = endpoint
        .connect(endpoint_addr, OPENSCOUT_IROH_MESH_ALPN)
        .await
        .context("connect to remote Iroh endpoint")?;
    let (mut send, mut recv) = connection.open_bi().await.context("open stream")?;
    let request = BridgeRequest {
        route,
        body: envelope.body,
        headers: envelope.headers,
    };
    let bytes = serde_json::to_vec(&request).context("encode bridge request")?;
    send.write_all(&bytes)
        .await
        .context("write bridge request")?;
    send.finish().context("finish bridge request stream")?;

    let response_bytes = recv
        .read_to_end(MAX_MESH_FRAME_BYTES)
        .await
        .context("read bridge response")?;
    let response: BridgeResponse =
        serde_json::from_slice(&response_bytes).context("decode bridge response")?;
    connection.close(0u32.into(), b"openscout mesh forward complete");
    endpoint.close().await;
    Ok(response)
}

async fn handle_incoming(
    incoming: iroh::endpoint::Incoming,
    broker_url: String,
    client: reqwest::Client,
) -> Result<()> {
    let connection = incoming.await.context("accept connection")?;
    let (mut send, mut recv) = connection.accept_bi().await.context("accept stream")?;
    let request_bytes = recv
        .read_to_end(MAX_MESH_FRAME_BYTES)
        .await
        .context("read bridge request")?;
    let request: BridgeRequest =
        serde_json::from_slice(&request_bytes).context("decode bridge request")?;
    let response = post_to_broker(&client, &broker_url, request).await?;
    let response_bytes = serde_json::to_vec(&response).context("encode bridge response")?;
    send.write_all(&response_bytes)
        .await
        .context("write bridge response")?;
    send.finish().context("finish bridge response stream")?;
    connection.closed().await;
    Ok(())
}

fn broker_client() -> Result<reqwest::Client> {
    // Never follow a redirect from the restrictive ingress mount to a local
    // operator route (or another host).
    Ok(reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?)
}

fn broker_request(
    client: &reqwest::Client,
    broker_url: &str,
    request: BridgeRequest,
) -> reqwest::RequestBuilder {
    let url = format!(
        "{}/v1/iroh{}",
        broker_url.trim_end_matches('/'),
        request.route.broker_path()
    );
    client
        .post(url)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .header("x-openscout-peer", request.headers.peer)
        .header("x-openscout-ts", request.headers.ts)
        .header("x-openscout-nonce", request.headers.nonce)
        .header("x-openscout-signature", request.headers.signature)
        // Do not parse/re-serialize: the Scout signature covers these bytes.
        .body(request.body)
}

async fn post_to_broker(
    client: &reqwest::Client,
    broker_url: &str,
    request: BridgeRequest,
) -> Result<BridgeResponse> {
    let response = broker_request(client, broker_url, request)
        .send()
        .await
        .context("POST authenticated Iroh broker ingress")?;
    let status = response.status().as_u16();
    let raw_body = response
        .text()
        .await
        .unwrap_or_else(|error| format!("failed to read broker response body: {error}"));
    let body = serde_json::from_str::<serde_json::Value>(&raw_body)
        .unwrap_or_else(|_| serde_json::json!({ "ok": false, "error": raw_body }));
    Ok(BridgeResponse { status, body })
}

fn read_stdin_json() -> Result<serde_json::Value> {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .context("read stdin")?;
    serde_json::from_str(&raw).context("parse stdin JSON")
}

fn alpn_string() -> String {
    String::from_utf8_lossy(OPENSCOUT_IROH_MESH_ALPN).into_owned()
}

fn print_json(value: &impl Serialize) -> Result<()> {
    println!(
        "{}",
        serde_json::to_string(value).context("serialize output")?
    );
    Ok(())
}

fn load_or_create_secret_key(path: &Path) -> Result<SecretKey> {
    if path.exists() {
        return load_secret_key(path);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create identity directory {}", parent.display()))?;
    }

    let secret_key = SecretKey::generate();
    let encoded = HEXLOWER.encode(&secret_key.to_bytes());
    write_identity(path, &encoded)?;
    Ok(secret_key)
}

fn load_secret_key(path: &Path) -> Result<SecretKey> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("read identity {}", path.display()))?;
    let trimmed = raw.trim();
    let bytes = HEXLOWER
        .decode(trimmed.as_bytes())
        .with_context(|| format!("decode identity {}", path.display()))?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("identity {} must decode to 32 bytes", path.display()))?;
    Ok(SecretKey::from_bytes(&bytes))
}

#[cfg(unix)]
fn write_identity(path: &Path, encoded: &str) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(encoded.as_bytes())
        .with_context(|| format!("write identity {}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_identity(path: &Path, encoded: &str) -> Result<()> {
    fs::write(path, encoded).with_context(|| format!("write identity {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> serde_json::Value {
        serde_json::json!({ "route": "invocations", "body": "{ \"z\": \"☃\", \"a\": 1 }", "headers": {
            "x-openscout-peer": "peer-key", "x-openscout-ts": "123", "x-openscout-nonce": "nonce", "x-openscout-signature": "signature"
        } })
    }

    #[test]
    fn forwards_only_proof_to_dedicated_mount_preserving_exact_bytes() {
        for route in [
            "messages",
            "invocations",
            "collaboration/records",
            "collaboration/events",
        ] {
            let mut value = frame();
            value["route"] = route.into();
            let request: BridgeRequest = serde_json::from_value(value.clone()).unwrap();
            let built = broker_request(
                &broker_client().unwrap(),
                "http://127.0.0.1:43110/",
                request,
            )
            .build()
            .unwrap();
            assert_eq!(built.url().path(), format!("/v1/iroh/v1/mesh/{route}"));
            assert_eq!(
                built.body().unwrap().as_bytes().unwrap(),
                value["body"].as_str().unwrap().as_bytes()
            );
            assert_eq!(built.headers()["x-openscout-peer"], "peer-key");
            assert_eq!(built.headers().len(), 6);
        }
    }

    #[test]
    fn missing_proofs_arbitrary_headers_and_operator_routes_are_rejected() {
        let mut missing = frame();
        missing.as_object_mut().unwrap().remove("headers");
        assert!(serde_json::from_value::<BridgeRequest>(missing).is_err());
        let mut injected = frame();
        injected["headers"]["x-openscout-local-admin"] = "evil".into();
        assert!(serde_json::from_value::<BridgeRequest>(injected).is_err());
        let mut route = frame();
        route["route"] = "/v1/commands".into();
        assert!(serde_json::from_value::<BridgeRequest>(route).is_err());
    }

    #[tokio::test]
    async fn redirects_never_escape_the_remote_ingress_mount() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 4096];
            let _ = socket.read(&mut bytes).unwrap();
            socket.write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: /v1/commands\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
        });
        let response = post_to_broker(
            &broker_client().unwrap(),
            &format!("http://{address}"),
            serde_json::from_value(frame()).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(response.status, 307);
        server.join().unwrap();
    }

    #[test]
    fn unsigned_legacy_frames_are_rejected() {
        let frame = r#"{"route":"invocations","payload":{"task":"untrusted"}}"#;
        assert!(serde_json::from_str::<BridgeRequest>(frame).is_err());
    }
}
