import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairingTrustOwner } from "../packages/runtime/src/pairing-security/trust-owner.ts";

for (const flavor of ["web", "desktop"]) {
  for (const scenario of ["revoked", "lifecycle", "workflow", "authority", "carrier", "subscriptions", "account-no-gate", "account-controller", "account-runtime", "account-deny", "account-expiry", "account-disconnect", "account-carrier", "account-authority", "account-error", "account-cas-deny", "account-cas-delivered"]) {
    test(`${flavor}: relay ${scenario}`, async () => {
      const root = mkdtempSync(join(tmpdir(), "relay-pairing-"));
      const isolatedEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(OPENSCOUT_|SCOUT_)/.test(key)));
      const child = Bun.spawn([process.execPath, "scripts/relay-pairing-worker.ts", flavor, scenario], {
        cwd: process.cwd(), env: {...isolatedEnv, OPENSCOUT_PAIRING_HOME: root, OPENSCOUT_HOME:join(root,"control"), OPENSCOUT_CONTROL_HOME:join(root,"db"), OPENSCOUT_SUPPORT_DIRECTORY:join(root,"support")},
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      const timeout = setTimeout(() => child.kill(), 10_000);
      try {
        const output = (async () => {
          let text = "", changed = false;
          for await (const chunk of child.stdout) {
            text += new TextDecoder().decode(chunk);
            if ((scenario === "account-runtime" || scenario === "account-controller") && !changed && /ACCOUNT_REQUEST ([a-f0-9-]+)/.test(text)) {
              changed=true;
              const token=/ACCOUNT_REQUEST ([a-f0-9-]+)/.exec(text)![1]!;
              const operator=Bun.spawn([process.execPath,"packages/pairing/src/fixtures/pairing-cli-worker.ts","requests","approve",token],{
                cwd:process.cwd(),env:{...isolatedEnv,OPENSCOUT_HOME:join(root,"control")},stdout:"pipe",stderr:"pipe",
              });
              const [exit,stdout,stderr]=await Promise.all([operator.exited,new Response(operator.stdout).text(),new Response(operator.stderr).text()]);
              expect(exit).toBe(0);expect(stderr).toBe("");expect(JSON.parse(stdout).request.status).toBe("approved");
            }
            if (scenario === "authority" && !changed && text.includes("OPPORTUNITY_READY")) {
              changed = true;
              const owner = pairingTrustOwner(root);
              owner.mutate(owner.read().revision, "other-process", {type: "grant", peer: {
                publicKey: "b".repeat(64), pairedAt: "2026-01-01",
              }});
              child.stdin.end("continue");
            }
          }
          return text;
        })();
        const [code, out, err] = await Promise.all([child.exited, output, new Response(child.stderr).text()]);
        console.log(out);
        if (code !== 0 || !out.includes('"ok":true')) {
          console.error(err);
          if (existsSync(join(root, "bridge.log"))) console.error(readFileSync(join(root, "bridge.log"), "utf8"));
        }
        expect(code).toBe(0);
        expect(out).toContain('"ok":true');
        if(scenario === "account-controller") {
          expect(out).toContain("CONTROLLER_OWNER_PATH_VERIFIED");
          const snapshot=JSON.parse(readFileSync(join(root,"runtime.json"),"utf8"));
          expect(snapshot.accountPairing).toBeNull();expect(snapshot.pairing).toBeNull();expect(snapshot.status).toBe("stopped");
        }
      } finally {
        clearTimeout(timeout); child.kill(); await child.exited;
        rmSync(root, {recursive: true, force: true});
      }
    }, 15_000);
  }
}

test("automatic controller refresh/restart never opens a pairing window", () => {
  for (const base of ["packages/pairing/src/core/pairing"]) {
    const controller = readFileSync(join(base,"pairing-runtime-controller.ts"),"utf8");
    expect(controller).not.toContain(".openPairing(");
    expect(controller).not.toContain("openPairingOpportunity(");
    expect(controller).not.toContain("refreshedPairingPayload(");
  }
});

test("maintenance restart is not pairing consent", () => {
  for (const file of ["packages/pairing/src/pairing.ts"]) {
    const source = readFileSync(file,"utf8");
    const control = source.slice(source.indexOf("export async function controlScout"));
    const restart = control.slice(control.indexOf('case "restart":'),control.indexOf('break;',control.indexOf('case "restart":')));
    expect(restart).not.toContain("requestLocalPairingOpportunity");
  }
});
