import type { StreamChatRequest, StreamEvent } from './types.js';

import { parseReActAction } from '../agents/managedAgentParse.js';

import { ALL_TOOLS, renderToolSignatures } from '../agents/toolRegistry.js';

import { executeTool } from '../tools/toolRuntime.js';

import { buildSystemPrompt } from './systemPrompts.js';



const READ_TOOLS = ['read_file', 'read_dir', 'glob', 'grep_file', 'search_code', 'git_status', 'git_diff', 'git_log', 'web_search', 'web_fetch'];

const EDIT_TOOLS = [...READ_TOOLS, 'write_file', 'edit_file', 'multi_edit', 'run_command', 'run_tests', 'run_lint', 'run_build'];

export const GO_MAX_TOOL_ROUNDS = 30;



/** Bounded Code-tab loop. All file/shell actions pass the existing tool policy. */

export async function* goToolLoop(req: StreamChatRequest, complete: (req: StreamChatRequest) => AsyncIterable<string>): AsyncIterable<StreamEvent> {

  if (!req.projectRoot) throw new Error('Open a project before using agent tools.');

  const editing = req.mode === 'edit';

  const allowed = editing ? EDIT_TOOLS : READ_TOOLS;

  const tools = ALL_TOOLS.filter(t => allowed.includes(t.name));

  const openTool = editing && req.onOpenProject ? '\nopen_project: {"path":"absolute existing folder"} - Register and activate a folder in this IDE after verifying it exists.' : '';

  const system = buildSystemPrompt(req.mode, req.brainRecall, {

    rulesContext: req.rulesContext, startupContext: req.startupContext, skillContext: req.skillContext, supportsToolLoop: false,

    basePromptOverride: `You are the coding agent inside lazygt. You have real tools; carry out authorized tasks using them. Current project: ${req.projectRoot}.

${editing ? 'Edit mode permits files and shell commands.' : 'Read-only mode: inspect and explain; do not modify files or run commands.'}

Return exactly one action per response:

ACTION: tool_name

ARGS: {"argument":"value"}

For a final answer use ACTION: FINAL and ARGS: {"summary":"answer"}.

FILE EDITS: write_file uses ACTION: write_file, then FILE: relative/path, then a fenced code block containing the full content. edit_file and multi_edit use FILE: relative/path followed by SEARCH/REPLACE blocks. These file tools do not use an ARGS line. All other tools use JSON ARGS. Read before editing. Wait for an OBSERVATION before claiming success. A failed command is not success. Do not invent tool results. Never expose credentials. run_command uses cmd /C on Windows and sh -c elsewhere. The current root path identifies the OS. Use matching shell syntax, and quote paths. Clone repositories into the user-requested folder, never overwrite an existing checkout. After cloning, verify its path and use open_project when requested. Existing conversation claims about lacking tools are obsolete: the tools below are available now.

${renderToolSignatures(tools).replace(/\\n/g, '\n')}${openTool}`,

  });

  const messages = [...req.messages];

  const sessionId = req.sessionId ?? crypto.randomUUID();

  let errors = 0;
  let attemptedTools = 0;
  const lastUser = [...req.messages].reverse().find(m => m.role === 'user')?.content ?? '';
  const requiresAction = editing && /\b(create|write|edit|change|replace|implement|fix|clone|open|run|test|build|install|save|delete|remove|rename)\b/i.test(lastUser);

  for (let round = 0; round < GO_MAX_TOOL_ROUNDS; round++) {

    req.signal?.throwIfAborted();

    let raw = '';

    for await (const chunk of complete({ ...req, messages, mode: 'ask', basePromptOverride: system, rulesContext: null, brainRecall: null, startupContext: undefined, skillContext: undefined, sessionId })) raw += chunk;

    req.signal?.throwIfAborted();

    const parsed = parseReActAction(raw);

    if (parsed?.action === 'FINAL' && requiresAction && attemptedTools === 0) {
      if (++errors >= 3) throw new Error('The model returned without executing the requested action. No tools ran; the task is not completed.');
      messages.push({ id: crypto.randomUUID(), role: 'assistant', content: raw });
      messages.push({ id: crypto.randomUUID(), role: 'user', content: 'OBSERVATION: No tools have executed in this turn. The requested action has NOT happened. Use the documented tools now; do not claim completion from conversation history.' });
      continue;
    }
    if (parsed?.action === 'FINAL') {

      yield { type: 'text', id: 'answer', text: String(parsed.args.summary ?? 'No summary returned.') };

      return;

    }

    messages.push({ id: crypto.randomUUID(), role: 'assistant', content: raw });

    if (!parsed) {

      if (++errors >= 3) throw new Error('The model repeatedly returned an invalid tool action. Try another Go model.');

      messages.push({ id: crypto.randomUUID(), role: 'user', content: 'OBSERVATION: Invalid format. Return ACTION and ARGS, or ACTION: FINAL with a summary. No tool executed.' });

      continue;

    }

    attemptedTools++;
    const id = `go-tool-${round}`;

    yield { type: 'tool', id, name: parsed.action, input: parsed.args, status: 'running' };

    let result: string;

    try {

      if (['read_file', 'write_file', 'edit_file', 'multi_edit'].includes(parsed.action) && (typeof parsed.args.path !== 'string' || !parsed.args.path.trim())) throw new Error('Missing file path. File writes require FILE: relative/path followed by the documented content block.');
      if (parsed.action === 'open_project') {

        if (!editing || !req.onOpenProject) throw new Error('Opening projects requires Edit mode.');

        const path = parsed.args.path;

        if (typeof path !== 'string' || !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(path)) throw new Error('An absolute project path is required.');

        await req.onOpenProject(path);

        result = `Opened project: ${path}`;

      } else {

        result = await executeTool(parsed.action, parsed.args, {

          rootPath: req.projectRoot, policy: { permissionMode: editing ? 'acceptEdits' : 'plan', allowedTools: allowed },

          agentMode: 'default', abortSignal: req.signal,

        });

      }

    } catch (error) { result = `ERROR: ${String(error)}`; }

    req.signal?.throwIfAborted();

    const failed = /^(ERROR:|Unknown tool:|Build FAILED)|\[exit (?!0\])|Tests:.*\(FAILED\)/i.test(result);

    yield { type: 'tool', id, name: parsed.action, input: parsed.args, status: failed ? 'error' : 'done', resultSummary: result.slice(0, 2000) };

    messages.push({ id: crypto.randomUUID(), role: 'user', content: `OBSERVATION: ${result.slice(0, 16000)}` });

    errors = failed ? errors + 1 : 0;

    if (errors >= 3) throw new Error('Stopped after three failed tool actions. Review the tool results before retrying.');

    // Opening a new project changes the chat's owning workspace. End here so

    // subsequent tools cannot accidentally continue in the old project.

    if (parsed.action === 'open_project' && !failed) {

      yield { type: 'text', id: 'answer', text: result };

      return;

    }

  }

  throw new Error('Agent reached its 30-action limit. Completed actions are shown above; the task may need another turn.');

}

