import test from "node:test";
import assert from "node:assert/strict";
import { announcementState, publicCandidate, publicResults, eventState, savedChoices } from "../src/domain.js";

test("registration and voting depend on explicit independent controls", () => {
  assert.deepEqual(
    eventState({ registrationOpen: true, votingStatus: "closed" }),
    { registration: "open", voting: "closed" },
  );
  assert.deepEqual(
    eventState({ registrationOpen: false, votingStatus: "open" }),
    { registration: "closed", voting: "open" },
  );
  assert.equal(
    eventState({ registrationOpen: true, votingStatus: "closing" }).voting,
    "closing",
  );
  assert.deepEqual(eventState(null), {
    registration: "unknown",
    voting: "unknown",
  });
  assert.equal(
    eventState({ registrationOpen: "true", votingStatus: "invalid" })
      .registration,
    "unknown",
  );
});

test("announcements require an explicit switch after voting closes", () => {
  assert.equal(announcementState({ announcementOpen: true, votingStatus: "closed" }), "announced");
  assert.equal(announcementState({ announcementOpen: true, votingStatus: "open" }), "waiting");
  assert.equal(announcementState({ announcementOpen: false, votingStatus: "closed" }), "waiting");
  assert.equal(announcementState({}), "unknown");
});
test("public candidate projection strips contacts and unsafe URLs", () => {
  const candidate = publicCandidate({
    _id: "1",
    fullName: "Name",
    phone: "PRIVATE",
    contactNumber: "PRIVATE",
    email: "PRIVATE",
    images: [
      "/uploads/a.jpg",
      "https://example.test/a.jpg",
      "//unsafe.example/a",
      "javascript:alert(1)",
      "/uploads/b.jpg",
      "/uploads/c.jpg",
    ],
    category: "king",
    isActive: true,
  });
  assert.equal(candidate.images.length, 3);
  assert.equal(JSON.stringify(candidate).includes("PRIVATE"), false);
  assert.equal(candidate.bio, "");
  assert.equal(candidate.age, null);
});
test("choices are independent and unavailable candidates still count as votes", () => {
  const choices = savedChoices([
    { contest: "queen", candidate: { _id: "q", fullName: "Queen" } },
  ]);
  assert.equal(choices.king, null);
  assert.equal(choices.queen._id, "q");
  assert.ok(savedChoices([{ contest: "king", candidate: null }]).king);
  assert.throws(() => savedChoices(null));
  assert.throws(() =>
    savedChoices([
      { contest: "king", candidate: null },
      { contest: "king", candidate: null },
    ]),
  );
});

test("announced result projection validates totals and deterministic ranking", () => {
  const candidate = (id, name, category) => ({ _id: id, fullName: name, category, images: ["/uploads/a.jpg"], isActive: true, contactNumber: "PRIVATE" });
  const result = publicResults({ round: 3, revision: 8,
    kings: [
      { candidate: candidate("k2", "Zaw", "king"), votes: 2, title: "Prince" },
      { candidate: candidate("k1", "Aung", "king"), votes: 5, title: "Mrs Thadingyut" },
    ], queens: [] });
  assert.deepEqual(result.king.map(entry => [entry._id, entry.votes, entry.title]), [["k1", 5, "Mrs Thadingyut"], ["k2", 2, "Prince"]]);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.throws(() => publicResults(null));
  assert.throws(() => publicResults({ round: 1, revision: 1, kings: [{ candidate: candidate("k", "K", "king"), votes: -1 }], queens: [] }));
});
