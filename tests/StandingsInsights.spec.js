// Coverage for public/standings-insights.js — the pure compute + HTML builders
// behind the Standings view. The module is an ES module (standings.js imports
// it as one); tests/helpers/esm-transform.js rewrites it for CommonJS so it can
// be required here. No DOM: every assertion is on returned data or markup.

// ccLogo is a browser global from logo.js. It's stubbed here (logos come
// largest-first, so [0] is the pick) — logo selection itself is covered by
// Logo.spec.js; this suite only cares that the chosen URL lands in the markup.
global.ccLogo = (logos) => (logos && logos[0]) || '';
// ccLeagueRank is the other browser global the module reaches for (rankedRows
// ranks through it). The REAL one, not a stub — placement and tie handling are
// exactly what the row assertions below are about. LeagueRank.spec.js covers it
// directly.
global.ccLeagueRank = require('../public/league-rank.js');

const {
    rankedRows,
    standingsHeadHtml,
    buildStandingsRowsHtml,
    buildHighlights,
    buildHighlightsHtml,
    buildChartData
} = require('../public/standings-insights.js');

// Node test env has no `window`, which is the "page hasn't loaded icons" branch.
// The icon test opts in by defining one.
afterEach(() => { delete global.window; });

// --- fixtures ----------------------------------------------------------------

// Weekly entries from a list of scores. A plain number is a regular-season week;
// an object is merged over the default so a test can mark one postseason or
// attach scoreByTeam.
function weeklyScore(list) {
    return list.map((entry, i) => Object.assign(
        { week: i + 1, season: 'regular', score: 0 },
        typeof entry === 'number' ? { score: entry } : entry
    ));
}

function user(id, firstName, lastName, scores, extra = {}) {
    const { franchiseName, teams, ...top } = extra;
    const weekly = weeklyScore(scores);
    return Object.assign({ _id: id, firstName, lastName }, top, {
        seasons: [{
            franchiseName,
            teams: teams || [],
            weeklyScore: weekly,
            cumulativeScore: weekly.reduce((s, w) => s + (w.score || 0), 0)
        }]
    });
}

const byTitle = (cards) => cards.reduce((acc, c) => Object.assign(acc, { [c.title]: c }), {});
const titles = (cards) => cards.map(c => c.title);

// --- rankedRows --------------------------------------------------------------

