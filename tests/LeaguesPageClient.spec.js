/**
 * @jest-environment jsdom
 *
 * public/leagues.js — the Leagues page and Create league (#536). Driven, not
 * string-matched: what each row offers, and what each step actually SENDS,
 * because the server tests trust these bodies — the season on a new person,
 * the order of the draft, a pool cap only for basketball.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'leagues.js'), 'utf8');
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
beforeAll(() => { (0, eval)(KIT); });

const ROWS = [
    { code: 'graham-league', name: 'The Polar Depressed', sport: 'football', season: 2026, managers: 6, state: 'live' },
    { code: 'hardwood', name: 'Hardwood <b>Heroes</b>', sport: 'basketball', season: 2027, managers: 1, state: 'setup' },
    { code: 'old', name: 'Old Days', sport: 'football', season: 2026, managers: 0, state: 'archived' }
];

const json = (body, code = 200) => Promise.resolve({
    ok: code < 400, status: code, json: () => Promise.resolve(body)
});
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

let routes, calls, toasts, navigations;

// routes: { 'GET /leagues/admin/rows': (opts) => json(...) }
async function render({ seasons = { football: 2026, basketball: 2027 } } = {}) {
    document.body.innerHTML = '<main id="leagues-page"></main>';
    window.LEAGUE_SEASONS = seasons;
    window.DRAFT_DEFAULTS = { football: { totalRounds: 10, poolSize: null }, basketball: { totalRounds: 10, poolSize: 120 } };
    (0, eval)(SRC);
    await flush();
    return document.getElementById('leagues-page');
}

beforeEach(() => {
    calls = []; toasts = []; navigations = [];
    routes = { 'GET /leagues/admin/rows': () => json(ROWS) };
    global.fetch = jest.fn((url, opts) => {
        const key = ((opts && opts.method) || 'GET') + ' ' + url;
        calls.push({ key, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
        if (routes[key]) return routes[key](opts);
        return Promise.reject(new Error('unexpected ' + key));
    });
    window.ccToast = { success: (m) => toasts.push(['ok', m]), error: (m) => toasts.push(['err', m]) };
    window.localStorage.clear();
    // jsdom cannot navigate; it reports the attempt on the virtual console,
    // which is the observable difference.
    jest.spyOn(console, 'error').mockImplementation((e) => {
        const msg = String((e && e.message) || e);
        if (/navigation/i.test(msg)) navigations.push(msg);
    });
});
afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const submit = (form) => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
const posted = (key) => calls.filter(c => c.key === key).map(c => c.body);

describe('the list', () => {
    test('one row per open league, with its sport, season, managers and status', async () => {
        await render();
        const open = $$('.lg-list > .lg-row').filter(r => !r.closest('details'));
        expect(open.map(r => r.getAttribute('data-league'))).toEqual(['graham-league', 'hardwood']);
        expect(open[0].textContent).toContain('Football · 2026 · 6 managers');
        expect(open[0].querySelector('.lg-chip').textContent).toBe('Live');
        // Basketball is named by both years.
        expect(open[1].textContent).toContain('Basketball · 2026–27 · 1 manager');
        expect(open[1].querySelector('.lg-chip').textContent).toBe('Setting up');
        expect(open[1].querySelector('.fa-basketball')).not.toBeNull();
    });

    test('names are escaped', async () => {
        await render();
        expect($('[data-league="hardwood"] .lg-name').innerHTML).toBe('Hardwood &lt;b&gt;Heroes&lt;/b&gt;');
    });

    test('Manage goes through /open, which selects the league first', async () => {
        await render();
        expect($('[data-league="graham-league"] [data-manage]').getAttribute('href')).toBe('/leagues/admin/graham-league/open');
        click($('[data-league="graham-league"] [data-manage]'));
        expect(window.localStorage.getItem('leagueCode')).toBe('graham-league');
    });

    test('only a league still setting up offers Continue setup', async () => {
        await render();
        expect($('[data-league="graham-league"] [data-continue]')).toBeNull();
        expect($('[data-league="hardwood"] [data-continue]')).not.toBeNull();
    });

    test('archived leagues are collapsed, and cannot be managed', async () => {
        await render();
        const box = $('details.lg-archived');
        expect(box.open).toBe(false);
        expect(box.querySelector('summary').textContent).toBe('Archived (1)');
        expect(box.querySelector('[data-league="old"] .lg-chip').textContent).toBe('Archived');
        expect(box.querySelector('[data-manage]')).toBeNull();
    });

    test('a failure says so', async () => {
        routes['GET /leagues/admin/rows'] = () => json({ message: 'Could not read the leagues' }, 500);
        const root = await render();
        expect(root.querySelector('.sp-error').textContent).toBe('Could not read the leagues');
    });

    test('no leagues at all', async () => {
        routes['GET /leagues/admin/rows'] = () => json([]);
        const root = await render();
        expect(root.querySelector('.sp-empty').textContent).toBe('No leagues yet.');
        expect(root.querySelector('details')).toBeNull();
    });
});

describe('Create league', () => {
    const MADE = { code: 'hardwood', name: 'Hardwood Heroes', sport: 'basketball', season: 2027 };
    const CANDIDATES = [
        { _id: 'a1', firstName: 'Ann', lastName: 'Lee', leagues: ['The Polar Depressed'] },
        { _id: 'b2', firstName: 'Bob', lastName: 'Ray', leagues: ['Goofballers', 'The Polar Depressed'] }
    ];
    let members;
    beforeEach(() => {
        members = [];
        routes['POST /leagues/admin'] = () => json(MADE, 201);
        routes['GET /users/league/hardwood/all'] = () => json(members);
        routes['GET /leagues/admin/candidates?league=hardwood'] = () => json(CANDIDATES);
        routes['GET /draft/hardwood/2027'] = () => json(null);
        routes['GET /leagues/admin/account?email=cy%40example.com&league=hardwood'] = () => json({ found: false });
    });

    async function toStep2() {
        await render();
        click($('[data-create]'));
        $$('input[name="lg-sport"]').find(i => i.value === 'basketball').checked = true;
        $('[data-name]').value = '  Hardwood Heroes ';
        submit($('[data-step1]'));
        await flush();
    }

    test('step 1 sends the sport and the trimmed name, and moves on', async () => {
        await toStep2();
        expect(posted('POST /leagues/admin')).toEqual([{ sport: 'basketball', name: 'Hardwood Heroes' }]);
        expect($('[data-step="2"]')).not.toBeNull();
        expect($('.lg-top h1').textContent).toBe('Hardwood Heroes');
    });

    test('a sport with no season cannot be picked', async () => {
        await render({ seasons: { football: 2026, basketball: null } });
        click($('[data-create]'));
        const hoops = $$('input[name="lg-sport"]').find(i => i.value === 'basketball');
        expect(hoops.disabled).toBe(true);
        expect(hoops.closest('label').textContent).toContain('No season set');
    });

    test('step 1: a refusal stays on the step and says why', async () => {
        routes['POST /leagues/admin'] = () => json({ message: 'There is already a league called "X".' }, 409);
        await toStep2();
        expect($('[data-step="1"]')).not.toBeNull();
        expect(toasts).toContainEqual(['err', 'There is already a league called "X".']);
        expect($('[data-step1] button[type="submit"]').disabled).toBe(false);
    });

    test('step 1: no name is caught before sending', async () => {
        await render();
        click($('[data-create]'));
        $('[data-name]').value = '   ';
        submit($('[data-step1]'));
        await flush();
        expect(posted('POST /leagues/admin')).toEqual([]);
    });

    test('step 2: existing managers are ticked and added by ACCOUNT id — no invite', async () => {
        await toStep2();
        expect($$('[data-pick]').map(c => c.getAttribute('data-pick'))).toEqual(['a1', 'b2']);
        expect($('[data-pick="b2"]').closest('li').textContent).toContain('Goofballers, The Polar Depressed');
        const btn = $('[data-add-picked]');
        expect(btn.disabled).toBe(true);

        const box = $('[data-pick="b2"]');
        box.checked = true;
        box.dispatchEvent(new window.Event('change', { bubbles: true }));
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Add 1 manager');

        routes['POST /leagues/admin/hardwood/members'] = () => {
            members = [{ _id: 'b2', firstName: 'Bob', lastName: 'Ray', seasons: [{ season: 2027 }] }];
            return json({ added: ['b2'], already: [], refused: [] });
        };
        click(btn);
        await flush();
        expect(posted('POST /leagues/admin/hardwood/members')).toEqual([{ accountIds: ['b2'] }]);
        expect(posted('POST /users')).toEqual([]);
        expect($('[data-member="b2"]').textContent).toContain('Bob Ray');
    });

    test('step 2: someone new goes through Add a Player WITH the league\'s season, then gets a link', async () => {
        await toStep2();
        routes['POST /users'] = () => json({ _id: 'c3', firstName: 'Cy' }, 201);
        routes['POST /users/c3/invite-link'] = () => json({ link: 'https://campusclash.io/invite/tok' });
        $('[data-first]').value = 'Cy';
        $('[data-last]').value = 'New';
        $('[data-email]').value = 'cy@example.com';
        submit($('[data-new-person]'));
        await flush();
        expect(posted('POST /users')).toEqual([{
            firstName: 'Cy', lastName: 'New', email: 'cy@example.com', league: 'hardwood', seasons: [{ season: 2027 }]
        }]);
        expect($('.lg-invite input').value).toBe('https://campusclash.io/invite/tok');
        expect($('.lg-invite [data-copy]').getAttribute('data-copy')).toBe('https://campusclash.io/invite/tok');
    });

    test('step 2: an email that already has a login joins under it — no second account', async () => {
        await toStep2();
        routes['GET /leagues/admin/account?email=cy%40example.com&league=hardwood'] =
            () => json({ found: true, _id: 'c3', firstName: 'Cy', lastName: 'Old', inLeague: false, elsewhere: true });
        routes['POST /leagues/admin/hardwood/members'] = () => json({ added: ['c3'], already: [], refused: [] });
        $('[data-first]').value = 'Cy'; $('[data-last]').value = 'New'; $('[data-email]').value = 'cy@example.com';
        submit($('[data-new-person]'));
        await flush();
        expect(posted('POST /users')).toEqual([]);
        expect(posted('POST /leagues/admin/hardwood/members')).toEqual([{ accountIds: ['c3'] }]);
        expect(toasts).toContainEqual(['ok', 'Cy Old already has a login — added under it, no invite needed']);
    });

    test.each([
        [{ inLeague: true, elsewhere: true }, 'Cy Old is already in this league'],
        [{ inLeague: false, elsewhere: false }, 'That email already belongs to Cy Old, who is in no league. Ask an admin to sort out that account.']
    ])('step 2: an existing email that cannot be added (%j) is refused, and nothing is created', async (flags, msg) => {
        await toStep2();
        routes['GET /leagues/admin/account?email=cy%40example.com&league=hardwood'] =
            () => json(Object.assign({ found: true, _id: 'c3', firstName: 'Cy', lastName: 'Old' }, flags));
        $('[data-first]').value = 'Cy'; $('[data-last]').value = 'New'; $('[data-email]').value = 'cy@example.com';
        submit($('[data-new-person]'));
        await flush();
        expect(posted('POST /users')).toEqual([]);
        expect(posted('POST /leagues/admin/hardwood/members')).toEqual([]);
        expect(toasts).toContainEqual(['err', msg]);
    });

    test('step 2: a refused new person says why and sends no invite', async () => {
        await toStep2();
        routes['POST /users'] = () => json({ message: 'A valid league is required.' }, 400);
        $('[data-first]').value = 'Cy'; $('[data-last]').value = 'New'; $('[data-email]').value = 'cy@example.com';
        submit($('[data-new-person]'));
        await flush();
        expect(toasts).toContainEqual(['err', 'A valid league is required.']);
        expect(calls.some(c => /invite-link/.test(c.key))).toBe(false);
    });

    async function toStep3(people) {
        members = people;
        await toStep2();
        click($('[data-to-step3]'));
        await flush();
    }
    const PEOPLE = [
        { _id: 'a1', firstName: 'Ann', lastName: 'Lee', seasons: [{ season: 2027 }] },
        { _id: 'b2', firstName: 'Bob', lastName: 'Ray', seasons: [{ season: 2027 }] },
        { _id: 'z9', firstName: 'Zed', lastName: 'Old', seasons: [{ season: 2026 }] }
    ];

    test('step 3: the order is the people in THIS season, and can be rearranged', async () => {
        await toStep3(PEOPLE);
        const names = () => $$('[data-order]').map(li => li.getAttribute('data-order'));
        expect(names()).toEqual(['a1', 'b2']);
        click($('[data-down="0"]'));
        expect(names()).toEqual(['b2', 'a1']);
        click($('[data-up="1"]'));
        expect(names()).toEqual(['a1', 'b2']);
        expect($('[data-up="0"]').disabled).toBe(true);
    });

    test('step 3: saves the draft with that order and a basketball pool cap, then opens its admin page', async () => {
        await toStep3(PEOPLE);
        click($('[data-down="0"]'));
        $('[data-rounds]').value = '12';
        $('[data-type]').value = 'linear';
        routes['POST /draft'] = () => json({ _id: 'd1' });
        submit($('[data-step3]'));
        await flush();
        expect(posted('POST /draft')).toEqual([{
            league: 'hardwood', season: 2027, draftOrder: ['b2', 'a1'], orderMethod: 'manual',
            snake: false, totalRounds: 12, scheduledAt: null, autoOpen: false, callUrl: '', poolSize: 120
        }]);
        expect(window.localStorage.getItem('leagueCode')).toBe('hardwood');
        expect(navigations.length).toBe(1);
    });

    test('step 3: football sends no pool size at all — the route refuses one', async () => {
        routes['POST /leagues/admin'] = () => json({ code: 'third', name: 'Third', sport: 'football', season: 2026 }, 201);
        routes['GET /users/league/third/all'] = () => json(PEOPLE.map(p => Object.assign({}, p, { seasons: [{ season: 2026 }] })));
        routes['GET /leagues/admin/candidates?league=third'] = () => json([]);
        routes['GET /draft/third/2026'] = () => json(null);
        await render();
        click($('[data-create]'));
        $('[data-name]').value = 'Third';
        submit($('[data-step1]'));
        await flush();
        expect($('[data-step="2"] .sp-empty').textContent).toContain('already in this one');
        click($('[data-to-step3]'));
        await flush();
        expect($('[data-pool]')).toBeNull();
        routes['POST /draft'] = () => json({});
        submit($('[data-step3]'));
        await flush();
        expect(posted('POST /draft')[0]).not.toHaveProperty('poolSize');
        expect(posted('POST /draft')[0].draftOrder).toEqual(['a1', 'b2', 'z9']);
    });

    test('step 3: a saved draft is edited, not overwritten', async () => {
        routes['GET /draft/hardwood/2027'] = () => json({
            status: 'scheduled', draftOrder: ['b2', 'a1'], totalRounds: 8, snake: false, poolSize: null,
            scheduledAt: '2026-11-01T23:00:00.000Z', autoOpen: true, callUrl: 'https://zoom.us/j/1'
        });
        await toStep3(PEOPLE);
        expect($$('[data-order]').map(li => li.getAttribute('data-order'))).toEqual(['b2', 'a1']);
        expect($('[data-rounds]').value).toBe('8');
        expect($('[data-type]').value).toBe('linear');
        // Uncapped stays uncapped, rather than the sport's 120.
        expect($('[data-pool]').value).toBe('');
        expect($('[data-when]').value).not.toBe('');
        routes['POST /draft'] = () => json({});
        submit($('[data-step3]'));
        await flush();
        const body = posted('POST /draft')[0];
        expect(body).toMatchObject({ draftOrder: ['b2', 'a1'], totalRounds: 8, snake: false, poolSize: null,
            autoOpen: true, callUrl: 'https://zoom.us/j/1', scheduledAt: '2026-11-01T23:00:00.000Z' });
    });

    test('step 3: a draft underway is locked, and nothing is sent', async () => {
        routes['GET /draft/hardwood/2027'] = () => json({ status: 'active', draftOrder: ['a1', 'b2'] });
        await toStep3(PEOPLE);
        expect($('[data-step3]')).toBeNull();
        expect($('[data-step="3"]').textContent).toContain('The draft is active, so its settings are locked.');
        expect($('[data-finish-skip]').getAttribute('href')).toBe('/leagues/admin/hardwood/open');
    });

    test('step 3: fewer than two managers offers to skip the draft instead', async () => {
        await toStep3([PEOPLE[0]]);
        expect($('[data-step3] button[type="submit"]')).toBeNull();
        expect($('[data-finish-skip]').getAttribute('href')).toBe('/leagues/admin/hardwood/open');
    });

    test('step 3: a refused draft stays put and says why', async () => {
        await toStep3(PEOPLE);
        routes['POST /draft'] = () => json({ message: 'Draft is active; settings are locked' }, 409);
        submit($('[data-step3]'));
        await flush();
        expect(toasts).toContainEqual(['err', 'Draft is active; settings are locked']);
        expect(navigations.length).toBe(0);
    });

    test('Continue setup comes back to step 2 for that league', async () => {
        await render();
        click($('[data-league="hardwood"] [data-continue]'));
        await flush();
        expect($('[data-step="2"]')).not.toBeNull();
        expect(calls.map(c => c.key)).toContain('GET /leagues/admin/candidates?league=hardwood');
        // And back to the list.
        click($('[data-back-list]'));
        await flush();
        expect($('[data-create]')).not.toBeNull();
    });
});
