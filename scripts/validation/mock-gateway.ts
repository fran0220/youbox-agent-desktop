/**
 * Mock OriginAI gateway for validation runs.
 * Run: bun scripts/validation/mock-gateway.ts [port]
 * Launch the app with ORIGINAI_GATEWAY_URL=http://127.0.0.1:<port>
 */
export type TextTurn = {
  type: 'text';
  text: string;
  delaySeconds?: number;
};

export type ToolCallSpec = {
  name: string;
  arguments: Record<string, unknown>;
  id?: string;
};

export type ToolCallTurn = {
  type: 'tool_calls';
  toolCalls: ToolCallSpec[];
  delaySeconds?: number;
};

export type SlowStreamTurn = {
  type: 'slow_stream';
  text: string;
  seconds: number;
};

export type PlaybookTurn = TextTurn | ToolCallTurn | SlowStreamTurn;

export type Playbook = {
  name: string;
  turns: PlaybookTurn[];
};

type Capture = {
  id: string;
  runId: string | null;
  playbook: string | null;
  turnIndex: number | null;
  receivedAt: string;
  payload: unknown;
};

type RunState = {
  runId: string;
  playbook: Playbook;
  nextTurnIndex: number;
  captures: Capture[];
  armedAt: string;
};

type ChatCompletionRequest = {
  stream?: boolean;
  model?: string;
};

const PORT = Number(process.argv[2] ?? 8899);
const TOKEN = 'a'.repeat(64);
const USER = { id: 'val-user-1', name: 'Validator', email: 'validator@example.com', role: 'user' };

const encoder = new TextEncoder();

export const PLAYBOOKS: Record<string, Playbook> = {
  'write-entry-file': {
    name: 'write-entry-file',
    turns: [
      {
        type: 'tool_calls',
        toolCalls: [
          {
            name: 'write',
            arguments: {
              file_path: 'index.html',
              content: '<!doctype html><html><body><h1>MOCK-WRITE-ENTRY-FILE</h1></body></html>',
            },
          },
        ],
      },
      { type: 'text', text: 'Wrote index.html with MOCK-WRITE-ENTRY-FILE.' },
    ],
  },
  'rapid-writes': {
    name: 'rapid-writes',
    turns: [
      {
        type: 'tool_calls',
        toolCalls: [
          { name: 'write', arguments: { file_path: 'index.html', content: '<h1>MOCK-RAPID-WRITE-1</h1>' } },
          { name: 'write', arguments: { file_path: 'assets/rapid-a.txt', content: 'rapid-a' } },
          { name: 'write', arguments: { file_path: 'assets/rapid-b.txt', content: 'rapid-b' } },
        ],
      },
      { type: 'text', text: 'Completed rapid writes.' },
    ],
  },
  'write-outside-project': {
    name: 'write-outside-project',
    turns: [
      {
        type: 'tool_calls',
        toolCalls: [
          {
            name: 'write',
            arguments: {
              file_path: '/tmp/originai-validation-outside-project.html',
              content: '<h1>SHOULD-NOT-BE-WRITTEN-BY-DESIGN-SESSION</h1>',
            },
          },
        ],
      },
      { type: 'text', text: 'Attempted outside-project write.' },
    ],
  },
  'slow-stream': {
    name: 'slow-stream',
    turns: [{ type: 'slow_stream', text: 'MOCK-SLOW-STREAM complete after a scripted delay.', seconds: 3 }],
  },
  'echo-context': {
    name: 'echo-context',
    turns: [{ type: 'text', text: 'MOCK-ECHO-CONTEXT response recorded for capture inspection.' }],
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-mock-gateway-run-id',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    },
  });
}

function sseHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function completionId(runId: string | null, turnIndex: number | null): string {
  return `chatcmpl-mock-${runId ?? 'default'}-${turnIndex ?? 0}`;
}

function sseChunk(model: string, id: string, delta: object, finishReason: string | null): Uint8Array {
  return encoder.encode(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  );
}

function sseDone(): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

function makeToolCalls(turn: ToolCallTurn, turnIndex: number): Array<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}> {
  return turn.toolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? `call_mock_${turnIndex}_${index}`,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  }));
}

