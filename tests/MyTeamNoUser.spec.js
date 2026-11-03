/**
 * @jest-environment jsdom
 *
 * /userHome with no ?user=, or one that does not load (#641).
 *
 * A bookmark, the PWA start URL or a pasted link with the query stripped
 * fetched /users/null, got a 500, and rendered a blank page. With no ?user=
 * the page now loads the viewer's own team and writes the id back into the
 * address bar; any failed load shows "That team isn't in this league." with a
 * way back to the viewer's team.
 */

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

const ME = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';

beforeAll(() => {
    const node = new Proxy(function () { return node; }, {
        get(t, k) { return k === 'length' ? 0 : node; }, apply() { return node; }
    });
    global.$ = window.$ = function () { return node; };
    (0, eval)(read('userhome-target.js'));   // the page loads it ahead of userHome.js
    (0, eval)(read('userHome.js'));
    // The page boots itself on load; the tests call getUser/getUserProfile
    // directly, and a second boot mid-test would render twice.
    window.onload = null;
});

let rendered;
beforeEach(() => {
    rendered = [];
    window.renderBento = jest.fn((d) => { rendered.push(d); });
    document.body.innerHTML = '<div class="uh-bento" id="uh-bento"></div>';
    window.localStorage.setItem('userId', ME);
});
afterEach(() => { window.localStorage.clear(); });

const at = (search) => history.replaceState(null, '', '/userHome' + search);
const res = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
const answer = (fn) => { window.fetch = jest.fn(fn); };
const bento = () => document.getElementById('uh-bento');
const cta = () => bento().querySelector('.uh-load-error-cta');

test('no ?user= loads the viewer’s own team and puts the id in the URL', async () => {
    at('');
    answer(() => res(200, [{ _id: ME, firstName: 'Ann' }]));
    await getUser();
    expect(window.fetch).toHaveBeenCalledWith(`/users/${ME}`, expect.anything());
    expect(rendered).toEqual([{ _id: ME, firstName: 'Ann' }]);
    expect(location.search).toBe(`?user=${ME}`);
});

test('other params survive the URL rewrite', async () => {
    at('?setup=1');
    answer(() => res(200, [{ _id: ME }]));
    await getUser();
    expect(new URLSearchParams(location.search).get('setup')).toBe('1');
    expect(new URLSearchParams(location.search).get('user')).toBe(ME);
});

test('a named team is loaded as named, and the URL is left alone', async () => {
    at(`?user=${OTHER}`);
    answer(() => res(200, [{ _id: OTHER }]));
    await getUser();
    expect(window.fetch).toHaveBeenCalledWith(`/users/${OTHER}`, expect.anything());
    expect(location.search).toBe(`?user=${OTHER}`);
    expect(bento().querySelector('.uh-load-error')).toBeNull();
});

test('a non-OK answer shows the error state with a way to My Team', async () => {
    at('?user=garbage');
    answer(() => res(400, { message: 'Invalid manager id.' }));
    await getUser();
    expect(rendered).toEqual([]);
    expect(bento().textContent).toContain('That team isn’t in this league.');
    expect(cta().textContent).toBe('Go to My Team');
    expect(cta().getAttribute('href')).toBe(`/userHome?user=${ME}`);
});

test('an id with no franchise in this league (empty list) is the same error', async () => {
    at(`?user=${OTHER}`);
    answer(() => res(200, []));
    await getUser();
    expect(rendered).toEqual([]);
    expect(cta().getAttribute('href')).toBe(`/userHome?user=${ME}`);
});

test('a network failure is the same error, not a blank page', async () => {
    at(`?user=${OTHER}`);
    answer(() => Promise.reject(new TypeError('Failed to fetch')));
    await getUser();
    expect(bento().querySelector('.uh-load-error')).not.toBeNull();
});

test('when the viewer’s OWN team is what failed, the link does not just reload it', async () => {
    at('');
    answer(() => res(200, []));
    await getUser();
    expect(cta().textContent).toBe('See your leagues');
    expect(cta().getAttribute('href')).toBe('/leagues');
});

test('no ?user= and no known viewer: error state, no /users/null fetch', async () => {
    window.localStorage.clear();
    at('');
    answer(() => res(500, {}));
    await getUser();
    expect(window.fetch).not.toHaveBeenCalled();
    expect(bento().querySelector('.uh-load-error')).not.toBeNull();
});

test('ids are escaped into the link', () => {
    // encodeURIComponent leaves ' alone, so only the HTML escape covers it.
    const html = window.ccUserHomeTarget.errorHtml('x', "a'b");
    expect(html).toContain('/userHome?user=a&#39;b');
});

test('a failed /profile still loads the team, not a blank page', async () => {
    at(`?user=${OTHER}`);
    answer((url) => url === '/profile' ? Promise.reject(new TypeError('Failed to fetch')) : res(200, [{ _id: OTHER }]));
    await getUserProfile();
    expect(rendered).toEqual([{ _id: OTHER }]);
});

test('a non-JSON /profile still loads the team', async () => {
    at(`?user=${OTHER}`);
    answer((url) => url === '/profile'
        ? Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('Unexpected token <')) })
        : res(200, [{ _id: OTHER }]));
    await getUserProfile();
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    expect(rendered).toEqual([{ _id: OTHER }]);
});