describe('rankedRows', () => {
    it('sorts by season total and reports rank plus gap to the leader', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [10, 20]),   // 30
            user('b', 'Bob', 'Brown', [30, 20]),     // 50
            user('c', 'Cara', 'Cole', [5, 5])        // 10
        ]);
        expect(rows.map(r => r.id)).toEqual(['b', 'a', 'c']);
        expect(rows.map(r => r.rank)).toEqual([1, 2, 3]);
        expect(rows.map(r => r.score)).toEqual([50, 30, 10]);
        expect(rows.map(r => r.gap)).toEqual([0, 20, 40]);
        expect(rows.every(r => r.preseason === false)).toBe(true);
    });

    it('shares a placement between managers level on points, and skips what the tie consumed', () => {
        // The old "index in the sorted array" rank gave the tied pair 2 and 3,
        // decided by nothing but the order they arrived in.
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [50]),
            user('b', 'Bob', 'Brown', [30]),
            user('c', 'Cara', 'Cole', [30]),
            user('d', 'Dan', 'Dole', [10])
        ]);
        expect(rows.map(r => r.rank)).toEqual([1, 2, 2, 4]);
        expect(rows.map(r => r.tie)).toEqual([false, true, true, false]);
    });

    it('gives the same placements whatever order the league arrives in', () => {
        const league = [
            user('a', 'Alice', 'Adams', [30]),
            user('b', 'Bob', 'Brown', [30]),
            user('c', 'Cara', 'Cole', [50])
        ];
        const byId = (rows) => rows.reduce((acc, r) => Object.assign(acc, { [r.id]: r.rank }), {});
        expect(byId(rankedRows(league))).toEqual(byId(rankedRows(league.slice().reverse())));
        expect(byId(rankedRows(league))).toEqual({ a: 2, b: 2, c: 1 });
    });

    it('ties everyone for 1st before the season starts, instead of numbering by DB order', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [0]),
            user('b', 'Bob', 'Brown', [0]),
            user('c', 'Cara', 'Cole', [0])
        ]);
        expect(rows.map(r => r.rank)).toEqual([1, 1, 1]);
        expect(rows.every(r => r.tie && r.preseason)).toBe(true);
    });

    it('reports movement against last week', () => {
        // Week 1: Bob 50, Alice 10. Week 2 flips it.
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [10, 100]),  // 110
            user('b', 'Bob', 'Brown', [50, 10])      // 60
        ]);
        expect(rows[0].id).toBe('a');
        expect(rows[0].delta).toBe(1);   // climbed one spot
        expect(rows[1].delta).toBe(-1);
    });

    it('reports zero movement when the order held', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [10, 10]),
            user('b', 'Bob', 'Brown', [20, 20])
        ]);
        expect(rows.map(r => r.delta)).toEqual([0, 0]);
    });

    it('counts losing a share of the lead as a slip', () => {
        // Week 1 both on 50 (co-leaders). Week 2 Alice pulls ahead, so Bob really
        // does drop from 1st to 2nd — the old index-based delta called it "no
        // change", because neither moved position in the sorted array.
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [50, 10]),
            user('b', 'Bob', 'Brown', [50, 0])
        ]);
        expect(rows.map(r => r.id)).toEqual(['a', 'b']);
        expect(rows[0].delta).toBe(0);    // held 1st
        expect(rows[1].delta).toBe(-1);   // 1st -> 2nd
    });

    it('has no movement to report after a single week', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [10]),
            user('b', 'Bob', 'Brown', [20])
        ]);
        expect(rows.map(r => r.delta)).toEqual([null, null]);
    });

    it('renders preseason as a flat tie rather than an arbitrary #1', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', []),
            user('b', 'Bob', 'Brown', [])
        ]);
        expect(rows.every(r => r.preseason)).toBe(true);
        expect(rows.every(r => r.score === 0 && r.gap === 0)).toBe(true);
        expect(rows.every(r => r.delta === null)).toBe(true);
    });

    it('treats a scored-but-scoreless week as preseason too', () => {
        const rows = rankedRows([user('a', 'Alice', 'Adams', [0])]);
        expect(rows[0].preseason).toBe(true);
    });

    it('returns nothing for an empty league', () => {
        expect(rankedRows([])).toEqual([]);
    });

    it('tolerates a manager with no season record at all', () => {
        const [row] = rankedRows([{ _id: 'z', firstName: 'Zed', lastName: 'Zane' }]);
        expect(row).toMatchObject({ score: 0, gap: 0, teams: [], preseason: true, delta: null });
    });

    it('carries the identity fields the row markup needs', () => {
        const [row] = rankedRows([user('a', 'Alice', 'Adams', [10], {
            franchiseName: 'Team Rocket',
            avatarUrl: 'https://img/a.png',
            color: '#123456',
            teams: [{ id: 1, school: 'Indiana' }]
        })]);
        expect(row).toMatchObject({
            id: 'a',
            name: 'Alice A.',
            franchise: 'Team Rocket',
            avatarUrl: 'https://img/a.png',
            initials: 'AA',
            color: '#123456',
            teams: [{ id: 1, school: 'Indiana' }]
        });
    });

    it('falls back to null franchise and an empty roster', () => {
        const [row] = rankedRows([user('a', 'Alice', 'Adams', [10])]);
        expect(row.franchise).toBeNull();
        expect(row.avatarUrl).toBeNull();
        expect(row.teams).toEqual([]);
    });

    it('handles a manager with no last name', () => {
        const [row] = rankedRows([user('a', 'Alice', '', [10])]);
        expect(row.name).toBe('Alice .');
        expect(row.initials).toBe('A');
    });

    it('hashes a stable fallback color when the user has none', () => {
        const first = rankedRows([user('a', 'Alice', 'Adams', [10])])[0].color;
        const again = rankedRows([user('a', 'Alice', 'Adams', [10])])[0].color;
        expect(first).toMatch(/^hsl\(\d{1,3}, 45%, 45%\)$/);
        expect(again).toBe(first);
    });
});

// --- table markup ------------------------------------------------------------

