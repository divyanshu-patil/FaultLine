import Link from "next/link";
import { SandboxBadge } from "./SandboxBadge";

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
        <SandboxBadge />
      </div>
    </header>
  );
}
