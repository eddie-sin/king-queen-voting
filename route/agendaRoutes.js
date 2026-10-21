const express = require("express");
const agendaController = require("../controller/agendaController");
const agendaAdminOnly = require("../middleware/agendaAdminOnly");

const router = express.Router();

// Public (no account, login, or API key needed)
router.get("/", agendaController.getAllAgenda);

// Admin-only during LOCAL development, with x-admin-key.
router.post("/", agendaAdminOnly, agendaController.createAgenda);
router.patch("/reorder", agendaAdminOnly, agendaController.reorderAgenda);
router.patch("/:id", agendaAdminOnly, agendaController.updateAgenda);
router.delete("/:id", agendaAdminOnly, agendaController.deleteAgenda);

module.exports = router;
