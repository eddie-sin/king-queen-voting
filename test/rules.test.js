const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { selectFinalists } = require("../utils/finalists");
const { hashVotingKey } = require("../utils/votingKey");
const { parseMyanmarTime, toMyanmarTime } = require("../utils/schedule");
const { checkPeriod } = require("../utils/election");

test("the same key is bound to a different hash for each account", () => {
  const key = crypto.randomBytes(32).toString("hex");
  assert.equal(hashVotingKey("a", key), crypto.createHash("sha256").update(`a:${key}`).digest("hex"));
  assert.notEqual(hashVotingKey("a", key), hashVotingKey("b", key));
});

test("Myanmar dates preserve the fixed offset and include the full closing minute", () => {
  const close = parseMyanmarTime("2026-11-02T23:59+06:30", "votingClosesAt");
  assert.equal(close.toISOString(), "2026-11-02T17:29:59.999Z");
  assert.equal(toMyanmarTime(close), "2026-11-02T23:59:59.999+06:30");
  assert.equal(parseMyanmarTime("2026-10-28T09:00+06:30", "votingOpensAt").toISOString(), "2026-10-28T02:30:00.000Z");
});

test("schedule input rejects other timezones and impossible calendar values", () => {
  for (const input of ["2026-10-28T09:00Z", "2026-10-28T09:00+07:00", "2026-02-30T09:00+06:30", "2026-10-28T25:00+06:30", 42]) {
    assert.throws(() => parseMyanmarTime(input, "votingOpensAt"), { statusCode: 400 });
  }
});

test("voting and registration enforce exact inclusive deadlines", () => {
  const election = { votingOpensAt: new Date(1000), votingClosesAt: new Date(2000), registrationClosesAt: new Date(3000), resultsPublishedAt: new Date(4000) };
  assert.throws(() => checkPeriod(election, "voting", new Date(999)), { statusCode: 403 });
  checkPeriod(election, "voting", new Date(1000));
  checkPeriod(election, "voting", new Date(2000));
  assert.throws(() => checkPeriod(election, "voting", new Date(2001)), { statusCode: 403 });
  checkPeriod(election, "registration", new Date(3000));
  assert.throws(() => checkPeriod(election, "registration", new Date(3001)), { statusCode: 403 });
  assert.throws(() => checkPeriod(election, "publish", new Date(3999)), { statusCode: 403 });
  checkPeriod(election, "publish", new Date(4000));
});

test("only the cutoff tie is randomized, including multiple remaining slots", () => {
  const entries = [20, 19, 18, 5, 5, 5, 5, 1].map((votes, candidate) => ({ candidate, votes }));
  const result = selectFinalists(entries, 5, () => 0);
  assert.equal(result.length, 5);
  assert.deepEqual(result.slice(0, 3).map((entry) => entry.votes), [20, 19, 18]);
  assert(result.slice(0, 3).every((entry) => !entry.selectedByTieBreak));
  assert(result.slice(3).every((entry) => entry.votes === 5 && entry.selectedByTieBreak));
  assert.equal(new Set(result.map((entry) => entry.candidate)).size, 5);
  assert.deepEqual(entries.map((entry) => entry.votes), [20, 19, 18, 5, 5, 5, 5, 1]);
});

test("all tied candidates can be chosen, with equal permutations for a three-way cutoff", () => {
  const entries = [20, 19, 18, 17, 5, 5, 5].map((votes, candidate) => ({ candidate, votes }));
  const wins = new Map();
  for (let first = 0; first < 3; first++) {
    for (let second = 0; second < 2; second++) {
      const draws = [first, second];
      const result = selectFinalists(entries, 5, () => draws.shift());
      const winner = result[4].candidate;
      wins.set(winner, (wins.get(winner) || 0) + 1);
    }
  }
  assert.deepEqual([...wins.values()], [2, 2, 2]);
});

test("no random draw occurs when ties fit entirely above the cutoff", () => {
  const entries = [10, 10, 8, 7, 6, 1].map((votes, candidate) => ({ candidate, votes }));
  const result = selectFinalists(entries, 5, () => { throw Error("Unexpected draw"); });
  assert.deepEqual(result.map((entry) => entry.votes), [10, 10, 8, 7, 6]);
  assert(result.every((entry) => !entry.selectedByTieBreak));
  assert.equal(selectFinalists([]).length, 0);
  assert.equal(selectFinalists(entries.slice(0, 2)).length, 2);
});
