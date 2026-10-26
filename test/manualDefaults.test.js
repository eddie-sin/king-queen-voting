const { test } = require("node:test");
const assert = require("node:assert/strict");
const Controls = require("../model/eventControlsModel");
test("event controls default closed and require an explicit operator action", async () => {
  const controls = new Controls();
  await controls.validate();
  assert.equal(controls.registrationOpen, false);
  assert.equal(controls.votingStatus, "closed");
  assert.equal(controls.announcementOpen, false);
  assert.equal(controls.lanternVotingOpen, false);
  assert.equal(controls.schemaVersion, 2);
  for (const field of ["votingOpensAt", "registrationClosesAt", "resultsPublishedAt"]) assert.equal(Controls.schema.path(field), undefined);
});
test("announcements cannot coexist with an open voting window", async () => {
  for (const input of [{announcementOpen:true,votingStatus:"open"},{lanternAnnouncementOpen:true,lanternVotingOpen:true}]) {
    await assert.rejects(new Controls(input).validate(), {name:"ValidationError"});
  }
});
