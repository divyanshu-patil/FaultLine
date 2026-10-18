export function Chip({ status, children }: { status: "pass" | "fail" | "na" | "high" | "tag" | "plain"; children: React.ReactNode }) {
  const icon = status === "pass" ? "✓" : status === "fail" ? "✕" : status === "high" ? "▲" : null;
  return (
    <span className={`chip ${status === "plain" ? "" : status}`}>
      {icon ? <span aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}
