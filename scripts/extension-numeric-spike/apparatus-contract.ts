/** Side-effect-free labels shared by proof processes and unit-test discovery. */
export type ApparatusControl = "suppressed-close" | "occupied-parent" | "above-frontier-churn" | "released-guard" | "reservation-stale-close" | "retained-setup-pin" | "low-prefix-interference" | "compile-residue";
export const APPARATUS_MESSAGES = {
  "low-prefix-interference": "channel reservation prefix changed",
  "compile-residue": "channel reservation prefix changed",
  "suppressed-close": "former pipe number was not reclaimed",
  "occupied-parent": "second spawn did not reuse a former descriptor number",
  "released-guard": "channel reservation placement failed",
  "reservation-stale-close": "replacement spawn descriptor lost",
  "retained-setup-pin": "native subprocess collection was not observed within 64 GC rounds",
} as const;
