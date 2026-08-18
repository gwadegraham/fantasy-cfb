/**
 * @jest-environment jsdom
 *
 * Browser-side tests for the kickoff times on the shared H2H matchup card
 * (public/h2h-card.js).
 *
 * These used to be formatted server-side with no timeZone option, so they came
 * out in the dyno's zone — UTC on Heroku. Every kickoff read five hours late,
 * and a night game landed on the wrong weekday outright: Memphis @ UNLV, a
 * Saturday 9pm Central kickoff, displayed as "Sun 2:00 AM". Meanwhile the
 * Captain picker rendered the same games in Central, so the two surfaces
 * disagreed about when a team played.
 *
 * The payload now carries the kickoff INSTANT and the card renders it in
 * Central, matching every other date in the app. The date is added only when a
 * matchup's games straddle more than one weekend — which is exactly the API
 * week that folds in the opening weekend, where "Sat 2:00 PM" can't tell Aug 29
 * from Sep 5.
 */

const fs = require('fs');
const path = require('path');

function loadCard() {
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'h2h-card.js'), 'utf8'));
    return window.ccH2H;
}

const BY_ID = {
    u1: { userId: 'u1', name: 'Ann T.', franchise: 'Big Mac', initials: 'AT', color: '#111' },
    u2: { userId: 'u2', name: 'Bob R.', franchise: 'Always Next Year', initials: 'BR', color: '#222' }
};
function team(school, kickoff) {
    return { teamId: school.length, school, abbr: school.slice(0, 3).toUpperCase(), logo: '', score: null, status: 'scheduled', kickoff, opp: 'OPP', ha: 'vs', gameScore: null, captain: false };
}
function card(aTeams, bTeams) {
    const g = { aId: 'u1', bId: 'u2', aScore: 0, bScore: 0, aTeams, bTeams, winner: null, winP: { a: 50, b: 50 }, final: false, upcoming: true };
    return loadCard().matchupCard(g, { byId: BY_ID });
}
// The rendered kickoff cells, in order.
function kicks(html) {
    document.body.innerHTML = html;
    return [...document.querySelectorAll('.h2h-tv.sched')].map(el => el.textContent);
}

// Real 2026 week-1 kickoffs, as stored (UTC instants).
const USC_SJSU = '2026-08-29T19:00:00.000Z';    // Sat Aug 29, 2:00 PM Central
const USC_FRES = '2026-09-05T01:00:00.000Z';    // Fri Sep 4,  8:00 PM Central
const MEM_UNLV = '2026-08-30T02:00:00.000Z';    // Sat Aug 29, 9:00 PM Central

