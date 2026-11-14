// Delivery receipts from public/sw.js. Mounted in server.js OUTSIDE the
// authenticated routers, on purpose: a service worker woken by a push may
// have no live session (the manager last opened the app days ago), and a
// receipt that needs a login would go missing exactly when it matters.
//
// What makes that safe: `sid` is 128 random bits minted per send (see
// modules/push-delivery.js), so knowing one means you received that
// notification. The worst a forged receipt can do is mark a delivery as
// arrived — it cannot read anything, and the route answers the same 204
// whether or not the id matched.
//
// `hello` takes an endpoint instead, and only ever stamps receiptsSince on a
// subscription that already exists. The endpoint is itself a secret the push
// service issued to that device.

const express = require('express');
const pushDelivery = require('../modules/push-delivery');

function build({ delivery = pushDelivery } = {}) {
    const router = express.Router();
    // Body already parsed by the app-wide express.json().
    router.post('/', async (req, res) => {
        const body = req.body || {};
        if (body.event === 'hello') await delivery.hello(body.endpoint);
        else await delivery.receipt(body.sid, body.event);
        res.status(204).end();
    });
    return router;
}

module.exports = { build };
