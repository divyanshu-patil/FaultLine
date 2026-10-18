import { createTwoFilesPatch } from "diff";

export type HunkLine = { op: " " | "-" | "+"; text: string };
export type Hunk = { oldStart: number; lines: HunkLine[] };
export type FilePatch = { path: string; isNew: boolean; isDeleted: boolean; hunks: Hunk[] };

const stripPrefix = (p: string) => p.replace(/^[ab]\//, "").trim();

/** Extracts the diff from a model reply (```diff fences optional). */
export function extractDiff(reply: string): string {
  const fenced = /```(?:diff|patch)?\s*\n([\s\S]*?)```/.exec(reply);
  const text = fenced ? fenced[1]! : reply;
  const start = text.search(/^(---|diff --git) /m);
  return start >= 0 ? text.slice(start) : text;
}

export function parseUnifiedDiff(text: string): FilePatch[] {
  const files: FilePatch[] = [];
  let file: FilePatch | null = null;
  let hunk: Hunk | null = null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ")) {
      const next = lines[i + 1] ?? "";
      if (!next.startsWith("+++ ")) throw new Error(`missing +++ after --- at line ${i + 1}`);
      const oldPath = stripPrefix(line.slice(4).split("\t")[0]!);
      const newPath = stripPrefix(next.slice(4).split("\t")[0]!);
      file = {
        path: newPath === "/dev/null" ? oldPath : newPath,
        isNew: oldPath === "/dev/null",
        isDeleted: newPath === "/dev/null",
        hunks: [],
      };
      files.push(file);
      hunk = null;
      i++;
      continue;
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      if (!file) throw new Error("hunk before file header");
      hunk = { oldStart: Number(header[1]), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const op = line[0];
    if (op === "+" || op === "-" || op === " ") hunk.lines.push({ op, text: line.slice(1) });
    else if (line === "") hunk.lines.push({ op: " ", text: "" }); // models often drop the space on blank context lines
    else throw new Error(`unexpected diff line ${i + 1}: ${line.slice(0, 40)}`);
  }
  // trailing blank context produced by the final newline of the reply carries no information
  for (const f of files) for (const h of f.hunks) while (h.lines.at(-1)?.op === " " && h.lines.at(-1)?.text === "") h.lines.pop();
  if (files.length === 0) throw new Error("no file headers found in diff");
  return files;
}

function findBlock(lines: string[], block: string[], near: number): number {
  const eq = (a: string, b: string, loose: boolean) => (loose ? a.trim() === b.trim() : a === b);
  for (const loose of [false, true]) {
    let best = -1;
    for (let i = 0; i + block.length <= lines.length; i++) {
      if (block.every((b, j) => eq(lines[i + j]!, b, loose)) && (best < 0 || Math.abs(i - near) < Math.abs(best - near))) best = i;
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Applies hunks by content, not by line number: model-written hunk headers are often off. Each hunk's
 * context+removed lines must appear in the file (exactly, else whitespace-insensitively); the closest match wins.
 */
export function applyPatch(files: Record<string, string>, patches: FilePatch[]): Record<string, string> {
  const out = { ...files };
  for (const p of patches) {
    if (p.isNew || p.isDeleted) throw new Error(`creating or deleting files is not allowed (${p.path})`);
    const original = out[p.path];
    if (original === undefined) throw new Error(`file not found: ${p.path}`);
    const lines = original.split("\n");
    let shift = 0;
    for (const h of p.hunks) {
      const oldBlock = h.lines.filter((l) => l.op !== "+").map((l) => l.text);
      const newBlock = h.lines.filter((l) => l.op !== "-").map((l) => l.text);
      if (oldBlock.length === 0) throw new Error(`hunk in ${p.path} has no context to anchor it`);
      const at = findBlock(lines, oldBlock, h.oldStart - 1 + shift);
      if (at < 0) throw new Error(`hunk does not apply to ${p.path} near line ${h.oldStart}`);
      // keep the file's own indentation for context lines that matched loosely
      const merged = newBlock.map((text, idx) => {
        const ctxIdx = oldBlock.indexOf(text);
        return ctxIdx >= 0 && lines[at + ctxIdx]!.trim() === text.trim() ? lines[at + ctxIdx]! : text;
      });
      lines.splice(at, oldBlock.length, ...merged);
      shift += newBlock.length - oldBlock.length;
    }
    out[p.path] = lines.join("\n");
  }
  return out;
}

export function changedLineCount(patches: FilePatch[]): number {
  return patches.reduce((n, p) => n + p.hunks.reduce((m, h) => m + h.lines.filter((l) => l.op !== " ").length, 0), 0);
}

/** Unified diff between two file maps (used for reference fixes). */
export function diffFiles(before: Record<string, string>, after: Record<string, string>): string {
  return Object.keys(after)
    .filter((path) => before[path] !== after[path])
    .sort()
    .map((path) => createTwoFilesPatch(`a/${path}`, `b/${path}`, before[path] ?? "", after[path]!, "", "", { context: 3 }).replace(/^=+\n/, ""))
    .join("");
}
