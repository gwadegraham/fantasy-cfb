// Shared in-memory MongoDB harness for the DB-backed suites (models + routes).
// Spins up a throwaway mongod via mongodb-memory-server and points the default
// mongoose connection at it — the same connection every model binds to. Import
// { useMongo } and call it once at the top of a describe file.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod;

async function connect() {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
}

async function disconnect() {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
}

// Drop every collection so each test starts from a clean slate.
async function clear() {
    const { collections } = mongoose.connection;
    for (const name of Object.keys(collections)) {
        await collections[name].deleteMany({});
    }
}

// Wire the standard lifecycle into a suite. Jest's default 5s timeout is too
// tight for the first-run binary download, so bump the connect hook.
function useMongo() {
    beforeAll(connect, 120000);
    afterEach(clear);
    afterAll(disconnect);
}

module.exports = { useMongo, connect, disconnect, clear };
