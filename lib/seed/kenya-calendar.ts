export type Holiday = {
  date: string;
  name: string;
  categoryBoost: Record<string, number>;
};

const FIXED: Omit<Holiday, "date">[] = [
  { name: "New Year's Day", categoryBoost: { ALL: 1.1 } },
  { name: "Labour Day", categoryBoost: { ALL: 1.2 } },
  { name: "Madaraka Day", categoryBoost: { ALL: 1.3 } },
  { name: "Mashujaa Day", categoryBoost: { ALL: 1.3 } },
  { name: "Jamhuri Day", categoryBoost: { ALL: 1.5, FRAGRANCE: 1.8 } },
  { name: "Christmas Day", categoryBoost: { ALL: 2.5, FRAGRANCE: 3.0, MAKEUP: 2.6, SKINCARE: 2.0 } },
  { name: "Boxing Day", categoryBoost: { ALL: 1.6 } },
  { name: "Valentine's Day", categoryBoost: { FRAGRANCE: 3.0, MAKEUP: 2.2, "LIP CARE": 2.5, ALL: 1.4 } },
  { name: "Mother's Day", categoryBoost: { SKINCARE: 2.0, FRAGRANCE: 2.2, MAKEUP: 1.8, ALL: 1.3 } },
  { name: "Father's Day", categoryBoost: { FRAGRANCE: 2.5, HAIRCARE: 1.6, ALL: 1.2 } },
];

const FIXED_DATES: Record<string, string> = {
  "New Year's Day": "01-01",
  "Labour Day": "05-01",
  "Madaraka Day": "06-01",
  "Mashujaa Day": "10-20",
  "Jamhuri Day": "12-12",
  "Christmas Day": "12-25",
  "Boxing Day": "12-26",
  "Valentine's Day": "02-14",
};

function mothersDay(year: number): string {
  const d = new Date(Date.UTC(year, 4, 1));
  const offset = (7 - d.getUTCDay()) % 7;
  const day = 1 + offset;
  return `${year}-05-${String(day).padStart(2, "0")}`;
}

function fathersDay(year: number): string {
  const d = new Date(Date.UTC(year, 5, 1));
  const offset = (7 - d.getUTCDay()) % 7;
  const day = 1 + offset + 14;
  return `${year}-06-${String(day).padStart(2, "0")}`;
}

export function kenyanHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];
  for (const h of FIXED) {
    const md = FIXED_DATES[h.name];
    if (!md) continue;
    holidays.push({ date: `${year}-${md}`, name: h.name, categoryBoost: h.categoryBoost });
  }
  holidays.push({ date: mothersDay(year), name: "Mother's Day", categoryBoost: { SKINCARE: 2.0, FRAGRANCE: 2.2, MAKEUP: 1.8, ALL: 1.3 } });
  holidays.push({ date: fathersDay(year), name: "Father's Day", categoryBoost: { FRAGRANCE: 2.5, HAIRCARE: 1.6, ALL: 1.2 } });
  return holidays;
}

export function isPaydayWeek(date: Date): boolean {
  const day = date.getUTCDate();
  return day >= 25 || (day >= 13 && day <= 16);
}

export function paydayBoost(date: Date): number {
  return isPaydayWeek(date) ? 1.6 : 1.0;
}

export function dayOfWeekMultiplier(date: Date): number {
  const dow = date.getUTCDay();
  if (dow === 5) return 1.35;
  if (dow === 6) return 1.5;
  if (dow === 0) return 0.9;
  if (dow === 1) return 0.85;
  return 1.0;
}

export function holidayBoost(date: Date, productType: string | null | undefined): { boost: number; name: string | null } {
  const isoDate = date.toISOString().slice(0, 10);
  const year = date.getUTCFullYear();
  const holidays = kenyanHolidays(year);
  let activeName: string | null = null;
  let multiplier = 1.0;
  for (const h of holidays) {
    const hDate = new Date(h.date + "T00:00:00Z");
    const diff = Math.abs((date.getTime() - hDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 3) {
      const proximity = 1 - diff / 5;
      const cat = (productType ?? "").toUpperCase();
      const catBoost = h.categoryBoost[cat] ?? h.categoryBoost["ALL"] ?? 1.0;
      const adj = 1 + (catBoost - 1) * proximity;
      if (adj > multiplier) {
        multiplier = adj;
        activeName = h.name;
      }
    } else if (isoDate === h.date) {
      const cat = (productType ?? "").toUpperCase();
      const catBoost = h.categoryBoost[cat] ?? h.categoryBoost["ALL"] ?? 1.0;
      if (catBoost > multiplier) {
        multiplier = catBoost;
        activeName = h.name;
      }
    }
  }
  return { boost: multiplier, name: activeName };
}
