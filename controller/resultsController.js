const Results = require("../model/resultsModel");
const catchAsync = require("../utils/catchAsync");
const { withElectionTransaction } = require("../utils/election");
const { getOrCreateResults } = require("../utils/results");

exports.getResults = catchAsync(async (req, res) => {
  const results = await withElectionTransaction("publish", async (context) => {
    await getOrCreateResults(context);
    return Results.findById("election").populate("kings.candidate queens.candidate").session(context.session);
  });
  res.status(200).json({ status: "success", data: { results } });
});
