"""
Kenya payday / holiday calendar helpers.

Port of lib/seed/kenya-calendar.ts — exact payday ranges, holiday dates,
and multipliers replicated so Python forecast Layer-2 matches the TS Layer-2.

All public functions accept datetime.date objects.
"""

from __future__ import annotations

import datetime
from typing import Optional


# ---------------------------------------------------------------------------
# Internal holiday data (mirrors FIXED + FIXED_DATES in the TS file)
# ---------------------------------------------------------------------------

# Each entry: (MM-DD or None for computed, name, category_boost dict)
_FIXED_DATES: dict[str, str] = {
    "New Year's Day":  "01-01",
    "Labour Day":      "05-01",
    "Madaraka Day":    "06-01",
    "Mashujaa Day":    "10-20",
    "Jamhuri Day":     "12-12",
    "Christmas Day":   "12-25",
    "Boxing Day":      "12-26",
    "Valentine's Day": "02-14",
}

_CATEGORY_BOOST: dict[str, dict[str, float]] = {
    "New Year's Day":  {"ALL": 1.1},
    "Labour Day":      {"ALL": 1.2},
    "Madaraka Day":    {"ALL": 1.3},
    "Mashujaa Day":    {"ALL": 1.3},
    "Jamhuri Day":     {"ALL": 1.5, "FRAGRANCE": 1.8},
    "Christmas Day":   {"ALL": 2.5, "FRAGRANCE": 3.0, "MAKEUP": 2.6, "SKINCARE": 2.0},
    "Boxing Day":      {"ALL": 1.6},
    "Valentine's Day": {"FRAGRANCE": 3.0, "MAKEUP": 2.2, "LIP CARE": 2.5, "ALL": 1.4},
    "Mother's Day":    {"SKINCARE": 2.0, "FRAGRANCE": 2.2, "MAKEUP": 1.8, "ALL": 1.3},
    "Father's Day":    {"FRAGRANCE": 2.5, "HAIRCARE": 1.6, "ALL": 1.2},
}


def _mothers_day(year: int) -> datetime.date:
    """
    First Sunday of May — port of TS mothersDay().

    TS:  d = new Date(UTC year, 4, 1)   ← May 1 UTC
         offset = (7 - d.getUTCDay()) % 7
         day = 1 + offset
    """
    may1 = datetime.date(year, 5, 1)
    # isoweekday(): Mon=1 … Sun=7; getUTCDay(): Sun=0 … Sat=6
    # We need UTC Sunday (getUTCDay==0).  Python: weekday() Mon=0…Sun=6
    # Sunday in Python weekday() == 6.
    dow = may1.weekday()  # 0=Mon … 6=Sun
    # offset = (7 - dow_ts) % 7  where dow_ts (getUTCDay) = (dow + 1) % 7
    dow_ts = (dow + 1) % 7  # convert Python weekday → JS getUTCDay
    offset = (7 - dow_ts) % 7
    return datetime.date(year, 5, 1 + offset)


def _fathers_day(year: int) -> datetime.date:
    """
    Third Sunday of June — port of TS fathersDay().

    TS:  d = new Date(UTC year, 5, 1)   ← June 1 UTC
         offset = (7 - d.getUTCDay()) % 7
         day = 1 + offset + 14          ← first Sunday + 2 weeks
    """
    jun1 = datetime.date(year, 6, 1)
    dow_ts = (jun1.weekday() + 1) % 7
    offset = (7 - dow_ts) % 7
    return datetime.date(year, 6, 1 + offset + 14)


def kenyan_holidays(year: int) -> list[dict]:
    """
    Return all Kenyan holidays for *year* as a list of dicts:
      { "date": "YYYY-MM-DD", "name": str, "categoryBoost": dict[str, float] }

    Mirrors kenyanHolidays(year) in the TS file exactly.
    """
    holidays: list[dict] = []

    # Fixed-date holidays
    for name, md in _FIXED_DATES.items():
        holidays.append({
            "date": f"{year}-{md}",
            "name": name,
            "categoryBoost": _CATEGORY_BOOST[name],
        })

    # Computed holidays
    holidays.append({
        "date": _mothers_day(year).isoformat(),
        "name": "Mother's Day",
        "categoryBoost": _CATEGORY_BOOST["Mother's Day"],
    })
    holidays.append({
        "date": _fathers_day(year).isoformat(),
        "name": "Father's Day",
        "categoryBoost": _CATEGORY_BOOST["Father's Day"],
    })

    return holidays


