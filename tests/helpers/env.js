// Restore an environment variable to a value captured earlier.
//
// `process.env.X = undefined` stores the STRING "undefined" rather than unsetting
// the key — assignment coerces. So the natural
//
//     prev = process.env.X;  process.env.X = 'test';  ... ; process.env.X = prev;
//
// leaves X *set*, truthy, and equal to "undefined" whenever it started out unset,
// for every suite that runs later in the same worker process. Any code testing
// "is this configured?" then takes the configured branch with a nonsense value.
function restoreEnv(key, prev) {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
}

module.exports = { restoreEnv };
