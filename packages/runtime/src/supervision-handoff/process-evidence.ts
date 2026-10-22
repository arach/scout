import { HandoffStore } from "./store.js";
import { refuse, type SelectedInstance } from "./contracts.js";
import { sampleDarwinProcess } from "./process-sampling.js";
import { nativeDarwinProcessSource } from "./darwin-process-source.js";

/** Diagnostic evidence, not an ExactChild, exit proof or stable process handle. */
export type ProcessSample = { format: "darwin-bsd-process/1"; instance: SelectedInstance;
  pid: number; uid: number; bootSession: string; startSeconds: string; startMicroseconds: string; executable: string };
export type ProcessSampleResult = { state: "sampled"; sample: ProcessSample } | { state: "pid_absent"; pid: number }
  | { state: "unavailable"; reason: "unsupported_platform" | "native_binding_unavailable" | "boot_session_unavailable"
    | "permission_denied" | "native_probe_failed" | "incomplete_native_read" | "invalid_native_identity" | "identity_changed" | "foreign_uid" };
export type ProcessComparison = { state: "same_sample" | "different_sample" } | Exclude<ProcessSampleResult, { state: "sampled" }>;
export interface ProcessEvidenceReader {
  sample(pid: number): ProcessSampleResult;
  compare(recorded: ProcessSample): ProcessComparison;
}

/** Explicit read-only selection. Import/construction does not open a native
 * library, read a process, create custody files or change readiness. */
export function createProcessEvidenceReader(instance: SelectedInstance): ProcessEvidenceReader {
  const selected = Object.freeze({ uid: instance.uid, id: instance.id, supportDirectory: instance.supportDirectory });
  // Reuse the custody selection boundary; the constructor creates no files.
  const validate = () => { new HandoffStore(selected); };
  validate();
  const sample = (pid: number): ProcessSampleResult => {
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff) refuse("invalid_process_id");
    validate();
    let result: ProcessSampleResult;
    if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) {
      result = { state: "unavailable", reason: "unsupported_platform" };
    } else {
      let source;
      try { source = nativeDarwinProcessSource(); }
      catch { return { state: "unavailable", reason: "native_binding_unavailable" }; }
      result = sampleDarwinProcess(selected, pid, source);
    }
    validate();
    return result;
  };
  return {
    sample,
    compare(recorded) {
      if (recorded.format !== "darwin-bsd-process/1" || recorded.instance.uid !== selected.uid
        || recorded.instance.id !== selected.id || recorded.instance.supportDirectory !== selected.supportDirectory) refuse("wrong_instance");
      const current = sample(recorded.pid);
      if (current.state !== "sampled") return current;
      const fields = ["format", "pid", "uid", "bootSession", "startSeconds", "startMicroseconds", "executable"] as const;
      return { state: fields.every(field => current.sample[field] === recorded[field]) ? "same_sample" : "different_sample" };
    },
  };
}
