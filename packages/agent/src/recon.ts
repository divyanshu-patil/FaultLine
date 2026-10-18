import { ReconOutput, type Suspect, type SuspectQuestion } from "@faultline/schemas";
import { type ChatMessage, type Ollama, extractJsonObject } from "./ollama.ts";
import { QUESTION_ATTACK, reconPrompt, PREAMBLE } from "./prompts.ts";

export type SourceExcerpt = { srcId: string; file: string; text: string };

const QS: SuspectQuestion[] = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"];

/** Fallback (docs/06 §9): every question likely at 0.5 so the planner still works. */
export function defaultSuspects(): Suspect[] {
  return QS.map((q) => ({ q, likely_bug: true, confidence: 0.5, evidence: ["src-0001"], reason: "recon unavailable; assuming a bug is possible" }));
}

export function withAttacks(suspects: Suspect[]): (Suspect & { attack: string })[] {
  return suspects.map((s) => ({ ...s, attack: QUESTION_ATTACK[s.q] }));
}

function wrapSource(excerpts: SourceExcerpt[]): string {
  return excerpts.map((e) => `<untrusted_source id="${e.srcId}" file="${e.file}">\n${e.text}\n</untrusted_source>`).join("\n\n");
}

/**
 * Recon (F11): ask the fixed suspect questions over the rendered source and parse the answer. On two invalid
 * attempts, return default suspects. `knownSrcIds` gates evidence to ids the model was actually shown.
 */
export async function recon(ollama: Ollama, excerpts: SourceExcerpt[], knownSrcIds: ReadonlySet<string>): Promise<{ suspects: Suspect[]; source: "model" | "default" }> {
  const messages: ChatMessage[] = [
    { role: "system" as const, content: PREAMBLE },
    { role: "user" as const, content: reconPrompt(wrapSource(excerpts)) },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await ollama.chat("recon", messages, undefined, { temperature: 0, num_predict: 2000 });
      const parsed = ReconOutput.safeParse(extractJsonObject(res.content));
      if (parsed.success) {
        const byQ = new Map(parsed.data.suspects.map((s) => [s.q, s]));
        if (QS.every((q) => byQ.has(q))) {
          const suspects = QS.map((q) => {
            const s = byQ.get(q)!;
            return { ...s, evidence: s.evidence.filter((id) => knownSrcIds.has(id)) };
          });
          return { suspects, source: "model" };
        }
      }
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: "That was invalid. Return exactly the JSON object with all eight questions Q1..Q8." });
    } catch {
      break;
    }
  }
  return { suspects: defaultSuspects(), source: "default" };
}
