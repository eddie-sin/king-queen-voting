const express = require("express");
const candidatesController = require("../controller/candidatesController");

const { candidateImages } = require("../middleware/upload");

const router = express.Router();

router
  .route("/")
  .get(candidatesController.getAllCandidates)
  .post(candidateImages, candidatesController.createCandidate);

router
  .route("/:id")
  .get(candidatesController.getCandidate)
  .patch(candidateImages, candidatesController.updateCandidate)
  .delete(candidatesController.deleteCandidate);

module.exports = router;
