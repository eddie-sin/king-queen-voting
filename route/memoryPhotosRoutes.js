const express = require("express");
const admitUpload = require("../middleware/uploadAdmission");
const uploadHandler = require("../utils/uploadHandler");
const authenticate = require("../middleware/authMiddleware");
const { memoryPhotoImages } = require("../middleware/upload");
const controller = require("../controller/memoryPhotosController");
const publicController = require("../controller/publicMemoryPhotosController");
const likes = require("../controller/memoryPhotoLikesController");

const router = express.Router();
router.get("/like-status", (req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  next();
}, authenticate, controller.requireEnabled, likes.getLikeStatus);
router.get("/mine", authenticate, controller.requireEnabled, controller.listMine);
router.get("/mine/:id/image", authenticate, controller.requireEnabled, controller.getOwnImage);
router.patch("/:id/archive", authenticate, controller.requireEnabled, controller.archiveOwn);
router.patch("/:id/unarchive", authenticate, controller.requireEnabled, controller.unarchiveOwn);
router.delete("/:id", authenticate, controller.requireEnabled, controller.deleteOwn);
router.get("/", publicController.publicAccess, publicController.listApproved);
router.get("/:id/image", publicController.publicAccess, publicController.getApprovedImage);
router.post("/", authenticate, controller.requireEnabled, admitUpload, controller.checkQuota, memoryPhotoImages, uploadHandler(controller.submitPhoto));
router.route("/:id/like")
  .post(authenticate, publicController.publicAccess, likes.likePhoto)
  .delete(authenticate, publicController.publicAccess, likes.unlikePhoto);

module.exports = router;
