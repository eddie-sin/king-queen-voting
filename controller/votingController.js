
const crypto = require("crypto");
const mongoose = require("mongoose");

const VotingCredential = require("../model/voting_credentialsModel");
const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");

exports.submitVote = async (req, res) => {
  try {
    const { votingKey, candidateId, contest } = req.body;

    // 1. Validate required fields
    if (!votingKey || !candidateId || !contest) {
      return res.status(400).json({
        message: "Voting key, candidate ID, and contest are required.",
      });
    }

    // 2. Validate contest
    if (!["king", "queen"].includes(contest)) {
      return res.status(400).json({
        message: "Contest must be king or queen.",
      });
    }

    // 3. Validate candidate ID
    if (!mongoose.isValidObjectId(candidateId)) {
      return res.status(400).json({
        message: "Invalid candidate ID.",
      });
    }

    // 4. Find the active voting credential
    const codeHash = crypto
      .createHash("sha256")
      .update(votingKey)
      .digest("hex");

    const credential = await VotingCredential.findOne({
      codeHash,
      status: "active",
    });

    if (!credential) {
      return res.status(401).json({
        message: "Invalid or inactive voting key.",
      });
    }

    // 5. Check the candidate
    const candidate = await Candidate.findOne({
      _id: candidateId,
      isActive: true,
    });

    if (!candidate) {
      return res.status(400).json({
        message: "Candidate does not exist or is inactive.",
      });
    }

    if (candidate.category !== contest) {
      return res.status(400).json({
        message: `This candidate is not in the ${contest} category.`,
      });
    }

    // 6. Save this category's vote
    await Ballot.create({
      credential: credential._id,
      candidate: candidate._id,
      contest,
    });

    return res.status(201).json({
      message: `${contest} vote submitted successfully.`,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: `This voting key has already voted for this category.`,
      });
    }

    console.error("Vote submission failed:", error.message);

    return res.status(500).json({
      message: "Unable to submit vote.",
    });
  }
};
