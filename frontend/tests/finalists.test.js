import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/api.js";
import { announcementState, publicResults } from "../src/domain.js";

test("announcements require voting closed and the explicit announcement switch", () => {
  assert.equal(
    announcementState({ votingStatus: "open", announcementOpen: true }),
    "waiting",
  );
  assert.equal(
    announcementState({ votingStatus: "closing", announcementOpen: true }),
    "waiting",
  );
  assert.equal(
    announcementState({ votingStatus: "closed", announcementOpen: false }),
    "waiting",
  );
  assert.equal(
    announcementState({ votingStatus: "closed", announcementOpen: true }),
    "announced",
  );
  assert.equal(announcementState(null), "unknown");
});

test("announced results preserve vote totals and titles while stripping contacts", () => {
  const entry = (name, votes, title) => ({
    candidate: {
      _id: name,
      fullName: name,
      category: "king",
      images: [],
      contactNumber: "PRIVATE",
    },
    votes,
    title,
  });
  const result = publicResults({
    round: 1,
    revision: 4,
    kings: [
      entry("Prince", 80, "Prince"),
      entry("Winner", 90, "Mrs Thadingyut"),
    ],
    queens: [
      {
        candidate: { _id: "q", fullName: "Queen", category: "queen" },
        votes: 99,
        title: "Miss Thadingyut",
      },
    ],
  });
  assert.deepEqual(
    result.king.map((p) => p.votes),
    [90, 80],
  );
  assert.equal(result.king[0].title, "Mrs Thadingyut");
  assert.equal(result.queen[0].title, "Miss Thadingyut");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.throws(() => publicResults(null));
  assert.throws(() =>
    publicResults({
      round: 1,
      revision: 1,
      kings: [entry("Bad", -1, "")],
      queens: [],
    }),
  );
});

test("results API reads the manual-voting public results contract", async () => {
  const seen = [];
  const api = createApi({
    fetchImpl: async (url) => {
      seen.push(url);
      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            results: {
              round: 2,
              revision: 3,
              kings: [
                {
                  candidate: { _id: "k1", fullName: "Kyaw", category: "king" },
                  votes: 3,
                  title: "Mrs Thadingyut",
                },
              ],
              queens: [],
            },
          },
        }),
      );
    },
  });
  const result = await api.results();
  assert.deepEqual(seen, ["/api/v1/results"]);
  assert.equal(result.king[0].fullName, "Kyaw");
  assert.equal(result.king[0].votes, 3);
});
