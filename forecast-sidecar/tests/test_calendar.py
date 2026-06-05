"""
TDD tests for app/calendar_ke.py — Task A2.

Written BEFORE implementation to drive the port from lib/seed/kenya-calendar.ts.
All date comparisons use UTC dates (no local-tz ambiguity).
"""

import datetime
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def d(iso: str) -> datetime.date:
    return datetime.date.fromisoformat(iso)


# ---------------------------------------------------------------------------
# is_payday_week
# ---------------------------------------------------------------------------

class TestIsPaydayWeek:
    def test_day_13_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-13")) is True

    def test_day_14_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-14")) is True

    def test_day_15_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-15")) is True

    def test_day_16_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-16")) is True

    def test_day_25_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-25")) is True

    def test_day_31_is_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-31")) is True

    def test_day_12_not_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-12")) is False

    def test_day_17_not_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-17")) is False

    def test_day_24_not_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-24")) is False

    def test_day_1_not_payday(self):
        from app.calendar_ke import is_payday_week
        assert is_payday_week(d("2024-01-01")) is False


# ---------------------------------------------------------------------------
# payday_boost
# ---------------------------------------------------------------------------

class TestPaydayBoost:
    def test_payday_week_returns_1_6(self):
        from app.calendar_ke import payday_boost
        assert payday_boost(d("2024-01-15")) == pytest.approx(1.6)

    def test_non_payday_returns_1_0(self):
        from app.calendar_ke import payday_boost
        assert payday_boost(d("2024-01-20")) == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# holiday_boost
# ---------------------------------------------------------------------------

