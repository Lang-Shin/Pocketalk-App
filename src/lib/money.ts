export interface PesoFormatOptions {
  showCents?: boolean;
  showSign?: boolean;
}

export function formatPeso(
  amountMinor: number,
  { showCents = true, showSign = false }: PesoFormatOptions = {},
): string {
  const safeAmount = Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0;
  const absolute = Math.abs(safeAmount);
  const pesos = Math.floor(absolute / 100);
  const cents = absolute % 100;
  const sign = safeAmount < 0 ? '-' : showSign && safeAmount > 0 ? '+' : '';
  const fraction = showCents ? `.${String(cents).padStart(2, '0')}` : '';

  return `${sign}\u20B1${groupThousands(pesos)}${fraction}`;
}

export function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(value, 0) : 0;
  return `${Math.round(safeValue * 100)}%`;
}

export function minorToMajor(amountMinor: number): number {
  return Math.round(amountMinor) / 100;
}

export function parsePesoToMinor(value: string): number | null {
  const normalized = value.replace(/[\u20B1,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const [pesos, cents = ''] = normalized.split('.');
  const pesoAmount = Number(pesos);
  if (!Number.isSafeInteger(pesoAmount)) return null;

  return pesoAmount * 100 + Number(cents.padEnd(2, '0'));
}

export function formatPesoInput(amountMinor: number): string {
  const safeAmount = Math.max(0, Math.round(amountMinor));
  return (safeAmount / 100).toFixed(2);
}

function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
