export function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="diff" tabIndex={0} aria-label="Patch diff">
      {lines.map((line, i) => {
        const cls = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : "";
        return (
          <code key={i} className={`ln ${cls}`}>
            {line || " "}
          </code>
        );
      })}
    </pre>
  );
}
