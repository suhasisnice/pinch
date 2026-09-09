/**
 * Formats a number in the Indian grouping system (1,00,000 rather than
 * 100,000). Intl handles this via the en-IN locale; the manual path is a
 * fallback for JS runtimes shipped without full ICU data, which is a real
 * risk on older Android builds of Hermes.
 */
export function formatAmount(amount: number, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? false;
  const rounded = decimals ? Math.round(amount * 100) / 100 : Math.round(amount);
  const negative = rounded < 0;
  const value = Math.abs(rounded);

  let text: string;
  try {
    text = value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    });
    // Some Hermes builds ignore the locale and return plain grouping.
    if (value >= 100000 && !text.includes(',')) throw new Error('no grouping');
  } catch {
    text = manualIndianGrouping(value, decimals);
  }

  return negative ? `-${text}` : text;
}

function manualIndianGrouping(value: number, decimals: boolean): string {
  const fixed = decimals ? value.toFixed(2) : String(Math.round(value));
  const [whole, fraction] = fixed.split('.');

  if (whole.length <= 3) return fraction ? `${whole}.${fraction}` : whole;

  // Last three digits, then pairs going left: 12,34,567
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const joined = `${grouped},${lastThree}`;

  return fraction ? `${joined}.${fraction}` : joined;
}

/** "₹1,240" */
export function formatMoney(amount: number, opts?: { decimals?: boolean }): string {
  const negative = amount < 0;
  const body = formatAmount(Math.abs(amount), opts);
  return negative ? `-₹${body}` : `₹${body}`;
}

/** Compact form for tight spaces: ₹1.2k, ₹45k, ₹1.2L */
export function formatMoneyCompact(amount: number): string {
  const value = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';

  if (value >= 10000000) return `${sign}₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `${sign}₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `${sign}₹${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return `${sign}₹${Math.round(value)}`;
}

/** "2 days ago", "just now" */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffMs = now.getTime() - then;
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months === 1 ? '1mo ago' : `${months}mo ago`;
}

/** "Mon 9 Sep" */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

/** Start-of-day ISO string, in local time. */
export function startOfDayIso(date: Date = new Date()): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

/** Start of tomorrow, so day ranges can be queried as [start, end). */
export function endOfDayIso(date: Date = new Date()): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() + 1);
  return copy.toISOString();
}
