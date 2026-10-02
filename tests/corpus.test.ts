/**
 * Measures the parser against real messages. Everything it touches lives in
 * `private/` (gitignored) and stays on this machine; with nothing there, both
 * tests pass without doing anything.
 *
 *   1. Export a backup from the app, save it as private/backup.pinch
 *   2. PINCH_BACKUP_PASS=<passphrase> npm run corpus:score   -> private/raw.jsonl
 *   3. npm run corpus:label   (local Ollama drafts the labels)
 *   4. npm run corpus:score   -> the table below + private/disagreements.md
 *
 * The labels are a local model's draft, so a disagreement is a question for a
 * person, not a verdict. Correct labels.jsonl by hand and score again.
 */
import fs from 'fs';
import path from 'path';
import { openBackup } from '../src/services/backupService';
import { ACCEPT_THRESHOLD, parseMessage } from '../src/services/parserService';

// PINCH_CORPUS_DIR points the scorer at another corpus, such as a public sample set.
const dir = process.env.PINCH_CORPUS_DIR ?? path.join(__dirname, '../private');
const file = (name: string) => path.join(dir, name);
const lines = (name: string) =>
  fs.readFileSync(file(name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

interface Raw { id: number; source: 'SMS' | 'NOTIFICATION'; sender: string | null; body: string }
interface Label { id: number; isTransaction: boolean; amount: number | null; direction: string | null; name: string | null }

const sameName = (a: string | null, b: string | null) => {
  if (!a || !b) return !a && !b;
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x.includes(y) || y.includes(x);
};

describe('parser against real messages', () => {
  it('unpacks a backup into private/raw.jsonl', async () => {
    const pass = process.env.PINCH_BACKUP_PASS;
    if (!fs.existsSync(file('backup.pinch')) || !pass) return;
    const payload = await openBackup(fs.readFileSync(file('backup.pinch'), 'utf8'), pass);
    const raw = (payload.tables.RawEvents ?? []).map((e) =>
      JSON.stringify({ id: e.id, source: e.source, sender: e.sender, body: e.body })
    );
    fs.writeFileSync(file('raw.jsonl'), raw.join('\n') + '\n');
    process.stdout.write(`\nunpacked ${raw.length} messages\n`);
  });

  it('scores the parser against the labels', () => {
    if (!fs.existsSync(file('raw.jsonl')) || !fs.existsSync(file('labels.jsonl'))) return;
    const labels = new Map<number, Label>(lines('labels.jsonl').map((l: Label) => [l.id, l]));
    const n = { labelled: 0, sameVerdict: 0, both: 0, amount: 0, direction: 0, name: 0, logged: 0, loggedWrong: 0, loggedNotReal: 0 };
    const out: string[] = [];

    for (const raw of lines('raw.jsonl') as Raw[]) {
      const label = labels.get(raw.id);
      if (!label) continue;
      n.labelled++;
      const parsed = parseMessage(raw.body, raw.sender, { source: raw.source });
      const logged = parsed !== null && parsed.confidence >= ACCEPT_THRESHOLD;
      if (logged) n.logged++;

      let wrong: string[] = [];
      if ((parsed !== null) !== label.isTransaction) {
        wrong = ['transaction or not'];
        if (logged) n.loggedNotReal++;
      } else {
        n.sameVerdict++;
        if (parsed) {
          n.both++;
          const amountOk = label.amount !== null && Math.abs(parsed.amount - label.amount) < 0.01;
          const directionOk = parsed.direction === label.direction;
          const nameOk = sameName(parsed.counterparty, label.name);
          if (amountOk) n.amount++; else wrong.push('amount');
          if (directionOk) n.direction++; else wrong.push('direction');
          if (nameOk) n.name++; else wrong.push('name');
          if (logged && (!amountOk || !directionOk)) n.loggedWrong++;
        }
      }
      if (wrong.length) {
        out.push(
          `## ${raw.id} — ${wrong.join(', ')}${logged ? ' (LOGGED without asking)' : ''}\n` +
          `${raw.source} from ${raw.sender ?? '-'}\n\n> ${raw.body.replace(/\n/g, ' ')}\n\n` +
          `- parser: ${parsed ? `${parsed.direction} ${parsed.amount} "${parsed.counterparty}" @${parsed.confidence}` : 'ignored'}\n` +
          `- label:  ${label.isTransaction ? `${label.direction} ${label.amount} "${label.name}"` : 'not a transaction'}\n`
        );
      }
    }

    fs.writeFileSync(file('disagreements.md'), out.join('\n'));
    const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : '0/0');
    process.stdout.write(
      `\nlabelled messages           ${n.labelled}\n` +
      `transaction-or-not agrees   ${pct(n.sameVerdict, n.labelled)}\n` +
      `amount agrees               ${pct(n.amount, n.both)}\n` +
      `direction agrees            ${pct(n.direction, n.both)}\n` +
      `name agrees                 ${pct(n.name, n.both)}\n` +
      `logged without asking       ${n.logged}\n` +
      `  of those, wrong sign/amt  ${n.loggedWrong}\n` +
      `  of those, not real        ${n.loggedNotReal}\n` +
      `disagreements written to private/disagreements.md: ${out.length}\n`
    );
  });
});
