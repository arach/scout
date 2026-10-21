import { describe, expect, spyOn, test } from "bun:test";
import { INHERITED_DESCRIPTOR_LAYOUTS as layouts, MAX_INHERITED_DESCRIPTOR_SLOT as ceiling,
  assertInheritedDescriptorRegistry, type InheritedDescriptorRegistry } from "./inherited-descriptors.js";
import { CARRIER_LAYOUT, carrierStdio } from "./supervision-handoff/carrier-layout.js";

function copy(): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.entries(layouts).map(([key, value]) => [key, { ...value }]));
}
describe("one inherited descriptor target registry", () => {
  test("pins standard I/O and preserves the shipped role-custody/1 ABI", () => {
    expect(layouts.stdio).toEqual({ stdin: 0, stdout: 1, stderr: 2 });
    expect(layouts.roleCustody).toEqual({ parentChannel: 3, reservedContext: 4, fence: 7 });
    expect(CARRIER_LAYOUT).toEqual({ id: "role-custody/1", ...layouts.roleCustody });
    expect(layouts.extensionApi2).toEqual({ context: 5, credential: 6 });
    expect(ceiling).toBe(7); expect(() => assertInheritedDescriptorRegistry()).not.toThrow();
  });
  test("all fragments can meet in one process without reusing any slot", () => {
    const slots = Object.values(layouts).flatMap(Object.values);
    expect(slots).toHaveLength(8); expect(new Set(slots).size).toBe(slots.length);
    expect([...slots].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  test.each([3, 4, 7])("extension context cannot take a role-custody slot %i", slot => {
    const bad = copy(); bad.extensionApi2!.context = slot;
    expect(() => assertInheritedDescriptorRegistry(bad)).toThrow("inherited_descriptor_collision");
  });
  test("the former extension 3/4 proposal fails when composed with the worker layout", () => {
    const old = { ...layouts, extensionApi2: { context: 3, credential: 4 } };
    expect(() => assertInheritedDescriptorRegistry(old)).toThrow("roleCustody.parentChannel and extensionApi2.context at 3");
  });
  test("reserved role context and future credentials also prevent collisions", () => {
    for (const [fragment, purpose, slot] of [["extensionApi2", "credential", 4], ["roleCustody", "reservedContext", 6]] as const) {
      const bad = copy(); bad[fragment]![purpose] = slot;
      expect(() => assertInheritedDescriptorRegistry(bad)).toThrow("inherited_descriptor_collision");
    }
  });
  test("a future spawn fragment is automatically checked, without an overlap list to forget", () => {
    expect(() => assertInheritedDescriptorRegistry({ ...layouts, futurePair: { parent: 3 } })).toThrow("inherited_descriptor_collision");
    expect(() => assertInheritedDescriptorRegistry({ ...layouts, futurePair: { distinct: 8 } })).not.toThrow();
  });
  test("duplicate purposes inside one fragment and stdio reuse also fail", () => {
    expect(() => assertInheritedDescriptorRegistry({ worker: { one: 7, two: 7 } })).toThrow("inherited_descriptor_collision");
    expect(() => assertInheritedDescriptorRegistry({ ...layouts, extensionApi2: { context: 0, credential: 6 } })).toThrow("inherited_descriptor_collision");
  });
  test.each([-1, 0.5, NaN, Infinity, 256, Number.MAX_SAFE_INTEGER + 1])("rejects invalid target slot %s", slot => {
    expect(() => assertInheritedDescriptorRegistry({ context: { target: slot } })).toThrow("invalid_inherited_descriptor_slot");
  });
  test("rejects malformed or empty fragments instead of silently checking nothing", () => {
    for (const registry of [null, [], {}, { empty: {} }, { array: [3] }, { "": { x: 3 } }, { context: { "": 3 } }, { context: { key: "3" } }]) {
      expect(() => assertInheritedDescriptorRegistry(registry as unknown as InheritedDescriptorRegistry)).toThrow();
    }
  });
  test("registry and every fragment are frozen", () => {
    expect(Object.isFrozen(layouts)).toBe(true);
    expect(Object.values(layouts).every(Object.isFrozen)).toBe(true);
    expect(Reflect.set(layouts.extensionApi2, "context", 3)).toBe(false);
    expect(layouts.extensionApi2.context).toBe(5);
  });
  test("actual carrier stdio derives its mappings and ignores both extension channels", () => {
    expect(carrierStdio(["inherit", "ignore", "inherit"], 101, 102))
      .toEqual(["inherit", "ignore", "inherit", 101, "ignore", "ignore", "ignore", 102]);
    const array = carrierStdio(["ignore", "ignore", "ignore"], 103, 104);
    expect(array).toHaveLength(ceiling + 1);
    expect(array[layouts.roleCustody.parentChannel]).toBe(103);
    expect(array[layouts.roleCustody.fence]).toBe(104);
    expect(array[layouts.roleCustody.reservedContext]).toBe("ignore");
    expect(array[layouts.extensionApi2.context]).toBe("ignore");
    expect(array[layouts.extensionApi2.credential]).toBe("ignore");
    array[layouts.extensionApi2.context] = "inherit";
    expect(carrierStdio(["ignore", "ignore", "ignore"], 103, 104)[layouts.extensionApi2.context]).toBe("ignore");
  });
  test("a cold registry import does not spawn or inspect native descriptors", async () => {
    const spawn = spyOn(Bun, "spawn").mockImplementation(() => { throw Error("registry spawned"); });
    try {
      const specifier = "./inherited-descriptors.ts?cold";
      const fresh = await import(specifier);
      expect(fresh.INHERITED_DESCRIPTOR_LAYOUTS).toEqual(layouts);
      expect(spawn).not.toHaveBeenCalled();
    } finally { spawn.mockRestore(); }
  });
});
