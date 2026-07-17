const { internalFetch } = require('./internal-api');

// Records job runs via the /job-runs API (not the model directly) so it works
// the same whether a job fires in-process from the scheduler or standalone via
// `node update-*-job.js`. Logging must never break the job itself, so every
// call is best-effort and swallows its own errors.

async function startRun(jobName, meta) {
    try {
        const res = await internalFetch(`${process.env.URL}/job-runs`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ jobName }, meta || {}))
        });
        const data = await res.json();
        return (res.status === 201 && data && data._id) ? data._id : null;
    } catch (e) {
        console.log('job-run start log failed:', e.message);
        return null;
    }
}

async function finishRun(id, status, message, meta) {
    if (!id) return;
    try {
        await internalFetch(`${process.env.URL}/job-runs/${id}`, {
            method: 'PATCH',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ status, message }, meta || {}))
        });
    } catch (e) {
        console.log('job-run finish log failed:', e.message);
    }
}

module.exports = { startRun, finishRun };
