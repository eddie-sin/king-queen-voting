const express = require("express");
const admitUpload = require("../middleware/uploadAdmission");
const uploadHandler = require("../utils/uploadHandler");
const imagesController = require("../controller/imagesController");
const { galleryImages } = require("../middleware/upload");
const { permission } = require("../middleware/authMiddleware");

const router = express.Router();

router
  .route("/")
  .get(imagesController.getImages)
  .post(permission('lantern.manage'), admitUpload, galleryImages, uploadHandler(imagesController.createImages));

router.route("/:id")
  .patch(permission('lantern.manage'), imagesController.updateLantern)
  .delete(permission('lantern.manage'), imagesController.deleteImage);

module.exports = router;
