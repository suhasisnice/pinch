import * as db from '../src/db/dbService';
import { ingestMessage, reprocessRawEvent, reprocessUnresolvedRawEvents } from '../src/services/captureService';
import { addToBlocklist } from '../src/db/dbService';
import { PARSER_RULES_VERSION } from '../src/services/revalidationService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { CapturedMessage } from '../modules/pinch-capture';

beforeEach(async () => {
  db.__resetDatabaseForTests();
  await db.initDatabase(await createSqlJsAdapter());
});

const sms = (body: string, sender = 'VM-HDFCBK'): CapturedMessage => ({
  source: 'SMS',
  sender,
  body,
  receivedAt: Date.now(),
});

/**
 * The bug this phase exists to fix: before it, a message that failed any
 * gate in ingestMessage left no row anywhere. Every test here proves the
 * opposite — a RawEvent exists no matter what happened to the message, and
 * a ParsedEvent names exactly what and why.
 */
describe('every message becomes a RawEvent, whatever happens to it', () => {
  it('records a RawEvent for a message the parser rejects outright', async () => {
    const outcome = await ingestMessage(sms('OTP 482913 for Rs.500 debit. Do not share.'));
    expect(outcome).toBe('SKIPPED');

    const recent = await db.getRecentRawEvents(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].body).toContain('OTP 482913');

    const parsed = await db.getParsedEventsForRawEvent(recent[0].id);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].outcome).toBe('SKIPPED_NO_PARSE');
    expect(parsed[0].rejectReason).toContain('hard reject');
  });

  it('records a RawEvent for a blocked sender, before parsing ever runs', async () => {
    await addToBlocklist('SPAMMER', 'test');
    const outcome = await ingestMessage(sms('Rs.500 debited from A/c XX1234 at SWIGGY', 'SPAMMER'));
    expect(outcome).toBe('SKIPPED');

    const recent = await db.getRecentRawEvents(10);
    expect(recent).toHaveLength(1);
    const parsed = await db.getParsedEventsForRawEvent(recent[0].id);
    expect(parsed[0].outcome).toBe('SKIPPED_BLOCKED');
  });

  it('records a RawEvent and a QUEUED ParsedEvent for a shaky low-confidence parse', async () => {
    // No named counterparty and no account/reference — low confidence, but
    // structurally enough to parse (a notification skips the account gate).
    const outcome = await ingestMessage({
      source: 'NOTIFICATION',
      sender: 'com.some.unknownapp',
      body: 'credited by 229',
      receivedAt: Date.now(),
    });
    expect(outcome).toBe('QUEUED');

    const recent = await db.getRecentRawEvents(10);
    const parsed = await db.getParsedEventsForRawEvent(recent[0].id);
    expect(parsed[0].outcome).toBe('QUEUED');
    expect(parsed[0].captureId).not.toBeNull();
  });

  it('records a RawEvent and a POSTED ParsedEvent with the transaction id for a confident parse', async () => {
    const outcome = await ingestMessage(
      sms('Rs.369.00 spent on your SBI Credit Card ending 9124 at AmazonSellerServices on 11/09/26.')
    );
    expect(outcome).toBe('POSTED');

    const recent = await db.getRecentRawEvents(10);
    const parsed = await db.getParsedEventsForRawEvent(recent[0].id);
    expect(parsed[0].outcome).toBe('POSTED');
    expect(parsed[0].transactionId).not.toBeNull();

    const transaction = await db.getTransactionById(parsed[0].transactionId!);
    expect(transaction?.amount).toBe(369);
  });

  it('records SKIPPED_DUPLICATE for a second source reporting the same payment', async () => {
    await ingestMessage(sms('Rs.500.00 debited from A/c XX1234 at SWIGGY on 11-09-26.'));
    const outcome = await ingestMessage({
      source: 'NOTIFICATION',
      sender: 'com.swiggy.app',
      body: 'Rs.500 paid to Swiggy',
      receivedAt: Date.now(),
    });
    expect(outcome).toBe('SKIPPED');

    const recent = await db.getRecentRawEvents(10);
    const secondEvent = recent.find((r) => r.source === 'NOTIFICATION');
    const parsed = await db.getParsedEventsForRawEvent(secondEvent!.id);
    expect(parsed[0].outcome).toBe('SKIPPED_DUPLICATE');
  });
});

