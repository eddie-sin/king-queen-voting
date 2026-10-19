const express = require("express");
const auth = require("../middleware/authMiddleware");
const controller = require("../controller/memoryPhotosController");
const { memoryPhoto, memoryPhotoUploadGate } = require("../middleware/memoryPhotoUpload");

const router = express.Router();
router.get("/settings", controller.getSettings);
router.get("/gallery", controller.gallery);
router.post("/gallery/:id/access", controller.galleryAccess);
router.get("/files/:token", controller.localFile);
router.get("/me", auth, controller.mine);
router.post("/", auth, memoryPhotoUploadGate, memoryPhoto, controller.upload);
router.post("/:id/access", auth, controller.ownerAccess);
router.post("/:id/likes", auth, controller.like);
router.delete("/:id/likes", auth, controller.unlike);

module.exports = router;
