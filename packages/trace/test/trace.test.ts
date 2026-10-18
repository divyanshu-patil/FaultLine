import { describe, expect, it } from "vitest";
import { createRecorder, redact, validateEvidenceRefs, type TraceItem } from "../src/index.ts";

describe("redaction (T-TR-redact, AC-29)", () => {
  it("removes secrets from headers, bodies and query strings", () => {
    const out = redact(
      {
        headers: { Authorization: "Bearer A21AA.secret", "PAYPAL-TRANSMISSION-SIG": "abc==", Cookie: "fl_session=x" },
        body: { access_token: "A21AAtoken", client_secret: "shh", nested: [{ password: "pw" }] },
        url: "https://x.test/cb?access_token=abc&ok=1",
        note: "used Basic QVo6c2VjcmV0 then Bearer eyJabc.def",
        env: "key=my-very-long-secret-value",
      },
      ["my-very-long-secret-value"],
    );
    const text = JSON.stringify(out);
    for (const leaked of ["A21AA.secret", "A21AAtoken", "shh", '"pw"', "fl_session=x", "QVo6c2VjcmV0", "eyJabc", "my-very-long-secret-value", "access_token=abc"]) {
      expect(text).not.toContain(leaked);
    }
    expect(out.headers["PAYPAL-TRANSMISSION-SIG"]).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(out.url).toContain("ok=1");
  });
});

describe("evidence ids (T-TR-evidence, AC-30/31)", () => {
  it("assigns unique, prefixed, per-run ids and persists redacted items", async () => {
    const items: TraceItem[] = [];
    const rec = createRecorder((i) => {
      items.push(i);
    });
    const a = rec.record("run1", null, "paypal_call", { authorization: "Bearer x" });
    const b = rec.record("run1", null, "paypal_call", {});
    const c = rec.record("run1", null, "webhook_delivery", {});
    const d = rec.record("run2", null, "paypal_call", {});
    await rec.flush();
    expect([a, b, c, d]).toEqual(["pc-0001", "pc-0002", "wh-0001", "pc-0001"]);
    expect(items[0]!.summary.authorization).toBe("[redacted]");
    expect(rec.known("run1")).toEqual(new Set(["pc-0001", "pc-0002", "wh-0001"]));
  });

  it("rejects outputs that cite ids missing from the trace", () => {
    const known = new Set(["pc-0001", "st-0002"]);
    expect(validateEvidenceRefs({ evidence: ["pc-0001", "st-0002"] }, known)).toEqual({ ok: true, unknown: [] });
    expect(validateEvidenceRefs({ evidence: ["pc-0001"], steps: ["see wh-0009"] }, known)).toEqual({ ok: false, unknown: ["wh-0009"] });
  });
});
