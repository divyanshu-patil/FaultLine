/**
 * Renders the source a real buggy store would have: every `if (flags.Bx) { … } else { … }` block is replaced by
 * the branch that is active for the chosen bug set (docs/10 §6). The model sees and patches this output only.
 */

const BRANCH_RE = /if \((?:ctx\.)?flags\.(B[1-8]|INJECT)\) \{/;

/** Index just past the `}` that closes the `{` at `open`, skipping strings, templates and comments. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (ch === "/" && next === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return i + 1;
  }
  throw new Error("unbalanced braces in branch");
}

function dedent(body: string): string {
  const lines = body.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  return lines.map((l) => (l.startsWith("  ") ? l.slice(2) : l.trimStart())).join("\n");
}

export function renderVariant(source: string, active: ReadonlySet<string>): string {
  let src = source;
  for (let guard = 0; guard < 500; guard++) {
    const m = BRANCH_RE.exec(src);
    if (!m) return src;
    const start = m.index;
    const thenOpen = start + m[0].length - 1;
    const thenEnd = matchBrace(src, thenOpen);
    let end = thenEnd;
    let elseBody = "";
    const elseMatch = /^\s*else \{/.exec(src.slice(thenEnd));
    if (elseMatch) {
      const elseOpen = thenEnd + elseMatch[0].length - 1;
      end = matchBrace(src, elseOpen);
      elseBody = src.slice(elseOpen + 1, end - 1);
    }
    const chosen = active.has(m[1]!) ? src.slice(thenOpen + 1, thenEnd - 1) : elseBody;
    const lineStart = src.lastIndexOf("\n", start) + 1;
    const text = dedent(chosen);
    if (text.trim() === "") {
      // drop the whole statement, including its line
      const lineEnd = src[end] === "\n" ? end + 1 : end;
      src = src.slice(0, lineStart) + src.slice(lineEnd);
    } else {
      // the first line lands after the existing indent; later lines keep their (dedented) absolute indent
      src = src.slice(0, start) + text.trimStart() + src.slice(end);
    }
  }
  throw new Error("too many branches");
}

export function parseBugList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^(B[1-8]|INJECT)$/.test(s)),
  );
}
