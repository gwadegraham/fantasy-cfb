// Retries an async function with linear backoff. Used to make flaky external
// API calls (CollegeFootballData) resilient to transient failures / 429s
// instead of letting a single hiccup take down an entire job run.
async function withRetry(fn, { retries = 3, baseDelayMs = 1000, label = 'operation' } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            console.log(`⚠️  ${label} failed (attempt ${attempt}/${retries}): ${err.message || err}`);
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
            }
        }
    }
    throw lastErr;
}

module.exports = { withRetry };
