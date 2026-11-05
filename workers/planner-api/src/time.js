import { TIMEZONE } from "./constants.js";

export function zonedParts(date, timeZone = TIMEZONE) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value;
  let hour = bag.hour;
  if (hour === "24") hour = "00";
  const dateStr = `${bag.year}-${bag.month}-${bag.day}`;
  return { date: dateStr, time: `${hour}:${bag.minute}`, month: dateStr.slice(0, 7) };
}

export function chicagoNow(now) {
  return zonedParts(now instanceof Date ? now : new Date(now));
}

export function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function daysBetween(earlier, later) {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

export function monthBounds(month) {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const start = `${month}-01`;
  const end = `${month}-${String(last).padStart(2, "0")}`;
  return { start, end, from: addDays(start, -7), to: addDays(end, 7) };
}

export function dayInMonth(month, dayOfMonth) {
  const { end } = monthBounds(month);
  const last = Number(end.slice(-2));
  const day = Math.min(Math.max(1, dayOfMonth), last);
  return `${month}-${String(day).padStart(2, "0")}`;
}
