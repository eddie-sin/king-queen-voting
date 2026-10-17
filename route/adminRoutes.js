const express = require("express");
const { admin } = require("../middleware/authMiddleware");
const candidates = require("../controller/candidatesController");
const settings = require("../controller/settingsController");

const router = express.Router();
router.use(admin);
router.get("/candidates", candidates.getAdminCandidates);
router.get("/candidates/:id", candidates.getAdminCandidate);
router.route("/settings").get(settings.getSettings).patch(settings.updateSettings);

module.exports = router;