describe('H2H card kickoffs', () => {
    test('render in Central, not the server zone', () => {
        // Same weekend on both sides, so no dates — just the corrected time.
        const out = kicks(card([team('USC', USC_SJSU)], [team('Duke', '2026-08-29T23:30:00.000Z')]));
        expect(out[0]).toBe('Sat 2:00 PM');       // was "Sat 7:00 PM" (UTC)
        expect(out[1]).toBe('Sat 6:30 PM');
    });

    test('a night game keeps its own weekday instead of rolling over in UTC', () => {
        const out = kicks(card([team('Memphis', MEM_UNLV)], [team('Duke', '2026-08-29T23:30:00.000Z')]));
        // Stored as Aug 30 UTC; it is a SATURDAY night game in Central.
        expect(out[0]).toBe('Sat 9:00 PM');       // was "Sun 2:00 AM"
    });

    // Dating EVERY row of a two-weekend card is most of the width on a phone,
    // and it is unnecessary: the weekend nearly all the games sit on is the
    // implicit default, so only the strays need a date. On a real week-1 card
    // that is two or three rows out of twenty-plus instead of all of them.
    test('dates only the games away from the card\'s main weekend', () => {
        const out = kicks(card(
            [team('USC', USC_SJSU), team('USC2', USC_FRES)],
            [team('Duke', '2026-09-05T23:30:00.000Z')]));
        expect(out[0]).toBe('Sat, 8/29 2:00 PM');   // the stray — dated
        expect(out[1]).toBe('Fri 8:00 PM');          // main weekend — bare
        expect(out[2]).toBe('Sat 6:30 PM');          // main weekend — bare
        // Still unmistakable: the two USC games read Sat 8/29 and Fri.
    });

    test('dates everything when no weekend carries the card', () => {
        // One game each weekend — neither can be the implicit default.
        const out = kicks(card([team('USC', USC_SJSU)], [team('Duke', USC_FRES)]));
        expect(out[0]).toBe('Sat, 8/29 2:00 PM');
        expect(out[1]).toBe('Fri, 9/4 8:00 PM');
    });

    test('treats a Thursday-through-Monday slate as one weekend', () => {
        // A college week runs Thu night through the Monday game; none of these
        // need a date, their weekdays already differ.
        const out = kicks(card(
            [team('A', '2026-09-04T00:00:00.000Z'), team('B', '2026-09-05T23:30:00.000Z')],
            [team('C', '2026-09-07T00:00:00.000Z'), team('D', '2026-09-08T00:30:00.000Z')]));
        out.forEach(k => expect(k).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M$/));
    });

    test('leaves the date off an ordinary single-weekend week', () => {
        const out = kicks(card([team('USC', USC_SJSU)], [team('Duke', '2026-08-30T00:00:00.000Z')]));
        out.forEach(k => expect(k).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M$/));
    });

    test('a kickoff with no firm time reads TBD', () => {
        expect(kicks(card([team('USC', null)], [team('Duke', null)]))).toEqual(['TBD', 'TBD']);
    });

    test('an unparseable kickoff degrades to TBD rather than Invalid Date', () => {
        expect(kicks(card([team('USC', 'not-a-date')], [team('Duke', USC_SJSU)]))[0]).toBe('TBD');
    });

    // The league spans time zones (one manager is Eastern) and the app renders
    // every date in Central. A card can carry 20+ kickoff rows, so the zone is
    // named once in the footer rather than repeated on each line.
    // The rank marker is tiered the way rankValue tiers the bonus: top-10 wins
    // pay double, 11-25 single, unranked nothing.
    test('marks a ranked opponent, and tiers the top ten differently', () => {
        const ranked = (rank) => Object.assign(team('USC', USC_SJSU), { opp: 'CLEM', oppRank: rank });
        document.body.innerHTML = card([ranked(23)], [ranked(3)]);
        const tags = [...document.querySelectorAll('.h2h-trk')];
        expect(tags.map(t => t.textContent)).toEqual(['#23', '#3']);
        expect(tags[0].classList.contains('top10')).toBe(false);
        expect(tags[1].classList.contains('top10')).toBe(true);
        // It sits with the opponent, not adrift.
        expect(document.querySelector('.h2h-tsub').textContent).toContain('vs #23 CLEM');
    });

    test('leaves an unranked opponent unmarked', () => {
        const plain = Object.assign(team('USC', USC_SJSU), { opp: 'SJSU', oppRank: null });
        document.body.innerHTML = card([plain], [plain]);
        expect(document.querySelectorAll('.h2h-trk')).toHaveLength(0);
        expect(document.querySelector('.h2h-tsub').textContent).toContain('vs SJSU');
    });

    test('names the zone once, in the footer', () => {
        document.body.innerHTML = card([team('USC', USC_SJSU)], [team('Duke', USC_SJSU)]);
        const foot = document.querySelector('.h2h-mfoot').textContent;
        expect(foot).toContain('kickoffs Central');
        // Not repeated on every row — that is what the footer is for.
        expect(kicks(card([team('USC', USC_SJSU)], [team('Duke', USC_SJSU)]))[0]).toBe('Sat 2:00 PM');
    });
});
