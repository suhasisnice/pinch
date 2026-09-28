# Helper chain log

Every time something in the automated chain breaks (Antigravity, the free worker, review, local model,
formatter, shell), it gets one entry here. The user asked for this on 2026-09-29 ("whenever
something in our automated chain hits an issue make note of it so we can discuss how to refine it").
Newest first. Add a **Fix idea** so there is something concrete to discuss; tick it once it's done.

## 2026-09-29 — making the free worker reliable

What changed (`scripts/free.js`, `scripts/llm.js`, new `scripts/omniroute.js`):
- The key is read from the Windows user environment when the shell doesn't have it (fixes #3).
- The probe uses `/v1/messages`, the same endpoint Claude Code calls. A 429 carries the gateway's
  `reset_seconds`; if every model is cooling down for 90s or less, it waits once instead of giving up.
- The run uses `--output-format json`, so a failed run is detected (`is_error`, or an empty result).
  It then tries the next model once, but only if the failed run changed no files.
  It exits 1 with a message when nothing finished.
- The worker is told to batch tool calls (fewer requests against the per-minute quota), and Claude
  Code's background traffic (titles, update checks) is switched off, since it spent the same quota.
- `llm.js --cloud` tries 3.8 → 3.7 → 3.6 → Flash-Lite, and gives Groq only inputs under 20k chars.

| # | Step | What happened | Cost | Fix idea |
|---|---|---|---|---|
| 10 | #4, re-checked | `[claude-code:unrecognized_model]` is a **harmless warning**: Flash-Lite prints it too and finishes fine. The 3.6 run died silently for another reason, most likely a 429 mid-run with no output. | Wrong diagnosis in #4 | ✅ Failed runs are now detected from the JSON result and retried once. |
| 11 | #5, re-checked | `llm.js` does set exit 1 when every model fails. The "exit 0" I saw was most likely my own `| tail` pipe. | Wrong diagnosis in #5 | ✅ It now also prints "No cloud model answered". Splitting big diffs is still open. |
| 12 | Free Gemini | 3.8, 3.7 and 3.6 Flash answered 429 all day, even after 10+ quiet minutes. The gateway's log from 28 Sep: **96 of 315** Gemini calls succeeded (166k tokens); the rest were 429 or 503. Flash-Lite carries most of the work. | Most jobs run on the weakest model | Fewer, fuller prompts (now in CLAUDE.md). A second free key, or a paid tier, would be the real fix. |
| 13 | Other providers | The gateway lists ~500 models, but only 3 accounts are connected: Gemini, Groq and "ghm". Groq's free tier rejects Claude Code's prompt as too large. Cloudflare, DuckDuckGo, zcode, Auggie and Devin all failed (502, 418 anti-abuse, or no account). | 30 min of probing | Add a provider only after one end-to-end `free.js` run on it passes. |
| 14 | Searching the gateway install | `grep -r` over the global `omniroute` package ran past 5 minutes and was stopped. | 8 min | Look up provider support in the gateway's dashboard or docs, not by grepping its install. |

## 2026-09-29 — 0.9.25 polish pass

| # | Step | What happened | Cost | Fix idea |
|---|---|---|---|---|
| 1 | `gem:edit` (agy); free.js takes stdin, agy still argv | I passed a multi-line prompt as one argument. Antigravity received it **empty** and replied "you forgot to include the edits". | One wasted run, about 1 min | `scripts/` wrapper: read the task from stdin or a file (`gem:edit -- -f task.md`) instead of argv. Newlines in argv don't survive `npm run` → node → agy on Windows. |
| 2 | `gem:edit` (agy) | On the retry: `RESOURCE_EXHAUSTED 429: Individual quota reached … Resets in 164h30m`. That is a **weekly** quota, not a daily one. It had finished the Wealth renames before stopping. | Agy gone for about 7 days | Check agy's quota before a big session. Save it for work that is actually large; small string edits are cheaper done inline than routed. |
| 3 | `free:edit` ✅ | `OMNIROUTE_KEY is not set`. The key was `setx`'d into the user environment, but this Claude Code session's shell started before that, so it never inherited it. | One run | `scripts/free.js` could fall back to reading the user env var itself (`reg query HKCU\Environment`). Or restart Claude Code after `setx`. |
| 4 | `free:edit` (see #10) | With the key present, the chain fell through: `gemini-3.8-flash` gave no answer in 30s, `3.7-flash` returned 429, and it landed on `gemini-3.6-flash`. Claude Code then rejected that model: `[claude-code:unrecognized_model]`. | Second failure, so the edits were done by Claude | Drop `gemini-3.6-flash` from the free worker's list, or map it to a model id Claude Code accepts. Test each model in the list once with a trivial prompt (`free -- "say ok"`). |
| 5 | `review:quick` (see #11) | Every model failed: `3.6-flash` 429, `3.1-flash-lite` 504, `groq gpt-oss-120b` **413 (diff too large)**. The script still **exited 0** and printed no review. | No second-opinion review. Claude reviewed its own diff instead. | (a) Exit non-zero when no model answered, so it can't pass silently. (b) Split big diffs per file, or send `--stat` plus the riskiest files only. |
| 6 | prettier | The repo has no `.prettierrc`. `npx prettier --write` used its defaults (double quotes, width 80) and rewrote every line of `ui.tsx` and `Heroes.tsx`. I caught it, reverted, and re-applied the edits. | About 5 min | Add `.prettierrc` = `{ "singleQuote": true, "printWidth": 100, "trailingComma": "es5" }`, which matches the existing code. |
| 7 | Bash heredoc | A heredoc containing TSX failed on quote matching. A heredoc containing JS lost its `\\` escapes. | Two retries | Write files with the Write tool, not heredocs, whenever the content has quotes or backslashes. |
| 8 | native-lib check | I looked for the NDK under `%LOCALAPPDATA%\Android\Sdk`. It is actually at `C:/Android/Sdk` (from `android/local.properties`). The first run printed a line of "command not found" per library instead of results. | One retry | Make the check a script, `npm run libcheck`, that reads `sdk.dir` itself and exits non-zero on a missing lib. |
| 9 | `postapk` copy-to-phone | "'Take the L' is not connected". The phone was not plugged in overnight. | None; the APK is built | Expected. Run `npm run phone` when the phone is connected. |
