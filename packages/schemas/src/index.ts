import { z } from "zod";

// ---------- identifiers ----------

export const AttackId = z.enum(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
export type AttackId = z.infer<typeof AttackId>;

export const InvariantId = z.enum(["I1", "I2", "I3", "I4", "I5", "I6", "I7"]);
export type InvariantId = z.infer<typeof InvariantId>;

export const BugId = z.enum(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]);
export type BugId = z.infer<typeof BugId>;

export const DiagnosisCategory = z.enum([
  "missing_dedupe",
  "ordering",
  "no_signature_check",
  "capture_retry",
  "client_amount_trusted",
  "fulfil_without_capture",
  "decline_handled_as_success",
  "webhook_only_fulfilment",
  "other",
]);
export type DiagnosisCategory = z.infer<typeof DiagnosisCategory>;

export const EVIDENCE_PREFIXES = ["pc", "wh", "wf", "br", "st", "tr", "iv", "src"] as const;
export type EvidencePrefix = (typeof EVIDENCE_PREFIXES)[number];
export const EVIDENCE_ID_RE = /\b(?:pc|wh|wf|br|st|tr|iv|src)-\d{4}\b/g;
export const EvidenceId = z.string().regex(/^(pc|wh|wf|br|st|tr|iv|src)-\d{4}$/, "evidence id like pc-0007");
export type EvidenceId = z.infer<typeof EvidenceId>;

export const PayPalEventType = z.enum([
  "CHECKOUT.ORDER.APPROVED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.CAPTURE.PENDING",
]);
export type PayPalEventType = z.infer<typeof PayPalEventType>;

// ---------- probe contract (docs/09 §3) ----------

export const OrderStatus = z.enum(["created", "approved", "pending_capture", "paid", "fulfilled", "failed", "abandoned"]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ProbeOrder = z.object({
  storeOrderId: z.string(),
  paypalOrderId: z.string().nullable(),
  sku: z.string(),
  qty: z.number().int().positive(),
  status: OrderStatus,
  captureId: z.string().nullable(),
  amount: z.string(),
  currency: z.string(),
  updatedAt: z.string(),
});
export type ProbeOrder = z.infer<typeof ProbeOrder>;

export const ProbeEntitlement = z.object({
  storeOrderId: z.string(),
  credits: z.number().int(),
  source: z.enum(["webhook", "capture", "fulfil"]),
  grantedAt: z.string(),
  ref: z.string().nullable(),
});
export type ProbeEntitlement = z.infer<typeof ProbeEntitlement>;

export const ProbeWebhookEvent = z.object({
  eventId: z.string(),
  type: z.string(),
  receivedAt: z.string(),
  outcome: z.enum(["processed", "ignored", "rejected"]),
});

export const ProbeState = z.object({
  storeTime: z.string(),
  orders: z.array(ProbeOrder),
  entitlements: z.array(ProbeEntitlement),
  webhookEvents: z.array(ProbeWebhookEvent),
});
export type ProbeState = z.infer<typeof ProbeState>;

export const CatalogItem = z.object({
  sku: z.string(),
  name: z.string(),
  price: z.string().regex(/^\d+\.\d{2}$/),
  currency: z.literal("USD"),
  creditsPerItem: z.number().int().positive(),
});
export type CatalogItem = z.infer<typeof CatalogItem>;

// ---------- proxy rules (docs/09 §2) ----------

const RuleMatch = z.object({ eventType: PayPalEventType.optional() });

export const WebhookRule = z.discriminatedUnion("action", [
  z.object({ match: RuleMatch, action: z.literal("pass") }),
  z.object({
    match: RuleMatch,
    action: z.literal("duplicate"),
    times: z.number().int().min(2).max(5),
    gapMs: z.number().int().min(0).max(10_000),
  }),
  z.object({ match: RuleMatch, action: z.literal("delay"), ms: z.number().int().min(0).max(60_000) }),
  // hold the matching event until an event of `until` type for the same order has been forwarded
  z.object({ match: RuleMatch, action: z.literal("hold_until"), until: PayPalEventType }),
  z.object({ match: RuleMatch, action: z.literal("drop") }),
]);
export type WebhookRule = z.infer<typeof WebhookRule>;

export const FaultRule = z.object({
  match: z.object({
    method: z.enum(["GET", "POST"]),
    pathPattern: z.string(), // e.g. "/v2/checkout/orders/*/capture"
    occurrence: z.number().int().positive().optional(),
  }),
  fault: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("timeout_after_forward"), ms: z.number().int().min(0).max(30_000) }),
    z.object({ kind: z.literal("error_before_forward"), status: z.number().int().min(400).max(599) }),
    z.object({ kind: z.literal("negative_test"), code: z.string().regex(/^[A-Z_]+$/) }),
    z.object({ kind: z.literal("latency"), ms: z.number().int().min(0).max(30_000) }),
  ]),
});
export type FaultRule = z.infer<typeof FaultRule>;

// ---------- attack spec (docs/05 §1) ----------

