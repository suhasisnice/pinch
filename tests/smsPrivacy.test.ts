import { isPersonalSender, isWorthKeeping, redactOtp } from '../src/services/smsPrivacy';
import { ingestMessage } from '../src/services/captureService';
import * as db from '../src/db/dbService';
import { createSqlJsAdapter } from './utils/sqljsAdapter';
import { V18_SMS_PRIVACY } from '../src/db/migrations';
import { getAdapter } from '../src/db/connection';

describe('isWorthKeeping', () => {
  it('drops a friend texting from a phone number, even about money', () => {
    expect(isPersonalSender('+91 98765 43210')).toBe(true);
    expect(isWorthKeeping('+919876543210', 'sent you Rs 500 for pizza')).toBe(false);
    expect(isWorthKeeping('9876543210', 'dinner at 8?')).toBe(false);
  });

  it('keeps a bank header talking about money', () => {
    expect(isWorthKeeping('AX-HDFCBK', 'Rs.450 debited from a/c XX1234')).toBe(true);
    expect(isWorthKeeping('VM-SBIUPI', 'Your UPI payment of INR 120 is successful')).toBe(true);
  });

  it('drops a business header with nothing about money', () => {
    expect(isWorthKeeping('JD-SWIGGY', 'Your order is on the way!')).toBe(false);
  });
});

describe('redactOtp', () => {
  it('masks the code and keeps the amount', () => {
    const out = redactOtp('OTP 482913 for Rs.2400 at Amazon. Do not share.');
    expect(out).toContain('••••••');
    expect(out).not.toContain('482913');
    expect(out).toContain('Rs.2400');
  });

  it('leaves ordinary bank messages alone', () => {
    const text = 'Rs.450 debited from a/c XX1234 ref 123456';
    expect(redactOtp(text)).toBe(text);
  });
});

describe('ingestMessage', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('never stores a personal SMS, not even as a raw event', async () => {
    const result = await ingestMessage(
      {
        source: 'SMS',
        sender: '+919876543210',
        body: 'owe you Rs 200 btw',
        receivedAt: Date.now(),
      },
      { silent: true }
    );
    expect(result).toBe('SKIPPED');
    expect(await db.getRecentRawEvents(10)).toHaveLength(0);
  });
});

describe('migration v18', () => {
  beforeEach(async () => {
    db.__resetDatabaseForTests();
    await db.initDatabase(await createSqlJsAdapter());
  });

  it('removes stored personal and OTP texts, keeps bank messages and anything behind a ledger row', async () => {
    const personal = await db.recordRawEvent({
      source: 'SMS',
      sender: '+919876543210',
      body: 'coming to the party?',
      receivedAt: new Date().toISOString(),
    });
    const otp = await db.recordRawEvent({
      source: 'SMS',
      sender: 'AX-HDFCBK',
      body: 'OTP 123456 for your login',
      receivedAt: new Date().toISOString(),
    });
    const bank = await db.recordRawEvent({
      source: 'SMS',
      sender: 'AX-HDFCBK',
      body: 'Rs.450 debited from a/c XX1234',
      receivedAt: new Date().toISOString(),
    });

    const adapter = getAdapter();
    for (const statement of V18_SMS_PRIVACY.statements) await adapter.execAsync(statement);

    const left = (await db.getRecentRawEvents(10)).map((r) => r.id);
    expect(left).toEqual([bank]);
    expect(left).not.toContain(personal);
    expect(left).not.toContain(otp);
  });
});
