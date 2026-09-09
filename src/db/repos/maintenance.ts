import { getAdapter } from '../connection';

export interface ResetOptions {
  /** Transactions, IOUs, settlements, the capture inbox and the nudge log. */
  ledger?: boolean;
  /** People and what they owe. */
  contacts?: boolean;
  /** Savings goals and their contributions. */
  goals?: boolean;
  /** Outings and their membership. */
  outings?: boolean;
  /** Senders the user has told the app to ignore. */
  blocklist?: boolean;
  /** Budget periods, including the current one. */
  periods?: boolean;
}

/**
 * Erases whatever the user asks to erase.
 *
 * The default is deliberately not "everything": the common case is a ledger
 * poisoned by a bad import, where the user still wants their goals, their
 * friends and the list of senders they have already blocked. Wiping those too
 * would punish them for the parser's mistake.
 *
 * Order matters — children before parents — because the schema declares real
 * foreign keys and SQLite enforces them.
 */
export async function resetData(options: ResetOptions): Promise<void> {
  const db = getAdapter();
  const statements: string[] = [];

  if (options.ledger) {
    statements.push(
      `DELETE FROM Settlements;`,
      `DELETE FROM IOUs;`,
      `DELETE FROM GoalContributions;`,
      `DELETE FROM NotificationLog;`,
      `DELETE FROM CaptureInbox;`,
      `DELETE FROM Transactions;`
    );
  }

  if (options.goals) {
    // Contributions point at goals, so they go first whether or not the
    // ledger was also cleared.
    statements.push(`DELETE FROM GoalContributions;`, `DELETE FROM Goals;`);
  }

  if (options.outings) statements.push(`DELETE FROM Outings;`);
  if (options.contacts) statements.push(`DELETE FROM Settlements;`, `DELETE FROM IOUs;`, `DELETE FROM Contacts;`);
  if (options.blocklist) statements.push(`DELETE FROM CaptureBlocklist;`);
  if (options.periods) statements.push(`DELETE FROM BudgetPeriods;`);

  for (const statement of statements) {
    await db.execAsync(statement);
  }
}

/** Row counts, so the reset screen can say exactly what is about to go. */
export async function countData(): Promise<{
  transactions: number;
  captures: number;
  ious: number;
  contacts: number;
  goals: number;
  outings: number;
  blocked: number;
}> {
  const db = getAdapter();

  async function count(table: string): Promise<number> {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table};`);
    return row?.n ?? 0;
  }

  const [transactions, captures, ious, contacts, goals, outings, blocked] = await Promise.all([
    count('Transactions'),
    count('CaptureInbox'),
    count('IOUs'),
    count('Contacts'),
    count('Goals'),
    count('Outings'),
    count('CaptureBlocklist'),
  ]);

  return { transactions, captures, ious, contacts, goals, outings, blocked };
}