export const AttackSpec = z.object({
  id: AttackId,
  name: z.string(),
  priority: z.enum(["must", "should", "could"]),
  bugClass: DiagnosisCategory,
  disturbs: z.string(),
  buyer: z.object({
    sku: z.string(),
    qty: z.number().int().positive(),
    approve: z.boolean(),
    tamperAmount: z.string().optional(),
    skipCapture: z.boolean().optional(),
    callFulfil: z.boolean().optional(),
  }),
  webhookRules: z.array(WebhookRule),
  faultRules: z.array(FaultRule),
  forge: z.boolean().optional(),
  expectedDeliveries: z.array(PayPalEventType),
  invariants: z.array(InvariantId).min(1),
  realVsSimulated: z.string(),
  referenceFix: z.string(),
});
export type AttackSpec = z.infer<typeof AttackSpec>;

// ---------- verdicts and findings ----------

export const VerdictStatus = z.enum(["pass", "fail", "not_applicable"]);
export type VerdictStatus = z.infer<typeof VerdictStatus>;

export const Verdict = z.object({
  invariant: InvariantId,
  status: VerdictStatus,
  expected: z.string(),
  actual: z.string(),
  evidence: z.array(z.string()),
});
export type Verdict = z.infer<typeof Verdict>;

// ---------- agent contracts (docs/06 §7) ----------

export const SuspectQuestion = z.enum(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]);
export type SuspectQuestion = z.infer<typeof SuspectQuestion>;

export const Suspect = z.object({
  q: SuspectQuestion,
  likely_bug: z.boolean(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().regex(/^src-\d{4}$/)).min(1),
  reason: z.string().max(400),
});
export type Suspect = z.infer<typeof Suspect>;

export const ReconOutput = z.object({ suspects: z.array(Suspect).length(8) });
export type ReconOutput = z.infer<typeof ReconOutput>;

export const PlannerAction = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("run_attack"), args: z.object({ attack_id: AttackId, reason: z.string().max(400) }) }),
  z.object({
    tool: z.literal("read_source"),
    args: z.object({
      file: z.string(),
      from_line: z.number().int().positive().optional(),
      to_line: z.number().int().positive().optional(),
    }),
  }),
  z.object({ tool: z.literal("inspect_evidence"), args: z.object({ ids: z.array(EvidenceId).min(1).max(10) }) }),
  z.object({ tool: z.literal("diagnose_finding"), args: z.object({ finding_id: z.string() }) }),
  z.object({ tool: z.literal("propose_and_verify_patch"), args: z.object({ finding_id: z.string() }) }),
  z.object({ tool: z.literal("finish"), args: z.object({ summary: z.string().max(800) }) }),
]);
export type PlannerAction = z.infer<typeof PlannerAction>;
export type ToolName = PlannerAction["tool"];

export const Diagnosis = z.object({
  finding_id: z.string(),
  category: DiagnosisCategory,
  root_cause: z.string().min(10).max(600),
  mechanism_steps: z.array(z.string().max(400)).min(1).max(8),
  evidence: z.array(EvidenceId).min(2),
  affected_files: z.array(z.string()).min(1).max(4),
  confidence: z.number().min(0).max(1),
  unknowns: z.array(z.string().max(300)).max(5),
});
export type Diagnosis = z.infer<typeof Diagnosis>;

// ---------- API DTOs (docs/09 §1) ----------

export const Budget = z.object({
  maxSteps: z.number().int().min(1).max(40),
  maxAttacks: z.number().int().min(1).max(16),
  maxPatchAttempts: z.number().int().min(0).max(3),
  maxModelCalls: z.number().int().min(1).max(80),
  maxSeconds: z.number().int().min(60).max(1800),
});
export type Budget = z.infer<typeof Budget>;

export const RunMode = z.enum(["agent", "checklist"]);
export type RunMode = z.infer<typeof RunMode>;

export const CreateSessionBody = z.object({ code: z.string().min(1).max(200) });

export const CreateRunBody = z.object({
  targetId: z.string().min(1).max(100),
  mode: RunMode,
  attacks: z.array(AttackId).min(1).max(8).optional(),
  budget: Budget.partial().optional(),
});
export type CreateRunBody = z.infer<typeof CreateRunBody>;

export const CustomTargetBody = z.object({ bugs: z.array(BugId).min(1).max(8) });

export const RunStatus = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Phase = z.enum([
  "queued",
  "preparing",
  "recon",
  "attacking",
  "diagnosing",
  "patching",
  "verifying",
  "reporting",
  "done",
]);
export type Phase = z.infer<typeof Phase>;

export const PatchStatus = z.enum(["rejected", "build_failed", "verified", "not_fixed", "regressed"]);
export type PatchStatus = z.infer<typeof PatchStatus>;

// ---------- run events (SSE payloads) ----------

export const RunEventKind = z.enum([
  "phase",
  "agent_step",
  "suspects",
  "attack_started",
  "trace",
  "attack_finished",
  "verdict",
  "finding",
  "diagnosis",
  "patch",
  "buyer_action",
  "degraded",
  "error",
  "info",
]);
export type RunEventKind = z.infer<typeof RunEventKind>;

export const RunEvent = z.object({
  id: z.number().int(),
  kind: RunEventKind,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
});
export type ApiError = z.infer<typeof ApiError>;

export { z };
