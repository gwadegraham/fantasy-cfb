/**
 * @jest-environment jsdom
 */
// Renders public/cfpBracket.js against a payload shaped like the bracket route's
// own output.
//
// The server-side bugs this guards showed up here, not there: the client groups
// games by `g.round` to fill the four columns, so a payload whose rounds came
// back undefined produced a page with four labelled, empty columns and no error
// anywhere. A response assertion alone would not have caught that the page went
// blank, and nothing exercised this file at all.
//
// The module is an IIFE that fetches on import, so the page and its globals have
// to exist before the require.

const SEASON = 2025;

function payload(overrides) {
    const team = (teamId, school, seed, extra) => Object.assign({
        teamId, school, seed, firstRoundBye: seed <= 4, logos: [`http://x/${teamId}.png`],
        color: '112233', owner: null, score: null
    }, extra || {});

    return Object.assign({
        season: SEASON, league: 'graham-league', model: 'graham', projected: false,
        pollSource: null, pollWeek: null, format: 'twelve_team_2025', status: 'completed',
        champion: { teamId: 84, school: 'Indiana' },
        pointsByRound: { first_round: 6, quarterfinal: 6, semifinal: 6, championship: 10,
                         quarterfinalByeBonus: 6, championshipMode: 'win' },
        participants: [
            { teamId: 84, school: 'Indiana', seed: 1, firstRoundBye: true, rank: 1,
              bidType: 'auto', conference: 'Big Ten', color: '990000', logos: ['http://x/84.png'],
              owner: null, eliminatedIn: null, maxPoints: 28 },
            { teamId: 194, school: 'Ohio State', seed: 2, firstRoundBye: true, rank: 2,
              bidType: 'at-large', conference: 'Big Ten', color: 'bb0000', logos: ['http://x/194.png'],
              owner: null, eliminatedIn: 'quarterfinal', maxPoints: 12 },
            { teamId: 2655, school: 'Tulane', seed: 11, firstRoundBye: false, rank: 20,
              bidType: 'auto', conference: 'American Athletic', color: '006747', logos: ['http://x/2655.png'],
              owner: null, eliminatedIn: 'first_round', maxPoints: 6 }
        ],
        games: [
            { gameId: 401779843, round: 'first_round', bracketSlot: 'FR1', roundOrder: 1,
              bowlName: null, projectedVenue: null, feedsFrom: null,
              teams: [team(2483, 'Oregon', 5, { score: 51 }), team(256, 'James Madison', 12, { score: 34 })],
              game: { completed: true, venue: 'Autzen Stadium', startDate: '2025-12-19T22:00:00.000Z',
                      startTimeTbd: false, period: null, clock: null, situation: null,
                      outlet: 'TNT', notes: 'CFP First Round', attendance: 54000, neutralSite: false } },
            { gameId: 401769072, round: 'quarterfinal', bracketSlot: 'QF1', roundOrder: 2,
              bowlName: 'Rose Bowl', projectedVenue: null, feedsFrom: null,
              teams: [team(84, 'Indiana', 1, { score: 38 }), team(333, 'Alabama', 9, { score: 3 })],
              game: { completed: true, venue: 'Rose Bowl', startDate: '2026-01-01T22:00:00.000Z',
                      startTimeTbd: false, period: null, clock: null, situation: null,
                      outlet: 'ESPN', notes: 'CFP Quarterfinal', attendance: 90000, neutralSite: true } },
            { gameId: 401769074, round: 'semifinal', bracketSlot: 'SF1', roundOrder: 3,
              bowlName: null, projectedVenue: null, feedsFrom: null,
              teams: [team(84, 'Indiana', 1, { score: 56 }), team(2483, 'Oregon', 5, { score: 22 })],
              game: { completed: true, venue: 'Mercedes-Benz Stadium', startDate: '2026-01-09T00:30:00.000Z',
                      startTimeTbd: false, period: null, clock: null, situation: null,
                      outlet: 'ESPN', notes: 'CFP Semifinal', attendance: 70000, neutralSite: true } },
            { gameId: 401769076, round: 'championship', bracketSlot: 'CH', roundOrder: 4,
              bowlName: null, projectedVenue: null, feedsFrom: null,
              teams: [team(84, 'Indiana', 1, { score: 27 }), team(2390, 'Miami', 10, { score: 21 })],
              game: { completed: true, venue: 'Hard Rock Stadium', startDate: '2026-01-20T00:30:00.000Z',
                      startTimeTbd: false, period: null, clock: null, situation: null,
                      outlet: 'ESPN', notes: 'CFP National Championship', attendance: 65000, neutralSite: true } }
        ],
        franchiseSummary: [
            { userId: 'u1', firstName: 'Bee', lastName: 'Cee', color: 'ed5858', avatarUrl: null,
              franchise: 'Beaten', maxPoints: 18,
              teams: [{ teamId: 2483, school: 'Oregon', seed: 5, logos: ['http://x/2483.png'], color: '154733' }],
              narrative: 'Oregon reaches the Semis before falling to Indiana.' }
        ]
    }, overrides || {});
}

async function renderPage(body) {
    jest.resetModules();
    document.body.innerHTML = '<div id="cfp-bracket"><div class="cfp-loading">Loading bracket...</div></div>';
    global.SEASON = String(SEASON);
    global.LEAGUE = 'graham-league';
    global.userState = { user_metadata: { metadata: { userId: 'u1' } } };
    window.ccLogo = (logos) => (logos && logos[0]) || '';
    window.ccKickoff = { parts: () => ({ monthShort: 'Dec', day: 20 }) };
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }));

    require('../public/cfpBracket.js');
    await new Promise(r => setTimeout(r, 0));
    return document.getElementById('cfp-bracket');
}

afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
    delete global.userState;
});

describe('the bracket grid', () => {
    test('each round column fills from the games it was given', async () => {
        const el = await renderPage(payload());
        const col = (n) => el.querySelectorAll(`.cfp-gc-${n} .cfp-matchup`);

        expect(col(1)).toHaveLength(1);   // first round
        expect(col(2)).toHaveLength(1);   // quarterfinal
        expect(col(3)).toHaveLength(1);   // semifinal
        expect(col(4)).toHaveLength(1);   // championship
        expect(el.querySelector('.cfp-loading')).toBeNull();
    });

    // The failure mode the server bug produced: labelled columns, no matchups,
    // no error. Nothing about the page said it was broken.
    test('a payload with no rounds leaves the columns visibly empty', async () => {
        const broken = payload();
        broken.games = broken.games.map(g => Object.assign({}, g, { round: undefined }));
        const el = await renderPage(broken);
        expect(el.querySelectorAll('.cfp-matchup')).toHaveLength(0);
        expect(el.querySelectorAll('.cfp-round-label').length).toBeGreaterThan(0);
    });

    test('scores, winners and the champion render', async () => {
        const el = await renderPage(payload());
        const ch = el.querySelector('.cfp-gc-4 .cfp-matchup');
        expect(ch.textContent).toContain('Indiana');
        expect(ch.textContent).toContain('27');
        expect(ch.querySelector('.cfp-winner .cfp-team-name').textContent).toBe('Indiana');
        expect(ch.querySelector('.cfp-loser .cfp-team-name').textContent).toBe('Miami');
        expect(el.querySelector('.cfp-champion-name').textContent).toBe('Indiana');
    });
});

describe('the field table', () => {
    test('marks a bye, an elimination and the committee rank', async () => {
        const el = await renderPage(payload());
        const rows = [...el.querySelectorAll('.cfp-field-row')];
        const rowFor = (school) => rows.find(r => r.textContent.includes(school));

        expect(rowFor('Indiana').querySelector('.cfp-bye-tag').textContent).toBe('BYE');
        // A bye team that lost shows why its points stopped, not the bye it had.
        expect(rowFor('Ohio State').querySelector('.cfp-out-tag').textContent).toBe('OUT');
        expect(rowFor('Ohio State').querySelector('.cfp-bye-tag')).toBeNull();
        expect(rowFor('Tulane').querySelector('.cfp-out-tag')).not.toBeNull();
        // Committee rank 20 for the 11 seed — the row that used to read "NR".
        expect(rowFor('Tulane').querySelector('.cfp-field-rank').textContent).toBe('#20');
    });

    test('labels an automatic qualifier as Auto', async () => {
        const el = await renderPage(payload());
        const rows = [...el.querySelectorAll('.cfp-field-row')];
        const indiana = rows.find(r => r.textContent.includes('Indiana'));
        const ohioState = rows.find(r => r.textContent.includes('Ohio State'));
        expect(indiana.querySelector('.cfp-auto-bid')).not.toBeNull();
        expect(ohioState.querySelector('.cfp-at-large')).not.toBeNull();
    });
});

describe('the points-by-round table', () => {
    test('Graham lists a value for every round', async () => {
        const el = await renderPage(payload());
        const rows = [...el.querySelectorAll('.cfp-points-table tbody tr')]
            .map(r => r.textContent);
        expect(rows.some(t => t.startsWith('First Round') && t.includes('6'))).toBe(true);
        expect(rows.some(t => t.includes('bye bonus for top-4 seeds'))).toBe(true);
    });

    // Claunts reports first_round: 0 next to a first_round_loss, because it pays
    // for the EXIT. The row used to test `pts == null`, which a 0 never is, so
    // the table printed "First Round 0" and the seven points a first-round exit
    // is actually worth never appeared anywhere on the page.
    test('Claunts shows the first-round exit value, not a zero', async () => {
        const el = await renderPage(payload({
            model: 'claunts',
            pointsByRound: { first_round: 0, quarterfinal: 8, semifinal: 9, championship: 10,
                             first_round_loss: 7, championshipMode: 'enter' }
        }));
        const rows = [...el.querySelectorAll('.cfp-points-table tbody tr')]
            .map(r => r.textContent);
        expect(rows.some(t => t.includes('First Round (exit)') && t.includes('7'))).toBe(true);
        expect(rows.some(t => t === 'First Round0')).toBe(false);
    });
});

describe('failures', () => {
    test('an error response renders the error card, not a blank page', async () => {
        jest.resetModules();
        document.body.innerHTML = '<div id="cfp-bracket"></div>';
        global.SEASON = String(SEASON);
        global.LEAGUE = 'graham-league';
        window.ccLogo = (l) => (l && l[0]) || '';
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false, json: () => Promise.resolve({ message: 'No rankings available to project bracket' })
        }));

        require('../public/cfpBracket.js');
        await new Promise(r => setTimeout(r, 0));

        const el = document.getElementById('cfp-bracket');
        expect(el.querySelector('.cfp-error')).not.toBeNull();
        expect(el.textContent).toContain('No rankings available to project bracket');
    });
});
