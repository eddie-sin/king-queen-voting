const AppError = require("./appError");

const OFFSET_MS = 390 * 60 * 1000;
exports.dateFields = ["registrationClosesAt", "votingOpensAt", "votingClosesAt", "resultsPublishedAt"];

exports.toMyanmarTime = (date) => new Date(date.getTime() + OFFSET_MS)
  .toISOString().replace("Z", "+06:30");

exports.parseMyanmarTime = (value, field) => {
  const match = typeof value === "string" && value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\+06:30$/,
  );
  if (!match) throw new AppError(`${field} must be an ISO date/time with Myanmar offset +06:30.`, 400);
  const [, year, month, day, hour, minute, second, fraction] = match;
  const parts = [Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0)];
  const local = new Date(Date.UTC(...parts, Number((fraction || "0").padEnd(3, "0"))));
  const actual = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()];
  if (!parts.every((part, index) => part === actual[index])) {
    throw new AppError(`${field} is not a valid calendar date/time.`, 400);
  }
  // A deadline entered at minute precision includes that entire minute.
  if (second === undefined && ["registrationClosesAt", "votingClosesAt"].includes(field)) {
    local.setUTCSeconds(59, 999);
  }
  return new Date(local.getTime() - OFFSET_MS);
};

exports.scheduleResponse = (election) => ({
  ...Object.fromEntries(exports.dateFields.map((field) => [field, exports.toMyanmarTime(election[field])])),
  timezone: "Asia/Yangon",
  timezoneLabel: "Myanmar Time [mm]",
  labels: {
    registrationClosesAt: "Account Creation Will not be allowed after",
    votingPeriod: "Votes are accepted between",
    resultsPublishedAt: "Voting Result of Top 5 finalist will be shown only after",
  },
  candidateManagementLocked: election.candidateManagementLocked,
});