describe('standingsHeadHtml', () => {
    it('keeps the classic points-only header', () => {
        const html = standingsHeadHtml(false);
        expect(html).toContain('>Score<');
        expect(html).toContain('>Teams<');
        expect(html).not.toContain('>Record<');
        expect(html.match(/<th/g)).toHaveLength(4);
    });

    it('swaps in record + total and a caret column for H2H', () => {
        const html = standingsHeadHtml(true);
        expect(html).toContain('>Record<');
        expect(html).toContain('>Total<');
        expect(html).toContain('h2h-caret-head');
        expect(html.match(/<th/g)).toHaveLength(6);
    });
});

describe('buildStandingsRowsHtml (classic)', () => {
    const rows = () => rankedRows([
        user('a', 'Alice', 'Adams', [50], { teams: [{ id: 1, mascot: 'Hoosiers', logos: ['ind.png'] }] }),
        user('b', 'Bob', 'Brown', [40]),
        user('c', 'Cara', 'Cole', [30]),
        user('d', 'Dan', 'Diaz', [20])
    ]);

    it('medals the top three and leaves fourth plain', () => {
        const html = buildStandingsRowsHtml(rows(), {});
        expect(html).toContain('standings-row medal-1');
        expect(html).toContain('standings-row medal-2');
        expect(html).toContain('standings-row medal-3');
        expect(html.match(/medal-/g)).toHaveLength(3);
    });

    it('links the name to the manager page and shows the score', () => {
        const html = buildStandingsRowsHtml(rows(), {});
        expect(html).toContain('href="/userHome?user=a"');
        expect(html).toContain('<span class="score-num" data-count="50">50</span>');
        expect(html).toContain('<span class="std-name">Alice A.</span>');
    });

    it('prefers the franchise name over the manager name', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { franchiseName: 'Team Rocket' })
        ]), {});
        expect(html).toContain('<span class="std-name">Team Rocket</span>');
        expect(html).not.toContain('Alice A.');
    });

    it('escapes a franchise name carrying markup', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { franchiseName: '<script>x</script>' })
        ]), {});
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    });

    it('labels a lone leader, a shared lead, and the gap behind', () => {
        const alone = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [50]),
            user('b', 'Bob', 'Brown', [30])
        ]), {});
        expect(alone).toContain('<span class="gap leader">Leader</span>');
        expect(alone).toContain('<span class="gap">-20 back</span>');

        // Level on points: both are leading, and both say so.
        const shared = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [50]),
            user('b', 'Bob', 'Brown', [50]),
            user('c', 'Cara', 'Cole', [30])
        ]), {});
        expect(shared.match(/<span class="gap leader">Co-leader<\/span>/g)).toHaveLength(2);
        expect(shared).not.toContain('>Leader<');
        expect(shared).toContain('<span class="gap">-20 back</span>');
    });

    it('prefixes a shared placement with T- in the rank cell', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [50]),
            user('b', 'Bob', 'Brown', [30]),
            user('c', 'Cara', 'Cole', [30])
        ]), {});
        expect(html).toContain('<span class="rank-num">1</span>');
        expect(html.match(/<span class="rank-num">T-2<\/span>/g)).toHaveLength(2);
        expect(html).not.toContain('>3<');   // the tie consumed 3rd
    });

    it('renders every preseason row as tied with no medals', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', []),
            user('b', 'Bob', 'Brown', [])
        ]), {});
        expect(html).not.toContain('medal-');
        expect(html.match(/>Tied</g)).toHaveLength(2);
        expect(html).not.toContain('Leader');
    });

    it('renders the arrows for rank movement', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10, 100]),
            user('b', 'Bob', 'Brown', [50, 10])
        ]), {});
        expect(html).toContain('<span class="move up" title="Up 1">▲1</span>');
        expect(html).toContain('<span class="move down" title="Down 1">▼1</span>');
    });

    it('renders a dash when the rank held and nothing before week two', () => {
        const held = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [20, 20]),
            user('b', 'Bob', 'Brown', [10, 10])
        ]), {});
        expect(held).toContain('<span class="move flat" title="No change">–</span>');

        const week1 = buildStandingsRowsHtml(rankedRows([user('a', 'Alice', 'Adams', [20])]), {});
        expect(week1).not.toContain('class="move');
    });

    it('face-crops a Cloudinary avatar and passes any other URL through', () => {
        const cloudinary = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { avatarUrl: 'https://res.cloudinary.com/x/image/upload/v1/a.png' })
        ]), {});
        expect(cloudinary).toContain('/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/v1/a.png');

        const plain = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { avatarUrl: 'https://img/a.png' })
        ]), {});
        expect(plain).toContain('<img src="https://img/a.png" alt="">');
    });

    it('falls back to a colored initials avatar', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { color: '#123456' })
        ]), {});
        expect(html).toContain('<span class="std-avatar std-avatar-initials" style="background:#123456">AA</span>');
    });

    it('shows a "?" avatar when the manager has no name to initial', () => {
        const html = buildStandingsRowsHtml(rankedRows([user('a', '', '', [10])]), {});
        expect(html).toContain('<span class="std-avatar std-avatar-initials" style="background:hsl(0, 45%, 45%)">?</span>');
    });

    it('renders the inline logo strip for both team shapes', () => {
        const classic = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { teams: [{ id: 1, mascot: 'Hoosiers', logos: ['ind.png'] }] })
        ]), {});
        expect(classic).toContain('<a href="/team?team=1"><img src="ind.png" alt="Hoosiers"></a>');

        const h2hShape = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { teams: [{ id: 2, school: 'Indiana', logo: 'ind2.png' }] })
        ]), {});
        expect(h2hShape).toContain('<a href="/team?team=2"><img src="ind2.png" alt="Indiana"></a>');
    });

    it('renders an empty logo strip for a team with no logos at all', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { teams: [{ id: 3, school: 'Indiana' }] })
        ]), {});
        expect(html).toContain('<img src="" alt="Indiana">');
    });

    it('still links a team carrying neither logo nor name', () => {
        const rows = rankedRows([user('a', 'Alice', 'Adams', [10], { teams: [{ id: 9 }] })]);
        expect(buildStandingsRowsHtml(rows, {}))
            .toContain('<a href="/team?team=9"><img src="" alt=""></a>');
        expect(buildStandingsRowsHtml(rows, { h2h: true }))
            .toContain('<a class="std-team" href="/team?team=9" title=""><img src="" alt=""></a>');
    });

    it('tolerates a row built without a roster', () => {
        const bare = {
            rank: 1, id: 'a', name: 'Alice A.', franchise: null, initials: 'AA',
            color: '#123456', score: 10, gap: 0, preseason: false, delta: null, base: 10, bonus: 0
        };
        expect(buildStandingsRowsHtml([bare], {})).toContain('<div class="team-logos"></div>');
        expect(buildStandingsRowsHtml([bare], { h2h: true })).toContain('<div class="std-roster-logos"></div>');
    });
});

