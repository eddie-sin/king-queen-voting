
const express = require("express");
const router = express.Router();

const { submitVote } = require("../controller/votingController");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/submit", authMiddleware, submitVote);

module.exports = router;
