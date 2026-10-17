const crypto = require("crypto");

exports.hashVotingKey = (accountId, votingKey) => crypto
  .createHash("sha256")
  .update(`${accountId}:${votingKey}`)
  .digest("hex");