describe('buildStandingsRowsHtml (h2h)', () => {
    const h2hRows = () => rankedRows([
        user('a', 'Alice', 'Adams', [50], { teams: [{ id: 1, school: 'Indiana', logo: 'ind.png' }] }),
        user('b', 'Bob', 'Brown', [30])
    ]).map((r, i) => Object.assign(r, i === 0
        ? { record: '3-0', base: 50, bonus: 15 }
        : { base: 30, bonus: 0 }));

    it('emits a compact row plus a hidden roster row per manager', () => {
        const html = buildStandingsRowsHtml(h2hRows(), { h2h: true });
        expect(html.match(/class="standings-row/g)).toHaveLength(2);
        expect(html.match(/class="std-roster-row" hidden/g)).toHaveLength(2);
        expect(html).toContain('colspan="6"');
    });

    it('shows the record, or an em dash when there is none', () => {
        const html = buildStandingsRowsHtml(h2hRows(), { h2h: true });
        expect(html).toContain('<td class="rec-cell">3-0</td>');
        expect(html).toContain('<td class="rec-cell">—</td>');
    });

    it('breaks the total into base plus bonus', () => {
        const html = buildStandingsRowsHtml(h2hRows(), { h2h: true });
        expect(html).toContain('<span class="score-math">50 <span class="bonus">+15</span></span>');
    });

    it('labels the expand caret with the escaped display name', () => {
        const html = buildStandingsRowsHtml(rankedRows([
            user('a', 'Alice', 'Adams', [10], { franchiseName: "O'Brien's" })
        ]), { h2h: true });
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-label="Show O&#39;Brien&#39;s\'s teams"');
    });

    it('puts clickable team links in the roster drawer', () => {
        const html = buildStandingsRowsHtml(h2hRows(), { h2h: true });
        expect(html).toContain('<a class="std-team" href="/team?team=1" title="Indiana"><img src="ind.png" alt="Indiana"></a>');
    });

    it('resolves the drawer logo from the classic logos array too', () => {
        const rows = rankedRows([
            user('a', 'Alice', 'Adams', [10], { teams: [{ id: 4, mascot: 'Hoosiers', logos: ['ind.png'] }] })
        ]);
        const html = buildStandingsRowsHtml(rows, { h2h: true });
        expect(html).toContain('<a class="std-team" href="/team?team=4" title="Hoosiers"><img src="ind.png" alt="Hoosiers"></a>');
    });

    it('keeps the medal and score classes so the shared animations carry over', () => {
        const html = buildStandingsRowsHtml(h2hRows(), { h2h: true });
        expect(html).toContain('standings-row medal-1');
        expect(html).toContain('<span class="score-num" data-count="50">50</span>');
    });

    it('leaves a row outside the top three without a medal', () => {
        const rows = rankedRows([50, 40, 30, 20].map((score, i) => user(`u${i}`, `M${i}`, 'Xu', [score])));
        const html = buildStandingsRowsHtml(rows, { h2h: true });
        expect(html.match(/medal-/g)).toHaveLength(3);
        expect(html).toContain('<span class="rank-num">4</span>');
    });

    it('defaults to the classic layout when no opts are passed', () => {
        expect(buildStandingsRowsHtml(rankedRows([user('a', 'Alice', 'Adams', [10])]))).toContain('team-item');
        expect(buildStandingsRowsHtml(rankedRows([user('a', 'Alice', 'Adams', [10])]))).not.toContain('std-caret');
    });

    it('renders nothing for no rows', () => {
        expect(buildStandingsRowsHtml([], { h2h: true })).toBe('');
    });
});

// --- highlights --------------------------------------------------------------

describe('buildHighlights', () => {
    it('shows nothing before anyone has played', () => {
        expect(buildHighlights([])).toEqual([]);
        expect(buildHighlights([user('a', 'Alice', 'Adams', [])])).toEqual([]);
    });

    it('names the big winner and big loser of the latest week', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [10, 40]),
            user('b', 'Bob', 'Brown', [50, 5])
        ]));
        expect(cards['Big Winner']).toMatchObject({ tag: 'Week 2', name: 'Alice A.', value: '+40', tone: 'good' });
        expect(cards['Big Loser']).toMatchObject({ tag: 'Week 2', name: 'Bob B.', value: '+5', tone: 'bad' });
    });

    it('labels a postseason week as Postseason', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [10, { season: 'postseason', score: 40 }])
        ]));
        expect(cards['Big Winner'].tag).toBe('Postseason');
    });

    it('scores hot and cold streaks over the last two weeks', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [100, 1, 1]),   // hot early, cold now
            user('b', 'Bob', 'Brown', [1, 50, 50])
        ]));
        expect(cards['Hot Streak']).toMatchObject({ tag: 'last 2 weeks', name: 'Bob B.', value: '+100' });
        expect(cards['Cold Streak']).toMatchObject({ tag: 'last 2 weeks', name: 'Alice A.', value: '+2' });
    });

    it('calls out the biggest riser, with plural spots', () => {
        const one = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [10, 100]),
            user('b', 'Bob', 'Brown', [50, 10])
        ]));
        expect(one['Biggest Riser']).toMatchObject({ name: 'Alice A.', value: '▲ 1 spot' });

        const two = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [1, 100]),
            user('b', 'Bob', 'Brown', [50, 10]),
            user('c', 'Cara', 'Cole', [40, 10])
        ]));
        expect(two['Biggest Riser'].value).toBe('▲ 2 spots');
    });

    it('skips the riser card when nobody climbed', () => {
        const flat = buildHighlights([
            user('a', 'Alice', 'Adams', [20, 20]),
            user('b', 'Bob', 'Brown', [10, 10])
        ]);
        expect(titles(flat)).not.toContain('Biggest Riser');

        const week1 = buildHighlights([
            user('a', 'Alice', 'Adams', [20]),
            user('b', 'Bob', 'Brown', [10])
        ]);
        expect(titles(week1)).not.toContain('Biggest Riser');
    });

    it('measures the closest race between first and second', () => {
        const gap = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [30]),
            user('b', 'Bob', 'Brown', [25]),
            user('c', 'Cara', 'Cole', [1])
        ]));
        expect(gap['Closest Race']).toMatchObject({ name: 'Alice A. over Bob B.', value: '5 pts', tone: 'neutral' });

        const onePoint = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [30]),
            user('b', 'Bob', 'Brown', [29])
        ]));
        expect(onePoint['Closest Race'].value).toBe('1 pt');

        const tied = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [30]),
            user('b', 'Bob', 'Brown', [30])
        ]));
        expect(tied['Closest Race'].value).toBe('Tied!');
    });

    it('omits the closest race in a one-manager league', () => {
        expect(titles(buildHighlights([user('a', 'Alice', 'Adams', [30])]))).not.toContain('Closest Race');
    });

    it('finds the season-high single week from any manager', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [10, 20]),
            user('b', 'Bob', 'Brown', [77, 5])
        ]));
        expect(cards['Season High']).toMatchObject({ tag: 'Week 1', name: 'Bob B.', value: '+77' });
    });

    it('totals a drafted team across the season for Best Team', () => {
        const teams = [{ id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] }];
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [
                { score: 20, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 20 }] },
                { score: 15, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 15 }] }
            ], { teams })
        ]));
        expect(cards['Best Team'].name).toBe('<a href="/team?team=1" style="color:inherit;text-decoration:none"><img src="ind.png" class="hl-logo">Hoosiers</a>');
        expect(cards['Best Team'].value).toBe('+35');
    });

    it('matches a legacy team entry stored without a teamId', () => {
        const teams = [{ id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] }];
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [
                { score: 20, scoreByTeam: [{ team: 'Indiana', score: 20 }] }
            ], { teams })
        ]));
        expect(cards['Best Team'].value).toBe('+20');
    });

    it('totals teams through sparse weekly data', () => {
        const teams = [
            { id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] },
            { id: 2, school: 'Purdue', mascot: 'Boilermakers', logos: ['pur.png'] }
        ];
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [
                { score: 20, scoreByTeam: [
                    { teamId: 1, team: 'Indiana', score: 20 },
                    { teamId: 2, team: 'Purdue' }        // played, no score recorded
                ] },
                { score: 0 }                             // bye week, no scoreByTeam at all
            ], { teams }),
            { _id: 'z', firstName: 'Zed', lastName: 'Zane' }   // joined late, no season record
        ]));
        expect(cards['Best Team'].name).toContain('Hoosiers');
        expect(cards['Best Team'].value).toBe('+20');
    });

    it('skips Best Team when no drafted team has scored', () => {
        const teams = [{ id: 1, school: 'Indiana', mascot: 'Hoosiers', logos: ['ind.png'] }];
        expect(titles(buildHighlights([
            user('a', 'Alice', 'Adams', [{ score: 5, scoreByTeam: [{ teamId: 9, team: 'Purdue', score: 5 }] }], { teams })
        ]))).not.toContain('Best Team');
    });

    it('names the single best team-game outright', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [{ score: 30, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 30 }] }]),
            user('b', 'Bob', 'Brown', [{ score: 10, scoreByTeam: [{ teamId: 2, team: 'Purdue', score: 10 }] }])
        ]));
        expect(cards['Top Single Game']).toMatchObject({ tag: 'one game', value: '+30' });
        expect(cards['Top Single Game'].name).toBe('<a href="/team?team=1" style="color:inherit;text-decoration:none">Indiana</a> <span class="hl-sub">(Alice A.)</span>');
    });

    it('still reads as one game when the same team ties its own high', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [
                { score: 30, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 30 }] },
                { score: 30, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 30 }] }
            ])
        ]));
        expect(cards['Top Single Game'].tag).toBe('one game');
        expect(cards['Top Single Game'].name).toContain('Indiana');
    });

    it('lists every team in a small tie', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [{ score: 30, scoreByTeam: [
                { teamId: 1, team: 'Indiana', score: 30 },
                { teamId: 2, team: 'Purdue', score: 30 }
            ] }])
        ]));
        expect(cards['Top Single Game'].tag).toBe('2-way tie');
        expect(cards['Top Single Game'].name).toBe('Indiana, Purdue');
    });

    it('truncates a big tie to four teams and hides the rest in a popover', () => {
        const scoreByTeam = ['Indiana', 'Purdue', 'Ohio State', 'Michigan', 'Iowa', 'Illinois']
            .map((team, i) => ({ teamId: i + 1, team, score: 30 }));
        const card = byTitle(buildHighlights([user('a', 'Alice', 'Adams', [{ score: 180, scoreByTeam }])]))['Top Single Game'];

        expect(card.tag).toBe('6-way tie');
        expect(card.name).toContain('Indiana, Purdue, Ohio State, Michigan');
        expect(card.name).toContain('<button type="button" class="hl-more" aria-expanded="false">+2</button>');
        expect(card.name).toContain('All 6 tied teams');
        expect(card.name).toContain('Iowa, Illinois');   // nothing is hidden for good
    });

    it('escapes team names in the tie list', () => {
        const scoreByTeam = [
            { teamId: 1, team: '<b>Indiana</b>', score: 30 },
            { teamId: 2, team: 'Purdue', score: 30 }
        ];
        const card = byTitle(buildHighlights([user('a', 'Alice', 'Adams', [{ score: 60, scoreByTeam }])]))['Top Single Game'];
        expect(card.name).not.toContain('<b>');
        expect(card.name).toContain('&lt;b&gt;Indiana&lt;/b&gt;');
    });

    it('skips the top-game card when nobody scored', () => {
        expect(titles(buildHighlights([
            user('a', 'Alice', 'Adams', [{ score: 0, scoreByTeam: [{ teamId: 1, team: 'Indiana', score: 0 }] }])
        ]))).not.toContain('Top Single Game');
    });

    it('crowns the steadiest manager as Mr. Reliable', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [10, 15]),   // sd 2.5, avg 12.5
            user('b', 'Bob', 'Brown', [0, 40])       // sd 20
        ]));
        expect(cards['Mr. Reliable']).toMatchObject({
            name: 'Alice A.',
            value: '±2.5 pts/wk',
            sub: 'avg 12.5/wk — smallest swing'
        });
    });

    it('waits for a second week before naming Mr. Reliable', () => {
        expect(titles(buildHighlights([
            user('a', 'Alice', 'Adams', [10]),
            user('b', 'Bob', 'Brown', [20])
        ]))).not.toContain('Mr. Reliable');
    });

    it('treats a missing weekly score as zero', () => {
        const cards = byTitle(buildHighlights([
            user('a', 'Alice', 'Adams', [{ score: null }, { score: 20 }]),
            user('b', 'Bob', 'Brown', [5, 5])
        ]));
        expect(cards['Big Winner'].value).toBe('+20');
        expect(cards['Season High'].value).toBe('+20');
        expect(cards['Mr. Reliable'].name).toBe('Bob B.');   // Alice swung 0 → 20
    });

    it('degrades to unlabelled cards when the first manager has no weeks yet', () => {
        const cards = byTitle(buildHighlights([
            user('z', 'Zed', 'Zane', []),
            user('a', 'Alice', 'Adams', [10, 20])
        ]));
        expect(cards['Big Winner']).toMatchObject({ tag: '', name: 'Alice A.', value: '+0' });
        expect(cards['Season High'].value).toBe('+20');
    });
});

