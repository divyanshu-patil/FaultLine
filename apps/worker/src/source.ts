import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBugList, renderVariant } from "@faultline/patch";

const FILES = ["src/routes/webhooks.ts", "src/routes/orders.ts", "src/db.ts"] as const;

function resolveFile(rel: string): string {
  return fileURLToPath(import.meta.resolve(`buggybeans/${rel}`));
}

export type RenderedSource = {
  files: Record<string, string>;
  excerpts: { srcId: string; file: string; text: string }[];
  knownSrcIds: Set<string>;
};

/** The victim store's source as deployed (rendered with the seeded bugs). This is what the AI is allowed to read. */
export function renderStoreSource(bugs: string): RenderedSource {
  const active = parseBugList(bugs);
  const files: Record<string, string> = {};
  const excerpts: { srcId: string; file: string; text: string }[] = [];
  const knownSrcIds = new Set<string>();
  FILES.forEach((rel, i) => {
    const rendered = renderVariant(readFileSync(resolveFile(rel), "utf8"), active);
    files[rel] = rendered;
    const srcId = `src-${String(i + 1).padStart(4, "0")}`;
    excerpts.push({ srcId, file: rel, text: rendered });
    knownSrcIds.add(srcId);
  });
  return { files, excerpts, knownSrcIds };
}
