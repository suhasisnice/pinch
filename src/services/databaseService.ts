/**
 * PHASE 1 CONTRACT STUB — NOT THE REAL IMPLEMENTATION.
 *
 * Phase 1 (owned by the other engineer) provides the real SQLite-backed
 * `addTransaction`, `createIOU`, and `resolveIOUByAmount`. This file exists
 * only so Phase 2 (parserService.ts, ParserScreen.tsx) has a concrete module
 * to import and run against locally.
 *
 * Integration contract: once Phase 1 lands, delete this file's body and
 * replace it with the real one — as long as it exports functions with these
 * same names, parameter shapes, and return types, nothing in Phase 2 needs
 * to change.
 */
import { IOU, Transaction } from '../types';

const transactions: Transaction[] = [];
const ious: IOU[] = [];
let nextTransactionId = 1;
let nextIouId = 1;

export async function addTransaction(
  transaction: Omit<Transaction, 'id'>
): Promise<Transaction> {
  const saved: Transaction = { ...transaction, id: nextTransactionId++ };
  transactions.push(saved);
  return saved;
}

export async function createIOU(
  iou: Omit<IOU, 'id' | 'status' | 'createdAt'>
): Promise<IOU> {
  const saved: IOU = {
    ...iou,
    id: nextIouId++,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
  };
  ious.push(saved);
  return saved;
}

export async function resolveIOUByAmount(
  amount: number,
  counterparty?: string
): Promise<IOU | null> {
  const match = ious.find(
    (iou) =>
      iou.status === 'OPEN' &&
      iou.amount === amount &&
      (!counterparty ||
        iou.counterparty.toLowerCase() === counterparty.toLowerCase())
  );
  if (!match) return null;

  match.status = 'RESOLVED';
  match.resolvedAt = new Date().toISOString();
  return match;
}

// Test-only helpers, not part of the Phase 1 contract.
export function __resetDatabaseForTests(): void {
  transactions.length = 0;
  ious.length = 0;
  nextTransactionId = 1;
  nextIouId = 1;
}

export function __getTransactionsForTests(): Transaction[] {
  return transactions;
}

export function __getIOUsForTests(): IOU[] {
  return ious;
}
