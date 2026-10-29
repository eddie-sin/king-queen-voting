const router = require("express").Router();
const controller = require("../controller/wishesController");
const authenticate = require("../middleware/authMiddleware");
const security = require("../utils/accounts/security");

router.get("/status", controller.getStatus);
router.get("/mine", authenticate, controller.getMyWishAllowance);
router.get("/mine/wishes", authenticate, controller.getMyWishes);
router.get("/", controller.getWishes);
router.post("/", authenticate, controller.createWish);
router.post("/:id/reaction", security.guard, controller.reactToWish);

module.exports = router;
