// A SYNTHETIC page in the shape of ncaa.com's NET rankings (#533).
//
// Never NCAA's own page: its terms forbid reproducing the content, and a
// committed copy would also freeze one day's numbers into every test. This
// builds the same markup — the Drupal "rankings-last-updated" figure, one
// sticky table, the thirteen columns in NCAA's order — around made-up rows.

const COLUMNS = ['Rank', 'School', 'Record', 'Conf', 'Road', 'Neutral', 'Home', 'Non-Div I', 'Prev',
    'Quad 1', 'Quad 2', 'Quad 3', 'Quad 4'];

// One table row's values, NCAA's column order. Every number is invented.
function netRow(rank, school, conf, o = {}) {
    return Object.assign({
        Rank: String(rank), School: school, Record: '10-2', Conf: conf, Road: '3-1', Neutral: '2-0', Home: '5-1',
        'Non-Div I': '0-0', Prev: String(rank), 'Quad 1': '2-1', 'Quad 2': '3-0', 'Quad 3': '1-1', 'Quad 4': '4-0'
    }, o);
}

function netPage(rows, { through = 'Dec. 09 2026', columns = COLUMNS, table = true } = {}) {
    const head = columns.map(c => `\n                                    <th>${c}</th>`).join('');
    const body = rows.map(r => `
                            <tr>${columns.map(c => `
                                    <td>${r[c] === undefined ? '' : r[c]}</td>`).join('')}
                                </tr>`).join('');
    return `<!DOCTYPE html><html><head><title>NET Rankings</title></head><body>
<form><select><option value="/rankings/basketball-men/d1/wab-ranking">WAB Ranking</option></select></form>
${through === null ? '' : `<figure class="rankings-last-updated">
    Through Games ${through}
</figure>`}
<div class="layout--has-sidebar">
    <article class="rankings-content overflowable-table-region layout--content-left">
${table ? `                <table class="sticky">
            <thead>
                <tr>${head}
                                </tr>
            </thead>
            <tbody>${body}
                        </tbody>
        </table>` : '<p>Rankings will be released later this season.</p>'}
    </article>
</div></body></html>`;
}

module.exports = { netPage, netRow, COLUMNS };
