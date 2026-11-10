/**
 * Adapter descriptors: what one external system looks like to Scout. DRAFT:
 * see docs/plans/interconnection-architecture.md.
 *
 * One adapter module per external system (Slack, Linear, GitHub). The module
 * ships a declarative descriptor and, where an API is odd, named code hooks.
 * The descriptor declares *what*: kinds, auth requirements, event
 * verification, and per stream the primary key, cursor field, deletion mode,
 * field maps, identity fields, audience and cross-adapter joins. The runtime's
 * normalizer owns *the rest*: dedup, change detection, cursors, tombstones and
 * sweeps, echo suppression, identity resolution, audience stamps and linking.
 *
 * Control flow does not go in the descriptor. A stage that needs logic names a
 * hook the module implements.
 */
import type { MetadataMap } from "./common.js";
import type { AdapterKind, ExternalObjectKind, ExternalObjectRef, SourceVisibility } from "./external-identity.js";
import type { ExternalEffectKind, ExternalErrorCategory } from "./interconnect-ledgers.js";
import type { TicketField, TicketStateCategory } from "./work-links.js";

export const ADAPTER_DESCRIPTOR_SCHEMA = "openscout.adapter-descriptor.v1" as const;

/** A JSONPath subset over the provider payload: `$.a.b`, `$.a[*].b`. */
export type FieldPath = string;

export type FieldTypecast = "string" | "number" | "boolean" | "timestamp_ms" | "markdown" | "string_array";

export type FieldMapping =
  | FieldPath
  | {
    from: FieldPath;
    /** Provider value to canonical value, StackOne `map_fields` style. Unmapped values fail the record into the health warnings. */
    enum?: Record<string, string>;
    typecast?: FieldTypecast;
    /** The value is a user id of this declared identity kind; the runtime resolves it to an `ExternalActor`. */
    identity?: string;
    default?: unknown;
  };

/** How the runtime turns an identity-bearing field into an `ExternalActor`. */
export interface AdapterIdentityKind {
  kind: string;
  /** Stable provider user id. Never a login or an email. */
  keyPath: FieldPath;
  enterpriseKeyPath?: FieldPath;
  displayNamePath: FieldPath;
  /** Candidate evidence only. An email string cannot establish a link. */
  emailPath?: FieldPath;
  /** Provider marker for bots and apps, mapped to an actor type. */
  actorType?: { path: FieldPath; map: Record<string, "human" | "foreign_agent" | "integration"> };
  membership?: { path: FieldPath; map: Record<string, "member" | "guest" | "external_shared"> };
}

/**
 * When an inbound event counts as addressed to Scout. Anything that matches
 * no rule is ambient: observed, never routed.
 */
export type AddressingRule =
  | { kind: "mention_of_app"; path: FieldPath }
  | { kind: "direct_message"; path: FieldPath; value: string }
  | { kind: "slash_command" }
  | { kind: "bound_thread_reply"; threadPath: FieldPath }
  | { kind: "delegation"; path: FieldPath }
  | { kind: "agent_session_prompt"; path: FieldPath };

export type DeletionMode = "tombstone_event" | "full_sweep" | "flag_field" | "none";

export interface AdapterStream {
  name: string;
  kind: AdapterKind;
  objectKind: ExternalObjectKind;
  /** One path, or several for a composite id (Slack `channel` + `ts`). */
  primaryKey: FieldPath | FieldPath[];
  containerPath?: FieldPath;
  cursor: {
    mode: "updated_at" | "opaque_token" | "event_only";
    field?: FieldPath;
    sinceParam?: string;
  };
  syncModes: Array<"incremental" | "full" | "webhook">;
  deletion: {
    mode: DeletionMode;
    flagPath?: FieldPath;
    /** Hold a full run that would delete more than `ratio` of records, once at least `minimum` would go. */
    massDeleteHold?: { ratio: number; minimum: number };
  };
  /** Volatile fields that must not trigger an update. */
  hashExclude?: FieldPath[];
  revisionPath?: FieldPath;
  remoteUpdatedAtPath?: FieldPath;
  /** Canonical field name to provider mapping. Ticket streams map onto `TicketField` names. */
  fields: Record<string, FieldMapping>;
  /** Ticket streams: provider workflow state to category, validated against live workflow metadata. */
  stateCategories?: { path: FieldPath; map: Record<string, TicketStateCategory> };
  audience?: { containerPath: FieldPath; visibility: SourceVisibility | { path: FieldPath; map: Record<string, SourceVisibility> } };
  /** The same object reachable through another adapter. The normalizer keeps one copy. */
  sameAs?: Array<{ adapterId: string; objectKind: ExternalObjectKind; keyPaths: FieldPath[]; originalWhenPath?: FieldPath }>;
  addressing?: AddressingRule[];
  /** Named code hooks the module implements: `fetch`, `normalize`, `paginate`. */
  hooks?: Partial<Record<"fetch" | "normalize" | "paginate", string>>;
}

