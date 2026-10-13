const express = require("express");
const candidatesController = require("../controller/candidatesController");

const router = express.Router();

router
  .route("/")
  .get(candidatesController.getAllCandidates)
  .post(candidatesController.createCandidate);

router
  .route("/:id")
  .get(candidatesController.getCandidate)
  .patch(candidatesController.updateCandidate)
  .delete(candidatesController.deleteCandidate);

module.exports = router;
