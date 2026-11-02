import {
  APPROVAL_KIND,
  APPROVAL_STATUS,
  CALENDAR_STATUS,
  CHANNELS,
  EVENT_DECISION,
  OWNERS,
  SHOOT_STATUS,
  STEP_STATUS,
  STORE_IDS,
  TASK_STATUS,
} from "./constants.js";
import { HttpError } from "./http.js";

export function text(value, max, opts = {}) {
  const name = opts.name || "value";
  if (value == null || value === "") {
    if (opts.required) throw new HttpError(400, `${name} is required`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${name} must be text`);
  const trimmed = value.trim();
  if (opts.required && !trimmed) throw new HttpError(400, `${name} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${name} is too long`);
  return trimmed;
}

export function owner(value, required = false) {
  if (value == null || value === "") {
    if (required) throw new HttpError(400, "owner is required");
    return null;
  }
  if (typeof value !== "string" || !OWNERS.includes(value)) {
    throw new HttpError(400, "owner is not on the desk");
  }
  return value;
}

export function choice(value, allowed, name, fallback = undefined) {
  if ((value == null || value === "") && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new HttpError(400, `${name} is not a valid choice`);
  }
  return value;
}

export function day(value, opts = {}) {
  const name = opts.name || "date";
  if (value == null || value === "") {
    if (opts.required) throw new HttpError(400, `${name} is required`);
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  }
  const [year, month, date] = value.split("-").map(Number);
  const probed = new Date(Date.UTC(year, month - 1, date));
  if (probed.getUTCFullYear() !== year || probed.getUTCMonth() !== month - 1 || probed.getUTCDate() !== date) {
    throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  }
  return value;
}

export function clock(value, name) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${name} must be HH:MM`);
  }
  return value;
}

export function storeId(value, opts = {}) {
  if (value == null || value === "") {
    if (opts.required) throw new HttpError(400, "store is required");
    return null;
  }
  if (typeof value !== "string" || !STORE_IDS.has(value)) throw new HttpError(400, "unknown store");
  return value;
}

export function channel(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !CHANNELS.some((item) => item.id === value)) {
    throw new HttpError(400, "unknown channel");
  }
  return value;
}

export function monthKey(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, "month must be YYYY-MM");
  }
  return value;
}

export function recordId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(value)) {
    throw new HttpError(400, "unknown id");
  }
  return value;
}

export const enums = {
  calendar: CALENDAR_STATUS,
  shoot: SHOOT_STATUS,
  task: TASK_STATUS,
  decision: EVENT_DECISION,
  approval: APPROVAL_STATUS,
  kind: APPROVAL_KIND,
  step: STEP_STATUS,
};