export interface AdapterCapabilities {
  /** Ticket fields this backend can own. The UI hides ownership choices it does not declare. */
  ownableFields: TicketField[];
  writes: ExternalEffectKind[];
  /** Tracker-native agent surfaces (Linear: agent sessions, activities, plan, delegate, elicitation signals). */
  agentNative: Array<"agent_session" | "activity" | "plan" | "delegate" | "elicitation_select" | "elicitation_auth" | "session_summary" | "external_links" | "present_as">;
  routingRuleKinds: Array<"comment_command" | "label" | "state_lane" | "user_mapping" | "default_route">;
  /** Where to read whether the tracker itself moves states on pull request events. */
  trackerAutomation?: { prDrivenStateMovesPath: FieldPath };
}

export interface AdapterDescriptor {
  schema: typeof ADAPTER_DESCRIPTOR_SCHEMA;
  adapterId: string;
  /** `YYYYMMDD_NN`. Connections pin a version. */
  version: string;
  displayName: string;
  kinds: AdapterKind[];
  /** Borrow auth and proxy from a vendor; Scout's normalizer and ledgers stay. */
  transport: "native" | "nango" | "composio";
  auth: {
    mode: "oauth2" | "app_installation" | "bot_token" | "api_key";
    actor: "app" | "user";
    scopes: string[];
    /** A missing scope returns an authorization URL instead of failing. */
    justInTime?: boolean;
  };
  events?: {
    delivery: "webhook" | "socket" | "poll_only";
    verification: "hmac_sha256" | "slack_signing_v0" | "none";
    eventIdPath: FieldPath;
    eventTypePath: FieldPath;
    timestampPath?: FieldPath;
    toleranceMs?: number;
    ackDeadlineMs: number;
    /** Provider retry behavior, for reconciliation planning. */
    retries?: string;
  };
  identity: AdapterIdentityKind[];
  streams: AdapterStream[];
  capabilities: AdapterCapabilities;
  echo: {
    marker: "message_metadata" | "body_marker" | "external_link" | "attachment";
    markerPath?: FieldPath;
    /** Path to the author id compared against the connection's app actor. */
    authorPath?: FieldPath;
  };
  errors: Array<{ match: { status?: number; code?: string }; category: ExternalErrorCategory; retryAfterHeader?: string }>;
  rateLimit?: { requestsPerHour?: number; perContainerPerSecond?: number; retryAfterHeader?: string };
}

// ---------------------------------------------------------------------------
// The module contract: what an adapter returns and what the runtime asks of it.

export interface NormalizedRecordInput {
  remoteId: string;
  containerId?: string;
  fields: MetadataMap;
  raw?: unknown;
  remoteUpdatedAt?: number;
  revision?: string;
}

export interface AdapterReadPage {
  stream: string;
  records: NormalizedRecordInput[];
  /** Explicit deletes from an incremental source. */
  tombstones: string[];
  cursor?: string;
  /** True on the last page of a run. A full-run sweep runs only after a complete, clean run. */
  complete: boolean;
}

export interface AdapterWriteRequest {
  deliveryId: string;
  idempotencyKey: string;
  effect: ExternalEffectKind;
  destination: { containerId?: string; threadId?: string; object?: ExternalObjectRef };
  payload: MetadataMap;
  marker: { kind: "scout_delivery"; deliveryId: string; workId?: string };
  presentAs?: { name: string; iconUrl?: string };
}

/** `uncertain` means the provider may have applied it. The runtime reconciles by marker; it never blindly retries. */
export interface AdapterWriteResult {
  outcome: "applied" | "uncertain" | "rejected";
  providerRef?: { id?: string; ts?: string; url?: string };
  error?: { category: ExternalErrorCategory; message?: string; retryAfterMs?: number };
}

// ---------------------------------------------------------------------------
// Validation

