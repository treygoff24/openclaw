export type VerificationArtifact = {
  /** Path to expected output file (relative to workspace or absolute). */
  path: string;
  /** Validate file is valid JSON. */
  json?: boolean;
  /** If json=true, validate top-level is array with min items. */
  minItems?: number;
  /** If json=true, validate each item has these keys. */
  requiredKeys?: string[];
  /** Minimum file size in bytes (catches empty/stub files). */
  minBytes?: number;
};

export type VerificationContract = {
  /** List of expected output artifacts */
  artifacts?: VerificationArtifact[];
  /** If true, require the subagent's final tool call to be report_completion */
  requireCompletionReport?: boolean;
  /** Action on verification failure */
  onFailure?: "retry_once" | "escalate" | "fail";
  /** Timeout for verification checks (default: 30s) */
  verificationTimeoutMs?: number;
};

export type VerificationCheckType = "artifact" | "completion_report";

export type VerificationCheckResult = {
  type: VerificationCheckType;
  target?: string;
  passed: boolean;
  reason?: string;
};

export type VerificationResult = {
  status: "passed" | "failed" | "skipped";
  checks: VerificationCheckResult[];
  verifiedAt: number;
};
