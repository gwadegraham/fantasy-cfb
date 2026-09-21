const express = require('express');
const router = express.Router();
const JobRun = require('../models/jobRun');
const { latestPerJob } = require('../modules/job-runs-util');

// Latest run per job — powers the admin status strip's "last run / outcome".
//
// Grouped in the DB, NOT by pulling the N newest rows and reducing them here.
// That was the old shape (`limit: 200` then latestPerJob) and it quietly hid
// most of the automation: the live poller writes a JobRun every 10 seconds
// while games are live, so 200 rows is about half an hour of a Saturday. Every
// weekly job — enrichment, season-stats, player-season-leaders — fell outside
// the window and disappeared from the admin strip entirely. Measured against a
// copy of prod: all 7 jobs had runs recorded, the page showed 2.
//
// The $sort keys match the { jobName: 1, startedAt: -1 } index on the model, so
// Mongo walks the index instead of sorting the whole collection in memory, and
// the cost does not grow with poller history.
router.get('/', async (req, res) => {
    try {
        const runs = await JobRun.aggregate([
            { $sort: { jobName: 1, startedAt: -1 } },
            { $group: { _id: '$jobName', doc: { $first: '$$ROOT' } } },
            { $replaceRoot: { newRoot: '$doc' } }
        ]);
        // Already one row per job; the helper stays as the single definition of
        // that invariant, so a future change to the query above cannot start
        // serving duplicates without this catching it.
        res.json(latestPerJob(runs));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Record the start of a run (status 'running'); returns the new run's id.
router.post('/', async (req, res) => {
    try {
        const { jobName, season, week, seasonType } = req.body;
        if (!jobName) return res.status(400).json({ message: 'jobName is required' });
        const doc = await JobRun.create({ jobName, season, week, seasonType, status: 'running', startedAt: new Date() });
        res.status(201).json(doc);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Finish a run: set outcome, finishedAt, and any resolved week/season details.
router.patch('/:id', async (req, res) => {
    try {
        const { status, message, week, seasonType, season } = req.body;
        const update = { finishedAt: new Date() };
        if (status) update.status = status;
        if (message != null) update.message = message;
        if (week != null) update.week = week;
        if (seasonType != null) update.seasonType = seasonType;
        if (season != null) update.season = season;
        const doc = await JobRun.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
        if (!doc) return res.status(404).json({ message: 'run not found' });
        res.json(doc);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
