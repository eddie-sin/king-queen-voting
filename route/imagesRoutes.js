const express = require("express");
const imagesController = require("../controller/imagesController");
const { galleryImages } = require("../middleware/upload");
const { admin } = require("../middleware/authMiddleware");

const router = express.Router();

router
  .route("/")
  .get(imagesController.getImages)
  .post(admin, galleryImages, imagesController.createImages);

router.route("/:id")
  .patch(admin, imagesController.updateLantern)
  .delete(admin, imagesController.deleteImage);

module.exports = router;
