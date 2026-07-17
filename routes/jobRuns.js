const express = require('express');
const router = express.Router();
const JobRun = require('../models/jobRun');
const { latestPerJob } = require('../modules/job-runs-util');

// Latest run per job — powers the admin status strip's "last run / outcome".
router.get('/', async (req, res) => {
    try {
        // Pull recent runs (newest first) and reduce to the latest per job.
        const runs = await JobRun.find({}, null, { sort: { startedAt: -1 }, limit: 200 }).lean();
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
