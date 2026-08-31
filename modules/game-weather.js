// Fetch CFBD game weather and store on Game docs.
//
// /games/weather returns one entry per game with temperature, windSpeed,
// weatherCondition, and windDirection. One call per year+week covers all games.

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

function weatherEmoji(condition, temp) {
    const c = (condition || '').toLowerCase();
    if (c.includes('snow') || c.includes('flurr')) return 'snow';
    if (c.includes('rain') || c.includes('shower') || c.includes('drizzle')) return 'rain';
    if (c.includes('thunder') || c.includes('storm') || c.includes('lightning')) return 'storm';
    if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'fog';
    if (c.includes('cloud') || c.includes('overcast')) return 'cloudy';
    if (c.includes('wind')) return 'wind';
    if (temp != null && temp <= 32) return 'cold';
    if (temp != null && temp >= 95) return 'hot';
    if (c.includes('sun') || c.includes('clear') || c.includes('fair')) return 'sunny';
    if (!condition && temp != null) return 'sunny';
    return null;
}

const EMOJI_MAP = {
    snow: '❄️',
    rain: '🌧️',
    storm: '⛈️',
    fog: '🌫️',
    cloudy: '☁️',
    wind: '💨',
    cold: '🥶',
    hot: '🥵',
    sunny: '☀️',
    dome: '🏟️'
};

function toEmoji(tag) {
    return tag ? (EMOJI_MAP[tag] || null) : null;
}

function isNotable(weather) {
    if (!weather) return false;
    const notable = ['snow', 'rain', 'storm', 'fog', 'cold', 'hot', 'wind'];
    return notable.includes(weather.emoji);
}

async function fetchWeather(year, week, seasonType) {
    const st = seasonType || 'regular';
    const url = `${CFBD_BASE}/games/weather?year=${year}&week=${week}&seasonType=${st}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /games/weather ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
}

async function updateWeather(year, week, seasonType) {
    const entries = await fetchWeather(year, week, seasonType);
    if (!Array.isArray(entries) || !entries.length) return { fetched: 0, updated: 0 };

    let updated = 0;
    const ops = entries
        .filter(e => e.id != null)
        .map(e => {
            const temp = e.temperature != null ? Number(e.temperature) : null;
            const wind = e.windSpeed != null ? Number(e.windSpeed) : null;
            const tag = e.venue && e.venue.dome
                ? 'dome'
                : weatherEmoji(e.weatherCondition, temp);
            return {
                updateOne: {
                    filter: { id: e.id },
                    update: {
                        $set: {
                            weather: {
                                temp,
                                wind,
                                condition: e.weatherCondition || null,
                                emoji: tag
                            }
                        }
                    }
                }
            };
        });

    if (ops.length) {
        const result = await Game.bulkWrite(ops, { ordered: false });
        updated = result.modifiedCount || 0;
    }

    return { fetched: entries.length, updated };
}

module.exports = { fetchWeather, updateWeather, weatherEmoji, toEmoji, isNotable, EMOJI_MAP };