describe('buildHighlightsHtml', () => {
    const card = {
        icon: 'trophy', title: 'Big Winner', tag: 'Week 2',
        name: 'Alice A.', value: '+40', tone: 'good'
    };

    it('renders a card with its title, tag, name and toned value', () => {
        const html = buildHighlightsHtml([card]);
        expect(html).toContain('Big Winner');
        expect(html).toContain('<span class="hl-tag">Week 2</span>');
        expect(html).toContain('<span class="hl-name">Alice A.</span>');
        expect(html).toContain('<span class="hl-value good">+40</span>');
    });

    it('includes the detail line only when the card has one', () => {
        expect(buildHighlightsHtml([card])).not.toContain('hl-detail');
        expect(buildHighlightsHtml([Object.assign({}, card, { sub: 'avg 10/wk' })]))
            .toContain('<span class="hl-detail">avg 10/wk</span>');
    });

    it('renders an empty tag rather than "undefined"', () => {
        const html = buildHighlightsHtml([Object.assign({}, card, { tag: undefined })]);
        expect(html).toContain('<span class="hl-tag"></span>');
    });

    it('escapes the title and tag', () => {
        const html = buildHighlightsHtml([Object.assign({}, card, { title: '<b>x</b>', tag: '"y"' })]);
        expect(html).not.toContain('<b>x</b>');
        expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
        expect(html).toContain('&quot;y&quot;');
    });

    it('passes name and value through unescaped so cards can carry markup', () => {
        const html = buildHighlightsHtml([Object.assign({}, card, {
            name: '<img src="ind.png" class="hl-logo">Hoosiers'
        })]);
        expect(html).toContain('<img src="ind.png" class="hl-logo">Hoosiers');
    });

    it('leaves the icon empty when the page has no icon helper', () => {
        expect(buildHighlightsHtml([card])).toContain('<span class="hl-icon"></span>');

        global.window = {};   // page loaded, ccIcon not registered
        expect(buildHighlightsHtml([card])).toContain('<span class="hl-icon"></span>');
    });

    it('draws the icon through window.ccIcon when the page provides it', () => {
        global.window = { ccIcon: (name, opts) => `<svg data-icon="${name}" data-size="${opts.size}"></svg>` };
        expect(buildHighlightsHtml([card])).toContain('<svg data-icon="trophy" data-size="20"></svg>');
    });

    it('renders nothing for no cards', () => {
        expect(buildHighlightsHtml([])).toBe('');
    });
});

