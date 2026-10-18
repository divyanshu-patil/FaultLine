import { extractDiff } from "@faultline/patch";
import type { Ollama } from "./ollama.ts";
import { PREAMBLE, patchPrompt } from "./prompts.ts";

export type ProposeInput = {
  diagnosis: string;
  files: { path: string; content: string }[];
  previous?: string;
};

/** Patch proposal (F14, step 1): ask for a unified diff. Guard/apply/verify happen in the worker via @faultline/patch. */
export async function proposePatch(ollama: Ollama, input: ProposeInput): Promise<string> {
  const res = await ollama.chat("patch", [
    { role: "system", content: PREAMBLE },
    { role: "user", content: patchPrompt(input) },
  ], undefined, { temperature: 0.1 });
  return extractDiff(res.content);
}
