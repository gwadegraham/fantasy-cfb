/**
 * @jest-environment jsdom
 *
 * Browser-side tests for public/draftBoard.js — the live draft board page.
 *
 * The page's whole job is to turn one payload into a fast read at the table, so
 * these assert what it actually renders: the recommendation, the scarcity
 * sentence, and that drafted teams leave the board. The DOM fixture mirrors the
 * hooks in views/draftBoard.ejs; if that view loses one, these fail loudly
 * rather than the page quietly rendering nothing on draft night.
 */

const fs = require('fs');
const path = require('path');

const FIXTURE = `
<div class="db-strip">
    <span class="db-live" db-live><span class="db-dot"></span><span db-live-text>connecting…</span></span>
    <span class="db-meta" db-source></span>
    <button type="button" db-refresh>Recompute</button>
</div>
<section db-advice></section>
<input db-search type="search">
<span db-count></span>
<table><tbody db-board></tbody></table>
<ol db-roster></ol>
<ol db-log></ol>`;

// The real shape of window.userState: the OIDC profile. The app's user id is in
// nested metadata — there is no _id here, which is exactly what the page got
// wrong first time (it read userState._id, got undefined, and told the
// commissioner their draft was complete before it had started).
const ME = '64f539d45cf0433f3b6a6a1e';
const USER_STATE = {
    sub: 'auth0|65c83b61e1ecca451f9f657b', email: 'g@example.com', name: 'Garrett',
    user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: ME } }
};
function payload(over) {
    return Object.assign({
        league: 'graham-league', season: 2026,
        rankedSource: 'SP+ stand-in (stored poll is "Coaches Poll")',
        projections: [
            { id: 1, school: 'Ohio State', conference: 'Big Ten', total: 34.4, regular: 21.9, post: 12.5, perWeek: 1.83, logo: 'https://x/osu-dark.png' },
            { id: 2, school: 'Texas', conference: 'SEC', total: 34.3, regular: 24.0, post: 10.3, perWeek: 2.0, logo: 'https://x/tex-dark.png' },
            { id: 3, school: 'Oregon', conference: 'Big Ten', total: 32.8, regular: 21.5, post: 11.3, perWeek: 1.79 },
            { id: 4, school: 'LSU', conference: 'SEC', total: 25.6, regular: 18.8, post: 6.8, perWeek: 1.57, logo: 'https://x/lsu-dark.png' },
            { id: 5, school: 'Notre Dame', conference: 'FBS Independents', total: 24.8, regular: 14.0, post: 10.7, perWeek: 1.17, logo: null }
        ],
        draft: { status: 'active', currentOverall: 2, snake: true, totalRounds: 10, draftOrder: [], picks: [] },
        schedule: { next: { overall: 2, round: 1 }, after: { overall: 11, round: 2 }, onTheClock: false, gap: 8 },
        advice: {
            take: { id: 1, school: 'Ohio State', total: 34.4 }, cost: 8.8, survivorRank: 3,
            effective: 34.4, captain: { enabled: false, gain: 0, settled: false },
            atRisk: [{ id: 1, school: 'Ohio State', total: 34.4 }, { id: 2, school: 'Texas', total: 34.3 }],
            safeToWait: [{ id: 4, school: 'LSU', total: 25.6 }, { id: 5, school: 'Notre Dame', total: 24.8 }]
        },
        roster: []
    }, over || {});
}

function loadPage(body) {
    document.body.innerHTML = FIXTURE;
    window.LEAGUE_CODE = 'graham-league';
    window.APP_YEAR = '2026';
    window.userState = USER_STATE;
    global.io = () => ({ on: () => {}, emit: () => {}, io: { on: () => {} } });
    global.fetch = jest.fn((url) => {
        if (String(url).indexOf('/draft-token') !== -1) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ token: 't' }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    });
    jest.isolateModules(() => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'draftBoard.js'), 'utf8');
        (0, eval)(src);
    });
    document.dispatchEvent(new Event('DOMContentLoaded'));
    return new Promise(r => setTimeout(r, 0));   // let the initial load() settle
}

