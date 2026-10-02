/**
 * A scoreboard that can only go up: 145 public sample bank messages (see
 * tests/fixtures/public-sms/NOTICE.md) with the answers another open-source
 * parser gives. If a parser change makes a number here worse, this fails.
 * Raise the floors when the parser improves.
 */
import fs from 'fs';
import path from 'path';
import { ACCEPT_THRESHOLD, parseMessage } from '../src/services/parserService';

const read = (name: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures/public-sms', name), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

it('keeps its score on the public sample messages', () => {
  const labels = new Map(read('labels.jsonl').map((l) => [l.id, l]));
  let noticed = 0, wrongSign = 0, loggedWrong = 0;
  for (const raw of read('raw.jsonl')) {
    const label = labels.get(raw.id);
    const parsed = parseMessage(raw.body, raw.sender, { source: raw.source });
    if (!parsed) continue;
    const logged = parsed.confidence >= ACCEPT_THRESHOLD;
    if (!label.isTransaction) { if (logged) loggedWrong++; continue; }
    noticed++;
    const ok = parsed.direction === label.direction && Math.abs(parsed.amount - label.amount) < 0.01;
    if (parsed.direction !== label.direction) wrongSign++;
    if (logged && !ok) loggedWrong++;
  }
  expect(noticed).toBeGreaterThanOrEqual(119); // of 138 real transactions
  expect(wrongSign).toBeLessThanOrEqual(1); // slice "bill has been paid", held for Review
  // Only card bill "payment received" notices, which are logged by choice.
  expect(loggedWrong).toBeLessThanOrEqual(3);
});
