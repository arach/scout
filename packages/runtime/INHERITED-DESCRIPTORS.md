# Inherited descriptor targets

`src/inherited-descriptors.ts` is the single source of child-side descriptor
numbers. `INHERITED_DESCRIPTOR_LAYOUTS` has one shared stdio fragment and two
spawn-context fragments. Every fragment is compatible with the conservative
union, including a provider/role-worker overlap at the pairing boundary:

| Fragment | Purpose | Child slot | State |
| --- | --- | ---: | --- |
| stdio | stdin | 0 | Standard process ABI |
| stdio | stdout | 1 | Standard process ABI |
| stdio | stderr | 2 | Standard process ABI |
| roleCustody | parentChannel | 3 | Existing SDK-owned EOF parent channel |
| roleCustody | reservedContext | 4 | Reserved, ignored by current workers |
| extensionApi2 | context | 5 | API-2 context-only loader target |
| extensionApi2 | credential | 6 | Reserved only; credential transport comes last |
| roleCustody | fence | 7 | Existing anchored role lifetime fence |

## Compatibility decision

Do not unify two different context schemas merely because both are named
context. Keep the shipped `role-custody/1` values **3, 4, 7** unchanged. Replace
the unimplemented extension proposal's 3/4 allocation with **5/6**, using its
previously unused padding. No released API-1 provider receives an extra channel.
No current carrier inherits context or credential data: slots 4, 5 and 6 remain
ignored in that spawn. The reserved role-context schema remains unimplemented.

All source bindings come from the registry, not a second literal table.
`supervision-handoff/carrier-layout.ts` derives the existing `CARRIER_LAYOUT`
view from it, preserving that module's path, ID, keys and values. `carrierStdio`
builds the actual worker mapping from the view; `DirectChildren` calls it.
`mappingCopy` uses `MAX_INHERITED_DESCRIPTOR_SLOT` so borrowed mapping sources
are copied above every reserved target. The ceiling remains 7 today. This does
not change descriptor ownership, CLOEXEC, FFI/backend gates or fence authority.
Parent-side numeric mapping sources must be CLOEXEC-marked copies duplicated
above `MAX_INHERITED_DESCRIPTOR_SLOT`, as the carrier layout already does.

The registry is pure and deeply frozen. `assertInheritedDescriptorRegistry`
checks every pair implicitly, both populated and reserved purposes, on import
and in tests. A new fragment cannot escape checking by forgetting to declare
an overlap edge. Every slot must be an integer in 0–255, and no slot can have
two meanings anywhere in the union. Stdio is represented once rather than
repeated in every spawn layout. This is deliberately stricter than relying on
a promise that two spawn contexts will remain disjoint.

The registry covers fixed inherited **target slots**, not the dynamically
allocated numeric source descriptors that an OS open/pipe/dup returns, and not
an inventory of all open files in a process. Existing general-purpose child
stdio with only 0–2 is the shared standard fragment. Runtime worker IPC or new
extra inherited channels must add a reviewed fragment rather than relying on
an implicit runtime-chosen extra slot.

## E1 consumption and release boundary

E1's context-only runner must import this pure module, select the extension
context slot from `INHERITED_DESCRIPTOR_LAYOUTS.extensionApi2.context`, and
leave the credential slot unused. The later credential slice must select
`extensionApi2.credential`; it must not allocate a new literal 3/4 layout.
Both channels must close before a provider calls a launcher or starts a child.
Do not forward worker parent/fence descriptors or arbitrary parent FDs.

The dedicated public subpath `@openscout/runtime/inherited-descriptors` exports
this pure registry with Bun-source, built-ESM and declaration targets. Its
presence in a packed artifact must be verified; a source export alone is not a
released package capability. Internal SDK imports remain relative. The CLI's
context-only slice uses the extension target, without importing custody or
changing the API-1 runner's transport. See
[the invocation contract](../../docs/extension-context.md). No credential channel
is enabled by this registry or the context-only slice.

The test restores the former extension 3/4 proposal and requires a collision,
checks each worker slot against extension channels, and inserts a new fragment
without a hand-maintained overlap list. Removing the collision guard makes the
negative case fail. The carrier mapping test checks the actual shared helper;
existing native custody tests retain the parent-pipe/fence witnesses on their
audited backend. Fable reviews this registry shape before merge.
