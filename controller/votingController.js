
const crypto = require("crypto");
const mongoose = require("mongoose");

const VotingCredential = require("../model/voting_credentialsModel");
const Candidate = require("../model/candidatesModel");
const Ballot = require("../model/ballotsModel");

exports.submitVote = async (req, res) => {
  try {
    const { votingKey, kingCandidateId, queenCandidateId } = req.body;

    // 1. Check required fields
    if (!votingKey || !kingCandidateId || !queenCandidateId) {
      return res.status(400).json({
        message: "Voting key, King candidate, and Queen candidate are required.",
      });
    }

    // 2. Validate candidate ID formats
    if (
      !mongoose.isValidObjectId(kingCandidateId) ||
      !mongoose.isValidObjectId(queenCandidateId)
    ) {
      return res.status(400).json({
        message: "Invalid candidate ID.",
      });
    }

    // 3. Hash the key and find its database record
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

    // 4. Check that both candidates exist and are active
    const king = await Candidate.findOne({
      _id: kingCandidateId,
      isActive: true,
    });

    const queen = await Candidate.findOne({
      _id: queenCandidateId,
      isActive: true,
    });

    if (!king || !queen) {
      return res.status(400).json({
        message: "One or both candidates do not exist or are inactive.",
      });
    }

    // 5. Ensure candidates belong to the correct categories
    if (king.category !== "king" || queen.category !== "queen") {
      return res.status(400).json({
        message: "Select one King candidate and one Queen candidate.",
      });
    }

    // 6. Save both choices in one ballot
    await Ballot.create({
      credential: credential._id,
      kingCandidate: king._id,
      queenCandidate: queen._id,
    });

    return res.status(201).json({
      message: "Your vote has been submitted successfully.",
    });
  } catch (error) {
    // Duplicate credential means a ballot already exists
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This voting key has already been used.",
      });
    }

    console.error("Vote submission failed:", error.message);

    return res.status(500).json({
      message: "Unable to submit vote.",
    });
  }
};