function textCompletion(text: string, model: string, runId: string | null, turnIndex: number | null): Response {
  const completionTokens = Math.max(1, text.split(/\s+/).length);
  return json({
    id: completionId(runId, turnIndex),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: completionTokens, total_tokens: completionTokens + 1 },
  });
}

function toolCallCompletion(turn: ToolCallTurn, model: string, runId: string | null, turnIndex: number): Response {
  return json({
    id: completionId(runId, turnIndex),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: null, tool_calls: makeToolCalls(turn, turnIndex) },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function streamText(text: string, model: string, runId: string | null, turnIndex: number | null, totalMs = 0): Response {
  const id = completionId(runId, turnIndex);
  const words = text.split(/(\s+)/).filter((part) => part.length > 0);
  const delayPerChunk = words.length > 1 ? totalMs / words.length : totalMs;
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseChunk(model, id, { role: 'assistant' }, null));
      for (const word of words) {
        if (delayPerChunk > 0) await sleep(delayPerChunk);
        controller.enqueue(sseChunk(model, id, { content: word }, null));
      }
      controller.enqueue(sseChunk(model, id, {}, 'stop'));
      controller.enqueue(sseDone());
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: sseHeaders() });
}

function streamToolCalls(turn: ToolCallTurn, model: string, runId: string | null, turnIndex: number): Response {
  const id = completionId(runId, turnIndex);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(sseChunk(model, id, { role: 'assistant' }, null));
      controller.enqueue(sseChunk(model, id, { tool_calls: makeToolCalls(turn, turnIndex).map((call, index) => ({ index, ...call })) }, null));
      controller.enqueue(sseChunk(model, id, {}, 'tool_calls'));
      controller.enqueue(sseDone());
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: sseHeaders() });
}

async function responseForTurn(
  turn: PlaybookTurn,
  options: { stream: boolean; model: string; runId: string | null; turnIndex: number },
): Promise<Response> {
  const delayMs = 'delaySeconds' in turn && turn.delaySeconds ? turn.delaySeconds * 1000 : 0;
  if (turn.type === 'tool_calls') {
    if (delayMs > 0) await sleep(delayMs);
    return options.stream ? streamToolCalls(turn, options.model, options.runId, options.turnIndex) : toolCallCompletion(turn, options.model, options.runId, options.turnIndex);
  }
  if (turn.type === 'slow_stream') {
    return options.stream
      ? streamText(turn.text, options.model, options.runId, options.turnIndex, turn.seconds * 1000)
      : (await sleep(turn.seconds * 1000), textCompletion(turn.text, options.model, options.runId, options.turnIndex));
  }
  if (delayMs > 0) await sleep(delayMs);
  return options.stream
    ? streamText(turn.text, options.model, options.runId, options.turnIndex)
    : textCompletion(turn.text, options.model, options.runId, options.turnIndex);
}

function fallbackCompletion(stream: boolean, model: string): Response {
  const text = 'MOCK-LLM-RESPONSE: acknowledged.';
  return stream ? streamText(text, model, null, null) : textCompletion(text, model, null, null);
}

