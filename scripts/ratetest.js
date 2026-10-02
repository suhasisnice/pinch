#!/usr/bin/env node
/**
 * Rate-limit probe for every chat model behind the local OmniRoute gateway.
 *
 *   node scripts/ratetest.js [--max 40] [--only <substring>]
 *   node scripts/ratetest.js --burst 150 --conc 10 --only <substring>   parallel burst: find the ceiling
 *
 * Per model: fire tiny requests back to back until the first failure (or --max),
 * and record how many got through, how fast, and what the failure said
 * (status, error text, reset_seconds, any rate-limit headers). Providers run in
 * parallel because their quotas are separate; models within a provider run one
 * after another. Results go to docs/AI_LIMITS.raw.json; docs/AI_LIMITS.md is the
 * readable version.
 *
 * Never lists a paid Ollama model: one call to one locks the whole connection
 * (docs/HELPER_LOG.md #16). Non-chat models (image, voice, embeddings, OCR) are skipped.
 * Only per-minute behaviour is measured here. Daily and monthly caps are read from
 * the headers and error text when the provider states them, never guessed.
 */
const fs = require('fs');
const { OMNIROUTE, omniKey } = require('./omniroute');

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const MAX = Number(opt('--max', 40));
const ONLY = opt('--only', '');
const KEY = omniKey();
const BURST = Number(opt('--burst', 0));
const CONC = Number(opt('--conc', 10));

/** Gateway ids. Grouped by provider (separate quotas). */
const GROUPS = {
  gemini: [
    'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-flash-latest',
    'gemini-flash-lite-latest', 'gemini-pro-latest', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash',
    'gemini-3.8-flash', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it',
  ],
  groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'allam-2-7b'],
  mistral: [
    'codestral-latest', 'mistral-small-latest', 'mistral-medium-latest', 'mistral-medium-3-5',
    'magistral-small-latest', 'magistral-medium-latest', 'ministral-3b-latest', 'ministral-8b-latest',
    'ministral-14b-latest', 'mistral-vibe-cli-latest',
  ],
  'ollama-cloud': ['nemotron-3-ultra', 'nemotron-3-super', 'nemotron-3-nano:30b', 'gemma4:31b', 'gpt-oss:20b'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${OMNIROUTE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the word ok.' }] }),
      signal: AbortSignal.timeout(45_000),
    });
    const ms = Date.now() - t0;
    const headers = {};
    res.headers.forEach((v, k) => { if (/ratelimit|retry-after|quota/i.test(k)) headers[k] = v; });
    if (res.ok) return { ok: true, ms, headers };
    const text = await res.text();
    let err = text.slice(0, 300);
    let reset;
    try { const j = JSON.parse(text); err = j.error?.message ?? err; reset = j.error?.reset_seconds; } catch { /* plain text */ }
    return { ok: false, status: res.status, ms, err: String(err).slice(0, 300), reset, headers };
  } catch (e) {
    return { ok: false, status: e.name === 'TimeoutError' ? 'timeout' : 'network', ms: Date.now() - t0, err: e.message };
  }
}

async function probe(provider, id) {
  const model = `${provider}/${id}`;
  const started = Date.now();
  const calls = [];
  for (let i = 0; i < MAX; i++) {
    const r = await call(model);
    calls.push(r);
    if (!r.ok) break;
  }
  const good = calls.filter((c) => c.ok);
  const fail = calls.find((c) => !c.ok);
  const secs = (Date.now() - started) / 1000;
  const row = {
    model,
    succeeded: good.length,
    firstFailAt: fail ? good.length + 1 : null,
    hitMax: !fail,
    seconds: Math.round(secs * 10) / 10,
    avgLatencyMs: good.length ? Math.round(good.reduce((s, c) => s + c.ms, 0) / good.length) : null,
    callsPerMinute: good.length ? Math.round((good.length / secs) * 60) : 0,
    failure: fail ? { status: fail.status, err: fail.err, resetSeconds: fail.reset, ms: fail.ms } : null,
    headers: (good[good.length - 1] ?? fail)?.headers ?? {},
  };
  console.error(`${model}: ${row.succeeded} ok${fail ? `, then ${fail.status}${fail.reset ? ` (reset ${fail.reset}s)` : ''}` : ` (no limit in ${MAX})`}`);
  return row;
}

/** N calls, CONC at a time: what the model sustains before it says no. */
async function burst(provider, id) {
  const model = `${provider}/${id}`;
  const started = Date.now();
  const codes = {};
  let sent = 0;
  let firstFail = null;
  let firstReset = null;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (sent < BURST) {
      const n = ++sent;
      const r = await call(model);
      const k = r.ok ? 200 : r.status;
      codes[k] = (codes[k] ?? 0) + 1;
      if (!r.ok && firstFail === null) { firstFail = n; firstReset = r.reset ?? null; }
    }
  }));
  const secs = (Date.now() - started) / 1000;
  const row = { model, burst: BURST, conc: CONC, codes, firstFailAt: firstFail, resetSeconds: firstReset,
    seconds: Math.round(secs * 10) / 10, okPerMinute: Math.round(((codes[200] ?? 0) / secs) * 60) };
  console.error(`${model}: ${JSON.stringify(codes)} in ${row.seconds}s = ${row.okPerMinute} ok/min${firstFail ? `, first fail at #${firstFail}` : ''}`);
  return row;
}

async function main() {
  if (!KEY) { console.error('No OmniRoute key.'); process.exit(1); }
  const out = [];
  await Promise.all(Object.entries(GROUPS).map(async ([provider, ids]) => {
    for (const id of ids) {
      if (ONLY && !ONLY.split(',').some((o) => `${provider}/${id}`.includes(o))) continue;
      out.push(await (BURST ? burst(provider, id) : probe(provider, id)));
      // A short rest between models of one provider so one model's burst is not blamed on the next.
      await sleep(5000);
    }
  }));
  fs.writeFileSync(BURST ? 'docs/AI_LIMITS.burst.json' : 'docs/AI_LIMITS.raw.json', JSON.stringify({ at: new Date().toISOString(), max: MAX, results: out }, null, 2));
  console.error("wrote results");
}

main();
