#!/usr/bin/env node
/**
 * Local-model helpers: jobs handed to a model on this laptop (Ollama) so
 * Claude reads less. See docs/LOCAL_MODEL.md.
 *
 *   node scripts/llm.js log <file>        shrink a build/test log to the error that matters
 *   node scripts/llm.js brief "<idea>"    turn a rough idea into a short spec for Claude
 *   node scripts/llm.js explain [rev]     explain a commit (default HEAD) in plain words
 *   node scripts/llm.js handoff <file>    five-line "where we are / what's next" from notes
 *   node scripts/llm.js ask "<question>"  anything else
 *
 * Anything can also come in on stdin:  some-command 2>&1 | node scripts/llm.js log -
 *
 * PINCH_LLM_MODEL overrides the model (default: per job, see JOB_MODEL); OLLAMA_HOST the server;
 * PINCH_LLM_THINK the gpt-oss reasoning effort (low | medium | high, default low).
 * Output is a draft from a small model: check it, never trust it blind.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
/**
 * Per job, from a side-by-side run on 2026-09-24 (docs/LOCAL_MODEL.md): the 7B
 * fits the GPU and was 2-3x faster with the same accuracy at pulling facts
 * out; gpt-oss judged better where there is thinking to do.
 */
const FAST = 'qwen2.5-coder:7b';
const SMART = 'gpt-oss:20b';
const JOB_MODEL = { log: FAST, explain: FAST, brief: SMART, handoff: SMART, ask: SMART };
/**
 * gpt-oss reasons before it answers; most of a helper job's time went there.
 * These jobs are extraction and summary, so low effort is enough. Other
 * models get no thinking flag (Ollama rejects it for models without one).
 */
const THINK = process.env.PINCH_LLM_THINK || 'low';
/** Keep the model loaded between jobs: loading it takes about a minute. */
const KEEP_ALIVE = '30m';
/** Input budget in characters. Keeps the context inside what an 8 GB GPU handles well. */
const MAX_INPUT = 24_000;

const [job, arg] = process.argv.slice(2);
const MODEL = process.env.PINCH_LLM_MODEL || JOB_MODEL[job] || SMART;

function readInput(source) {
  if (!source || source === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(source, 'utf8');
}

/**
 * The deterministic half of shrinking a log: keep the lines around anything
 * that looks like a failure, so the model reads kilobytes, not megabytes.
 */
function errorWindows(text) {
  const lines = text.split(/\r?\n/);
  const hit = /error|fail|exception|what went wrong|cannot|unable|✕|×|FAILED|panic|fatal/i;
  const keep = new Set();
  lines.forEach((line, i) => {
    if (!hit.test(line)) return;
    for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 8); j++) keep.add(j);
  });
  const picked = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
  const body = picked.length > 0 ? picked.join('\n') : lines.slice(-200).join('\n');
  return clip(body);
}

function clip(text) {
  return text.length <= MAX_INPUT
    ? text
    : `${text.slice(0, MAX_INPUT / 2)}\n…[cut]…\n${text.slice(-MAX_INPUT / 2)}`;
}

const PROJECT =
  'Pinch: an offline-first Android personal finance app for Indian college students. ' +
  'Expo 57, React Native 0.86, TypeScript, expo-sqlite with SQLCipher, Jest tests, a custom Kotlin module for SMS capture.';

const JOBS = {
  log: () => ({
    system:
      `${PROJECT} You read build and test logs. Reply with: 1) the root error in one line, ` +
      '2) the file and line if shown, 3) the 5-15 log lines that prove it, verbatim, 4) one line: likely cause. ' +
      'No advice beyond that. If there is no error, say "No error found."',
    user: errorWindows(readInput(arg)),
  }),
  brief: () => ({
    system:
      `${PROJECT} Turn the user's rough idea into a brief for a senior engineer. Sections: Goal (1-2 lines), ` +
      'Behaviour (bullets), Screens/areas likely touched, Edge cases, Open questions (only real ones). ' +
      'Under 250 words. Do not write code. Do not invent file names you were not given.',
    user: clip(arg && fs.existsSync(arg) ? readInput(arg) : arg || readInput('-')),
  }),
  explain: () => {
    const rev = arg || 'HEAD';
    const diff = execSync(`git show --stat --patch ${rev}`, { encoding: 'utf8', maxBuffer: 64e6 });
    return {
      system:
        `${PROJECT} Explain this commit to the app's owner, who is learning. What changed and why, ` +
        'grouped by feature, in plain words, then a short "risks to check" list. Under 300 words.',
      user: clip(diff),
    };
  },
  handoff: () => ({
    system:
      'Summarise these working notes into exactly five lines: Done, In progress, Next, Blockers, ' +
      'Things to remember. Keep names, versions, file paths and numbers exact.',
    user: clip(readInput(arg)),
  }),
  ask: () => ({
    system: `${PROJECT} Answer briefly and concretely. Say so when you are not sure.`,
    user: clip(arg || readInput('-')),
  }),
};

async function main() {
  if (!JOBS[job]) {
    console.error('usage: node scripts/llm.js <log|brief|explain|handoff|ask> [file|text|-]');
    process.exit(2);
  }
  const { system, user } = JOBS[job]();
  let res;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        keep_alive: KEEP_ALIVE,
        ...(MODEL.startsWith('gpt-oss') ? { think: THINK } : {}),
        options: { num_ctx: 16384, temperature: 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch {
    console.error(`Could not reach Ollama at ${HOST}. Is it running? (open the Ollama app)`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`Ollama said ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  // Streamed, so the answer appears as it is written rather than all at the end.
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.message?.content) process.stdout.write(msg.message.content);
    }
  }
  process.stdout.write('\n');
}

main();
