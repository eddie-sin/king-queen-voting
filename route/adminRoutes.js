const express = require("express");
const { admin, memoryAdmin } = require("../middleware/authMiddleware");
const candidates = require("../controller/candidatesController");
const settings = require("../controller/settingsController");
const memoryPhotos = require("../controller/adminMemoryPhotosController");
const accounts = require("../controller/adminAccountsController");

const router = express.Router();
// Only these explicitly declared routes allow the limited moderator role.
router.get("/memory-photos", memoryAdmin, memoryPhotos.listPending);
router.get("/memory-photos/:id/image", memoryAdmin, memoryPhotos.getImage);
router.patch("/memory-photos/:id/review", memoryAdmin, memoryPhotos.reviewPhoto);

router.use(admin);
router.post("/memory-admins", accounts.createMemoryAdmin);
router.get("/candidates", candidates.getAdminCandidates);
router.get("/candidates/:id", candidates.getAdminCandidate);
router.route("/settings").get(settings.getSettings).patch(settings.updateSettings);

module.exports = router;
