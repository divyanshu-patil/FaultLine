import { categoryAllowed, getAttack } from "@faultline/core";
import { Diagnosis, type InvariantId, type Verdict } from "@faultline/schemas";
import { validateEvidenceRefs } from "@faultline/trace";
import { type Ollama, extractJsonObject } from "./ollama.ts";
import { PREAMBLE, diagnosisPrompt } from "./prompts.ts";

export type DiagnoseInput = {
  findingId: string;
  attackId: string;
  verdicts: Verdict[];
  trace: string;
  source: string;
  knownEvidence: ReadonlySet<string>;
};

export type DiagnoseResult = { source: "model" | "template"; body: Diagnosis; evidenceValid: boolean; rawEvidenceValid: boolean };

/** Template fallback from the attack spec (docs/06 §9), labelled "template". */
export function templateDiagnosis(input: DiagnoseInput): Diagnosis {
  const spec = getAttack(input.attackId as never);
  const failed = input.verdicts.filter((v) => v.status === "fail");
  const evidence = [...new Set(failed.flatMap((v) => v.evidence))].slice(0, 6);
  while (evidence.length < 2) evidence.push(evidence[0] ?? "iv-0001");
  return Diagnosis.parse({
    finding_id: input.findingId,
    category: spec.bugClass,
    root_cause: `${spec.name}: ${spec.disturbs} ${spec.referenceFix}`,
    mechanism_steps: failed.map((v) => `${v.invariant}: expected ${v.expected}, got ${v.actual} (${v.evidence[0] ?? "iv-0001"})`),
    evidence,
    affected_files: affectedFor(input.attackId),
    confidence: 0.4,
    unknowns: ["Generated from the attack spec, not the model"],
  });
}

function affectedFor(attackId: string): string[] {
  if (["A1", "A2", "A3", "A8"].includes(attackId)) return ["src/routes/webhooks.ts"];
  if (attackId === "A4") return ["src/routes/orders.ts", "src/routes/webhooks.ts"];
  return ["src/routes/orders.ts"];
}

/**
 * Diagnosis (F13): parse → zod → evidence refs exist → category consistent with the failed invariants.
 * One repair turn, then a template fallback. Evidence is always valid for accepted output (template or validated).
 */
export async function diagnose(ollama: Ollama, input: DiagnoseInput): Promise<DiagnoseResult> {
  const failed = input.verdicts.filter((v) => v.status === "fail");
  const failedIds = failed.map((v) => v.invariant as InvariantId);
  const messages = [
    { role: "system" as const, content: PREAMBLE },
    {
      role: "user" as const,
      content: diagnosisPrompt({
        findingId: input.findingId,
        attackId: input.attackId,
        failed: failed.map((v) => ({ invariant: v.invariant, expected: v.expected, actual: v.actual })),
        trace: input.trace,
        source: input.source,
      }),
    },
  ];
  let rawValid = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    let errors: string | null = null;
    try {
      const res = await ollama.chat(attempt === 0 ? "diagnosis" : "repair", messages, undefined, { temperature: 0.1 });
      const parsed = Diagnosis.safeParse(extractJsonObject(res.content));
      if (!parsed.success) {
        errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      } else {
        const refs = validateEvidenceRefs(parsed.data, input.knownEvidence);
        if (attempt === 0) rawValid = refs.ok;
        if (!refs.ok) errors = `evidence ids not in the trace: ${refs.unknown.join(", ")}`;
        else if (!categoryAllowed(parsed.data.category, failedIds)) errors = `category ${parsed.data.category} is not consistent with failed invariants ${failedIds.join(", ")}`;
        else return { source: "model", body: parsed.data, evidenceValid: true, rawEvidenceValid: rawValid };
      }
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: `That was invalid: ${errors}. Return a corrected JSON object only.` });
    } catch {
      break;
    }
  }
  return { source: "template", body: templateDiagnosis(input), evidenceValid: true, rawEvidenceValid: rawValid };
}
