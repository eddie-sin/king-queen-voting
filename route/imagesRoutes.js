const express = require("express");
const imagesController = require("../controller/imagesController");
const { galleryImages } = require("../middleware/upload");

const router = express.Router();

// TODO: protect POST/DELETE with admin auth once login exists.
router
  .route("/")
  .get(imagesController.getImages)
  .post(galleryImages, imagesController.createImages);

router.route("/:id").delete(imagesController.deleteImage);

module.exports = router;