const txt = (sel) => (document.querySelector(sel) || {}).textContent || '';

describe('the recommendation', () => {
    it('names the team to take and prices the wait', async () => {
        await loadPage(payload());
        const advice = txt('[db-advice]');
        expect(advice).toContain('Ohio State');
        expect(advice).toContain('34.4 projected');
        expect(advice).toContain('8 picks before your next turn (#11)');
        expect(advice).toContain('8.8 points');
        expect(advice).toContain('LSU');                     // best expected to survive
    });

    it('is honest that the scarcity read is a floor, not a forecast', async () => {
        await loadPage(payload());
        expect(txt('[db-advice]')).toContain('treat it as a floor, not a forecast');
    });

    it('says so plainly when the manager is on the clock', async () => {
        await loadPage(payload({ schedule: { next: { overall: 2, round: 1 }, after: null, onTheClock: true, gap: null } }));
        expect(txt('[db-advice]')).toContain('You are on the clock');
    });

    // `cost` and `after` sit on different halves of the payload. The server keeps
    // them consistent, but the page must not crash if they ever disagree — this
    // is the combination that used to throw and blank the whole panel.
    it('does not blow up on a last pick that still carries a cost', async () => {
        await loadPage(payload({ schedule: { next: { overall: 59, round: 10 }, after: null, onTheClock: true, gap: null } }));
        expect(txt('[db-advice]')).toContain('Ohio State');
        expect(txt('[db-advice]')).toContain('nothing to weigh against it');
    });

    it('reports a finished draft rather than rendering an empty pick', async () => {
        await loadPage(payload({ schedule: { next: null, after: null, onTheClock: false, gap: null } }));
        expect(txt('[db-advice]')).toContain('draft is complete');
    });
});

describe('identity', () => {
    it('sends the app user id from nested metadata, not a top-level _id', async () => {
        await loadPage(payload());
        const urls = global.fetch.mock.calls.map(c => String(c[0]));
        const boardCall = urls.find(u => u.indexOf('/draft/board/') !== -1);
        expect(boardCall).toContain('userId=' + ME);
    });

    it('sends an empty id rather than "undefined" when metadata is missing', async () => {
        document.body.innerHTML = FIXTURE;
        window.LEAGUE_CODE = 'graham-league'; window.APP_YEAR = '2026';
        window.userState = { sub: 'auth0|x', email: 'g@example.com' };   // no metadata at all
        global.io = () => ({ on: () => {}, emit: () => {}, io: { on: () => {} } });
        global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload()) }));
        jest.isolateModules(() => {
            (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'draftBoard.js'), 'utf8'));
        });
        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 0));
        const boardCall = global.fetch.mock.calls.map(c => String(c[0])).find(u => u.indexOf('/draft/board/') !== -1);
        expect(boardCall).toContain('userId=');
        expect(boardCall).not.toContain('undefined');
    });
});

describe('the board', () => {
    it('lists available teams best-first and flags the recommendation', async () => {
        await loadPage(payload());
        const rows = [...document.querySelectorAll('[db-board] tr')];
        expect(rows).toHaveLength(5);
        expect(rows[0].querySelector('.db-team').textContent).toBe('Ohio State');
        expect(rows[0].classList.contains('db-best')).toBe(true);
        expect(txt('[db-count]')).toBe('5 available');
    });

    it('drops teams that have been drafted', async () => {
        await loadPage(payload({
            draft: { status: 'active', currentOverall: 3, snake: true, totalRounds: 10, draftOrder: [],
                picks: [{ overall: 1, round: 1, userId: 'other', teamId: 1, school: 'Ohio State' }] }
        }));
        const names = [...document.querySelectorAll('[db-board] .db-team')].map(e => e.textContent);
        expect(names).not.toContain('Ohio State');
        expect(names[0]).toBe('Texas');
        expect(txt('[db-count]')).toBe('4 available');
    });

    it('filters on team and conference', async () => {
        await loadPage(payload());
        const search = document.querySelector('[db-search]');
        search.value = 'sec';
        search.dispatchEvent(new Event('input'));
        expect([...document.querySelectorAll('[db-board] .db-team')].map(e => e.textContent))
            .toEqual(['Texas', 'LSU']);
    });
});

