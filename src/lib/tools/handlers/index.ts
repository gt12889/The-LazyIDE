/* Dispatch table for executeTool — one entry per tool action, grouped by
   domain module. The KEYS below are the action strings the model produces
   and MUST match toolRegistry.ts's tool names exactly (a typo here
   silently breaks that tool for every caller). */

import type { ToolHandler } from './types.js';
import {
  readFile,
  grepFile,
  writeFile,
  editFile,
  multiEdit,
  undoEdit,
  renameFile,
  deleteFile,
  globFiles,
  findFile,
  readDir,
} from './files.js';
import {
  searchCode,
  searchSymbols,
  gotoDefinition,
  findReferences,
  getDiagnostics,
} from './search.js';
import { runCommand, runTests, runLint, runBuild } from './shell.js';
import {
  gitStatus,
  gitDiff,
  gitLog,
  gitCommit,
  reviewDiff,
  gitCreatePr,
} from './git.js';
import { webSearch, webFetch, checkUrl } from './network.js';
import {
  brainQuery,
  brainQueryCss,
  brainNeighbours,
  brainRecord,
  brainSynthesize,
} from './brain.js';
import { listTransforms, runTransform, delegate, askUser, findTool } from './meta.js';
import { mcpListTools, mcpCall } from './mcp.js';
import {
  browserOpen,
  browserNavigate,
  browserClick,
  browserFill,
  browserScreenshot,
  browserSnapshot,
  browserClose,
} from './browser.js';

export const toolHandlers: Record<string, ToolHandler> = {
  read_file: readFile,
  grep_file: grepFile,
  write_file: writeFile,
  edit_file: editFile,
  multi_edit: multiEdit,
  undo_edit: undoEdit,
  rename_file: renameFile,
  delete_file: deleteFile,
  glob: globFiles,
  find_file: findFile,
  read_dir: readDir,

  search_code: searchCode,
  search_symbols: searchSymbols,
  goto_definition: gotoDefinition,
  find_references: findReferences,
  get_diagnostics: getDiagnostics,

  run_command: runCommand,
  run_tests: runTests,
  run_lint: runLint,
  run_build: runBuild,

  git_status: gitStatus,
  git_diff: gitDiff,
  git_log: gitLog,
  git_commit: gitCommit,
  review_diff: reviewDiff,
  git_create_pr: gitCreatePr,

  web_search: webSearch,
  web_fetch: webFetch,
  check_url: checkUrl,

  brain_query: brainQuery,
  brain_query_css: brainQueryCss,
  brain_neighbours: brainNeighbours,
  brain_record: brainRecord,
  brain_synthesize: brainSynthesize,

  list_transforms: listTransforms,
  run_transform: runTransform,
  delegate,
  ask_user: askUser,
  find_tool: findTool,

  mcp_list_tools: mcpListTools,
  mcp_call: mcpCall,

  browser_open: browserOpen,
  browser_navigate: browserNavigate,
  browser_click: browserClick,
  browser_fill: browserFill,
  browser_screenshot: browserScreenshot,
  browser_snapshot: browserSnapshot,
  browser_close: browserClose,
};