const VERSION = /^\d{8}_\d{2}$/;
const TICKET_FIELD_NAMES = new Set<string>(["title", "summary", "priority", "labels", "state", "ownerId", "relations", "parentId"]);

function mappingPath(mapping: FieldMapping): FieldPath {
  return typeof mapping === "string" ? mapping : mapping.from;
}

function checkPath(path: FieldPath | undefined, where: string, errors: string[]): void {
  if (path !== undefined && !path.startsWith("$")) errors.push(`${where}: path ${path} must start with $`);
}

export function validateAdapterDescriptor(doc: AdapterDescriptor): string[] {
  const errors: string[] = [];
  if (doc.schema !== ADAPTER_DESCRIPTOR_SCHEMA) errors.push(`schema must be ${ADAPTER_DESCRIPTOR_SCHEMA}`);
  if (!doc.adapterId?.trim()) errors.push("adapterId is required");
  if (!VERSION.test(doc.version ?? "")) errors.push("version must be YYYYMMDD_NN");
  if (!doc.kinds?.length) errors.push("at least one kind is required");
  const identityKinds = new Set(doc.identity.map((kind) => kind.kind));
  for (const kind of doc.identity) {
    checkPath(kind.keyPath, `identity ${kind.kind}`, errors);
    checkPath(kind.displayNamePath, `identity ${kind.kind}`, errors);
  }
  if (doc.events) {
    checkPath(doc.events.eventIdPath, "events", errors);
    if (doc.events.delivery !== "poll_only" && doc.events.verification === "none") {
      errors.push("events: pushed events need a verification scheme, or declare poll_only");
    }
  }
  const names = new Set<string>();
  for (const stream of doc.streams) {
    const where = `stream ${stream.name}`;
    if (names.has(stream.name)) errors.push(`${where}: duplicate stream name`);
    names.add(stream.name);
    if (!doc.kinds.includes(stream.kind)) errors.push(`${where}: kind ${stream.kind} is not declared by the adapter`);
    const keys = Array.isArray(stream.primaryKey) ? stream.primaryKey : [stream.primaryKey];
    if (keys.length === 0) errors.push(`${where}: primaryKey is required`);
    for (const key of keys) checkPath(key, where, errors);
    if (stream.cursor.mode === "updated_at" && !stream.cursor.field) errors.push(`${where}: an updated_at cursor needs a field`);
    checkPath(stream.cursor.field, where, errors);
    if (stream.deletion.mode === "flag_field" && !stream.deletion.flagPath) errors.push(`${where}: flag_field deletion needs flagPath`);
    if (stream.deletion.mode === "full_sweep") {
      if (!stream.syncModes.includes("full")) errors.push(`${where}: full_sweep deletion needs a full sync mode`);
      if (!stream.deletion.massDeleteHold) errors.push(`${where}: full_sweep deletion needs a massDeleteHold`);
    }
    const hold = stream.deletion.massDeleteHold;
    if (hold && !(hold.ratio > 0 && hold.ratio <= 1 && hold.minimum >= 1)) errors.push(`${where}: massDeleteHold needs 0 < ratio <= 1 and minimum >= 1`);
    for (const [field, mapping] of Object.entries(stream.fields)) {
      checkPath(mappingPath(mapping), `${where}.${field}`, errors);
      if (typeof mapping !== "string" && mapping.identity && !identityKinds.has(mapping.identity)) {
        errors.push(`${where}.${field}: identity kind ${mapping.identity} is not declared`);
      }
      if (stream.kind === "ticket" && stream.objectKind === "ticket" && !TICKET_FIELD_NAMES.has(field) && !field.startsWith("x_")) {
        errors.push(`${where}.${field}: ticket fields map onto TicketField names, or use an x_ extension name`);
      }
    }
    for (const field of doc.capabilities.ownableFields) {
      if (stream.kind === "ticket" && stream.objectKind === "ticket" && !(field in stream.fields)) {
        errors.push(`${where}: ownable field ${field} has no mapping`);
      }
    }
    if (stream.kind === "ticket" && stream.objectKind === "ticket" && !stream.stateCategories) {
      errors.push(`${where}: ticket streams map workflow states to categories`);
    }
    if (stream.kind === "channel" && stream.objectKind === "message" && !stream.addressing?.length) {
      errors.push(`${where}: message streams declare addressing rules; everything else is ambient`);
    }
  }
  return errors;
}
