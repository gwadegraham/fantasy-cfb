/**
 * @jest-environment jsdom
 *
 * The Captain picker (public/userHome.js hydrateCaptain) fed a BASKETBALL
 * state from GET /users/me/captain: most tip-offs are TBD, so the server names
 * the teams that close the pick and the slate carries each game's day; the
 * verb is "tips off"; and once a week locks the picker has already moved to
 * the next one, with a line saying what the locked week carries.
 */

const fs = require('fs');
const path = require('path');

function load() {
    const node = new Proxy(function () { return node; }, {
        get(t, k) { return k === 'length' ? 0 : node; },
        apply() { return node; }
    });
    global.$ = window.$ = function () { return node; };
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'h2h-card.js'), 'utf8'));
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'userHome.js'), 'utf8'));
}

const STATE = {
    season: 2027, sport: 'basketball', week: 2, locked: false, teamId: null,
    // Midnight Eastern on Mon 9 Nov 2026 — a TBD tip.
    lockAt: '2026-11-09T05:00:00.000Z',
    lockTeamIds: [1],
    autoTeamId: 1,
    current: { week: 1, teamId: null, autoTeamId: 2 },
    slate: [
        { teamId: 1, games: [{ gameId: 10, opp: 'OPP', oppRank: 12, ha: 'vs', kickoff: null, day: '2026-11-09T05:00:00.000Z' }] },
        { teamId: 2, games: [
            { gameId: 11, opp: 'AAA', oppRank: null, ha: '@', kickoff: '2026-11-12T00:30:00.000Z', day: '2026-11-12T00:30:00.000Z' },
            { gameId: 12, opp: 'BBB', oppRank: null, ha: 'vs', kickoff: null, day: '2026-11-14T05:00:00.000Z' }
        ] }
    ]
};
const USER = {
    _id: 'u1', league: 'hoops-league', firstName: 'Ann',
    seasons: [{ season: 2027, teams: [
        { id: 1, school: 'Hoops One', logos: [] },
        { id: 2, school: 'Hoops Two', logos: [] }
    ], weeklyScore: [] }]
};

beforeEach(() => {
    document.body.innerHTML = '<button id="uh-tile-captain"><span id="uh-glance-captain"></span></button>';
    load();
    window.currentUserId = () => 'u1';
    global.ccLogo = window.ccLogo = () => '';
    global.currentUserId = window.currentUserId;
    global.fetch = jest.fn(url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).startsWith('/scoring-config')
            ? { engagement: { captainEnabled: true } }
            : STATE)
    }));
});

test('the basketball picker names the tip-off, the TBD days and the locked week', async () => {
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const text = body.textContent.replace(/\s+/g, ' ');

    expect(text).toContain('Pick your 2× for Week 2.');
    // Named by the server, because a TBD tip has no kickoff to match. A TBD
    // lock is the start of the Eastern game day, not a tip, and says so.
    expect(text).toContain('Locks Sun 11:00 PM CT, midnight ET on game day for Hoops One (tip time TBD)');
    expect(text).not.toContain('tips off');
    expect(text).not.toContain('kick');
    // The untimed games say which day they are, in EASTERN time: the lock
    // instant is 23:00 Sunday in Central.
    expect(text).toContain('vs #12 OPP · Mon · TBD');
    expect(text).toContain('vs BBB · Sat · TBD');
    expect(text).toContain('Hoops Two play twice');
    expect(text).toContain('Week 1 is locked · Hoops Two is your 2× (default)');
    // The default for the week being picked, worded as the reminder words it.
    expect(text).toContain('No pick yet — Hoops One goes in by default');
    expect(fetch).toHaveBeenCalledWith('/users/me/captain?season=2027', expect.anything());
});

test('a firm basketball tip-off still reads "when … tips off"', async () => {
    const firm = Object.assign({}, STATE, { slate: [
        { teamId: 1, games: [{ gameId: 10, opp: 'OPP', oppRank: 12, ha: 'vs', kickoff: STATE.lockAt, day: STATE.lockAt }] }
    ] });
    global.fetch = jest.fn(url => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).startsWith('/scoring-config')
        ? { engagement: { captainEnabled: true } } : firm) }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const text = body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('when Hoops One tips off');
    expect(text).not.toContain('TBD)');
});

