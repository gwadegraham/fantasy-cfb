// Non-negative numeric config vars, read once at require time.
//
// The pattern this exists to prevent: a typo'd duration var (`LIVE_PLAYS_TTL_MS=90s`)
// becoming NaN, which makes every `>=` comparison false and silently disables
// whatever the value was gating. A bad value falls back to the default instead,
// so a fat-fingered config change degrades to "as shipped" rather than to a
// cache that never expires or a debounce that never fires.
//
// Zero is a legal value and deliberately distinguished from unset — several
// callers use 0 as a kill switch (a TTL of 0 means "never cache", a quiet
// window of 0 means "don't debounce").
function envNum(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

module.exports = { envNum };
