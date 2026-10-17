
const express = require("express");
const router = express.Router();

const voting = require("../controller/votingController");
const authMiddleware = require("../middleware/authMiddleware");

router.use(authMiddleware);
router.post("/submit", voting.submitVote);
router.patch("/change", voting.changeVote);
// Keep keys in the request body, never in URLs or access logs.
router.post("/my-votes", voting.viewVotes);
router.delete("/remove", voting.removeVote);

module.exports = router;
