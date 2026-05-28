# Plan 01-01 — Runbook for Roy

**Purpose:** Steps Claude could not execute autonomously (require Docker, Postgres, browser, or a live `npm run dev`). Run these in order on your Windows host. Each section says exactly what to do and what success looks like.

**When to run what:**

| Step | When | Reason |
|------|------|--------|
| §A Task 0 baseline | **BEFORE you merge / before Claude's Task 2 schema flip lands on your branch** | Captures the pre-Postgres SQLite baseline (FND-01 literal compliance). |
| §B Bring up Postgres + apply baseline migration | **AFTER Task 2 commit** (`feat(01-01): flip Prisma to Postgres ...`) | Runs the baseline migration against a fresh Postgres. |
| §C Create the Phase 1 delta migration | **Immediately after §B** | Generates the `*_phase1_onorder_forecastrun` migration directory. You commit this yourself (Claude can't because the timestamped dirname is unknown until `prisma migrate dev` runs). |
| §D Boot check on Postgres | **After §C** | Confirms seed + dashboard work end-to-end on Postgres. |

---

## §A — Task 0: Pre-change SQLite baseline (FND-01 literal compliance)

**Do this BEFORE any of the Plan 01-01 commits land on your working tree.** If you've already pulled the Plan 01-01 commits, `git checkout 91e726f -- prisma/schema.prisma next.config.ts package.json` (the pre-Plan-01-01 HEAD) before running this section, then `git checkout main -- prisma/schema.prisma next.config.ts package.json` after to restore.

```bash
# 1. Confirm clean working tree
git status   # should be clean

# 2. Install + materialize SQLite schema
npm install              # postinstall runs prisma generate
npx prisma db push       # creates prisma/dev.db with current SQLite schema

# 3. Boot dev server (background it — Ctrl-C kills it when you're done)
npm run dev              # 5-10s to be ready
```

**4. In a browser:**

a. Open http://localhost:3000/settings
b. Enter shop name = "Beauty Square Baseline", domain = "beautysquareke.co", token blank.
c. Click **Test Connection** → expect `{ ok: true, mock: true }` (or similar).
d. Click **Seed catalog** → wait for `{ ok: true, productsSeeded: N }`. **Record N.**
e. Click **Generate forecasts** → wait for `{ ok: true, forecastsCreated: N }`. **Record N.**
f. Open http://localhost:3000/dashboard → confirm Urgent / Review / All tabs render with products. **Screenshot.**

```bash
# 5. Stop the dev server (Ctrl-C in the terminal that ran npm run dev).
# 6. Confirm no edits leaked:
git status               # should still be clean
```

**Paste the N values and screenshot file path into `01-01-SUMMARY.md` under "Baseline (Task 0)".**

---

## §B — After Task 2 lands: bring up Postgres + apply baseline migration

```bash
# 1. Make sure Docker Desktop is running.
# 2. Bring up local Postgres
docker compose up -d db
docker compose ps                 # db should be Up + healthy

# 3. Copy env template and fill in DATABASE_URL + DIRECT_URL
cp .env.example .env
# Edit .env, set BOTH of these (local: same URL — no pooler locally):
#   DATABASE_URL="postgresql://wezesha:wezesha_dev@localhost:5433/wezesha?schema=public"
#   DIRECT_URL="postgresql://wezesha:wezesha_dev@localhost:5433/wezesha?schema=public"

# 4. Generate the Prisma client against the new Postgres schema
npx prisma generate

# 5. Apply the baseline migration (Claude already authored prisma/migrations/20260528000000_init/migration.sql)
npx prisma migrate deploy

# Expected output: "1 migration applied: 20260528000000_init"
```

If `migrate deploy` errors with "drift detected": the local DB was left in an inconsistent state. Easiest fix:
```bash
docker compose down -v   # wipes the volume
docker compose up -d db
npx prisma migrate deploy
```

---

## §C — Create the Phase 1 delta migration

This step **requires** §B to have run successfully (live Postgres + baseline applied).

The schema deltas (`Product.onOrder`, `Product.expectedArrivalAt`, `Product.receivedAt`, `Prediction.forecastRunId`, `Prediction.regime`, composite index) are **already in `prisma/schema.prisma`** — Claude added them in the Task 2 commit. Running `prisma migrate dev` now will diff the live DB against the schema and produce the delta migration:

```bash
npx prisma migrate dev --name phase1_onorder_forecastrun
```

**Expected output:**
- New directory created: `prisma/migrations/<timestamp>_phase1_onorder_forecastrun/`
- File: `prisma/migrations/<timestamp>_phase1_onorder_forecastrun/migration.sql`
- Applied to your local DB.
- Prisma client regenerated.

**Verify the generated SQL contains:**
```sql
ALTER TABLE "Product" ADD COLUMN "onOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "expectedArrivalAt" TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "receivedAt" TIMESTAMP(3);
ALTER TABLE "Prediction" ADD COLUMN "forecastRunId" TEXT NOT NULL;
ALTER TABLE "Prediction" ADD COLUMN "regime" TEXT;
CREATE INDEX "Prediction_tenantId_productId_runDate_idx" ON "Prediction"("tenantId", "productId", "runDate");
```

**Commit the new migration directory yourself:**
```bash
git add prisma/migrations/<timestamp>_phase1_onorder_forecastrun/
git commit -m "feat(01-01): add Phase 1 delta migration (onOrder + forecastRunId + regime)"
```

---

## §D — Boot check on Postgres (FND-01 success criterion #1)

```bash
npm install              # ensures Prisma client is fresh
npm run seed             # tsx scripts/seed-from-beautysquare.ts && tsx scripts/synth-sales-history.ts
npm run dev              # http://localhost:3000
```

**Open http://localhost:3000/settings** → walk the same flow as Task 0:
1. Configure shop ("Beauty Square Postgres" or similar).
2. Click **Seed catalog** → expect `productsSeeded > 0`.
3. Click **Generate forecasts** → **may error** because Plan 02 hasn't landed yet. That's expected and documented; the route still references `Math.random`, lacks the seeded RNG, and may break on the new forecastRunId field handling. **The seed + dashboard read path is what we're proving here.**
4. Open http://localhost:3000/dashboard → confirm Urgent / Review / All tabs render with products.

**If the dashboard renders with seeded products: FND-01 is met for the Postgres rebuild.** Paste the N value (productsSeeded) into `01-01-SUMMARY.md`.

---

## §E — Sanity verification (anything-broken-leftover check)

```bash
# 1. Confirm prisma/dev.db is gone and ignored
test -f prisma/dev.db && echo "FAIL: dev.db still here" || echo "OK: dev.db removed"
git ls-files prisma/dev.db   # should print nothing
git check-ignore -v prisma/dev.db   # should print a matching .gitignore line

# 2. Confirm schema is Postgres
grep "provider" prisma/schema.prisma   # provider  = "postgresql"
grep "directUrl" prisma/schema.prisma  # directUrl = env("DIRECT_URL")

# 3. Confirm package.json scripts
grep -E "db:migrate|db:push" package.json
# db:migrate: present
# db:migrate:deploy: present
# db:push: ABSENT

# 4. Confirm next.config.ts
grep "outputFileTracingIncludes" next.config.ts   # no match
grep "dev.db" next.config.ts                       # no match

# 5. Confirm README
grep "npm run db:migrate" README.md   # match
grep "docker compose up" README.md     # match
grep "npx prisma db push" README.md   # no match (replaced)
grep "/onboarding" README.md           # no match (replaced with /settings)
```

If all of the above are green, Plan 01-01 is fully complete and Plan 01-02 is unblocked.
