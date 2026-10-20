const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export interface CalendarMonth {
  key: string;
  year: number;
  monthIndex: number;
  startDateKey: string;
  endDateKey: string;
  dayCount: number;
}

export function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  return day <= new Date(year, month, 0).getDate();
}

export function dateKeyToLocalDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function monthKeyForDateKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function currentMonthKey(now = new Date()): string {
  return toLocalDateKey(now).slice(0, 7);
}

export function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function getCalendarMonth(monthKey: string): CalendarMonth {
  if (!isValidMonthKey(monthKey)) {
    throw new Error(`Invalid calendar month: ${monthKey}`);
  }

  const year = Number(monthKey.slice(0, 4));
  const monthNumber = Number(monthKey.slice(5, 7));
  const dayCount = new Date(year, monthNumber, 0).getDate();

  return {
    key: monthKey,
    year,
    monthIndex: monthNumber - 1,
    startDateKey: `${monthKey}-01`,
    endDateKey: `${monthKey}-${String(dayCount).padStart(2, '0')}`,
    dayCount,
  };
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const month = getCalendarMonth(monthKey);
  const shifted = new Date(month.year, month.monthIndex + delta, 1);
  return currentMonthKey(shifted);
}

export function getMonthDateKey(monthKey: string, day: number): string {
  const month = getCalendarMonth(monthKey);
  const safeDay = Math.min(Math.max(Math.trunc(day), 1), month.dayCount);
  return `${monthKey}-${String(safeDay).padStart(2, '0')}`;
}

export function getMonthKeysBack(count: number, endMonthKey: string): string[] {
  return Array.from({ length: Math.max(count, 0) }, (_, index) =>
    shiftMonthKey(endMonthKey, index - count + 1),
  );
}

export function compareMonthKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

export function formatMonthKey(monthKey: string): string {
  const month = getCalendarMonth(monthKey);
  return `${MONTHS_LONG[month.monthIndex] ?? ''} ${month.year}`;
}

export function formatMonthKeyShort(monthKey: string): string {
  const month = getCalendarMonth(monthKey);
  return `${MONTHS_SHORT[month.monthIndex] ?? ''} ${String(
    month.year,
  ).slice(-2)}`;
}

export function formatMonthPeriod(monthKey: string): string {
  const month = getCalendarMonth(monthKey);
  return `${month.startDateKey.slice(8)}–${month.endDateKey.slice(
    8,
  )} ${MONTHS_LONG[month.monthIndex] ?? ''} ${month.year}`;
}

export function formatDateKey(dateKey: string): string {
  const date = dateKeyToLocalDate(dateKey);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    date.getDay()
  ];
  return `${weekday}, ${MONTHS_SHORT[date.getMonth()] ?? ''} ${date.getDate()}`;
}

export function isPastMonth(monthKey: string, activeMonthKey: string): boolean {
  return compareMonthKeys(monthKey, activeMonthKey) < 0;
}
