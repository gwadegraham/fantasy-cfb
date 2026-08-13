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

const ME = 'me-id';
function payload(over) {
    return Object.assign({
        league: 'graham-league', season: 2026,
        rankedSource: 'SP+ stand-in (stored poll is "Coaches Poll")',
        projections: [
            { id: 1, school: 'Ohio State', conference: 'Big Ten', total: 34.4, regular: 21.9, post: 12.5, perWeek: 1.83 },
            { id: 2, school: 'Texas', conference: 'SEC', total: 34.3, regular: 24.0, post: 10.3, perWeek: 2.0 },
            { id: 3, school: 'Oregon', conference: 'Big Ten', total: 32.8, regular: 21.5, post: 11.3, perWeek: 1.79 },
            { id: 4, school: 'LSU', conference: 'SEC', total: 25.6, regular: 18.8, post: 6.8, perWeek: 1.57 },
            { id: 5, school: 'Notre Dame', conference: 'FBS Independents', total: 24.8, regular: 14.0, post: 10.7, perWeek: 1.17 }
        ],
        draft: { status: 'active', currentOverall: 2, snake: true, totalRounds: 10, draftOrder: [], picks: [] },
        schedule: { next: { overall: 2, round: 1 }, after: { overall: 11, round: 2 }, onTheClock: false, gap: 8 },
        advice: {
            take: { id: 1, school: 'Ohio State', total: 34.4 }, cost: 8.8, survivorRank: 3,
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
    window.userState = { _id: ME };
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
        window.LEAGUE_CODE = 'graham-league'; window.APP_YEAR = '2026'; window.userState = { _id: ME };
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