describe('logos', () => {
    it('shows the recommended team\'s logo big, and its name still reads plainly', async () => {
        await loadPage(payload());
        const hero = document.querySelector('.db-pick-logo');
        expect(hero.src).toBe('https://x/osu-dark.png');
        expect(hero.alt).toBe('');                                   // decorative; the name is right there
        expect(document.querySelector('.db-pick-team').textContent).toBe('Ohio State');
    });

    it('puts a logo in every board row that has one', async () => {
        await loadPage(payload());
        const first = document.querySelector('[db-board] .db-team');
        expect(first.querySelector('img').src).toBe('https://x/osu-dark.png');
        expect(first.textContent).toBe('Ohio State');                // text unaffected by the img
    });

    it('renders no img at all for a team without a logo', async () => {
        await loadPage(payload());
        const nd = [...document.querySelectorAll('[db-board] .db-team')].find(e => e.textContent === 'Notre Dame');
        expect(nd).toBeTruthy();
        expect(nd.querySelector('img')).toBeNull();                  // no ghost box
    });

    it('drops a logo that fails to load rather than leaving a broken image', async () => {
        await loadPage(payload());
        const img = document.querySelector('[db-board] .db-team img');
        const row = img.parentElement;
        img.dispatchEvent(new Event('error'));
        expect(row.querySelector('img')).toBeNull();
        expect(row.textContent).toBe('Ohio State');
    });

    it('carries logos into the chips and the pick log', async () => {
        await loadPage(payload({
            draft: { status: 'active', currentOverall: 3, snake: true, totalRounds: 10, draftOrder: [],
                picks: [{ overall: 1, round: 1, userId: 'other', teamId: 2, school: 'Texas' }] }
        }));
        expect(document.querySelector('.db-chip-logo')).not.toBeNull();
        expect(document.querySelector('[db-log] .db-l-team img').src).toBe('https://x/tex-dark.png');
    });
});

// The captain doubles ONE team's weekly score, regular season only, so it prices
// regular-season points and ignores postseason entirely. Which of the three
// states shows is the useful part — especially "settled", which tells you to
// stop reading the Cap/wk column for the rest of the draft.
describe('the captain line', () => {
    const withCaptain = (cap, extra) => payload(Object.assign({
        advice: Object.assign({
            take: { id: 2, school: 'Texas', total: 34.3 }, cost: 13.9, survivorRank: 8,
            effective: 58.3, captain: cap,
            atRisk: [{ id: 1, school: 'Ohio State', total: 34.4 }],
            safeToWait: [{ id: 4, school: 'LSU', total: 25.6 }]
        }, extra || {})
    }));

    it('says a first pick is also choosing the season captain, and prices it', async () => {
        await loadPage(withCaptain({ enabled: true, gain: 24.0, settled: false, anchorSchool: null, anchorRegular: 0 }));
        const t = txt('[db-advice]');
        expect(t).toContain('34.3 projected  +  24.0 captain  =  58.3');
        expect(t).toContain('This also picks your season captain');
        expect(t).toContain('+24.0 points');
    });

    it('prices an upgrade over the anchor you already hold', async () => {
        await loadPage(withCaptain({ enabled: true, gain: 4.0, settled: false, anchorSchool: 'Middling', anchorRegular: 20 }));
        const t = txt('[db-advice]');
        expect(t).toContain('Captain upgrade');
        expect(t).toContain('+4.0 points');
        expect(t).toContain('over Middling');
    });

    it('tells you to stop reading Cap/wk once the anchor cannot be beaten', async () => {
        await loadPage(withCaptain({ enabled: true, gain: 0, settled: true, anchorSchool: 'Texas', anchorRegular: 24 }));
        const t = txt('[db-advice]');
        expect(t).toContain('Captain settled');
        expect(t).toContain('Texas');
        expect(t).toContain('ignore Cap/wk for the rest of the draft');
        expect(t).not.toContain('captain  =');            // no effective-value maths to show
    });

    it('says nothing about the captain when the league has the mode off', async () => {
        await loadPage(payload());                         // fixture default: captain disabled
        expect(document.querySelector('.db-captain')).toBeNull();
        expect(txt('[db-advice]')).toContain('34.4 projected');
        expect(txt('[db-advice]')).not.toContain('captain');
    });

    it('highlights the recommended team even when it is not the top row', async () => {
        await loadPage(withCaptain({ enabled: true, gain: 24.0, settled: false, anchorSchool: null, anchorRegular: 0 }));
        const best = document.querySelector('[db-board] tr.db-best');
        expect(best.querySelector('.db-team').textContent).toBe('Texas');
        // Board stays in market order, so Texas is the SECOND row.
        expect(document.querySelectorAll('[db-board] tr')[0].querySelector('.db-team').textContent).toBe('Ohio State');
    });
});