test("football's state renders as before: no locked-week line, kicks off", async () => {
    const football = Object.assign({}, STATE, { sport: undefined, lockTeamIds: undefined, current: undefined,
        slate: [{ teamId: 1, games: [{ gameId: 10, opp: 'OPP', ha: 'vs', kickoff: STATE.lockAt }] }] });
    global.fetch = jest.fn(url => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).startsWith('/scoring-config')
        ? { engagement: { captainEnabled: true } } : football) }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const text = body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('when Hoops One kicks off');
    expect(text).not.toContain('is locked ·');
});

test('a locked basketball week names its default instead of "your best team"', async () => {
    const locked = Object.assign({}, STATE, { locked: true, current: undefined, autoTeamId: 2 });
    global.fetch = jest.fn(url => Promise.resolve({ ok: true, json: () => Promise.resolve(String(url).startsWith('/scoring-config')
        ? { engagement: { captainEnabled: true } } : locked) }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const text = body.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('No pick, so Hoops Two doubles by default.');
    expect(text).not.toContain('your best team auto-doubles');
});

test('uhTbdDay falls back to a bare TBD', () => {
    expect(uhTbdDay(null)).toBe('TBD');
    expect(uhTbdDay('nope')).toBe('TBD');
});

test('each game carries its quadrant, and each team what its week pays as Captain', async () => {
    const withQ = JSON.parse(JSON.stringify(STATE));
    withQ.slate[0].games[0] = Object.assign(withQ.slate[0].games[0], { quadrant: 1, quadrantRank: 20, winValue: 10 });
    Object.assign(withQ.slate[1].games[0], { quadrant: 2, quadrantRank: 90, winValue: 6 });
    Object.assign(withQ.slate[1].games[1], { quadrant: 4, quadrantRank: 300, winValue: 0 });
    global.fetch = jest.fn(url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).startsWith('/scoring-config') ? { engagement: { captainEnabled: true } } : withQ)
    }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const [one, two] = [...body.querySelectorAll('.captain-team')];
    expect([...one.querySelectorAll('.cap-q')].map(e => e.textContent)).toEqual(['Q1']);
    expect(one.querySelector('.cap-q').getAttribute('title')).toContain('#20');
    expect(one.querySelector('.cap-up').textContent).toBe('+10 if won');
    // Two games: both chips, and the week's total.
    expect([...two.querySelectorAll('.cap-q')].map(e => e.textContent)).toEqual(['Q2', 'Q4']);
    expect(two.querySelector('.cap-up').textContent).toBe('+6 if both won');
    // A league with the penalty off sends no lossValue: nothing about losses.
    expect(body.querySelector('.cap-down')).toBeNull();
});

test('with the Q4 penalty on, a card shows what losing out costs, undoubled', async () => {
    const withQ = JSON.parse(JSON.stringify(STATE));
    Object.assign(withQ.slate[0].games[0], { quadrant: 1, winValue: 10, lossValue: 0 });
    Object.assign(withQ.slate[1].games[0], { quadrant: 4, winValue: 0, lossValue: -2 });
    Object.assign(withQ.slate[1].games[1], { quadrant: 4, winValue: 0, lossValue: -2 });
    global.fetch = jest.fn(url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).startsWith('/scoring-config') ? { engagement: { captainEnabled: true } } : withQ)
    }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const [one, two] = [...body.querySelectorAll('.captain-team')];
    expect(one.querySelector('.cap-pay').textContent).toBe('+10 if won no loss penalty');
    expect(two.querySelector('.cap-up').textContent).toBe('+0 if both won');
    expect(two.querySelector('.cap-down').textContent).toBe('−4 if both lost');
});

test('"no loss penalty" only when every game\'s quadrant is known', async () => {
    const withQ = JSON.parse(JSON.stringify(STATE));
    // Team two: a Q1, and an opponent not rated yet (no quadrant, no values).
    Object.assign(withQ.slate[1].games[0], { quadrant: 1, winValue: 10, lossValue: 0 });
    global.fetch = jest.fn(url => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).startsWith('/scoring-config') ? { engagement: { captainEnabled: true } } : withQ)
    }));
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    const two = body.querySelectorAll('.captain-team')[1];
    expect(two.querySelector('.cap-pay').textContent).toBe('+10 if won');
});

test('a slate without quadrants (football, or a failed read) shows neither', async () => {
    await hydrateCaptain(USER, '2027');
    const body = document.createElement('div');
    uhDrawer.captain(body);
    expect(body.querySelector('.cap-q')).toBeNull();
    expect(body.querySelector('.cap-up')).toBeNull();
});
