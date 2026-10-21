import type { BudgetQuotaWindowSnapshot } from "./budget.js";

/** No cross-account aggregation: each window keeps its endpoint/session identity. */
export type ProviderQuotaReadWindow = Omit<BudgetQuotaWindowSnapshot, "metadata" | "createdAt"> & {
  ageMs: number;
  observationSource: string;
};
export type ProviderQuotaRead = {
  schema: "scout.provider-quotas/v1";
  generatedAt: number;
  availability: "available" | "unknown";
  /** A read never polls providers, repairs statuslines or opens a dashboard. */
  refresh: "not_requested" | "unsupported";
  windows: ProviderQuotaReadWindow[];
  coverage: { endpointsScanned: number; truncated: boolean };
};
