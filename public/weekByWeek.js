import { buildChartData } from './standings-insights.js';

let chart = null;
let chartData = null;
let mode = 'points';

// Draws the "Path to the Championship" chart and wires the Points/Rank toggle.
// Chart is a global from the Chart.js CDN script in the view.
export function setChartData(data) {
    chartData = buildChartData(data);
    draw();

    const toggle = document.querySelector('[chart-mode-toggle]');
    if (toggle && !toggle.dataset.wired) {
        toggle.dataset.wired = '1';
        toggle.querySelectorAll('button[data-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                mode = btn.getAttribute('data-mode');
                toggle.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
                draw();
            });
        });
    }
}

function draw() {
    if (!chartData) return;
    const canvas = document.getElementById('week-by-week');
    if (!canvas) return;
    if (chart) chart.destroy();

    const isRank = mode === 'rank';
    const grid = { color: 'rgba(255,255,255,0.06)' };
    chart = new Chart(canvas, {
        type: 'line',
        data: { labels: chartData.labels, datasets: isRank ? chartData.rankDatasets : chartData.pointsDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            scales: {
                x: { ticks: { color: '#F4F6FB' }, grid },
                y: isRank
                    ? { reverse: true, min: 1, max: chartData.playerCount, ticks: { color: '#F4F6FB', stepSize: 1, precision: 0 }, grid,
                        title: { display: true, text: 'Rank', color: '#AEB4CC' } }
                    : { beginAtZero: true, ticks: { color: '#F4F6FB' }, grid,
                        title: { display: true, text: 'Points', color: '#AEB4CC' } }
            },
            plugins: { legend: { labels: { color: '#F4F6FB' } } }
        }
    });
}