describe('reprocessing a raw event under the current parser', () => {
  it('recovers a message that would have been rejected under a stricter rule, without a second RawEvent', async () => {
    // Simulate "the parser used to reject this, but the rule was fixed":
    // ingest while blocked, then unblock and reprocess.
    await addToBlocklist('TEMP-BLOCK', 'simulating an old over-eager rule');
    const first = await ingestMessage(sms('Rs.200 debited from A/c XX1234 at ZOMATO on 11-09-26.', 'TEMP-BLOCK'));
    expect(first).toBe('SKIPPED');

    const [rawEvent] = await db.getRecentRawEvents(10);
    expect((await db.getParsedEventsForRawEvent(rawEvent.id))).toHaveLength(1);

    await db.removeFromBlocklist('TEMP-BLOCK');
    const second = await reprocessRawEvent(rawEvent.id);
    expect(second).toBe('POSTED');

    // Still exactly one RawEvent — reprocessing never duplicates the source
    // record — but now two ParsedEvents on file: the old rejection and the
    // new success, both kept.
    expect(await db.getRecentRawEvents(10)).toHaveLength(1);
    const history = await db.getParsedEventsForRawEvent(rawEvent.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.outcome).sort()).toEqual(['POSTED', 'SKIPPED_BLOCKED']);
  });

  it('returns null for a raw event id that does not exist', async () => {
    expect(await reprocessRawEvent(999)).toBeNull();
  });
});

describe('reprocessUnresolvedRawEvents', () => {
  it('sweeps every never-resolved message and reports what changed', async () => {
    await addToBlocklist('TEMP-BLOCK', 'simulating an old over-eager rule');
    await ingestMessage(sms('Rs.100 debited from A/c XX1234 at CAFE on 11-09-26.', 'TEMP-BLOCK'));
    await ingestMessage(sms('Rs.200 debited from A/c XX1234 at BOOKSTORE on 11-09-26.', 'TEMP-BLOCK'));
    await db.removeFromBlocklist('TEMP-BLOCK');

    const result = await reprocessUnresolvedRawEvents();
    expect(result.checked).toBe(2);
    expect(result.posted).toBe(2);
    expect(result.stillSkipped).toBe(0);

    expect(await db.getAllTransactions()).toHaveLength(2);
  });

  it('does not touch a message that already posted or is already queued', async () => {
    await ingestMessage(sms('Rs.150 debited from A/c XX1234 at CAFE on 11-09-26.'));

    const result = await reprocessUnresolvedRawEvents();
    expect(result.checked).toBe(0);
  });

  it('leaves a message rejected under the current parser marked stillSkipped, not silently dropped again', async () => {
    await ingestMessage(sms('OTP 482913 for Rs.500 debit. Do not share.'));

    const result = await reprocessUnresolvedRawEvents();
    expect(result.checked).toBe(1);
    expect(result.stillSkipped).toBe(1);

    // Two ParsedEvents now: the original rejection, and this sweep's,
    // both naming the same reason — nothing about reprocessing invents a
    // transaction just because it tried again.
    const [rawEvent] = await db.getRecentRawEvents(10);
    const history = await db.getParsedEventsForRawEvent(rawEvent.id);
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.outcome === 'SKIPPED_NO_PARSE')).toBe(true);
  });
});

/**
 * Turns "a payment went missing once" into something answerable in bulk: a
 * rule eating real transactions shows up at the top of this list, where one
 * bug report would never have revealed it.
 */
describe('what the parser is dropping, grouped by rule', () => {
  it('ranks the rules by how many messages each one caught', async () => {
    await ingestMessage(sms('OTP 482913 for Rs.500 debit. Do not share.'));
    await ingestMessage(sms('OTP 111111 for Rs.900 debit. Do not share.'));
    await ingestMessage(sms('Rs.200 debited at SWIGGY on 11-09-26.')); // names no account

    const groups = await db.getRejectionBreakdown(PARSER_RULES_VERSION);

    expect(groups[0].count).toBe(2);
    expect(groups[0].reason).toContain('hard reject');
    expect(groups[0].example).toContain('OTP');

    const structural = groups.find((g) => g.reason.includes('no account'));
    expect(structural?.count).toBe(1);
  });

  it('carries an example so the rule can be read against a real message', async () => {
    await ingestMessage(sms('Rs.200 debited at SWIGGY on 11-09-26.'));

    const [group] = await db.getRejectionBreakdown(PARSER_RULES_VERSION);
    expect(group.example).toContain('SWIGGY');
    expect(group.outcome).toBe('SKIPPED_NO_PARSE');
  });

  it('ignores messages that did become transactions', async () => {
    await ingestMessage(
      sms('Rs.369.00 spent on your SBI Credit Card ending 9124 at Amazon on 11/09/26.')
    );
    expect(await db.getRejectionBreakdown(PARSER_RULES_VERSION)).toEqual([]);
  });

  it('does not mix in explanations from a parser version that no longer exists', async () => {
    await ingestMessage(sms('OTP 482913 for Rs.500 debit. Do not share.'));
    expect(await db.getRejectionBreakdown(PARSER_RULES_VERSION + 1)).toEqual([]);
  });
});

describe('countUnresolvedRawEvents / getUnresolvedRawEvents', () => {
  it('counts only messages that never became a transaction or review item', async () => {
    await ingestMessage(sms('OTP 482913 for Rs.500 debit. Do not share.'));
    await ingestMessage(sms('Rs.369.00 spent on your SBI Credit Card ending 9124 at Amazon on 11/09/26.'));

    expect(await db.countUnresolvedRawEvents()).toBe(1);
    const unresolved = await db.getUnresolvedRawEvents();
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].body).toContain('OTP');
  });
});
