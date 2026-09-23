import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../lib/models/localFetch', () => ({ localFetch: vi.fn() }));
vi.mock('../lib/vault/vaultClient', () => ({ getSecretPresence: vi.fn() }));
vi.mock('../lib/agents/managedAgent', () => ({ planAndActManaged: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/tools/toolRuntime', () => ({ executeTool: vi.fn() }));
import { planAndAct, classifyMissionModel } from '../lib/agents/runtime';
import { planAndActManaged } from '../lib/agents/managedAgent';
import { checkToolExecution } from '../lib/agents/managedToolPermissions';
import { localFetch } from '../lib/models/localFetch';
import { executeTool } from '../lib/tools/toolRuntime';
import { getSecretPresence } from '../lib/vault/vaultClient';
import { goToolLoop } from '../lib/models/opencodeGoToolLoop';
import { createGoAgentTurnStreamer, GO_DEFAULT } from '../lib/models/opencodeGoProvider';
import { gateAgentSession } from '../lib/agents/agentSessionGate';
import { resolveManagerModelId } from '../lib/agents/managerModelResolve';
import { streamManagerCompletion } from '../lib/agents/managerStreamCompletion';
import { saveAccessSettings } from '../lib/models/accessSettings';
import type { StreamChatRequest, StreamEvent } from '../lib/models/types';

const request: StreamChatRequest = { mode: 'edit', projectRoot: 'C:/projects/example', model: { id: GO_DEFAULT, label: 'Kimi', provider: 'opencode-go' }, messages: [{ id: 'user', role: 'user', content: 'Write and test a file' }], sessionId: 'test-agent' };
function turns(...responses: string[]) {
  return vi.fn(async function* (_req: StreamChatRequest) { yield responses.shift() ?? 'ACTION: FINAL\nARGS: {"summary":"done"}'; });
}
async function collect(source: AsyncIterable<StreamEvent>) { const result = []; for await (const event of source) result.push(event); return result; }
function sse(text: string) { return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`); }
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
it('executes an action in the real project and feeds its observation into the next turn', async () => {
  vi.mocked(executeTool).mockResolvedValue('[exit 0]\nTEST_OK');
  const complete = turns('ACTION: run_command\nARGS: {"command":"echo TEST_OK"}', 'ACTION: FINAL\nARGS: {"summary":"Test passed"}');
  const events = await collect(goToolLoop(request, complete));
  expect(executeTool).toHaveBeenCalledWith('run_command', { command: 'echo TEST_OK' }, expect.objectContaining({ rootPath: request.projectRoot, policy: expect.objectContaining({ permissionMode: 'acceptEdits' }) }));
  expect(complete.mock.calls[1][0].messages.some(m => m.content.includes('OBSERVATION: [exit 0]'))).toBe(true);
  expect(events.map(e => e.type)).toEqual(['tool', 'tool', 'text']);
  expect(events.at(-1)).toMatchObject({ text: 'Test passed' });
});
it.each(['ask', 'plan'] as const)('enforces read-only tools in %s', async mode => {
  vi.mocked(executeTool).mockResolvedValue('ERROR: blocked');
  await collect(goToolLoop({ ...request, mode }, turns('ACTION: write_file\nARGS: {"path":"x","content":"bad"}')));
  const policy = vi.mocked(executeTool).mock.calls[0][2].policy;
  expect(policy.permissionMode).toBe('plan');
  expect(policy.allowedTools).not.toContain('write_file');
  expect(policy.allowedTools).not.toContain('run_command');
});
it('stops after three shell failures and exposes them as error steps', async () => {
  vi.mocked(executeTool).mockResolvedValue('[exit 1]\nfailed');
  const complete = turns(...Array(4).fill('ACTION: run_command\nARGS: {"command":"bad"}'));
  await expect(collect(goToolLoop(request, complete))).rejects.toThrow('three failed');
  expect(executeTool).toHaveBeenCalledTimes(3);
});
it('cancellation prevents the next tool from executing', async () => {
  const controller = new AbortController();
  const complete = async function* () { controller.abort(); yield 'ACTION: run_command\nARGS: {"command":"bad"}'; };
  await expect(collect(goToolLoop({ ...request, signal: controller.signal }, complete))).rejects.toThrow();
  expect(executeTool).not.toHaveBeenCalled();
});
it('opens a project through the UI callback and stops using the old root', async () => {
  const onOpenProject = vi.fn().mockResolvedValue(undefined);
  const complete = turns('ACTION: open_project\nARGS: {"path":"C:/projects/new"}');
  const events = await collect(goToolLoop({ ...request, onOpenProject }, complete));
  expect(onOpenProject).toHaveBeenCalledWith('C:/projects/new');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ text: 'Opened project: C:/projects/new' });
});
it('runs Go agent turns through the dedicated transport with the full tool contract', async () => {
  vi.mocked(localFetch).mockResolvedValue(sse('ACTION: FINAL\nARGS: {"summary":"done"}'));
  for await (const _ of createGoAgentTurnStreamer('mission-1')({ model: GO_DEFAULT, system: 'TOOLS: read_file run_command', messages: [{ role: 'user', content: 'act' }] })) { /* drain */ }
  const body = JSON.parse(String(vi.mocked(localFetch).mock.calls[0][1]?.body));
  expect(body.messages[0].content).toContain('TOOLS: read_file run_command');
  expect(body.messages[0].content).not.toContain('You cannot modify');
  expect(vi.mocked(localFetch).mock.calls[0][2]).toEqual({ endpoint: 'chat/completions', session: 'mission-1' });
});
it('preserves manager action instructions for Go', async () => {
  vi.mocked(localFetch).mockResolvedValue(sse('<lazy_actions>[{"type":"open_project","path":"C:/project"}]</lazy_actions>'));
  const result = await streamManagerCompletion({ mode: 'opencode-go', model: GO_DEFAULT, system: 'Emit <lazy_actions> to operate this IDE.', apiMessages: [] });
  expect(result).toContain('open_project');
  expect(String(vi.mocked(localFetch).mock.calls[0][1]?.body)).toContain('Emit <lazy_actions>');
  expect(String(vi.mocked(localFetch).mock.calls[0][1]?.body)).not.toContain('Do not emit action blocks');
});
it('routes Go models without Pro or CLI and checks the vault before a mission', async () => {
  saveAccessSettings({ accessMode: 'opencode-go', model: GO_DEFAULT });
  expect(resolveManagerModelId('sonnet', 'opencode-go')).toBe(GO_DEFAULT);
  expect(resolveManagerModelId(undefined, 'opencode-go', undefined, 'kimi-k2.7-code')).toBe(GO_DEFAULT);
  vi.mocked(getSecretPresence).mockResolvedValue({ present: true });
  expect(await gateAgentSession({ model: GO_DEFAULT, mode: 'opencode-go', cliReady: false, proReady: false })).toEqual({ ok: true, rail: 'opencode-go' });
  vi.mocked(getSecretPresence).mockResolvedValue({ present: false });
  expect(await gateAgentSession({ model: GO_DEFAULT, mode: 'opencode-go' })).toMatchObject({ ok: false, rail: 'opencode-go' });
});

it('dispatches a Go mission into the real agent loop without consulting Pro readiness', async () => {
  Object.assign(window, { __TAURI_INTERNALS__: {} });
  try {
    expect(classifyMissionModel(GO_DEFAULT)).toBe('opencode-go');
    await planAndAct({ missionId: 'go-mission', missionTitle: 'Test', managedModel: GO_DEFAULT, worktreePath: 'C:/worktree', steps: [], onStep: vi.fn(), onAction: vi.fn(), onProgress: vi.fn(), stopSignal: () => false });
    expect(planAndActManaged).toHaveBeenCalledWith(expect.objectContaining({ model: GO_DEFAULT, streamTurn: expect.any(Function), worktreePath: 'C:/worktree' }));
  } finally { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; }
});
it('the actual policy rejects writes in Plan and excluded shell commands in Edit', () => {
  expect(checkToolExecution('write_file', { path: 'x', content: 'x' }, { permissionMode: 'plan' }, 'default', [])).toContain('read-only');
  expect(checkToolExecution('run_command', { command: 'echo test' }, { permissionMode: 'acceptEdits' }, 'default', [{ pattern: 'Bash', level: 'exclude', source: 'user', createdAt: '' }])).toBeTruthy();
});

it('never invokes the project-opening callback in read-only mode', async () => {
  const onOpenProject = vi.fn();
  await collect(goToolLoop({ ...request, mode: 'ask', onOpenProject }, turns('ACTION: open_project\nARGS: {"path":"C:/projects/other"}')));
  expect(onOpenProject).not.toHaveBeenCalled();
});
it('bounds a model that endlessly requests tools', async () => {
  vi.mocked(executeTool).mockResolvedValue('file content');
  const complete = turns(...Array(31).fill('ACTION: read_file\nARGS: {"path":"a.txt"}'));
  await expect(collect(goToolLoop(request, complete))).rejects.toThrow('30-action limit');
  expect(executeTool).toHaveBeenCalledTimes(30);
});
it('does not report an unsuccessful project opening as success', async () => {
  const onOpenProject = vi.fn().mockRejectedValue(new Error('Missing folder'));
  const events = await collect(goToolLoop({ ...request, onOpenProject }, turns('ACTION: open_project\nARGS: {"path":"C:/missing"}', 'ACTION: FINAL\nARGS: {"summary":"Could not open the missing folder"}')));
  expect(events[1]).toMatchObject({ status: 'error', resultSummary: expect.stringContaining('Missing folder') });
});

it('rejects missing file paths before invoking a filesystem handler', async () => {
  const events = await collect(goToolLoop(request, turns('ACTION: write_file\nARGS: {"content":"wrong"}')));
  expect(executeTool).not.toHaveBeenCalled();
  expect(events[1]).toMatchObject({ status: 'error', resultSummary: expect.stringContaining('Missing file path') });
});
it('executes the documented file-content block format', async () => {
  vi.mocked(executeTool).mockResolvedValue('Wrote 5 bytes');
  await collect(goToolLoop(request, turns('ACTION: write_file\nFILE: example.txt\n```text\nhello\n```')));
  expect(executeTool).toHaveBeenCalledWith('write_file', { path: 'example.txt', content: 'hello' }, expect.any(Object));
});

it('does not accept a fabricated success before an action executes', async () => {
  const complete = turns(...Array(3).fill('ACTION: FINAL\nARGS: {"summary":"Created the file successfully"}'));
  await expect(collect(goToolLoop(request, complete))).rejects.toThrow('No tools ran');
  expect(executeTool).not.toHaveBeenCalled();
});
it('recovers from a zero-tool claim by asking the model to execute the action', async () => {
  vi.mocked(executeTool).mockResolvedValue('Wrote 5 bytes');
  const complete = turns('ACTION: FINAL\nARGS: {"summary":"Created file"}', 'ACTION: write_file\nFILE: example.txt\n```text\nhello\n```', 'ACTION: FINAL\nARGS: {"summary":"Created example.txt"}');
  const events = await collect(goToolLoop(request, complete));
  expect(executeTool).toHaveBeenCalledTimes(1);
  expect(events.at(-1)).toMatchObject({ text: 'Created example.txt' });
});
