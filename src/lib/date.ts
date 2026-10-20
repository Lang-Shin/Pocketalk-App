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

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDifference(target: Date, reference: Date): number {
  const milliseconds =
    startOfLocalDay(target).getTime() - startOfLocalDay(reference).getTime();
  return Math.round(milliseconds / 86_400_000);
}

export interface RecordedStamp {
  recordedAt: string;
  recordedTimeZone: string;
  recordedOffsetMinutes: number;
}

export function captureRecordedStamp(date = new Date()): RecordedStamp {
  return {
    recordedAt: date.toISOString(),
    recordedTimeZone:
      typeof Intl === 'undefined'
        ? 'Local time'
        : Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time',
    recordedOffsetMinutes: -date.getTimezoneOffset(),
  };
}

function recordedLocalDate(isoDate: string, offsetMinutes: number): Date {
  return new Date(new Date(isoDate).getTime() + offsetMinutes * 60_000);
}

export function recordedDateKey(
  isoDate: string,
  offsetMinutes: number,
): string {
  const date = recordedLocalDate(isoDate, offsetMinutes);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function formatTime(
  isoDate: string,
  offsetMinutes?: number,
): string {
  const date = new Date(isoDate);
  const offsetDate =
    offsetMinutes === undefined
      ? null
      : recordedLocalDate(isoDate, offsetMinutes);
  const hours = offsetDate ? offsetDate.getUTCHours() : date.getHours();
  const minutes = String(
    offsetDate ? offsetDate.getUTCMinutes() : date.getMinutes(),
  ).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${period}`;
}

export function formatDayLabel(isoDate: string, now = new Date()): string {
  const date = new Date(isoDate);
  const difference = dayDifference(date, now);

  if (difference === 0) return 'Today';
  if (difference === -1) return 'Yesterday';

  const weekday = WEEKDAYS_SHORT[date.getDay()] ?? '';
  const month = MONTHS_SHORT[date.getMonth()] ?? '';
  return `${weekday}, ${month} ${date.getDate()}`;
}

export function formatLongDate(date = new Date()): string {
  const weekday = WEEKDAYS_SHORT[date.getDay()] ?? '';
  const month = MONTHS_LONG[date.getMonth()] ?? '';
  return `${weekday}, ${date.getDate()} ${month}`;
}

export function formatMonthYear(date = new Date()): string {
  const month = MONTHS_LONG[date.getMonth()] ?? '';
  return `${month} ${date.getFullYear()}`;
}

export function formatMonthShort(isoDate: string): string {
  const date = new Date(isoDate);
  return `${MONTHS_SHORT[date.getMonth()] ?? ''} ${date.getDate()}`;
}

export function toDateKey(isoDate: string): string {
  const date = new Date(isoDate);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
