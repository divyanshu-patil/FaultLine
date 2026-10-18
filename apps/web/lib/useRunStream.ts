"use client";

import { useEffect, useRef, useState } from "react";

export type RunEvent = { id?: number; kind: string; payload: Record<string, unknown> };

/**
 * Live run events: SSE first, falling back to polling /events?after= every 2 s on error (docs/11 §4, AC-59/60).
 * Events are deduped by id; a refresh mid-run re-reads everything from id 0.
 */
export function useRunStream(runId: string, done: boolean) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const lastId = useRef(0);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    if (done) return;
    let stop = false;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const push = (evs: RunEvent[]) => {
      const fresh = evs.filter((e) => e.id === undefined || !seen.current.has(e.id));
      if (!fresh.length) return;
      for (const e of fresh) if (e.id !== undefined) { seen.current.add(e.id); lastId.current = Math.max(lastId.current, e.id); }
      setEvents((prev) => [...prev, ...fresh]);
    };

    async function poll() {
      try {
        const res = await fetch(`/api/runs/${runId}/events?after=${lastId.current}`);
        if (res.ok) push(await res.json());
      } catch {
        /* keep trying */
      }
      if (!stop) timer = setTimeout(poll, 2000);
    }

    function startSse() {
      es = new EventSource(`/api/runs/${runId}/stream`);
      es.addEventListener("run_event", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data);
          push([{ id: Number((ev as MessageEvent).lastEventId) || undefined, kind: data.kind, payload: data.payload }]);
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener("done", () => es?.close());
      es.onerror = () => {
        es?.close();
        es = null;
        if (!stop && !timer) poll(); // fall back to polling
      };
    }

    if (typeof EventSource !== "undefined") startSse();
    else poll();

    return () => {
      stop = true;
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [runId, done]);

  return events;
}
