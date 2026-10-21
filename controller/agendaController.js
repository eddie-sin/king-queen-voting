const mongoose = require("mongoose");
const Agenda = require("../model/agendaModel");

const ALLOWED_FIELDS = ["title", "performer", "startTime", "location", "description"];

// Keep this controller independent of other project controllers/error utilities.
const wrap = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function pickAgendaFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Send a JSON object in the request body" };
  }

  const unknown = Object.keys(body).filter((field) => !ALLOWED_FIELDS.includes(field));
  if (unknown.length) {
    return { error: `Unrecognized fields: ${unknown.join(", ")}. Use the reorder API to change order.` };
  }

  const picked = {};
  for (const field of ALLOWED_FIELDS) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== "string") {
        return { error: `${field} must be a string` };
      }
      picked[field] = body[field].trim();
    }
  }
  return { value: picked };
}

exports.getAllAgenda = wrap(async (req, res) => {
  const agenda = await Agenda.find().sort({ order: 1, _id: 1 });
  res.status(200).json({
    status: "success",
    results: agenda.length,
    data: { agenda },
  });
});

exports.createAgenda = wrap(async (req, res) => {
  const { value, error } = pickAgendaFields(req.body);
  if (error) return res.status(400).json({ status: "fail", message: error });
  if (!value.title) {
    return res.status(400).json({ status: "fail", message: "title is required" });
  }

  const last = await Agenda.findOne().sort({ order: -1 }).select("order").lean();
  const item = await Agenda.create({ ...value, order: last ? last.order + 1 : 1 });

  res.status(201).json({ status: "success", data: { agendaItem: item } });
});

exports.updateAgenda = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: "fail", message: "Invalid agenda ID" });
  }
  const { value, error } = pickAgendaFields(req.body);
  if (error) return res.status(400).json({ status: "fail", message: error });
  if (!Object.keys(value).length || (Object.hasOwn(value, "title") && !value.title)) {
    return res.status(400).json({ status: "fail", message: "Provide at least one valid field (title cannot be blank)" });
  }

  const item = await Agenda.findByIdAndUpdate(req.params.id, value, {
    new: true,
    runValidators: true,
  });
  if (!item) return res.status(404).json({ status: "fail", message: "Agenda item not found" });
  res.status(200).json({ status: "success", data: { agendaItem: item } });
});

// Body: { "ids": ["firstId", "secondId", ...] }
// Send ALL existing agenda IDs, in the precise display order you want.
exports.reorderAgenda = wrap(async (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || !ids.length || !ids.every(mongoose.isValidObjectId)) {
    return res.status(400).json({ status: "fail", message: "ids must be a non-empty array of valid agenda IDs" });
  }
  if (new Set(ids.map(String)).size !== ids.length) {
    return res.status(400).json({ status: "fail", message: "Duplicate IDs are not allowed" });
  }

  const existing = await Agenda.find().select("_id").lean();
  const existingIds = new Set(existing.map((item) => String(item._id)));
  if (ids.length !== existing.length || ids.some((id) => !existingIds.has(String(id)))) {
    return res.status(400).json({
      status: "fail",
      message: "Send every existing agenda ID exactly once (no missing/unknown IDs)",
    });
  }

  await Agenda.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id }, update: { $set: { order: index + 1 } } },
    }))
  );
  const agenda = await Agenda.find().sort({ order: 1, _id: 1 });
  res.status(200).json({ status: "success", data: { agenda } });
});

exports.deleteAgenda = wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: "fail", message: "Invalid agenda ID" });
  }
  const item = await Agenda.findByIdAndDelete(req.params.id);
  if (!item) return res.status(404).json({ status: "fail", message: "Agenda item not found" });

  // Close the gap, so orders remain 1, 2, 3 ... after deletion.
  await Agenda.updateMany({ order: { $gt: item.order } }, { $inc: { order: -1 } });
  res.status(200).json({ status: "success", message: "Agenda item deleted" });
});
