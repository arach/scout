export const PRESSURE_DRAIN_BYTES = 4096;
export const PRESSURE_PRIMER_LIMIT = 1024 * 1024;
/** Witness-only, bounded raw writes while the child is causally forbidden to
 * read. Measure capacity by EAGAIN; never assume a platform's pipe size. */
export function prefillForWriteAbort(write: (bytes: Uint8Array) => number) {
  const primer = Buffer.alloc(PRESSURE_DRAIN_BYTES, "p");
  let bytes = 0, calls = 0;
  while (bytes < PRESSURE_PRIMER_LIMIT && calls < PRESSURE_PRIMER_LIMIT / PRESSURE_DRAIN_BYTES + 64) {
    calls++;
    try {
      const part = primer.subarray(0, Math.min(primer.length, PRESSURE_PRIMER_LIMIT - bytes));
      const n = write(part);
      if (!Number.isInteger(n) || n <= 0 || n > part.length) throw Error("invalid pressure write result");
      bytes += n;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EINTR") continue;
      if (code !== "EAGAIN" && code !== "EWOULDBLOCK") throw error;
      if (bytes < PRESSURE_DRAIN_BYTES) throw Error("pressure pipe cannot supply the drain quota");
      return {bytes, calls};
    }
  }
  throw Error("pressure fill did not reach EAGAIN within the bounded primer");
}
