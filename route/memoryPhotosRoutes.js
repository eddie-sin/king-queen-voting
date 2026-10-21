const express = require("express");
const authenticate = require("../middleware/authMiddleware");
const { memoryPhotoImages } = require("../middleware/upload");
const controller = require("../controller/memoryPhotosController");
const publicController = require("../controller/publicMemoryPhotosController");
const likes = require("../controller/memoryPhotoLikesController");

const router = express.Router();
router.get("/", publicController.publicAccess, publicController.listApproved);
router.get("/:id/image", publicController.publicAccess, publicController.getApprovedImage);
router.post("/", authenticate, controller.requireEnabled, memoryPhotoImages, controller.submitPhoto);
router.route("/:id/like")
  .post(authenticate, publicController.publicAccess, likes.likePhoto)
  .delete(authenticate, publicController.publicAccess, likes.unlikePhoto);

module.exports = router;
