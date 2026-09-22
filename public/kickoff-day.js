// The one way to turn a game's startDate into a day, a date and a time
// (client + server; UMD so both can load this one file).
//
// Why this exists: CFBD has no kickoff TIME for a game until roughly 12 days
// out, and it does not send a null — it sends midnight EASTERN as a placeholder
// and flags the row startTimeTBD. Midnight ET is 04:00Z during daylight saving,
// and every renderer in the app did `new Date(startDate).getDay()`, which reads
// that instant in the VIEWER's zone. In Central that is 11:00 PM the night
// before, so Miami's four TBD October games all advertised themselves as Friday
// games on the team page, the standings, the home cards, the scoreboard's day
// headings and the betting game picker.
//
// The placeholder is an ET CALENDAR DATE wearing a timestamp's clothes, so that
// is how it has to be read back: for a TBD game the day comes from the Eastern
// zone, whatever zone the viewer is in. A game with a real kickoff is an actual
// instant and keeps being formatted locally, exactly as before — which is also
// why this is not "just format everything in Eastern".
//
// The one zone it was ever right in is Eastern. Everywhere west of there —
// which is most of this league — every TBD game on the schedule was showing the
// day before, all season, and the DST change does not rescue it: midnight EST
// is 05:00Z, which is still 11:00 PM the previous night in Central.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccKickoff = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    var ET = 'America/New_York';
    var SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    // Intl.DateTimeFormat construction is the expensive part, not formatting, so
    // the formatters are built once per (zone, shape) and kept — the same reason
    // h2h-card.js hoists its own. A standings week builds a card per game and
    // each card asks for a day, a date and a time; without this that is a dozen
    // fresh formatters per card on a phone.
    var cache = {};
    function formatter(zone, key, opts) {
        var id = (zone || 'local') + '|' + key;
        if (!cache[id]) {
            var config = { timeZone: zone };
            for (var k in opts) config[k] = opts[k];
            cache[id] = new Intl.DateTimeFormat('en-US', config);
        }
        return cache[id];
    }

    // Formatted fields in one zone, as a { type: value } map. `zone` of
    // undefined means the viewer's own zone, which is what Intl already does
    // with an absent timeZone — so the non-TBD path stays byte-identical to the
    // hand-rolled getDay()/getHours() it replaces.
    function fields(d, zone, key, opts) {
        var out = {};
        formatter(zone, key, opts).formatToParts(d).forEach(function (p) {
            out[p.type] = p.value;
        });
        return out;
    }

    // Everything a caller might want about one kickoff, or null if there is no
    // usable date. Callers fall back to '' on null rather than printing
    // "Invalid Date", which is what the old inline formatters did print.
    function parts(startDate, tbd) {
        if (!startDate) return null;
        var d = new Date(startDate);
        if (isNaN(d.getTime())) return null;

        var zone = tbd ? ET : undefined;
        var day = fields(d, zone, 'day', { weekday: 'long', month: 'numeric', day: 'numeric', year: 'numeric' });
        var mon = fields(d, zone, 'mon', { month: 'short' });
        var time = fields(d, zone, 'time', { hour: 'numeric', minute: '2-digit', hour12: true });

        var weekdayLong = day.weekday || '';
        return {
            tbd: !!tbd,
            weekdayLong: weekdayLong,
            weekdayShort: weekdayLong ? weekdayLong.slice(0, 3).toUpperCase() : '',
            month: Number(day.month),
            monthShort: mon.month || '',
            monthLong: fields(d, zone, 'monLong', { month: 'long' }).month || '',
            day: Number(day.day),
            year: Number(day.year),
            hour: time.hour || '',
            minute: time.minute || '',
            period: (time.dayPeriod || '').toUpperCase()
        };
    }

    // SAT
    function dayAbbr(startDate, tbd) {
        var p = parts(startDate, tbd);
        return p ? p.weekdayShort : '';
    }

    // 10/3
    function monthDay(startDate, tbd) {
        var p = parts(startDate, tbd);
        return p ? p.month + '/' + p.day : '';
    }

    // TBD, or the kickoff in one of the three shapes the app already uses:
    //   compact  6:30PM   (team page, standings, home cards)
    //   spaced   6:30 PM  (scoreboard)
    //   terse    6:30p / 6p, minutes dropped on the hour (betting game picker)
    function time(startDate, tbd, style) {
        var p = parts(startDate, tbd);
        if (!p) return '';
        if (p.tbd) return 'TBD';
        if (style === 'terse') {
            var mins = p.minute === '00' ? '' : ':' + p.minute;
            return p.hour + mins + p.period.charAt(0).toLowerCase();
        }
        if (style === 'spaced') return p.hour + ':' + p.minute + ' ' + p.period;
        return p.hour + ':' + p.minute + p.period;
    }

    // Saturday, Oct 3 — the scoreboard's day grouping key. Games are bucketed
    // by this string, so a TBD game has to land in the same bucket as the rest
    // of its Saturday rather than opening a Friday heading of its own.
    function dayKey(startDate, tbd) {
        var p = parts(startDate, tbd);
        return p ? p.weekdayLong + ', ' + p.monthShort + ' ' + p.day : 'TBD';
    }

    // Saturday, October 3, 2026 — the game detail header.
    function longDate(startDate, tbd) {
        var p = parts(startDate, tbd);
        return p ? p.weekdayLong + ', ' + p.monthLong + ' ' + p.day + ', ' + p.year : '';
    }

    return {
        parts: parts,
        dayAbbr: dayAbbr,
        monthDay: monthDay,
        time: time,
        dayKey: dayKey,
        longDate: longDate
    };
}));
