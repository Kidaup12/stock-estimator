import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/** YYYY-MM-DD in the tenant's tz — the determinism seed key component (D-19/D-06). */
export function tenantDayKey(tz: string, when: Date = new Date()): string {
  return formatInTimeZone(when, tz, "yyyy-MM-dd");
}

/** UTC instant for tenant-local midnight "today" — for date-range filters. */
export function tenantTodayUtc(tz: string, when: Date = new Date()): Date {
  const ymd = tenantDayKey(tz, when);
  return fromZonedTime(`${ymd}T00:00:00`, tz); // local midnight -> UTC instant
}