describe('the value bar', () => {
    it('scales every bar against the best team still on the board', async () => {
        await loadPage(payload());
        const bars = [...document.querySelectorAll('[db-board] .db-bar')];
        expect(bars).toHaveLength(5);
        expect(bars[0].style.width).toBe('100%');                    // Ohio State, the top
        expect(parseInt(bars[4].style.width, 10)).toBe(Math.round(24.8 / 34.4 * 100));
    });

    it('rescales once the top team is drafted', async () => {
        await loadPage(payload({
            draft: { status: 'active', currentOverall: 3, snake: true, totalRounds: 10, draftOrder: [],
                picks: [{ overall: 1, round: 1, userId: 'other', teamId: 1, school: 'Ohio State' }] }
        }));
        const bars = [...document.querySelectorAll('[db-board] .db-bar')];
        expect(bars[0].style.width).toBe('100%');                    // now Texas
        expect(parseInt(bars[3].style.width, 10)).toBe(Math.round(24.8 / 34.3 * 100));
    });
});

describe('roster, log and provenance', () => {
    it('totals the roster it has built so far', async () => {
        await loadPage(payload({
            roster: [
                { overall: 2, round: 1, id: 1, school: 'Ohio State', total: 34.4 },
                { overall: 11, round: 2, id: 4, school: 'LSU', total: 25.6 }
            ]
        }));
        const r = txt('[db-roster]');
        expect(r).toContain('Ohio State');
        expect(r).toContain('Projected total');
        expect(r).toContain('60.0');
    });

    it('marks your own picks in the log', async () => {
        await loadPage(payload({
            draft: { status: 'active', currentOverall: 3, snake: true, totalRounds: 10, draftOrder: [],
                picks: [
                    { overall: 1, round: 1, userId: 'other', teamId: 3, school: 'Oregon' },
                    { overall: 2, round: 1, userId: ME, teamId: 1, school: 'Ohio State' }
                ] }
        }));
        const mine = document.querySelectorAll('[db-log] .db-mine');
        expect(mine).toHaveLength(1);
        expect(mine[0].textContent).toContain('Ohio State');
        // Newest first.
        expect(document.querySelector('[db-log] li').textContent).toContain('#2');
    });

    it('says out loud when the ranked bonuses came from a stand-in poll', async () => {
        await loadPage(payload());
        expect(txt('[db-source]')).toContain('SP+ stand-in');
    });

    it('surfaces a failed load instead of rendering a blank page', async () => {
        document.body.innerHTML = FIXTURE;
        window.LEAGUE_CODE = 'graham-league'; window.APP_YEAR = '2026'; window.userState = USER_STATE;
        global.io = () => ({ on: () => {}, emit: () => {}, io: { on: () => {} } });
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false, status: 403, json: () => Promise.resolve({ message: 'Forbidden: not your league' })
        }));
        jest.isolateModules(() => {
            (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'draftBoard.js'), 'utf8'));
        });
        document.dispatchEvent(new Event('DOMContentLoaded'));
        await new Promise(r => setTimeout(r, 0));
        expect(txt('[db-advice]')).toContain('Forbidden');
    });
});
