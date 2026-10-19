const express = require("express");
const { admin } = require("../middleware/authMiddleware");
const candidates = require("../controller/candidatesController");
const settings = require("../controller/settingsController");
const memoryPhotos = require("../controller/memoryPhotosController");

const router = express.Router();
router.use(admin);
router.get("/candidates", candidates.getAdminCandidates);
router.get("/candidates/:id", candidates.getAdminCandidate);
router.route("/settings").get(settings.getSettings).patch(settings.updateSettings);
router.route("/memory-photos/settings").get(memoryPhotos.getSettings).patch(memoryPhotos.updateSettings);
router.get("/memory-photos/pending", memoryPhotos.pending);
router.post("/memory-photos/:id/access", memoryPhotos.adminAccess);
router.patch("/memory-photos/:id/review", memoryPhotos.review);

module.exports = router;
