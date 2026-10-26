const express = require("express");
const candidatesController = require("../controller/candidatesController");

const { candidateImages } = require("../middleware/upload");
const { permission } = require("../middleware/authMiddleware");
const candidateManagement = require("../middleware/candidateManagement");

const router = express.Router();

router
  .route("/")
  .get(candidatesController.getAllCandidates)
  .post(permission("candidates.create"), candidateManagement, candidateImages, candidatesController.createCandidate);

router
  .route("/:id")
  .get(candidatesController.getCandidate)
  .patch(permission("candidates.update"), candidateManagement, candidateImages, candidatesController.updateCandidate)
  .delete(permission("candidates.delete"), candidateManagement, candidatesController.deleteCandidate);

module.exports = router;
