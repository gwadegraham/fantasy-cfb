// Pure helper: given job-run records, return the most recent run per jobName.
// DB-free so it can be unit-tested; the route feeds it the query results.
function latestPerJob(runs) {
    var byJob = {};
    (runs || []).forEach(function (r) {
        if (!r || !r.jobName) return;
        var cur = byJob[r.jobName];
        if (!cur || new Date(r.startedAt) > new Date(cur.startedAt)) {
            byJob[r.jobName] = r;
        }
    });
    return Object.keys(byJob).map(function (k) { return byJob[k]; });
}

module.exports = { latestPerJob };
