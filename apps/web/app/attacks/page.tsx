import { getJson, type Attack } from "../../lib/api";
import { Chip } from "../../components/Chip";

export const metadata = { title: "Attacks — FaultLine" };

export default async function AttacksPage() {
  const attacks = (await getJson<Attack[]>("/api/attacks", { authed: false })) ?? [];
  return (
    <main className="section">
      <div className="wrap">
        <div className="eyebrow">Catalog</div>
        <h1 style={{ fontSize: 48 }}>Eight ways checkout breaks.</h1>
        <p style={{ marginTop: 14, maxWidth: 640 }}>
          Every attack targets one documented PayPal hazard and checks specific invariants. Verdicts are decided by code, not the model.
        </p>
        <div className="grid two" style={{ marginTop: 32 }}>
          {attacks.map((a) => (
            <article className="card data" key={a.id}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <h3>
                  <span className="mono ember">{a.id}</span> {a.name}
                </h3>
                <Chip status={a.priority === "must" ? "high" : "tag"}>{a.priority}</Chip>
              </div>
              <p style={{ marginTop: 10 }}>{a.description}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0 12px" }}>
                {a.invariants.map((i) => (
                  <Chip key={i} status="plain">
                    <span className="mono">{i}</span>
                  </Chip>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                <b style={{ fontFamily: "var(--font-display)", color: "var(--brass)" }}>Real vs simulated:</b> {a.realVsSimulated}
              </p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
