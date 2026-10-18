/**
 * Owner-supplied test hooks. FaultLine's core never forges a signature or drops a live response on its own; those two
 * behaviours are provided here by the operator, for their own sandbox account, and injected into createProxy.
 *
 * Both default to a safe no-op/passthrough so the engine runs every attack that does NOT need them. Attacks A3
 * (unsigned/forged event) and A4 (capture response fault) require a real implementation — until then they throw a
 * clear error that is recorded as "skipped: hook not provided", never as a passing or failing verdict.
 */

export type ForgeSpec = {
  /** The store's PayPal order id the forged event should reference. */
  orderId: string;
  /** "capture.completed" etc. — the event the operator wants to fabricate for the signature-verification test. */
  eventType: string;
  instanceId: string;
};

export type ForgedEvent = { body: string; headers: Record<string, string> };

/**
 * A3 — signature-verification test. Return an event body plus transmission headers whose signature is deliberately
 * invalid (or absent), so a correct store REJECTS it via verify-webhook-signature. See packages/testing FakePayPal
 * for the header shape. Do not fabricate a valid PayPal signature.
 */
export type ForgeEvent = (spec: ForgeSpec) => ForgedEvent | Promise<ForgedEvent>;

export const forgeNotProvided: ForgeEvent = () => {
  throw new Error("A3 needs a forgeEvent hook; see apps/proxy/src/stubs.ts. Not provided, so A3 is skipped.");
};

export type FaultSpec = {
  /** Which upstream call this is, e.g. "capture". */
  operation: string;
  /** 1-based index of this call for the order (inject on the Nth attempt only). */
  occurrence: number;
  instanceId: string;
};

/**
 * A4 — capture-timeout test. Given the real upstream response (already completed at PayPal), decide whether to
 * withhold/delay it on the way back to the store, so the store sees a timeout although the money moved. Return the
 * Response to hand back (the real one for passthrough), or throw/delay to simulate the fault.
 */
export type InjectCaptureFault = (spec: FaultSpec, upstream: Response) => Response | Promise<Response>;

export const faultPassthrough: InjectCaptureFault = (_spec, upstream) => upstream;
