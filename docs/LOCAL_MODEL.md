# Local model

The user's rule (2026-09-24): hand every job that can go to the local model to it, so Claude reads less and the user's Claude usage lasts longer. The local model is for indirect savings; it is not a replacement coder.

## Setup

- Ollama 0.34.4, installed with winget. The app runs the server at `http://localhost:11434`.
- Model: `gpt-oss:20b` (OpenAI, open weights, about 13 GB). On the RTX 4060 (8 GB) it runs partly on the GPU and partly on RAM.

## Helpers: `npm run llm -- <job> …`

| Job | Use |
|---|---|
| `log <file>` or `log -` | Shrinks a Gradle/Jest/Metro log to the root error, the proving lines and a likely cause. Lines are pre-filtered with a regex first, so the model reads kilobytes, not megabytes. |
| `brief "<idea>"` | Turns a rough idea into a short brief to hand to Claude. |
| `explain [rev]` | Explains a commit in plain words, plus risks to check. |
| `handoff <notes>` | Five-line "where we are" note for starting a fresh Claude session. |
| `ask "<question>"` | General questions. |

Example: `npm run apk 2>&1 | npm run llm -- log -`

## What stays with Claude

- Changes across many files.
- Budget and financial logic.
- Database migrations.
- Native Android and build debugging.
- A final check of anything the local model wrote. Run `npm test` and `npm run typecheck` on its code.
