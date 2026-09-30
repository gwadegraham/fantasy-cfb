// Basketball weeks, derived from dates (#315, Hardwood B2).
//
// The app's spine is week-indexed — weeklyScore, standings, H2H, Captain, the
// weekly recap all key on a week number. CBBD games carry NO `week` field and
// there is no /calendar endpoint, so modules/cfbd-calendar.js and
// resolveCurrentWeek have no counterpart to call. The weeks have to be
// computed, and this is the one place that does it.
//
// ---- Monday to Sunday, on the EASTERN calendar ----
//
// Monday because the 2026-27 season opens on Monday 2 November, so the natural
// week boundary and the season boundary coincide. And because basketball plays
// every night: a Saturday-anchored week like football's would cut the midweek
// slate in half.
//
// EASTERN because a UTC date is the wrong day for 12% of games. Measured on the
// real 5,015-game 2026-27 schedule: 624 games fall on a different calendar day
// in ET than in UTC — every evening tip-off, since 19:00 ET is already tomorrow
// in UTC. Bucketing on UTC would file those under the wrong day, and any near a
// Sunday/Monday boundary under the wrong WEEK.
//
// ---- why a midnight timestamp is still a usable date ----
//
// 3,755 of those 5,015 games (75%) carry startTimeTbd and are stamped at
// exactly midnight ET — the same placeholder CFBD uses for an unannounced
// kickoff. That makes the TIME meaningless for three quarters of the schedule,
// but the DATE is real, and a week bucket only needs the date. Anything that
// needs a real tip-off (a Captain lock, say) has to check startTimeTbd itself.

const ZONE = 'America/New_York';
const DAY_MS = 86400000;

// The calendar date a moment falls on in Eastern time, as a UTC-midnight Date
// so week arithmetic is plain subtraction with no DST drift. Using the raw
// timestamp would make a week 167 or 169 hours long across a DST change.
function easternDay(when) {
    const d = when instanceof Date ? when : new Date(when);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA gives YYYY-MM-DD.
    return new Date(`${d.toLocaleDateString('en-CA', { timeZone: ZONE })}T00:00:00Z`);
}

// The Monday on or before a given Eastern day.
function mondayOf(easternDayUtc) {
    // getUTCDay: 0 = Sunday. Monday-start means Sunday is 6 days into its week,
    // not 0 — the off-by-one that would put every Sunday game a week early.
    const dow = easternDayUtc.getUTCDay();
    const back = (dow + 6) % 7;
    return new Date(easternDayUtc.getTime() - back * DAY_MS);
}

// Week 1 starts on the Monday of the week containing the season's first game.
//
// Derived from the schedule rather than configured: the ingest already knows
// every game, and a hardcoded date is a thing to forget every October. It also
// means a season that opens on a Tuesday still gets a week 1 that starts Monday
// rather than a bucket boundary mid-slate.
function seasonStartFrom(firstGameDate) {
    const day = easternDay(firstGameDate);
    return day && mondayOf(day);
}

// Which week a game belongs to, 1-based. null for a date before week 1 or an
// unparseable one — never 0 or a negative, which would look like a real week to
// a caller indexing an array.
function weekOf(when, seasonStart) {
    const day = easternDay(when);
    if (!day || !seasonStart) return null;
    const weeks = Math.floor((day.getTime() - seasonStart.getTime()) / (7 * DAY_MS));
    return weeks < 0 ? null : weeks + 1;
}

// The real UTC instant at which an Eastern calendar day begins.
//
// The day markers above are UTC midnight, which is convenient to do arithmetic
// on and the WRONG thing to compare a game's startDate against —
// 2026-11-16T00:00Z is 19:00 on the 15th in Eastern.
//
// Eastern is UTC-5 or UTC-4 depending on DST, so the offset is found rather
// than assumed. VALIDATE THE HOUR, NOT JUST THE DAY: the first version checked
// only that the candidate landed on the intended day, and +5h during EDT is
// 01:00 on the right day, so it was accepted and the -4 branch never ran. That
// made every bound from 15 Mar 2027 onward an hour late — and a midnight-ET
// game (the startTimeTbd placeholder 75% of the schedule carries) then fell
// outside its own week's bounds and inside the previous week's.
function easternMidnight(dayMarker) {
    const want = dayMarker.toISOString().slice(0, 10);
    for (const offsetHours of [4, 5]) {
        const candidate = new Date(dayMarker.getTime() + offsetHours * 3600000);
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(candidate).reduce((o, p) => (o[p.type] = p.value, o), {});
        const day = `${parts.year}-${parts.month}-${parts.day}`;
        // '24' is how some ICU builds spell midnight; both mean the day's start.
        const atMidnight = (parts.hour === '00' || parts.hour === '24') && parts.minute === '00';
        if (day === want && atMidnight) return candidate;
    }
    // Unreachable for any real US date — one of UTC-4/-5 always lands on
    // Eastern midnight. Kept so a zone change fails loudly rather than
    // returning an hour that only looks right.
    throw new Error(`Could not resolve Eastern midnight for ${want}`);
}

// The [start, end) bounds of a week as real instants, so they can be compared
// directly against a stored startDate:
//
//   HoopsGame.find({ startDate: { $gte: b.start, $lt: b.end } })
function weekBounds(week, seasonStart) {
    if (!seasonStart || !Number.isInteger(week) || week < 1) return null;
    const startDay = new Date(seasonStart.getTime() + (week - 1) * 7 * DAY_MS);
    const endDay = new Date(startDay.getTime() + 7 * DAY_MS);
    return { start: easternMidnight(startDay), end: easternMidnight(endDay) };
}

// Which week it is now, in the shape routes/score-update's football equivalent
// returns: { week, seasonType } or { skip: <reason> }.
//
// Refuses rather than guesses, for the same reason football's does: a wrong
// week silently scores the wrong slate, and a thrown error is recoverable in a
// way a quietly wrong number is not.
function resolveCurrentWeek({ seasonStart, lastGameDate, now = new Date(), seasonType = 'regular' } = {}) {
    if (!seasonStart) {
        return { skip: 'no basketball schedule ingested — refusing to guess the current week' };
    }
    const today = easternDay(now);
    if (!today) return { skip: 'unparseable clock' };

    if (today.getTime() < seasonStart.getTime()) {
        return { skip: 'preseason — the first week has not started' };
    }

    // Past the last scheduled week, there is nothing left to score.
    //
    // NOTE the difference from football's resolveCurrentWeek, which returns
    // "the week that just ended" when the clock falls in a GAP between calendar
    // windows. There are no gaps here: weeks are contiguous by construction, so
    // every day belongs to exactly one of them and there is nothing to fall
    // between. `lastGameDate` is the last game WE KNOW OF, so ingesting the
    // postseason extends the season on its own rather than needing a second
    // date configured.
    if (lastGameDate) {
        const lastWeek = weekOf(lastGameDate, seasonStart);
        const bounds = weekBounds(lastWeek, seasonStart);
        if (bounds && now.getTime() >= bounds.end.getTime()) {
            return { skip: 'season over — the last scheduled week has closed' };
        }
    }

    return { week: weekOf(now, seasonStart), seasonType };
}

module.exports = { easternDay, easternMidnight, mondayOf, seasonStartFrom, weekOf, weekBounds, resolveCurrentWeek, ZONE };
