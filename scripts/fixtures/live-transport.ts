/** Actual Noise, with an in-process frame carrier for registry unit/cost probes.
 * Socket/relay end-to-end evidence is separate. No handle minting seam. */
import {SecureTransport, type TransportDomain} from "../../packages/runtime/src/pairing-security/transport.ts";
import {generateKeyPair, type KeyPair} from "../../packages/runtime/src/pairing-security/noise.ts";
export function liveTransport(domain: TransportDomain, phone: KeyPair, options: {
  local?: boolean; group?: string; mutateCallbackKey?: boolean;
} = {}) {
  const frames: ["host"|"phone", string|Uint8Array][] = [];
  const closes: {code:number;reason:string;time:number}[] = [];
  const messages: string[] = [], outbound: string[] = [];
  let ctx: any;
  // The fixture supplies a real host identity, not domain.hostKey as a key pair.
  const host = hostKeys.get(domain);
  if (!host) throw Error("Fixture host key required");
  const server = new SecureTransport({send: f => frames.push(["phone",f])}, "responder", host, {
    onReady: key => {
      if (options.mutateCallbackKey) key.fill(0);
      if (!(options.local ? server.activateLocalService() : server.activatePaired())) throw Error("Fixture admission failed");
      ctx = server.bindContext({bridge: domain.bridge, secureTransport: true, trustedPeer: true, deviceId: "same-display"});
    }, onMessage: m => messages.push(m), onError: e => {throw e;},
  }, {domain, replacementGroup: options.group, close: (code,reason) => closes.push({code,reason,time:performance.now()}),
    trustOnComplete:false, skipTrustWrite:()=>true});
  const client = new SecureTransport({send:f=>frames.push(["host",f])}, "initiator", phone, {onMessage: message => outbound.push(message)},
    {trustOnComplete:false,skipTrustWrite:()=>true});
  const flush = () => {while (frames.length) {const [to,f] = frames.shift()!; (to === "host" ? server : client).receive(f);}};
  flush();
  if (!ctx || !server.isReady()) throw Error("Real Noise handshake did not complete");
  return {server, client, ctx, closes, messages, outbound, flush};
}
const hostKeys = new WeakMap<TransportDomain, KeyPair>();
export function fixtureHost(domain: TransportDomain, host: KeyPair) {hostKeys.set(domain,host);}
export {generateKeyPair};
