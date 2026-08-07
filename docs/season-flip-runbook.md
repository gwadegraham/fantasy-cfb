# Season Flip Runbook (e.g. 2025 → 2026)

Steps to open a new season. **Order matters:** the data loads, engagement, and
draft config all take an explicit season and can be staged anytime; but the
**Season Roster** action writes to the *active* season (`process.env.YEAR`), so
it must come **after** you flip `YEAR`. Substitute the new year for `2026` below.

## TL;DR checklist

Stage anytime (explicit season — safe to do before the flip):
- [ ] **Enrich teams** for 2026 — full/preseason mode (SP+ / FPI / talent / returning / coaches / conference)
- [ ] **Expected Wins** for 2026 (needs the season subdoc from Enrich first)
- [ ] **CFP Odds** for 2026 (manual paste — make + champ boards)
- [ ] **Ingest the full 2026 schedule** ← easy to forget; grades are silently wrong without it
- [ ] **Configure Engagement** for 2026 per league (H2H + Captain) — off by default otherwise
- [ ] **Configure the 2026 Draft** per league

The pivot:
- [ ] **Set `YEAR=2026`** in the prod (Heroku) config vars and restart

After the flip (writes to the active season):
- [ ] **Populate the 2026 Season Roster** — add each returning manager
- [ ] Run the draft
- [ ] Spot-check draft grades render after the draft

---

## Step detail

### 1. Enrich teams — `POST /teams/2026/enrich` (full/preseason)
Admin → **Enrichment** (or `node update-enrichment-job.js 2026 preseason`).
Creates each team's 2026 season subdoc with SP+/FPI/talent/coach/conference.
The `preseason` mode (scope=all) is required here — it pulls the season-fixed
fields (talent, returning production, coaches) that the *weekly* Tuesday job no
longer fetches. Run it once before the draft.
*If skipped:* the draft pool and grades silently fall back to **2025** ratings.
SP+ itself falls back to the prior year until CFBD publishes the new season.

> Note: the scheduled Tuesday enrichment runs `scope=weekly` (SP+/FPI + media
> only, ~3 CFBD calls) all season. Talent/returning/coaches don't change
> in-season, so they're pulled once here rather than every week.

### 2. Expected Wins — `POST /teams/2026/expectedWins`
Admin → **Expected Wins**. Reads `json/expectedWins2026.json` (already present).
Requires the season subdoc from step 1 to exist first.

### 3. CFP Odds — `POST /teams/2026/cfp-odds`
Admin → **CFP Odds**. Paste the market **make** and **champ** boards (dry-run,
then commit). *If skipped:* the projection falls back to an SP+-rank make-prob —
degraded, not obviously so.

### 4. Ingest the full 2026 schedule — `POST /games/2026/schedule`  ⚠️
Admin → **Ingest Full Schedule / Schedule**. **The most-forgotten step.**
*If skipped:* every team's regular-season projection zeroes out and Draft Grades
compute from postseason points only — a full, **convincing-but-wrong** payload
with no error and no empty state. Load it and spot-check before draft day.

> Postseason (mid-December, once the bowl/CFP bracket is published): re-hit the
> same route with `{ "seasonType": "postseason" }` to preload the bowl schedule.
> Not required for scoring (the nightly job pulls postseason games itself), but
> it lets the **live poller** detect day-1 postseason kickoffs the first
> afternoon rather than waiting for that night's job.

### 5. Configure Engagement (per league) — `POST /scoring-config/:league/engagement`
Admin → **Engagement**, pick season **2026** in the dropdown. Set H2H + Captain
per league. *If skipped:* `engagementForSeason` returns OFF defaults, so both
silently disable for 2026 until configured.

> The H2H win/tie bonus is **banked into the weekly scores** by
> `POST /scores/h2h-bonus`, which every scoring run calls between `updateScores`
> and `updateCumulativeScores` — so it lands in `cumulativeScore` and the Hall of
> Fame, My Team rank, weekly recap and projections all agree with the standings.
> Nothing to run by hand: the pass re-derives from scratch each time, so turning
> the mode on/off or changing the bonus mid-season self-corrects on the next run.

### 6. Configure the 2026 Draft (per league)
Admin → **Configure Draft** (defaults to the active season). Sets pick order
(reverse-2025-standings default, reorderable) and creates the `Draft` doc the
draft room needs. Nothing carries over from 2025; a fresh draft starts clean.

### 7. Flip `YEAR=2026` (the pivot)
Set the `YEAR` config var to `2026` in prod and restart. This switches the
scoring jobs, standings, records, team-enrichment reads, roster queries, and the
season lock to 2026. There is no admin UI for this — it's an env var.

### 8. Populate the 2026 Season Roster (after the flip)
Admin → **Season Roster**, toggle each returning manager in. This writes to
`process.env.YEAR`, so it only targets 2026 **after** step 7. *If skipped:*
Standings and My Team are empty (no 2026 members).

### 9. Draft, then grades
Run the live draft (commissioner clicks **Start Draft**; there is no auto-open
or per-pick clock, so cover absent managers by picking for the on-the-clock
slot). After it completes, confirm grades render in the draft-room panel and the
profile chip.

---

## Post-flip verification
- Standings loads for each league (managers present; empty state is fine pre-scoring).
- My Team shows the 2026 preseason state.
- Draft Room shows the configured 2026 draft (not "no draft scheduled").
- Draft Grades render and look sane (schedule + enrich + odds all loaded).
- Hall of Fame shows 2023–2025 and does **not** crown 2026 yet.
- H2H + Captain are on where you configured them.

## Notes / gotchas
- **Draft Grades degrade silently, never empty** — always spot-check after loading data.
- **Hall of Fame** crowns a season once it's a past season *or* its postseason is
  scored; the in-progress season is never crowned (fixed in PR #240).
- **Draft completion** merges teams into the season and preserves `franchiseName`
  (fixed in PR #240) — but re-running a *completed* draft after a reset leaves the
  old teams on rosters until the next completion overwrites them.
- **Confirm `YEAR`** is actually `2026` in prod before drafting — the draft writes
  rosters to the active season, and a mismatch lands them in the wrong year.
