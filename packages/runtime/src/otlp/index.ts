export { startOtlpReceiver, type OtlpReceiverOptions } from "./receiver.js";
export { DEFAULT_OTLP_PORT, OTLP_HOST, otlpPaths, otlpDefaults, resolveOtlpPort, type OtlpLimits } from "./config.js";
export type { OtlpObservation, OtlpSignal } from "./sanitize.js";
// the wire codec alone (strict JSON + protobuf decode, no sanitizing): for receivers that keep their own policy
export { decodeOtlpRequest, encodeOtlpResponse, OtlpDecodeError, type OtlpEncoding } from "./codec.js";
