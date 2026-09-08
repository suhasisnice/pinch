export type TransactionType = 'DEBIT' | 'CREDIT';

export interface Transaction {
  id?: number;
  type: TransactionType;
  amount: number;
  merchant: string;
  rawSms?: string;
  date: string; // ISO 8601
}

export type IOUStatus = 'OPEN' | 'RESOLVED';

export interface IOU {
  id?: number;
  amount: number;
  counterparty: string;
  note?: string;
  status: IOUStatus;
  createdAt: string; // ISO 8601
  resolvedAt?: string; // ISO 8601
}
