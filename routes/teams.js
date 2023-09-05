const express = require('express');
const router = express.Router();
const Team = require('../models/team');

//Getting All
router.get('/', async (req, res) => {
    try {
        const teams = await Team.find();
        res.json(teams);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One
// router.get('/:id', (req, res) => {
//     res.send(req.params.id);
// });

// //Creating One
// router.post('/', async (req, res) => {

//     console.log("teams", req.body.teams);
//     const user = new User({
//         firstName: req.body.firstName,
//         lastName: req.body.lastName,
//         teams: req.body.teams
//     });

//     try {
//         const newUser = await user.save();
//         res.status(201).json(newUser);
//     } catch (err) {
//         res.status(400).json({message: err.message});
//     }
// });

// //Updating One
// router.patch('/:id', (req, res) => {

// });

//Deleting One
// router.delete('/:id', (req, res) => {

// });

module.exports = router;