import { applyPatch, changedLineCount, parseUnifiedDiff, type FilePatch } from "./diff.ts";

/** Files a patch may touch at all (docs/12 §5 rule 2). */
export const PATCHABLE_FILES = ["src/routes/orders.ts", "src/routes/webhooks.ts", "src/db.ts", "public/checkout.js"];
export const MAX_CHANGED_LINES = 120;
const ALLOWED_IMPORTS = new Set(["express", "zod", "node:crypto", "node:sqlite"]);

const FORBIDDEN: [RegExp, string][] = [
  [/child_process/, "child_process"],
  [/\bexec(Sync)?\s*\(/, "exec("],
  [/\bspawn(Sync)?\s*\(/, "spawn("],
  [/\beval\s*\(/, "eval("],
  [/\bnew\s+Function\b|\bFunction\s*\(/, "Function constructor"],
  [/\brequire\s*\(/, "require("],
  [/process\.env\.\w+\s*=[^=]|process\.env\[[^\]]+\]\s*=[^=]/, "process.env assignment"],
  [/process\.env\b/, "new process.env read"],
  [/\bfs\.|node:fs|from\s+["']fs["']/, "filesystem access"],
  [/\bnet\.|node:net|\bdgram\b/, "raw sockets"],
  [/\bhttps?\.request\s*\(/, "http.request"],
  [/fetch\s*\(\s*["'`]https?:/, "fetch to a literal host"],
  [/__crashtest/, "probe route edit"],
  [/\bBUGS\b|\bflags\.(B\d|INJECT)\b/, "bug switches"],
  [/\bprocess\.(exit|kill)\b/, "process control"],
];

export type GuardResult = { passed: boolean; reasons: string[]; files: Record<string, string> | null; patches: FilePatch[] };

/**
 * Patch guard (docs/12 §5). All rules must pass. `affected` comes from the diagnosis; `files` is the rendered
 * variant source the model was shown.
 */
export function guardPatch(diffText: string, files: Record<string, string>, affected: string[]): GuardResult {
  const reasons: string[] = [];
  let patches: FilePatch[] = [];
  try {
    patches = parseUnifiedDiff(diffText);
  } catch (e) {
    return { passed: false, reasons: [`diff does not parse: ${(e as Error).message}`], files: null, patches };
  }
  const allowedHere = new Set([...affected.filter((f) => PATCHABLE_FILES.includes(f)), "src/db.ts"]);
  for (const p of patches) {
    if (!PATCHABLE_FILES.includes(p.path)) reasons.push(`file not allowed: ${p.path}`);
    else if (!allowedHere.has(p.path)) reasons.push(`file not in the diagnosis' affected files: ${p.path}`);
    if (p.isNew || p.isDeleted) reasons.push(`creating or deleting files is not allowed: ${p.path}`);
  }
  const changed = changedLineCount(patches);
  if (changed > MAX_CHANGED_LINES) reasons.push(`${changed} changed lines (max ${MAX_CHANGED_LINES})`);
  if (changed === 0) reasons.push("patch changes nothing");

  const added = patches.flatMap((p) => p.hunks.flatMap((h) => h.lines.filter((l) => l.op === "+").map((l) => ({ path: p.path, text: l.text }))));
  for (const { path, text } of added) {
    for (const [re, label] of FORBIDDEN) if (re.test(text)) reasons.push(`forbidden in ${path}: ${label}`);
    const imp = /^\s*import\s.*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/.exec(text);
    const spec = imp?.[1] ?? imp?.[2];
    if (spec && !spec.startsWith(".") && !ALLOWED_IMPORTS.has(spec)) reasons.push(`import not allowed in ${path}: ${spec}`);
    if (spec?.startsWith(".")) {
      const dir = path.split("/").slice(0, -1);
      const resolved = [...dir, ...spec.split("/")].reduce<string[]>((acc, part) => (part === ".." ? acc.slice(0, -1) : part === "." ? acc : [...acc, part]), []).join("/");
      if (!(resolved in files)) reasons.push(`import of a file that does not exist in ${path}: ${spec}`);
    }
  }

  let applied: Record<string, string> | null = null;
  if (reasons.length === 0) {
    try {
      applied = applyPatch(files, patches);
    } catch (e) {
      reasons.push(`does not apply: ${(e as Error).message}`);
    }
  }
  return { passed: reasons.length === 0, reasons: [...new Set(reasons)], files: applied, patches };
}
