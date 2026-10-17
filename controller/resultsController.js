const Results = require("../model/resultsModel");
const catchAsync = require("../utils/catchAsync");
const { withElectionOperation } = require("../utils/election");
const { getOrCreateResults } = require("../utils/results");

exports.getResults = catchAsync(async (req, res) => {
  const results = await withElectionOperation("publish", async (context) => {
    await getOrCreateResults(context);
    return Results.findById("election").populate("kings.candidate queens.candidate");
  });
  res.status(200).json({ status: "success", data: { results } });
});
