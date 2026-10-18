"""Markdown export of a frozen report (docs/16 F16, Should)."""

from __future__ import annotations

from typing import Any


def render_markdown(body: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append(f"# FaultLine report — {body.get('target', {}).get('name', 'target')}")
    lines.append("")
    summary = body.get("summary", {})
    lines.append(f"> {summary.get('headline', 'Crash test report')}")
    lines.append("")
    lines.append(f"- Mode: **{body.get('effectiveMode', body.get('mode'))}**")
    lines.append(f"- Model: {body.get('model') or 'none (checklist)'}")
    lines.append(f"- Date: {body.get('createdAt', '')}")
    lines.append("")
    lines.append("## Findings")
    lines.append("")
    for f in body.get("findings", []):
        lines.append(f"### {f.get('title', f.get('attackId'))}")
        lines.append(f"- Attack: {f['attackId']} · Failed: {', '.join(f.get('failedInvariants', []))} · Severity: {f.get('severity')}")
        diag = f.get("diagnosis")
        if diag:
            label = "AI explanation" if diag.get("source") == "model" else "Template explanation"
            lines.append(f"- {label}: {diag.get('body', {}).get('root_cause', '')}")
        patch = f.get("patch")
        if patch:
            label = "AI patch" if patch.get("source") == "model" else "Reference fix (not AI-generated)"
            lines.append(f"- {label}: **{patch.get('status')}**")
        lines.append("")
    real = body.get("realVsSimulated")
    if real:
        lines.append("## What was real, what was simulated")
        lines.append("")
        for item in real:
            lines.append(f"- **{item['attackId']}**: {item['text']}")
        lines.append("")
    lines.append("---")
    lines.append("Sandbox only. Verdicts come from deterministic checks against PayPal's own record, not from the AI.")
    return "\n".join(lines) + "\n"