class TestHolidayBoost:
    def test_christmas_day_all_category(self):
        """Christmas Day (12-25) with generic product type → ALL boost 2.5."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-25"), "skincare")
        # Christmas: ALL=2.5, SKINCARE=2.0.  SKINCARE wins (2.0) but "ALL" fallback is 2.5.
        # TS: cat = SKINCARE → catBoost = h.categoryBoost["SKINCARE"] = 2.0; but ALL=2.5
        # Wait: catBoost = h.categoryBoost[cat] ?? h.categoryBoost["ALL"] — SKINCARE IS in the map (2.0)
        # so SKINCARE gets 2.0.  But... on exact day diff=0 → proximity = 1 - 0/5 = 1.0
        # adj = 1 + (2.0 - 1) * 1.0 = 2.0
        assert boost == pytest.approx(2.0)
        assert name == "Christmas Day"

    def test_christmas_fragrance(self):
        """Christmas Day FRAGRANCE → 3.0."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-25"), "fragrance")
        assert boost == pytest.approx(3.0)
        assert name == "Christmas Day"

    def test_christmas_generic_none_uses_all(self):
        """No product type → falls back to ALL=2.5."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-25"), None)
        assert boost == pytest.approx(2.5)
        assert name == "Christmas Day"

    def test_non_holiday_returns_1_0(self):
        """A random day far from any holiday → 1.0."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-07-10"), None)
        assert boost == pytest.approx(1.0)
        assert name is None

    def test_holiday_3_days_before_fades(self):
        """3 days before Christmas (12-22) → diff=3, proximity=1-3/5=0.4, adj=1+(2.5-1)*0.4=1.6."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-22"), None)
        assert boost == pytest.approx(1 + (2.5 - 1) * (1 - 3 / 5))
        assert name == "Christmas Day"

    def test_holiday_4_days_before_no_boost(self):
        """4 days before Christmas → diff=4 > 3, no boost."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-21"), None)
        assert boost == pytest.approx(1.0)

    def test_valentines_fragrance(self):
        """Valentine's Day fragrance → 3.0."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-02-14"), "fragrance")
        assert boost == pytest.approx(3.0)
        assert name == "Valentine's Day"

    def test_jamhuri_day_fragrance(self):
        """Jamhuri Day (12-12) FRAGRANCE → 1.8."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-12-12"), "fragrance")
        assert boost == pytest.approx(1.8)
        assert name == "Jamhuri Day"

    def test_new_years_day(self):
        """New Year's Day (01-01) → ALL 1.1."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2025-01-01"), None)
        assert boost == pytest.approx(1.1)
        assert name == "New Year's Day"

    def test_labour_day(self):
        """Labour Day (05-01) → ALL 1.2."""
        from app.calendar_ke import holiday_boost
        boost, name = holiday_boost(d("2024-05-01"), None)
        assert boost == pytest.approx(1.2)
        assert name == "Labour Day"


# ---------------------------------------------------------------------------
# kenyan_holidays (spot-check computed dates)
# ---------------------------------------------------------------------------

class TestKenyanHolidays:
    def test_2024_contains_christmas(self):
        from app.calendar_ke import kenyan_holidays
        hols = kenyan_holidays(2024)
        dates = {h["date"]: h for h in hols}
        assert "2024-12-25" in dates
        assert dates["2024-12-25"]["name"] == "Christmas Day"

    def test_2024_mothers_day_is_first_sunday_of_may(self):
        """May 1 2024 is Wednesday. First Sunday = May 5."""
        from app.calendar_ke import kenyan_holidays
        hols = kenyan_holidays(2024)
        dates = {h["date"]: h for h in hols}
        assert "2024-05-05" in dates
        assert dates["2024-05-05"]["name"] == "Mother's Day"

    def test_2024_fathers_day_is_third_sunday_of_june(self):
        """June 1 2024 is Saturday. First Sunday = June 2. Third Sunday = June 16."""
        from app.calendar_ke import kenyan_holidays
        hols = kenyan_holidays(2024)
        dates = {h["date"]: h for h in hols}
        assert "2024-06-16" in dates
        assert dates["2024-06-16"]["name"] == "Father's Day"

    def test_yields_8_fixed_plus_2_computed(self):
        from app.calendar_ke import kenyan_holidays
        hols = kenyan_holidays(2024)
        assert len(hols) == 10


# ---------------------------------------------------------------------------
# lookahead_holiday_boost
# ---------------------------------------------------------------------------

class TestLookaheadHolidayBoost:
    def test_boost_above_1_approaching_christmas(self):
        """20 Dec 2024: Christmas is 5 days away (within lookahead=30), should boost."""
        from app.calendar_ke import lookahead_holiday_boost
        boost, name = lookahead_holiday_boost(None, d("2024-12-20"), days=30)
        assert boost > 1.0
        assert name is not None

    def test_no_boost_far_from_holidays(self):
        """A date far from all holidays with a short lookahead window → 1.0."""
        from app.calendar_ke import lookahead_holiday_boost
        # July 10–August 9: no Kenyan public holidays in that window
        boost, name = lookahead_holiday_boost(None, d("2024-07-10"), days=30)
        assert boost == pytest.approx(1.0)

    def test_fragrance_higher_than_all_near_christmas(self):
        """Near Christmas, FRAGRANCE gets a higher boost than None/ALL."""
        from app.calendar_ke import lookahead_holiday_boost
        boost_all, _ = lookahead_holiday_boost(None, d("2024-12-20"), days=30)
        boost_frag, _ = lookahead_holiday_boost("fragrance", d("2024-12-20"), days=30)
        assert boost_frag >= boost_all


# ---------------------------------------------------------------------------
# lookahead_paydays
# ---------------------------------------------------------------------------

class TestLookaheadPaydays:
    def test_count_is_non_negative(self):
        from app.calendar_ke import lookahead_paydays
        count = lookahead_paydays(d("2024-01-01"), days=30)
        assert count >= 0

    def test_early_january_has_paydays(self):
        """Jan 1 → 30-day window covers days 13-16 AND 25-31 (7 days total)."""
        from app.calendar_ke import lookahead_paydays
        count = lookahead_paydays(d("2024-01-01"), days=30)
        # Days 13,14,15,16 (4) + days 25-30 (6) within Jan = 10 payday days
        assert count == 10

    def test_days_parameter(self):
        """With days=7 starting Jan 1, no payday days in range (1-7)."""
        from app.calendar_ke import lookahead_paydays
        count = lookahead_paydays(d("2024-01-01"), days=7)
        assert count == 0

    def test_starting_jan_13_within_7(self):
        """Jan 13 + 7 days = Jan 13-19. Payday days: 13,14,15,16 = 4."""
        from app.calendar_ke import lookahead_paydays
        count = lookahead_paydays(d("2024-01-13"), days=7)
        assert count == 4
