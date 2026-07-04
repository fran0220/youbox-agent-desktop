import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startMockGateway } from '../validation/mock-gateway.ts';

type TestServer = ReturnType<typeof startMockGateway>;

let servers: TestServer[] = [];
let tempDirs: string[] = [];

afterEach(async () => {
  for (const server of servers) server.stop(true);
  servers = [];
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function startServer(): { server: TestServer; baseUrl: string } {
  const server = startMockGateway(0);
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

async function postJson(baseUrl: string, pathName: string, body: unknown, headers?: HeadersInit): Promise<Response> {
  return fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function arm(baseUrl: string, playbook: string): Promise<string> {
  const response = await postJson(baseUrl, '/control/arm', { playbook });
  expect(response.status).toBe(200);
  const body = await response.json() as { runId: string; playbook: string };
  expect(body.playbook).toBe(playbook);
  expect(body.runId).toContain(playbook);
  return body.runId;
}

async function chat(baseUrl: string, runId: string, body: Record<string, unknown> = {}): Promise<any> {
  const response = await postJson(
    baseUrl,
    '/llm/v1/chat/completions',
    { model: 'mock-model', tools: [{ type: 'function', function: { name: 'write' } }], ...body },
    { 'x-mock-gateway-run-id': runId },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function applyWriteToolCalls(projectDir: string, toolCalls: any[]): Promise<void> {
  for (const toolCall of toolCalls) {
    expect(toolCall.type).toBe('function');
    const args = JSON.parse(toolCall.function.arguments) as { path: string; content: string };
    const target = path.resolve(projectDir, args.path);
    if (!target.startsWith(`${projectDir}${path.sep}`) && target !== projectDir) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, args.content);
  }
}

describe('validation mock gateway playbooks', () => {
  it('keeps the login, desktop config, and fallback chat contracts compatible', async () => {
    const { baseUrl } = startServer();

    const login = await postJson(baseUrl, '/api/auth/login', { username: 'any', password: 'any' });
    expect(login.status).toBe(200);
    const { token } = await login.json() as { token: string };
    expect(token).toMatch(/^[a]+$/);

    const config = await fetch(`${baseUrl}/api/desktop/config`, { headers: { authorization: `Bearer ${token}` } });
    expect(config.status).toBe(200);
    const configBody = await config.json() as { llm_proxy_url: string; models: Array<{ id: string }> };
    expect(configBody.llm_proxy_url).toContain('/llm');
    expect(configBody.models[0]?.id).toBe('mock-model');

    const completion = await postJson(baseUrl, '/llm/v1/chat/completions', { model: 'mock-model' });
    expect(completion.status).toBe(200);
    const completionBody = await completion.json() as any;
    expect(completionBody.choices[0].message.content).toContain('MOCK-LLM-RESPONSE');
  });

  it('arms named playbooks at runtime and plays back distinct multi-turn scripts', async () => {
    const { baseUrl } = startServer();

    const writeRunId = await arm(baseUrl, 'write-entry-file');
    const writeTurn = await chat(baseUrl, writeRunId);
    expect(writeTurn.choices[0].finish_reason).toBe('tool_calls');
    expect(writeTurn.choices[0].message.tool_calls[0].function.name).toBe('write');
    expect(writeTurn.choices[0].message.tool_calls[0].function.arguments).toContain('index.html');
    expect(JSON.parse(writeTurn.choices[0].message.tool_calls[0].function.arguments)).toMatchObject({
      path: 'index.html',
    });
    expect(JSON.parse(writeTurn.choices[0].message.tool_calls[0].function.arguments)).not.toHaveProperty('file_path');

    const echoRunId = await arm(baseUrl, 'echo-context');
    const echoTurn = await chat(baseUrl, echoRunId);
    expect(echoTurn.choices[0].finish_reason).toBe('stop');
    expect(echoTurn.choices[0].message.content).toContain('MOCK-ECHO-CONTEXT');

    const writeFinal = await chat(baseUrl, writeRunId);
    expect(writeFinal.choices[0].message.content).toContain('Wrote index.html');
  });

  it('returns OpenAI-compatible tool-call turns whose writes can be applied to real files', async () => {
    const { baseUrl } = startServer();
    const projectDir = await mkdtemp(path.join(tmpdir(), 'mock-gateway-project-'));
    tempDirs.push(projectDir);

    const runId = await arm(baseUrl, 'write-entry-file');
    const turn = await chat(baseUrl, runId);
    const toolCalls = turn.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      type: 'function',
      function: { name: 'write' },
    });

    await applyWriteToolCalls(projectDir, toolCalls);
    const written = await readFile(path.join(projectDir, 'index.html'), 'utf8');
    expect(written).toContain('MOCK-WRITE-ENTRY-FILE');
  });

  it('uses Pi-compatible write tool arguments for rapid and outside-project playbooks', async () => {
    const { baseUrl } = startServer();

    const rapidRunId = await arm(baseUrl, 'rapid-writes');
    const rapidTurn = await chat(baseUrl, rapidRunId);
    const rapidCalls = rapidTurn.choices[0].message.tool_calls;
    expect(rapidCalls).toHaveLength(4);
    expect(rapidCalls.map((call: any) => call.function.name)).toEqual(['write', 'write', 'write', 'write']);
    const rapidArgs = rapidCalls.map((call: any) => JSON.parse(call.function.arguments));
    expect(rapidArgs.every((args: any) => typeof args.path === 'string')).toBe(true);
    expect(rapidArgs.every((args: any) => !('file_path' in args))).toBe(true);
    expect(rapidArgs.at(-1)).toMatchObject({
      path: 'index.html',
      content: '<h1>MOCK-RAPID-WRITE-FINAL</h1>',
    });

    const outsideRunId = await arm(baseUrl, 'write-outside-project');
    const outsideTurn = await chat(baseUrl, outsideRunId);
    const outsideArgs = JSON.parse(outsideTurn.choices[0].message.tool_calls[0].function.arguments);
    expect(outsideTurn.choices[0].message.tool_calls[0].function.name).toBe('write');
    expect(outsideArgs).toMatchObject({
      path: '/tmp/originai-validation-outside-project.html',
    });
    expect(outsideArgs).not.toHaveProperty('file_path');
  });

  it('does not consume armed playbook turns for non-agent completion requests', async () => {
    const { baseUrl } = startServer();
    const runId = await arm(baseUrl, 'write-entry-file');

    const noTools = await postJson(
      baseUrl,
      '/llm/v1/chat/completions',
      { model: 'mock-model', messages: [{ role: 'user', content: 'title request' }] },
      { 'x-mock-gateway-run-id': runId },
    );
    expect(noTools.status).toBe(200);
    expect((await noTools.json() as any).choices[0].message.content).toContain('MOCK-LLM-RESPONSE');

    const emptyTools = await postJson(
      baseUrl,
      '/llm/v1/chat/completions',
      { model: 'mock-model', tools: [] },
      { 'x-mock-gateway-run-id': runId },
    );
    expect(emptyTools.status).toBe(200);
    expect((await emptyTools.json() as any).choices[0].message.content).toContain('MOCK-LLM-RESPONSE');

    const captures = await fetch(`${baseUrl}/control/captures?runId=${encodeURIComponent(runId)}`);
    const capturesBody = await captures.json() as any;
    expect(capturesBody.runs[0].nextTurnIndex).toBe(0);
    expect(capturesBody.runs[0].captures.map((capture: any) => capture.turnIndex)).toEqual([null, null]);

    const agentTurn = await chat(baseUrl, runId);
    expect(agentTurn.choices[0].finish_reason).toBe('tool_calls');
    const agentArgs = JSON.parse(agentTurn.choices[0].message.tool_calls[0].function.arguments);
    expect(agentArgs.path).toBe('index.html');
  });

  it('generates unique automatic tool-call ids across separately armed runs', async () => {
    const { baseUrl } = startServer();

    const firstRunId = await arm(baseUrl, 'write-entry-file');
    const firstTurn = await chat(baseUrl, firstRunId);
    const firstCallId = firstTurn.choices[0].message.tool_calls[0].id;

    const secondRunId = await arm(baseUrl, 'rapid-writes');
    const secondTurn = await chat(baseUrl, secondRunId);
    const secondCallIds = secondTurn.choices[0].message.tool_calls.map((call: any) => call.id);

    expect(secondCallIds).not.toContain(firstCallId);
    expect(new Set([firstCallId, ...secondCallIds]).size).toBe(1 + secondCallIds.length);
  });

  it('captures every chat completion payload retrievably per run', async () => {
    const { baseUrl } = startServer();
    const runId = await arm(baseUrl, 'echo-context');

    await chat(baseUrl, runId, { messages: [{ role: 'user', content: 'capture sentinel' }] });
    await chat(baseUrl, runId, { messages: [{ role: 'user', content: 'capture sentinel two' }] });

    const captures = await fetch(`${baseUrl}/control/captures?runId=${encodeURIComponent(runId)}`);
    expect(captures.status).toBe(200);
    const body = await captures.json() as any;
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].captures).toHaveLength(2);
    expect(body.runs[0].captures[0].payload.messages[0].content).toBe('capture sentinel');
    expect(body.runs[0].captures[1].turnIndex).toBe(1);
  });

  it('honors scripted slow-stream delays', async () => {
    const { baseUrl } = startServer();
    const runId = await arm(baseUrl, 'slow-stream');

    const startedAt = performance.now();
    const response = await postJson(
      baseUrl,
      '/llm/v1/chat/completions',
      { model: 'mock-model', stream: true, tools: [{ type: 'function', function: { name: 'write' } }] },
      { 'x-mock-gateway-run-id': runId },
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const elapsedMs = performance.now() - startedAt;

    expect(text).toContain('MOCK-SLOW-STREAM');
    expect(text).toContain('data: [DONE]');
    expect(elapsedMs).toBeGreaterThanOrEqual(2500);
  });
});