function createRun(playbook: Playbook): RunState {
  return {
    runId: `${playbook.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    playbook,
    nextTurnIndex: 0,
    captures: [],
    armedAt: new Date().toISOString(),
  };
}

export function createMockGatewayHandler(
  playbooks: Record<string, Playbook> = PLAYBOOKS,
  getPort: () => number = () => PORT,
): (req: Request) => Promise<Response> | Response {
  const runs = new Map<string, RunState>();
  let activeRunId: string | null = null;

  function selectedRun(req: Request): RunState | null {
    const headerRunId = req.headers.get('x-mock-gateway-run-id');
    if (headerRunId && runs.has(headerRunId)) return runs.get(headerRunId)!;
    if (activeRunId && runs.has(activeRunId)) return runs.get(activeRunId)!;
    return null;
  }

  return async (req: Request) => {
    const url = new URL(req.url);
    const p = url.pathname;
    console.log(`[mock-gateway] ${req.method} ${p}`);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: json({}).headers });
    if (p === '/health') return new Response('ok');

    if (p === '/control/playbooks' && req.method === 'GET') {
      return json({ playbooks: Object.values(playbooks).map((playbook) => ({ name: playbook.name, turns: playbook.turns.length })) });
    }
    if (p === '/control/arm' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { playbook?: string };
      const playbook = body.playbook ? playbooks[body.playbook] : null;
      if (!playbook) return json({ error: `unknown playbook: ${body.playbook ?? ''}` }, 404);
      const run = createRun(playbook);
      runs.set(run.runId, run);
      activeRunId = run.runId;
      return json({ ok: true, runId: run.runId, playbook: playbook.name, turns: playbook.turns.length });
    }
    if (p === '/control/captures' && req.method === 'GET') {
      const runId = url.searchParams.get('runId');
      const selectedRuns = runId ? [...runs.values()].filter((run) => run.runId === runId) : [...runs.values()];
      return json({
        activeRunId,
        runs: selectedRuns.map((run) => ({
          runId: run.runId,
          playbook: run.playbook.name,
          armedAt: run.armedAt,
          nextTurnIndex: run.nextTurnIndex,
          captures: run.captures,
        })),
      });
    }
    if (p === '/control/reset' && req.method === 'POST') {
      runs.clear();
      activeRunId = null;
      return json({ ok: true });
    }

    if (p === '/api/auth/login' && req.method === 'POST') return json({ token: TOKEN, user: USER });
    if (p === '/api/auth/logout' && req.method === 'POST') return new Response(null, { status: 204 });

    const auth = req.headers.get('authorization') ?? '';
    if (p.startsWith('/api/') && auth !== `Bearer ${TOKEN}`) return json({ error: 'unauthorized' }, 401);

    if (p === '/api/users/me') return json(USER);
    if (p === '/api/desktop/config')
      return json({
        llm_proxy_url: `http://127.0.0.1:${getPort()}/llm`,
        llm_proxy_key: 'sk-validation-mock',
        primary_model: 'mock-model',
        primary_provider: 'openai',
        models: [{ id: 'mock-model', provider: 'openai', label: 'Mock Model', context_window: 128000, max_tokens: 8192, api_type: 'openai-completions' }],
      });
    if (p === '/api/desktop/policy') return json({ role: 'user' });
    if (p === '/api/memory/sync' && req.method === 'POST')
      return json({ pull: [], push_accepted: [], server_time: new Date().toISOString() });
    if (p === '/api/memory/stats') return json({ file_count: 0, total_bytes: 0 });
    if (p === '/api/memory/search') return json({ hits: [] });
    if (p === '/api/desktop/classic-sessions') return json([]);
    if (p === '/api/desktop/audit' && req.method === 'POST') return new Response(null, { status: 204 });
    if (p === '/api/desktop/session-metadata' && req.method === 'POST') return json({ ok: true });
    if (p.startsWith('/api/desktop/release/')) return json({ error: 'not found' }, 404);

    if (p === '/llm/v1/chat/completions' && req.method === 'POST') {
      const payload = (await req.json().catch(() => ({}))) as ChatCompletionRequest;
      const run = selectedRun(req);
      const turnIndex = run ? run.nextTurnIndex : null;
      if (run && turnIndex !== null) {
        run.captures.push({
          id: `capture-${run.captures.length + 1}`,
          runId: run.runId,
          playbook: run.playbook.name,
          turnIndex,
          receivedAt: new Date().toISOString(),
          payload,
        });
      }
      if (!run) return fallbackCompletion(payload.stream === true, payload.model ?? 'mock-model');

      const turn = run.playbook.turns[run.nextTurnIndex] ?? run.playbook.turns[run.playbook.turns.length - 1];
      run.nextTurnIndex += 1;
      return responseForTurn(turn, {
        stream: payload.stream === true,
        model: payload.model ?? 'mock-model',
        runId: run.runId,
        turnIndex: turnIndex ?? 0,
      });
    }
    if (p === '/llm/v1/models') return json({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] });

    return json({ error: `mock-gateway: unhandled ${req.method} ${p}` }, 404);
  };
}

export function startMockGateway(port = PORT): ReturnType<typeof Bun.serve> {
  let server: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: createMockGatewayHandler(PLAYBOOKS, () => server.port),
  });
  console.log(`[mock-gateway] listening on http://127.0.0.1:${server.port}`);
  return server;
}

if (import.meta.path === Bun.main) {
  startMockGateway(PORT);
}
