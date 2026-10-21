/** Child-side descriptor targets, not arbitrary numeric descriptors opened by
 * the parent. All fragments can meet in one process, so every purpose has one
 * globally distinct slot. Stdio is one shared fragment, not repeated per spawn.
 * Reserved slots participate in collision checks even before their transport
 * exists. This module has no I/O, native imports, or process/secret access.
 */
export const INHERITED_DESCRIPTOR_LAYOUTS = Object.freeze({
  stdio: Object.freeze({ stdin: 0, stdout: 1, stderr: 2 } as const),
  roleCustody: Object.freeze({ parentChannel: 3, reservedContext: 4, fence: 7 } as const),
  extensionApi2: Object.freeze({ context: 5, credential: 6 } as const),
} as const);

export type InheritedDescriptorRegistry = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Conservative union: no pair of spawn fragments is assumed forever disjoint.
 * Adding a fragment automatically checks it against every existing fragment.
 * Different schemas/purposes must not alias a descriptor, even if both are
 * called "context". Registry validation does not authorize FD inheritance.
 */
export function assertInheritedDescriptorRegistry(registry: InheritedDescriptorRegistry = INHERITED_DESCRIPTOR_LAYOUTS): void {
  if (!registry || typeof registry !== "object" || Array.isArray(registry) || !Object.keys(registry).length) {
    throw new Error("invalid_inherited_descriptor_registry");
  }
  const slots = new Map<number, string>();
  for (const [context, bindings] of Object.entries(registry)) {
    if (!context || !bindings || typeof bindings !== "object" || Array.isArray(bindings) || !Object.keys(bindings).length) {
      throw new Error("invalid_inherited_descriptor_layout");
    }
    for (const [purpose, slot] of Object.entries(bindings)) {
      if (!purpose || !Number.isSafeInteger(slot) || slot < 0 || slot > 255) throw new Error("invalid_inherited_descriptor_slot");
      const name = `${context}.${purpose}`, previous = slots.get(slot);
      if (previous !== undefined) throw new Error(`inherited_descriptor_collision: ${previous} and ${name} at ${slot}`);
      slots.set(slot, name);
    }
  }
}

assertInheritedDescriptorRegistry();
/** Mapping sources must be copied above every reserved target, not only the
 * highest currently populated role slot. Today the ceiling remains FD 7. */
export const MAX_INHERITED_DESCRIPTOR_SLOT = Math.max(...Object.values(INHERITED_DESCRIPTOR_LAYOUTS).flatMap(Object.values));
