export type FakeChatRequest = {
  model: string;
  messages: { role: string; content: string }[];
  tools?: { function: { name: string } }[];
  options?: Record<string, unknown>;
};

export type FakeReply = { content?: string; tool?: { name: string; arguments: Record<string, unknown> }; status?: number };

/** Scripted Ollama `/api/chat` + `/api/tags` (docs/15 §2). The responder decides each reply from the request. */
export function createFakeOllama(responder: (req: FakeChatRequest, n: number) => FakeReply | Promise<FakeReply>, opts: { healthy?: boolean } = {}) {
  const calls: FakeChatRequest[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    if (path === "/api/tags") {
      return opts.healthy === false ? new Response("down", { status: 503 }) : Response.json({ models: [{ name: "gemma4:31b" }] });
    }
    if (path !== "/api/chat") return new Response("not found", { status: 404 });
    const body = (await req.json()) as FakeChatRequest;
    calls.push(body);
    const reply = await responder(body, calls.length);
    if (reply.status && reply.status >= 400) return new Response("error", { status: reply.status });
    return Response.json({
      model: body.model,
      done: true,
      message: {
        role: "assistant",
        content: reply.content ?? "",
        ...(reply.tool ? { tool_calls: [{ function: { index: 0, name: reply.tool.name, arguments: reply.tool.arguments } }] } : {}),
      },
      prompt_eval_count: JSON.stringify(body.messages).length / 4,
      eval_count: (reply.content ?? JSON.stringify(reply.tool ?? "")).length / 4,
    });
  };
  return { fetch: fakeFetch, calls };
}
