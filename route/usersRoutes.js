const express = require("express");
const usersController = require("../controller/usersController");

const router = express.Router();

// 1. Sign Up: POST /api/v1/users/signup
router.post("/signup", usersController.signUp);

// 5. Change name/phone and 4. Delete account: LOCAL DEVELOPMENT ONLY.
// Replace these guards with ownership-based auth before deploying publicly.
router.patch("/:id", usersController.localDevOnly, usersController.updateProfile);
router.delete("/:id", usersController.localDevOnly, usersController.deleteAccount);

module.exports = router;
