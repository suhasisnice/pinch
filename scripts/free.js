#!/usr/bin/env node
/**
 * Free labour: Claude Code run headless on a free Gemini model through the
 * local OmniRoute gateway (`omniroute` running, OMNIROUTE_KEY set).
 * See CLAUDE.md "Team".
 *
 *   node scripts/free.js ask "<task>"     read, search, run git/tests; no edits
 *   node scripts/free.js edit "<task>"    same, plus edits outside protected code
 *   node scripts/free.js review           review the uncommitted diff
 *
 * The task can also come in on stdin (`-`). Unlike headless Antigravity, which
 * cannot run any shell command, this one runs git and the test scripts, and
 * protected code is kept out of reach by deny rules, not by asking nicely.
 * It never commits. Output is a draft from a small model: check it.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const OMNIROUTE = 'http://localhost:20128';
/** Smartest first. Free-tier models come and go (429 quota, 503 busy), so each run takes the first that answers. */
const MODELS = ['gemini/gemini-3.8-flash', 'gemini/gemini-3.7-flash', 'gemini/gemini-3.6-flash', 'gemini/gemini-3.1-flash-lite'];
const CHEAP = 'gemini/gemini-3.1-flash-lite';

const PROTECTED = ['src/math/**', 'src/db/**', 'src/security/**', 'modules/pinch-capture/**',
  ...['capture', 'parser', 'classification', 'backup', 'budget', 'settlement', 'transfer', 'revalidation']
    .map((s) => `src/services/${s}Service.ts`),
  'src/services/backupFiles.ts', 'src/services/smsPrivacy.ts'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git log:*)',
  'Bash(git status:*)', 'Bash(git grep:*)', 'Bash(npm run test:q:*)', 'Bash(npm run typecheck)', 'Bash(npx jest:*)'];
/** Edit rules cover every file-editing tool, Write included. */
const DENY = [...PROTECTED.map((p) => `Edit(${p})`),
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(rm:*)'];

const REVIEW =
  'You are the reviewer for Pinch. Read CLAUDE.md, then run `git status` and `git diff HEAD` and read changed files for ' +
  'context. Review for correctness bugs, broken financial invariants from CLAUDE.md, privacy leaks, and any edit to ' +
  'protected code. Report findings most severe first, each with file:line and a one-line failure scenario. ' +
  'If nothing is wrong, say "No findings." Do not edit anything.';

const [job, arg] = process.argv.slice(2);

async function firstLiveModel() {
  for (const model of process.env.PINCH_FREE_MODEL ? [process.env.PINCH_FREE_MODEL] : MODELS) {
    try {
      const res = await fetch(`${OMNIROUTE}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OMNIROUTE_KEY}` },
        body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return model;
      console.error(`${model}: ${res.status}, trying the next model`);
    } catch (e) {
      if (e.name !== 'TimeoutError') {
        console.error(`Could not reach OmniRoute at ${OMNIROUTE}. Run \`omniroute\` in another window.`);
        return null;
      }
      console.error(`${model}: no answer in 30s, trying the next model`);
    }
  }
  return null;
}

async function main() {
  if (!['ask', 'edit', 'review'].includes(job) || (job !== 'review' && !arg)) {
    console.error('usage: node scripts/free.js <ask|edit> "<task>" | -   or   node scripts/free.js review');
    process.exitCode = 2;
    return;
  }
  if (!process.env.OMNIROUTE_KEY) {
    console.error('OMNIROUTE_KEY is not set. setx it, then open a new terminal.');
    process.exitCode = 1;
    return;
  }
  const task = job === 'review' ? REVIEW : arg === '-' ? fs.readFileSync(0, 'utf8') : arg;
  const model = await firstLiveModel();
  if (!model) {
    console.error('No free model is answering right now. Try again later, or hand it to Antigravity.');
    process.exitCode = 1;
    return;
  }
  console.error(`free: ${model}`);
  const tools = job === 'edit' ? [...READ_TOOLS, 'Edit', 'Write'] : READ_TOOLS;
  // A free model that gets busy mid-run hands over to Flash-Lite instead of failing the job.
  const fallback = model === CHEAP ? [] : ['--fallback-model', 'haiku'];
  const child = spawn('claude', ['-p', '--model', 'sonnet', ...fallback, '--max-turns', '40',
    '--tools', tools.map((t) => t.replace(/\(.*$/, '')).filter((t, i, a) => a.indexOf(t) === i).join(','),
    '--allowedTools', tools.join(','), '--disallowedTools', DENY.join(',')], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: OMNIROUTE,
      ANTHROPIC_AUTH_TOKEN: process.env.OMNIROUTE_KEY,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: CHEAP,
    },
  });
  child.stdin.end(task);
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

main();
