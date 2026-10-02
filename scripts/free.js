#!/usr/bin/env node
/**
 * Free labour: Claude Code run headless on a free model (see MODELS) through the
 * local OmniRoute gateway (`omniroute` running; key from OMNIROUTE_KEY or the
 * Windows user environment). See CLAUDE.md "Team".
 *
 *   node scripts/free.js ask "<task>"     read, search, run git/tests; no edits
 *   node scripts/free.js edit "<task>"    same, plus edits outside protected code
 *   node scripts/free.js review           review the uncommitted diff
 *
 * The task can also come in on stdin (`-`), which is the safe way to pass a
 * multi-line task on Windows. Unlike headless Antigravity, which cannot run any
 * shell command, this one runs git and the test scripts, and protected code is
 * kept out of reach by deny rules, not by asking nicely. It never commits.
 * Output is a draft from a small model: check it.
 *
 * Free limits are per minute and per day, so every request counts: the
 * worker is told to batch its tool calls, background chatter is switched off,
 * and a short cooldown is waited out instead of burning the next model.
 */
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { OMNIROUTE, omniKey } = require('./omniroute');

/**
 * Codestral first: it answers in seconds and its free Mistral quota is the
 * largest we have. Nemotron 3 Ultra (Ollama Cloud) is more careful but slower
 * and its free credits are monthly; Flash-Lite is the last resort. Gemini 3.6-3.8 Flash are gone:
 * about 1 call in 15 got through (2026-09-28/29), and a probe that passed was
 * followed by a quota 429 that Claude Code retried for ten minutes. Groq's free
 * tier rejects Claude Code's prompt as too large; the other Mistral chat models
 * are rate-limited on this key. Only Ollama's free models may go here (gemma4,
 * gpt-oss, nemotron-3): one call to a paid one locks the whole connection.
 * See docs/HELPER_LOG.md.
 */
const NEMOTRON = 'ollama-cloud/nemotron-3-ultra';
const MODELS = ['mistral/codestral-latest', NEMOTRON, 'gemini/gemini-3.1-flash-lite'];
const CHEAP = 'gemini/gemini-3.1-flash-lite';
/** Codestral answered the review prompt with a one-line greeting and no tool calls. */
const REVIEWERS = [CHEAP, NEMOTRON];
/**
 * Compact at 128k whatever the model's window: every turn resends the whole
 * context against a per-minute token quota, and Mistral's window is 128k anyway.
 */
const COMPACT_WINDOW = '128000';
/** A cooldown this short is cheaper to wait out than to fall to a weaker model. */
const MAX_WAIT_S = 90;
/** Model runs per job. A second run only happens when the first changed nothing. */
const MAX_RUNS = 2;

/**
 * Only code where a mistake is silent or cannot be undone (CLAUDE.md "Protected").
 * Everything else in src/math, src/db and src/services is open to helpers.
 */
const PROTECTED = [
  // Ledger truth: what counts as spending, income, a debt or a transfer.
  ...['budget', 'reimbursement', 'splitEngine', 'transfers', 'classification'].map((s) => `src/math/${s}.ts`),
  ...['transactions', 'ious', 'reimbursements', 'balance', 'budget'].map((s) => `src/db/repos/${s}.ts`),
  ...['capture', 'parser', 'budget', 'settlement', 'transfer', 'revalidation'].map((s) => `src/services/${s}Service.ts`),
  // Cannot be undone: schema, backup, erase.
  'src/db/migrations.ts', 'src/db/schema.ts', 'src/db/repos/maintenance.ts',
  'src/services/backupService.ts', 'src/services/backupFiles.ts',
  // Encryption, app lock, SMS privacy, native capture.
  'src/db/expoAdapter.ts', 'src/security/**', 'src/services/smsPrivacy.ts', 'modules/pinch-capture/**'];
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git log:*)',
  'Bash(git status:*)', 'Bash(git grep:*)', 'Bash(npm run test:q:*)', 'Bash(npm run typecheck)', 'Bash(npx jest:*)'];
/** Edit rules cover every file-editing tool, Write included. */
const DENY = [...PROTECTED.map((p) => `Edit(${p})`),
  'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(rm:*)'];

/** Each turn is one request against a per-minute quota, so fewer, fuller turns. */
const FRUGAL =
  'You run on a free model with a small per-minute request quota. Batch your work: read or search several files ' +
  'in one turn (parallel tool calls), make all edits to a file in one go, and do not re-read a file to check an edit. ' +
  'Finish with a short plain report of what you did or found.';

const REVIEW =
  'You are the reviewer for Pinch. Read CLAUDE.md, then run `git status` and `git diff HEAD` and read changed files for ' +
  'context. Review for correctness bugs, broken financial invariants from CLAUDE.md and privacy leaks. Edits to ' +
  'protected code are made by the lead and are allowed: do not report them as a violation, review their logic ' +
  'harder instead. Report findings most severe first, each with file:line and a one-line failure scenario. ' +
  'If nothing is wrong, say "No findings." Do not edit anything.';

const [job, arg] = process.argv.slice(2);
const KEY = omniKey();
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const treeState = () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });

