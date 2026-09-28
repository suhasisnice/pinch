# Helper chain log

Every time something in the automated chain breaks (Antigravity, the free worker, review, local model,
formatter, shell), it gets one entry here. The user asked for this on 2026-09-29 ("whenever
something in our automated chain hits an issue make note of it so we can discuss how to refine it").
Newest first. Add a **Fix idea** so there is something concrete to discuss; tick it once it's done.

## 2026-09-29 — 0.9.25 polish pass

| # | Step | What happened | Cost | Fix idea |
|---|---|---|---|---|
| 1 | `gem:edit` (agy) | I passed a multi-line prompt as one argument. Antigravity received it **empty** and replied "you forgot to include the edits". | One wasted run, about 1 min | `scripts/` wrapper: read the task from stdin or a file (`gem:edit -- -f task.md`) instead of argv. Newlines in argv don't survive `npm run` → node → agy on Windows. |
| 2 | `gem:edit` (agy) | On the retry: `RESOURCE_EXHAUSTED 429: Individual quota reached … Resets in 164h30m`. That is a **weekly** quota, not a daily one. It had finished the Wealth renames before stopping. | Agy gone for about 7 days | Check agy's quota before a big session. Save it for work that is actually large; small string edits are cheaper done inline than routed. |
| 3 | `free:edit` | `OMNIROUTE_KEY is not set`. The key was `setx`'d into the user environment, but this Claude Code session's shell started before that, so it never inherited it. | One run | `scripts/free.js` could fall back to reading the user env var itself (`reg query HKCU\Environment`). Or restart Claude Code after `setx`. |
| 4 | `free:edit` | With the key present, the chain fell through: `gemini-3.8-flash` gave no answer in 30s, `3.7-flash` returned 429, and it landed on `gemini-3.6-flash`. Claude Code then rejected that model: `[claude-code:unrecognized_model]`. | Second failure, so the edits were done by Claude | Drop `gemini-3.6-flash` from the free worker's list, or map it to a model id Claude Code accepts. Test each model in the list once with a trivial prompt (`free -- "say ok"`). |
| 5 | `review:quick` | Every model failed: `3.6-flash` 429, `3.1-flash-lite` 504, `groq gpt-oss-120b` **413 (diff too large)**. The script still **exited 0** and printed no review. | No second-opinion review. Claude reviewed its own diff instead. | (a) Exit non-zero when no model answered, so it can't pass silently. (b) Split big diffs per file, or send `--stat` plus the riskiest files only. |
| 6 | prettier | The repo has no `.prettierrc`. `npx prettier --write` used its defaults (double quotes, width 80) and rewrote every line of `ui.tsx` and `Heroes.tsx`. I caught it, reverted, and re-applied the edits. | About 5 min | Add `.prettierrc` = `{ "singleQuote": true, "printWidth": 100, "trailingComma": "es5" }`, which matches the existing code. |
| 7 | Bash heredoc | A heredoc containing TSX failed on quote matching. A heredoc containing JS lost its `\\` escapes. | Two retries | Write files with the Write tool, not heredocs, whenever the content has quotes or backslashes. |
| 8 | native-lib check | I looked for the NDK under `%LOCALAPPDATA%\Android\Sdk`. It is actually at `C:/Android/Sdk` (from `android/local.properties`). The first run printed a line of "command not found" per library instead of results. | One retry | Make the check a script, `npm run libcheck`, that reads `sdk.dir` itself and exits non-zero on a missing lib. |
| 9 | `postapk` copy-to-phone | "'Take the L' is not connected". The phone was not plugged in overnight. | None; the APK is built | Expected. Run `npm run phone` when the phone is connected. |
