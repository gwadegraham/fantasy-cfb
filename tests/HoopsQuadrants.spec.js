// Quadrants — what a basketball result was worth, the night it happened.
//
// This is the core of the basketball scoring model (#316), and it is pure, so
// it is tested exhaustively at the boundaries. Getting a band edge wrong by
// one is invisible in a spot check and permanently mis-banks every game on
// that line — scores are banked at TIME OF PLAY and never recomputed.

const { quadrantFor, venueFor, venueOf, BANDS, VENUES, DEFAULT_VENUE } = require('../modules/hoops-quadrants');

describe('the table matches the committee’s shape', () => {
    // Straight from #316. Written out again rather than imported from BANDS,
    // so a typo in the module cannot agree with itself.
    //              Q1        Q2          Q3           Q4
    // home     1-30      31-75       76-160       161+
    // neutral  1-50      51-100      101-200      201+
    // away     1-75      76-135      136-240      241+
    const TABLE = {
        home:    [[1, 1], [30, 1], [31, 2], [75, 2], [76, 3], [160, 3], [161, 4], [364, 4]],
        neutral: [[1, 1], [50, 1], [51, 2], [100, 2], [101, 3], [200, 3], [201, 4], [364, 4]],
        away:    [[1, 1], [75, 1], [76, 2], [135, 2], [136, 3], [240, 3], [241, 4], [364, 4]]
    };

    for (const venue of Object.keys(TABLE)) {
        describe(venue, () => {
            test.each(TABLE[venue])('rank %i is Q%i', (rank, quadrant) => {
                expect(quadrantFor(rank, venue)).toBe(quadrant);
            });
        });
    }

    test('every rank 1–364 lands in exactly one quadrant, and they only get worse', () => {
        // Monotonic: a worse opponent can never be worth MORE. An inverted
        // pair would be invisible at the edges tested above.
        for (const venue of VENUES) {
            let last = 1;
            for (let rank = 1; rank <= 364; rank++) {
                const q = quadrantFor(rank, venue);
                expect([1, 2, 3, 4]).toContain(q);
                expect(q).toBeGreaterThanOrEqual(last);
                last = q;
            }
        }
    });

    test('the same opponent is worth at least as much away as at home', () => {
        // The entire reason venue is in the model. Never the other way round.
        for (let rank = 1; rank <= 364; rank++) {
            expect(quadrantFor(rank, 'away')).toBeLessThanOrEqual(quadrantFor(rank, 'neutral'));
            expect(quadrantFor(rank, 'neutral')).toBeLessThanOrEqual(quadrantFor(rank, 'home'));
        }
    });

    test('and somewhere it is STRICTLY better, or venue would be decorative', () => {
        const differs = [];
        for (let rank = 1; rank <= 364; rank++) {
            if (quadrantFor(rank, 'away') < quadrantFor(rank, 'home')) differs.push(rank);
        }
        expect(differs.length).toBeGreaterThan(100);
    });
});

describe('an opponent with no usable rank', () => {
    // Q4, not an error and not "no quadrant". A missing rank means the
    // ratings refresh has not reached that team yet, and that must read as
    // the cheapest possible win rather than stop a week from scoring.
    test.each([[undefined], [null], [''], ['not a number'], [0], [-5], [NaN], [1.5], [Infinity], [{}], [[]]])(
        '%p is Q4', (rank) => {
            expect(quadrantFor(rank, 'home')).toBe(4);
            expect(quadrantFor(rank, 'away')).toBe(4);
        });

    test('a numeric string still ranks, because that is what a query gives back', () => {
        expect(quadrantFor('12', 'home')).toBe(1);
        expect(quadrantFor('200', 'away')).toBe(3);
    });
});

describe('an unknown venue is treated as HOME', () => {
    // The stingiest of the three. Being wrong toward fewer points is
    // recoverable; the other way is a manager banking a Q1 they did not earn,
    // and time-of-play means it is never taken back.
    test('the default is the strictest venue', () => {
        for (let rank = 1; rank <= 364; rank++) {
            expect(quadrantFor(rank, DEFAULT_VENUE)).toBe(Math.max(
                quadrantFor(rank, 'home'), quadrantFor(rank, 'neutral'), quadrantFor(rank, 'away')));
        }
    });

    test.each([[undefined], [null], [''], ['HOME-ish'], ['road'], [42]])('%p resolves to home', (v) => {
        expect(venueOf(v)).toBe('home');
        expect(quadrantFor(40, v)).toBe(quadrantFor(40, 'home'));
    });

    test('case does not matter, because feeds shout', () => {
        expect(venueOf('AWAY')).toBe('away');
        expect(venueOf('Neutral')).toBe('neutral');
    });
});

describe('which venue a game was, for the scoring team', () => {
    const GAME = { homeId: 10, awayId: 20 };

    test('home and away are from that team’s point of view', () => {
        expect(venueFor(10, GAME)).toBe('home');
        expect(venueFor(20, GAME)).toBe('away');
    });

    test('a neutral site beats both, for BOTH teams', () => {
        // CBBD still names a home and an away team at a neutral site. Reading
        // that literally hands one of them a home-court advantage they never
        // had — in the conference and NCAA tournaments, where it matters most.
        const neutral = { ...GAME, neutralSite: true };
        expect(venueFor(10, neutral)).toBe('neutral');
        expect(venueFor(20, neutral)).toBe('neutral');
    });

    test('and that genuinely changes what a win is worth', () => {
        // #40 opponent: Q2 if you hosted, Q1 at a neutral site.
        expect(quadrantFor(40, venueFor(10, GAME))).toBe(2);
        expect(quadrantFor(40, venueFor(10, { ...GAME, neutralSite: true }))).toBe(1);
    });

    test('a string id still matches, because ids arrive as both', () => {
        expect(venueFor('10', GAME)).toBe('home');
        expect(venueFor(10, { homeId: '10', awayId: '20' })).toBe('home');
    });

    test('a team in neither slot is away, not home', () => {
        // Defensive: scoring a team that is not in the game should not hand
        // it the cheapest-to-earn venue. It should not happen at all.
        expect(venueFor(99, GAME)).toBe('away');
    });

    test('no game at all is the safe default', () => {
        expect(venueFor(10, null)).toBe(DEFAULT_VENUE);
        expect(venueFor(10, undefined)).toBe(DEFAULT_VENUE);
    });
});

describe('the bands themselves', () => {
    test('three ceilings per venue, ascending, with Q4 open-ended', () => {
        for (const venue of VENUES) {
            const b = BANDS[venue];
            expect(b).toHaveLength(3);
            expect([...b].sort((x, y) => x - y)).toEqual(b);
            expect(quadrantFor(b[2] + 1, venue)).toBe(4);
        }
    });

    test('and the three venues are the only ones', () => {
        expect(VENUES.sort()).toEqual(['away', 'home', 'neutral']);
    });
});
