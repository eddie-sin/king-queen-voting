const router = require('express').Router();
const voting = require('../controller/votingController');
router.use(require('../middleware/authMiddleware'));
router.post('/submit', voting.submitVote);
router.get('/my-votes', voting.viewVotes);
module.exports = router;
