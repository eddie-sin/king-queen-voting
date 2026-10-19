const router = require("express").Router();
const controller = require("../controller/wishesController");
const authenticate = require("../middleware/authMiddleware");

router.get("/status", controller.getStatus);
router.get("/", controller.getWishes);
router.post("/", authenticate, controller.createWish);

module.exports = router;
