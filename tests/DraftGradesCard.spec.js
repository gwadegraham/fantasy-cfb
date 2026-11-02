/**
 * @jest-environment jsdom
 *
 * public/draftGrades.js — the shared grade card. One thing pinned: the
 * make-the-field count carries its sport's label. A basketball grade sends
 * ncaaCount (expected teams in the NCAA bracket); under a "CFP teams" label
 * it would be a basketball number dressed as a football one.
 */

const fs = require('fs');
const path = require('path');

beforeAll(() => {
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'draftGrades.js'), 'utf8'));
});

const manager = (over) => Object.assign({
    userId: 'u1', name: 'Pat T.', grade: 'B+', projPoints: 712, projWins: 19.6,
    regPoints: 500, postPoints: 212, bestPick: null, worstPick: null
}, over);

function render(m) {
    const el = document.createElement('div');
    window.renderDraftGradeCard(el, m, {});
    return el;
}
const stat = (el) => Array.from(el.querySelectorAll('.gg-stat'))
    .map(s => s.querySelector('.gg-stat-val').textContent + ' ' + s.querySelector('.gg-stat-lbl').textContent);

test('a basketball grade counts NCAA teams', () => {
    const el = render(manager({ ncaaCount: 7.3 }));
    expect(stat(el)).toContain('7.3 exp. NCAA teams');
    expect(el.textContent).not.toContain('CFP');
});

test('a football grade still counts CFP teams', () => {
    const el = render(manager({ cfpCount: 2.4 }));
    expect(stat(el)).toEqual(['712 proj points', '19.6 avg wins / team', '2.4 exp. CFP teams']);
});

// #636: "+28 slots" meant nothing to a new player. value = draft slot minus
// the pick's projected-points rank, so it is said in picks.
test('best value and biggest reach say how many picks off projection', () => {
    const pick = (value) => ({ teamId: 1, school: 'Duke', round: 3, points: 120, value, logo: null });
    const el = render(manager({ ncaaCount: 4.5, bestPick: pick(28), worstPick: pick(-16) }));
    const meta = Array.from(el.querySelectorAll('.gg-pick-meta')).map(m => m.textContent);
    expect(meta).toEqual([
        'R3 · 120 proj pts · drafted 28 picks later than projected',
        'R3 · 120 proj pts · drafted 16 picks earlier than projected'
    ]);
    expect(el.textContent).not.toMatch(/slots/);
});
