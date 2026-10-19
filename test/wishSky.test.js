const { test } = require("node:test");
const assert = require("node:assert/strict");
const clock = require("../utils/clock");
const wishSky = require("../utils/wishSky");

test("Wish Sky opens only within the configured Myanmar calendar date", () => {
  const originalClock = clock.now;
  const originalDate = process.env.WISH_SKY_EVENT_DATE;
  try {
    process.env.WISH_SKY_EVENT_DATE = "2026-10-28";
    for (const [time, isOpen] of [
      ["2026-10-27T23:59:59.999+06:30", false],
      ["2026-10-28T00:00:00+06:30", true],
      ["2026-10-28T23:59:59.999+06:30", true],
      ["2026-10-29T00:00:00+06:30", false],
    ]) {
      clock.now = () => new Date(time);
      assert.equal(wishSky.getStatus().isOpen, isOpen);
      if (isOpen) assert.doesNotThrow(() => wishSky.requireOpen());
      else assert.throws(() => wishSky.requireOpen(), { statusCode: 403 });
    }
    for (const date of ["", "2026-02-30", "2026-13-01", "28-10-2026"]) {
      process.env.WISH_SKY_EVENT_DATE = date;
      assert.throws(() => wishSky.getStatus(), { statusCode: 503 });
    }
  } finally {
    clock.now = originalClock;
    if (originalDate === undefined) delete process.env.WISH_SKY_EVENT_DATE;
    else process.env.WISH_SKY_EVENT_DATE = originalDate;
  }
});
