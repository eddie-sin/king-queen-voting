const AppError = require("./appError");
const clock = require("./clock");
const { parseMyanmarTime } = require("./schedule");

exports.getStatus = () => {
  const eventDate = process.env.WISH_SKY_EVENT_DATE;
  let opensAt;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate || "")) throw new Error();
    opensAt = parseMyanmarTime(`${eventDate}T00:00:00+06:30`, "WISH_SKY_EVENT_DATE");
  } catch {
    throw new AppError("Wish Sky event date has not been configured correctly.", 503);
  }
  const closesAt = new Date(+opensAt + 24 * 60 * 60 * 1000);
  const now = clock.now();
  return { eventDate, timezone: "Asia/Yangon", isOpen: now >= opensAt && now < closesAt, maxWishes: 3 };
};

exports.requireOpen = () => {
  if (!exports.getStatus().isOpen) throw new AppError("Wish Sky is only available on the event date.", 403);
};
