#!/usr/bin/env node
/**
 * Writes docs/CODEMAP.md: one line per source file, drafted by the local
 * model (scripts/llm.js's server), so a Claude session can read one page
 * instead of searching the tree. Regenerate after big changes:
 *
 *   node scripts/codemap.js            (PINCH_LLM_MODEL to pick the model)
 *
 * The model sees each file's header comment and export lines only — enough
 * to say what a file is for, small enough to stay fast. It can be wrong;
 * the map is a starting point for finding things, never a source of truth.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.PINCH_LLM_MODEL || 'gpt-oss:20b';
const DIRS = ['src', 'modules/pinch-capture/android/src/main/java', 'plugins', 'scripts'];
const BATCH = 8;

function walk(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
    return /\.(tsx?|kt|js)$/.test(e.name) ? [rel] : [];
  });
}

/** Header comment plus export/declaration lines, capped. */
function digest(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, 30).join('\n');
  const exports = lines
    .filter((l) => /^(export |class |object |fun |module\.exports|async function |function )/.test(l))
    .slice(0, 25)
    .join('\n');
  return `### ${file} (${lines.length} lines)\n${head}\n...\n${exports}`.slice(0, 3500);
}

async function ask(files) {
  const body = {
    model: MODEL,
    stream: false,
    keep_alive: '30m',
    ...(MODEL.startsWith('gpt-oss') ? { think: 'low' } : {}),
    options: { num_ctx: 16384, temperature: 0.1 },
    messages: [
      {
        role: 'system',
        content:
          'You write a code map. For each file given, output exactly one line: ' +
          '`path` — what it is for, in under 20 words, naming its key exports. ' +
          'Output only those lines, in the order given, nothing else.',
      },
      { role: 'user', content: files.map(digest).join('\n\n') },
    ],
  };
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const lines = (json.message?.content ?? '')
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  // One line per file, matched by path; anything the model skipped is marked.
  return files.map((f) => {
    const hit = lines.find((l) => l.includes(f) || l.includes(path.posix.basename(f)));
    // Drop the model's echo of the path (paths can contain hyphens, so cut at the dash after it).
    const desc = hit ? hit.replace(/^.*?(?:`[^`]*`|\S+\.(?:tsx?|kt|js))\s*[—–-]+\s*/, '') : '(not summarised)';
    return `- \`${f}\` — ${desc}`;
  });
}

async function main() {
  const files = DIRS.flatMap(walk).sort();
  const out = [];
  const started = Date.now();
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    out.push(...(await ask(batch)));
    process.stderr.write(`\r${Math.min(i + BATCH, files.length)}/${files.length} files`);
  }
  const byDir = new Map();
  for (const line of out) {
    const dir = path.posix.dirname(line.match(/`([^`]+)`/)[1]);
    byDir.set(dir, [...(byDir.get(dir) ?? []), line]);
  }
  const md = [
    '# Code map',
    '',
    `Drafted by the local model (${MODEL}) from each file's header and exports on ${new Date()
      .toISOString()
      .slice(0, 10)}. A map for finding things, not a source of truth. Regenerate: \`node scripts/codemap.js\`.`,
    '',
    ...[...byDir].flatMap(([dir, lines]) => [`## ${dir}`, '', ...lines, '']),
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'docs/CODEMAP.md'), md);
  process.stderr.write(`\nwrote docs/CODEMAP.md in ${Math.round((Date.now() - started) / 1000)}s\n`);
}

main();
