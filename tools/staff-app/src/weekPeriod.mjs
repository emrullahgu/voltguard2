import { localISODate } from './operations.mjs';

/** Monday–Sunday in the browser's local calendar; copy the Monday before advancing across month/year boundaries. */
export function currentWeekPeriod(date = new Date()) {
  const monday = new Date(date);
  if (!Number.isFinite(monday.getTime())) throw new RangeError('Geçerli bir tarih gereklidir.');
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: localISODate(monday), end: localISODate(sunday) };
}