// --- chart data --------------------------------------------------------------

describe('buildChartData', () => {
    it('labels a Start point plus one entry per week', () => {
        const data = buildChartData([
            user('a', 'Alice', 'Adams', [10, 20]),
            user('b', 'Bob', 'Brown', [50])
        ]);
        expect(data.labels).toEqual(['Start', 'Wk 1', 'Wk 2']);
        expect(data.playerCount).toBe(2);
    });

    it('accumulates points from zero and holds the last value for missed weeks', () => {
        const data = buildChartData([
            user('a', 'Alice', 'Adams', [10, 20], { color: '#aaa' }),   // 30
            user('b', 'Bob', 'Brown', [50], { color: '#bbb' })          // 50, only one week
        ]);
        expect(data.pointsDatasets.map(d => d.label)).toEqual(['Bob B.', 'Alice A.']);
        expect(data.pointsDatasets[0].data).toEqual([0, 50, 50]);   // held flat through Wk 2
        expect(data.pointsDatasets[1].data).toEqual([0, 10, 30]);
    });

    it('carries the per-manager line styling', () => {
        const [set] = buildChartData([user('a', 'Alice', 'Adams', [10], { color: '#aaa' })]).pointsDatasets;
        expect(set).toMatchObject({ fill: false, backgroundColor: '#aaa', borderColor: '#aaa', tension: 0.15 });
    });

    it('tracks rank week by week for the bump chart', () => {
        const data = buildChartData([
            user('a', 'Alice', 'Adams', [10, 100]),   // 110 — behind at Wk 1, ahead at Wk 2
            user('b', 'Bob', 'Brown', [50, 10])       // 60
        ]);
        expect(data.rankDatasets.map(d => d.label)).toEqual(['Alice A.', 'Bob B.']);
        expect(data.rankDatasets[0].data).toEqual([1, 2, 1]);
        expect(data.rankDatasets[1].data).toEqual([2, 1, 2]);
    });

    it('treats a missing weekly score as zero in the series', () => {
        const data = buildChartData([user('a', 'Alice', 'Adams', [{ score: null }, { score: 20 }])]);
        expect(data.pointsDatasets[0].data).toEqual([0, 0, 20]);
    });

    it('keeps a manager with no weeks flat at zero', () => {
        const data = buildChartData([
            user('a', 'Alice', 'Adams', [10, 20]),
            user('b', 'Bob', 'Brown', [])
        ]);
        expect(data.pointsDatasets[1].data).toEqual([0, 0, 0]);
        expect(data.rankDatasets[1].data).toEqual([2, 2, 2]);
    });

    it('handles an empty league', () => {
        expect(buildChartData([])).toEqual({
            labels: ['Start'], pointsDatasets: [], rankDatasets: [], playerCount: 0
        });
    });
});
