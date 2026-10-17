const express = require("express");
const candidatesController = require("../controller/candidatesController");

const { candidateImages } = require("../middleware/upload");
const { admin } = require("../middleware/authMiddleware");
const candidateManagement = require("../middleware/candidateManagement");

const router = express.Router();

router
  .route("/")
  .get(candidatesController.getAllCandidates)
  .post(admin, candidateManagement, candidateImages, candidatesController.createCandidate);

router
  .route("/:id")
  .get(candidatesController.getCandidate)
  .patch(admin, candidateManagement, candidateImages, candidatesController.updateCandidate)
  .delete(admin, candidateManagement, candidatesController.deleteCandidate);

module.exports = router;