/**
 * One tiny request on the same endpoint Claude Code uses. Returns 'ok', a cooldown
 * in seconds, or null. 15s is enough: the gateway spends ~30s retrying a model
 * that is rate-limited, and that model is not worth the wait.
 */
async function probe(model) {
  try {
    const res = await fetch(`${OMNIROUTE}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return 'ok';
    const body = await res.json().catch(() => ({}));
    const wait = body.error?.reset_seconds;
    console.error(`${model}: ${res.status}${wait ? ` (cooling down ${wait}s)` : ''}`);
    return res.status === 429 && wait ? wait : null;
  } catch (e) {
    if (e.name !== 'TimeoutError') throw e;
    console.error(`${model}: no answer in 15s`);
    return null;
  }
}

/** The first model that answers, waiting out one short cooldown if every model is cooling down. */
async function liveModel(models) {
  for (let pass = 0; pass < 2; pass++) {
    let shortest = Infinity;
    for (const model of models) {
      const r = await probe(model);
      if (r === 'ok') return model;
      if (typeof r === 'number') shortest = Math.min(shortest, r);
    }
    if (pass || shortest > MAX_WAIT_S) return null;
    console.error(`all cooling down, waiting ${shortest}s`);
    await sleep(shortest + 2);
  }
  return null;
}

/** One headless Claude Code run. Resolves to the final report, or null when the run failed. */
function run(model, task) {
  const tools = job === 'edit' ? [...READ_TOOLS, 'Edit', 'Write'] : READ_TOOLS;
  // A model that gets busy mid-run hands over to Flash-Lite instead of failing the job.
  const fallback = model === CHEAP ? [] : ['--fallback-model', CHEAP];
  // Claude Code asks every model for adaptive thinking at high effort. Mistral
  // rejects that with a 400 (once hidden by the fallback), so only Gemini gets it.
  const quiet = model.startsWith('gemini/') ? {} : { CLAUDE_CODE_DISABLE_THINKING: '1', CLAUDE_CODE_EFFORT_LEVEL: 'auto' };
  // No user settings: user plugins and hooks would add tokens to every turn.
  const child = spawn('claude', ['-p', '--model', model, ...fallback, '--max-turns', '40',
    '--setting-sources', 'project,local', '--output-format', 'json', '--append-system-prompt', FRUGAL,
    '--tools', tools.map((t) => t.replace(/\(.*$/, '')).filter((t, i, a) => a.indexOf(t) === i).join(','),
    '--allowedTools', tools.join(','), '--disallowedTools', DENY.join(',')], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: OMNIROUTE,
      ANTHROPIC_AUTH_TOKEN: KEY,
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: CHEAP,
      // No title generation, update checks or telemetry: they would spend the same quota.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: COMPACT_WINDOW,
      // A quota 429 is retried about once a minute; give up soon and try the next model.
      CLAUDE_CODE_MAX_RETRIES: '2',
      ...quiet,
    },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stdin.end(task);
  return new Promise((resolve) => child.on('exit', () => {
    let r = {};
    try { r = JSON.parse(out); } catch { /* a crash prints no JSON */ }
    const text = typeof r.result === 'string' ? r.result.trim() : '';
    // A silent fallback once passed Flash-Lite's work off as Codestral's.
    if (r.modelUsage) console.error(`free: answered by ${Object.keys(r.modelUsage).join(', ')}`);
    if (!r.is_error && text) return resolve(text);
    console.error(`${model}: run failed (${r.subtype ?? 'no result'}, ${r.num_turns ?? 0} turns)${text ? `: ${text.slice(0, 300)}` : ''}`);
    resolve(null);
  }));
}

async function main() {
  if (!['ask', 'edit', 'review'].includes(job) || (job !== 'review' && !arg)) {
    console.error('usage: node scripts/free.js <ask|edit> "<task>" | -   or   node scripts/free.js review');
    return 2;
  }
  if (!KEY) {
    console.error('No OmniRoute key: set OMNIROUTE_KEY (setx OMNIROUTE_KEY <key>).');
    return 1;
  }
  const task = job === 'review' ? REVIEW : arg === '-' ? fs.readFileSync(0, 'utf8') : arg;
  if (!task.trim()) {
    console.error('The task is empty.');
    return 2;
  }
  let models = process.env.PINCH_FREE_MODEL ? [process.env.PINCH_FREE_MODEL] : job === 'review' ? REVIEWERS : MODELS;
  const before = treeState();
  for (let runs = 0; runs < MAX_RUNS; runs++) {
    let model;
    try {
      model = await liveModel(models);
    } catch {
      console.error(`Could not reach OmniRoute at ${OMNIROUTE}. Run \`omniroute\` in another window.`);
      return 1;
    }
    if (!model) break;
    console.error(`free: ${model}`);
    const report = await run(model, task);
    if (report) {
      process.stdout.write(`${report}\n`);
      return 0;
    }
    // Half-done edits must not be redone by another model on top: stop and let Claude look.
    if (treeState() !== before) {
      console.error('The failed run changed files. Not retrying; check `git diff`.');
      return 1;
    }
    models = models.slice(models.indexOf(model) + 1);
    if (!models.length) break;
  }
  console.error('No free model finished the job. Try later, narrow the task, or do it another way.');
  return 1;
}

main().then((code) => { process.exitCode = code; });
