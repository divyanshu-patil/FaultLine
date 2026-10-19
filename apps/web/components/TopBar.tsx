import Link from "next/link";
import { SandboxBadge } from "./SandboxBadge";
import { Tour } from "./Tour";

export function TopBar() {
  return (
    <header className="top">
      <div className="wrap">
        <Link href="/" className="brand" aria-label="FaultLine home">
          <span>
            <b>Fault</b>
            <b className="fault">Line</b>
          </span>
        </Link>
        <nav className="navpill" aria-label="Primary">
          <Link href="/runs/new">Run</Link>
          <Link href="/attacks">Attacks</Link>
          <Link href="/about">About</Link>
        </nav>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Tour />
          <SandboxBadge />
        </div>
      </div>
    </header>
  );
}