# ---------------------------------------------------------------------------
# Payday helpers
# ---------------------------------------------------------------------------

def is_payday_week(date: datetime.date) -> bool:
    """
    True when *date* falls in a Kenya payday window.

    Port of isPaydayWeek: day >= 25  OR  (day >= 13 AND day <= 16).
    """
    day = date.day
    return day >= 25 or (13 <= day <= 16)


def payday_boost(date: datetime.date) -> float:
    """1.6 on payday weeks, 1.0 otherwise. Port of paydayBoost."""
    return 1.6 if is_payday_week(date) else 1.0


# ---------------------------------------------------------------------------
# Holiday boost (single day)
# ---------------------------------------------------------------------------

def holiday_boost(
    date: datetime.date,
    product_type: Optional[str],
) -> tuple[float, Optional[str]]:
    """
    Returns (boost, holiday_name) for *date* and *product_type*.

    Port of holidayBoost(date, productType):
      - Check holidays in date.year (and date.year-1 for holidays that might
        bleed across year boundaries — e.g. New Year's Day on Jan 1).
      - Within ±3 days: linear proximity fade (1 − diff/5).
      - On the exact day (diff==0): full multiplier (proximity == 1.0).
      - Returns the highest-boost holiday; 1.0 if none applies.
    """
    iso = date.isoformat()
    year = date.year

    # Check both current and adjacent years to catch cross-year proximity
    # (e.g. Dec 31 is within 3 days of Jan 1 of the next year).
    all_holidays: list[dict] = kenyan_holidays(year)
    if date.month == 1:
        all_holidays += kenyan_holidays(year - 1)
    if date.month == 12:
        all_holidays += kenyan_holidays(year + 1)

    cat = (product_type or "").upper()
    best_boost = 1.0
    best_name: Optional[str] = None

    for h in all_holidays:
        h_date = datetime.date.fromisoformat(h["date"])
        diff = abs((date - h_date).days)

        if diff <= 3:
            proximity = 1 - diff / 5
            cat_boost = h["categoryBoost"].get(cat) or h["categoryBoost"].get("ALL", 1.0)
            adj = 1 + (cat_boost - 1) * proximity
            if adj > best_boost:
                best_boost = adj
                best_name = h["name"]
        elif iso == h["date"]:
            # exact-day fallback (diff would be 0 if the date matches, covered above)
            cat_boost = h["categoryBoost"].get(cat) or h["categoryBoost"].get("ALL", 1.0)
            if cat_boost > best_boost:
                best_boost = cat_boost
                best_name = h["name"]

    return best_boost, best_name


# ---------------------------------------------------------------------------
# Lookahead helpers (used in forecast Layer-2)
# ---------------------------------------------------------------------------

def lookahead_holiday_boost(
    product_type: Optional[str],
    today: datetime.date,
    days: int = 30,
) -> tuple[float, Optional[str]]:
    """
    Return the best (boost, name) across the next *days* days.

    Port of lookaheadHolidayBoost in simulate-layers.ts.
    """
    best_boost = 1.0
    best_name: Optional[str] = None

    for d_offset in range(days):
        dt = today + datetime.timedelta(days=d_offset)
        boost, name = holiday_boost(dt, product_type)
        if boost > best_boost:
            best_boost = boost
            best_name = name

    return best_boost, best_name


def lookahead_paydays(today: datetime.date, days: int = 30) -> int:
    """
    Count how many days in the next *days* days fall in a payday window.

    Port of lookaheadPaydays in simulate-layers.ts.
    """
    count = 0
    for d_offset in range(days):
        dt = today + datetime.timedelta(days=d_offset)
        if is_payday_week(dt):
            count += 1
    return count
