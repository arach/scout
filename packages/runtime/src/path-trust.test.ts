import { expect, spyOn, test } from "bun:test";
import { untrustedPathMetadata } from "./path-trust.js";

test("strict policy accepts the current uid/root, refuses foreign owners and world writers", () => {
  const uid = process.getuid?.() ?? 501;
  expect(untrustedPathMetadata("fixture", { uid, mode: 0o600 })).toBeUndefined();
  expect(untrustedPathMetadata("fixture", { uid: 0, mode: 0o644 })).toBeUndefined();
  expect(untrustedPathMetadata("fixture", { uid: uid + 1, mode: 0o600 })).toContain("not owned by the current user or root");
  expect(untrustedPathMetadata("fixture", { uid, mode: 0o666 })).toContain("anyone on this machine can write");
  // A sticky flag never excuses world-writability on a strict path/file.
  expect(untrustedPathMetadata("fixture", { uid, mode: 0o1666 })).toContain("anyone on this machine can write");
});

test("only loose ancestors keep the extension loader's sticky-folder exception", () => {
  const uid = (process.getuid?.() ?? 501) + 1;
  expect(untrustedPathMetadata("ancestor", { uid, mode: 0o1777 }, true)).toBeUndefined();
  expect(untrustedPathMetadata("ancestor", { uid, mode: 0o777 }, true)).toContain("anyone on this machine can write");
  expect(untrustedPathMetadata("ancestor", { uid, mode: 0o1777 })).toContain("not owned by the current user or root");
});

test("missing getuid fails closed for strict paths, as in the extension loader", () => {
  const mock = spyOn(process, "getuid").mockImplementation(() => undefined as any);
  try { expect(untrustedPathMetadata("fixture", { uid: 0, mode: 0o600 })).toContain("not owned by the current user or root"); }
  finally { mock.mockRestore(); }
});
