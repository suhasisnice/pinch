# AI limits through OmniRoute

Measured on 2026-09-29 with `scripts/ratetest.js` against the local gateway (free keys). Raw runs:
`AI_LIMITS.raw.json` and `AI_LIMITS.sequential.txt` (one call at a time, up to 40, tiny prompts) and
`AI_LIMITS.burst.txt` (150 calls, 10 at a time). Re-run: `node scripts/ratetest.js --burst 150 --conc 10 --only <name>`.

**Only per-minute behaviour is measured.** Daily and monthly caps are NOT known: no provider stated one in
a header or error, and the gateway's own limit tables are empty. "No limit hit" means the ceiling is at least
that rate, not that there is none. The burst was capped by model latency, not by a limit.

## Usable now (chat, answered)

| Model | Sequential (40 calls) | Burst, 10 at a time | Sustained ok/min | Notes |
|---|---|---|---|---|
| mistral/codestral-latest | 40 ok | 150 of 150 | 54+ | Fastest for edits. Ignores audit/review prompts. |
| mistral/ministral-3b-latest | 40 ok | 150 of 150 | 71+ | Small model. |
| mistral/ministral-8b-latest | 40 ok | 150 of 150 | 55+ | |
| mistral/ministral-14b-latest | 40 ok | 429 from call 20 (77 ok, 72 x 429) | ~14 | Tightest Mistral limit. |
| ollama-cloud/nemotron-3-nano:30b | 40 ok | 150 of 150 | 67+ | |
| ollama-cloud/gpt-oss:20b | 40 ok | 150 of 150 | 59+ | |
| ollama-cloud/gemma4:31b | 40 ok | 429 from call 106 | ~41 | |
| ollama-cloud/nemotron-3-super | 40 ok | 429 from call 77 | ~35 | |
| ollama-cloud/nemotron-3-ultra | 40 ok | 429 from call 11 (5 ok, 140 x 429) | ~5 in a burst | Fine one call at a time, poor in parallel. |
| groq/openai/gpt-oss-120b | 40 ok | 429 from call 9 (100 ok in the run) | ~27 | Free tier rejects Claude Code's big prompt (too large). |
| groq/openai/gpt-oss-20b | 40 ok | 429 from call 35 | ~34 | |
| groq/qwen/qwen3.8-27b | 40 ok | 429 from call 33 | ~34 | |
| groq/allam-2-7b | 40 ok | 429 from call 43 | ~33 | Arabic-focused; weak for code. |

## Gemini (flaky, mostly server-side)

| Model | Result |
|---|---|
| gemini-flash-latest | 4 ok, then 429, cooldown 43s |
| gemini-flash-lite-latest | 17 ok, then 504 (the gateway's own request timeout) |
| gemini-3.5-flash-lite | 10 ok, then 504 |
| gemini-3.1-flash-lite | 5 ok, then 504 |
| gemini-3.7-flash | 1 ok, then 504 |
| gemma-4-31b-it | 1 ok, then 500 "Internal error" |
| gemini-3.1-pro-preview | 0 ok, 429, cooldown 34s |
| gemini-pro-latest | 0 ok, 429, cooldown 55s |
| gemini-3.6-flash | 0 ok, 503 "high demand" |
| gemini-3.8-flash | 0 ok, 504 |
| gemini-3-flash-preview | 0 ok, 502 empty response |
| gemma-4-26b-a4b-it | 0 ok, 500 |
| gemini-2.5-flash, -pro, -flash-lite | 404 "no longer available to new users" |

The 5xx are demand and timeouts, not quota. They say nothing about a per-minute cap.

## Not usable on this key

mistral-small-latest, mistral-medium-latest, mistral-medium-3-5, magistral-small/medium-latest and
mistral-vibe-cli-latest all return 429 "Rate limit exceeded (reset after 3s)" on the first call. The Mistral
Limits page probably gives them no free allowance.

## Never probed

- **Paid Ollama models** (kimi-*, deepseek-*, glm-*, minimax-*, mistral-large-3): one call locks the whole connection.
- **Non-chat models**: image, voice, music, embeddings, OCR, moderation, guard models.
- **Other providers in the gateway** (Devin, Auggie, zcode, DuckDuckGo, Cloudflare, tllm, OpenCode, ghm, aihorde, Felo):
  several serve "free Claude". Not probed: see the open decision in the chat about terms of service.

## Still to measure

Daily and monthly caps need a run to exhaustion, which spends the day's quota. Cheaper: let the gateway's
`call_logs` accumulate and read the first 429 of each day per model.
