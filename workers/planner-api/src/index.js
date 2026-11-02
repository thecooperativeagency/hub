import { identify } from "./auth.js";
import {
  CHANNELS,
  OWNERS,
  STEPS,
  storeById,
} from "./constants.js";
import {
  clearFixtures,
  deleteById,
  ensureRollouts,
  fixtureRowCount,
  insertApproval,
  insertCalendar,
  insertEvent,
  insertShoot,
  insertTask,
  listApprovals,
  listCalendar,
  listEvents,
  listRollouts,
  listShoots,
  listStores,
  listTasks,
  rangeFor,
  ready,
  updateApproval,
  updateCalendar,
  updateEvent,
  updateRollout,
  updateShoot,
  updateStep,
  updateStoreCadence,
  updateTask,
} from "./data.js";
import { CORS, HttpError, json, readBody } from "./http.js";
import { loadPosting } from "./posting.js";
import { chicagoNow, zonedParts } from "./time.js";
import { choice, channel, clock, day, enums, monthKey, owner, recordId, storeId, text } from "./validate.js";

const STEP_KEYS = new Set(STEPS.map((step) => step.key));

function log(fields) {
  console.log(JSON.stringify({ level: "info", ...fields }));
}

function clockFrom(env) {
  const now = env.PLANNER_NOW ? new Date(env.PLANNER_NOW) : new Date();
  if (Number.isNaN(now.getTime())) throw new HttpError(500, "clock");
  return { now, zoned: chicagoNow(now), nowIso: now.toISOString() };
}

function noticeFor(auth, posting) {
  const parts = [];
  if (auth.mode === "open") {
    parts.push("No PIN is set on the Worker. This preview is fine for the sample desk. Do not put real client work here until PLANNER_PIN is set.");
  }
  if (posting.mode === "fixture") {
    parts.push("Posting health is a fictional sample. Zernio and PostEngine are not connected, and nothing on this desk can publish.");
  } else if (posting.mode === "live") {
    parts.push("Posting health is a live read. This desk still cannot publish.");
  } else {
    parts.push(...posting.warnings);
    parts.push("This desk cannot publish.");
  }
  return parts.join(" ");
}

async function bundle(env, fetchImpl, monthValue) {
  const { nowIso, zoned } = clockFrom(env);
  await ready(env, nowIso, zoned.date);
  const month = monthValue || zoned.month;
  monthKey(month);
  await ensureRollouts(env.DB, month, nowIso);
  const stores = await listStores(env.DB);
  const posting = await loadPosting({
    env,
    fetchImpl,
    today: zoned.date,
    dateOf: (instant) => zonedParts(instant).date,
    stores,
  });
  const range = rangeFor(month);
  const posts = posting.posts.filter((post) => post.date >= range.from && post.date <= range.to);
  return {
    zoned,
    nowIso,
    month,
    range,
    stores,
    posting: {
      mode: posting.mode,
      zernio: posting.zernio,
      postengine: posting.postengine,
      warnings: posting.warnings,
      stores: posting.stores,
    },
    posts,
    calendar: await listCalendar(env.DB, range.from, range.to),
    shoots: await listShoots(env.DB, range.from, range.to),
    rollouts: await listRollouts(env.DB, month),
    events: await listEvents(env.DB),
    tasks: await listTasks(env.DB),
    approvals: await listApprovals(env.DB),
    fixtureRows: (await fixtureRowCount(env.DB)) > 0,
  };
}

function calendarInput(body, nowIso) {
  return {
    storeId: storeId(body.storeId, { required: true }),
    title: text(body.title, 180, { required: true, name: "title" }),
    startsOn: day(body.startsOn, { required: true, name: "startsOn" }),
    endsOn: day(body.endsOn, { name: "endsOn" }),
    channel: channel(body.channel),
    owner: owner(body.owner, false),
    status: choice(body.status, enums.calendar, "status", "planned"),
    notes: text(body.notes, 2000, { name: "notes" }),
    nowIso,
  };
}

function shootInput(body, nowIso) {
  const shooter = text(body.shooter, 80, { name: "shooter" }) || "Lance";
  return {
    storeId: storeId(body.storeId, { required: true }),
    shootOn: day(body.shootOn, { required: true, name: "shootOn" }),
    startTime: clock(body.startTime, "startTime"),
    endTime: clock(body.endTime, "endTime"),
    shooter,
    location: text(body.location, 180, { name: "location" }),
    brief: text(body.brief, 2000, { name: "brief" }),
    status: choice(body.status, enums.shoot, "status", "planned"),
    nowIso,
  };
}

function eventInput(body, nowIso) {
  return {
    storeId: storeId(body.storeId, { required: false }),
    title: text(body.title, 180, { required: true, name: "title" }),
    startsOn: day(body.startsOn, { name: "startsOn" }),
    endsOn: day(body.endsOn, { name: "endsOn" }),
    decision: choice(body.decision, enums.decision, "decision", "pending"),
    offer: text(body.offer, 500, { name: "offer" }),
    notes: text(body.notes, 2000, { name: "notes" }),
    owner: owner(body.owner, false),
    nowIso,
  };
}

function taskInput(body, nowIso) {
  return {
    title: text(body.title, 180, { required: true, name: "title" }),
    owner: owner(body.owner, true),
    storeId: storeId(body.storeId, { required: false }),
    dueOn: day(body.dueOn, { name: "dueOn" }),
    status: choice(body.status, enums.task, "status", "open"),
    notes: text(body.notes, 2000, { name: "notes" }),
    nowIso,
  };
}

function approvalInput(body, nowIso) {
  return {
    title: text(body.title, 180, { required: true, name: "title" }),
    storeId: storeId(body.storeId, { required: false }),
    kind: choice(body.kind, enums.kind, "kind", "creative"),
    requestedBy: owner(body.requestedBy, false),
    status: choice(body.status, enums.approval, "status", "pending"),
    notes: text(body.notes, 2000, { name: "notes" }),
    dueOn: day(body.dueOn, { name: "dueOn" }),
    nowIso,
  };
}

async function route(request, env, fetchImpl) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (path === "/api/planner/healthz" && request.method === "GET") {
    return json({ ok: true, service: "hub-planner" });
  }
  if (!path.startsWith("/api/planner")) return json({ error: "not found" }, 404);

  if (path === "/api/planner/session" && request.method === "POST") {
    const body = await readBody(request);
    const pin = typeof body.pin === "string" ? body.pin : "";
    const probe = new Request(request.url, {
      headers: { "X-Planner-Pin": pin, Authorization: `Bearer ${pin}` },
    });
    const auth = await identify(probe, env);
    if (!auth.ok) return json({ error: "unauthorized" }, 401);
    return json({ ok: true, mode: auth.mode });
  }

  const auth = await identify(request, env);
  if (!auth.ok) return json({ error: "unauthorized" }, 401);

  const { nowIso } = clockFrom(env);

  if (path === "/api/planner" && request.method === "GET") {
    const data = await bundle(env, fetchImpl, url.searchParams.get("month"));
    return json({
      ok: true,
      service: "hub-planner",
      timezone: "America/Chicago",
      now: data.nowIso,
      today: data.zoned.date,
      month: data.month,
      range: { from: data.range.from, to: data.range.to },
      auth: { mode: auth.mode },
      notice: noticeFor(auth, data.posting),
      fixtureRows: data.fixtureRows,
      stores: data.stores,
      owners: OWNERS,
      channels: CHANNELS,
      steps: STEPS,
      posting: data.posting,
      posts: data.posts,
      calendar: data.calendar,
      shoots: data.shoots,
      rollouts: data.rollouts,
      events: data.events,
      tasks: data.tasks,
      approvals: data.approvals,
    });
  }

  if (path === "/api/planner/fixtures" && request.method === "DELETE") {
    await ready(env, nowIso, clockFrom(env).zoned.date);
    await clearFixtures(env.DB);
    log({ msg: "planner.clear_fixtures", who: auth.who });
    return json({ ok: true });
  }

  const storeMatch = path.match(/^\/api\/planner\/stores\/([a-z0-9]+)$/);
  if (storeMatch && request.method === "PATCH") {
    const id = storeMatch[1];
    if (!storeById(id)) return json({ error: "unknown store" }, 404);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const body = await readBody(request);
    const cadenceDays = Number(body.cadenceDays);
    if (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 30) {
      throw new HttpError(400, "cadenceDays must be 1–30");
    }
    const store = await updateStoreCadence(env.DB, id, cadenceDays);
    log({ msg: "planner.write", collection: "stores", id, who: auth.who });
    return json({ ok: true, store });
  }

  const stepMatch = path.match(/^\/api\/planner\/rollouts\/([a-z0-9]+)\/(\d{4}-\d{2})\/steps\/([a-z_]+)$/);
  if (stepMatch) {
    const [, store, month, stepKey] = stepMatch;
    if (!storeById(store) || !STEP_KEYS.has(stepKey)) return json({ error: "not found" }, 404);
    monthKey(month);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    await ensureRollouts(env.DB, month, nowIso);
    if (request.method !== "PATCH") return json({ error: "method" }, 405);
    const body = await readBody(request);
    const step = await updateStep(env.DB, store, month, stepKey, {
      status: choice(body.status, enums.step, "status"),
      owner: owner(body.owner, false),
      note: text(body.note, 500, { name: "note" }),
      nowIso,
    });
    log({ msg: "planner.write", collection: "rollout_steps", id: `${store}:${month}:${stepKey}`, who: auth.who });
    return json({ ok: true, step });
  }

  const rolloutMatch = path.match(/^\/api\/planner\/rollouts\/([a-z0-9]+)\/(\d{4}-\d{2})$/);
  if (rolloutMatch) {
    const [, store, month] = rolloutMatch;
    if (!storeById(store)) return json({ error: "not found" }, 404);
    monthKey(month);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    await ensureRollouts(env.DB, month, nowIso);
    if (request.method !== "PATCH") return json({ error: "method" }, 405);
    const body = await readBody(request);
    const rollout = await updateRollout(env.DB, store, month, {
      programName: text(body.programName, 180, { name: "programName" }),
      notes: text(body.notes, 2000, { name: "notes" }),
    });
    log({ msg: "planner.write", collection: "rollouts", id: `${store}:${month}`, who: auth.who });
    return json({ ok: true, rollout });
  }

  const collections = {
    "/api/planner/calendar": {
      name: "calendar",
      table: "calendar_items",
      input: calendarInput,
      insert: insertCalendar,
      update: updateCalendar,
    },
    "/api/planner/shoots": {
      name: "shoots",
      table: "shoots",
      input: shootInput,
      insert: insertShoot,
      update: updateShoot,
    },
    "/api/planner/events": {
      name: "events",
      table: "events",
      input: eventInput,
      insert: insertEvent,
      update: updateEvent,
    },
    "/api/planner/tasks": {
      name: "tasks",
      table: "tasks",
      input: taskInput,
      insert: insertTask,
      update: updateTask,
    },
    "/api/planner/approvals": {
      name: "approvals",
      table: "approvals",
      input: approvalInput,
      insert: insertApproval,
      update: updateApproval,
    },
  };

  for (const [base, collection] of Object.entries(collections)) {
    if (path !== base && !path.startsWith(`${base}/`)) continue;
    await ready(env, nowIso, clockFrom(env).zoned.date);
    if (path === base && request.method === "POST") {
      const body = await readBody(request);
      const item = collection.input(body, nowIso);
      item.id = crypto.randomUUID();
      const record = await collection.insert(env.DB, item);
      log({ msg: "planner.write", collection: collection.name, id: record.id, who: auth.who, action: "create" });
      return json({ ok: true, item: record }, 201);
    }
    if (path.startsWith(`${base}/`)) {
      let rawId = path.slice(base.length + 1);
      try {
        rawId = decodeURIComponent(rawId);
      } catch {
        return json({ error: "unknown id" }, 400);
      }
      const id = recordId(rawId);
      if (request.method === "PATCH") {
        const body = await readBody(request);
        const item = collection.input(body, nowIso);
        const record = await collection.update(env.DB, id, item);
        log({ msg: "planner.write", collection: collection.name, id, who: auth.who, action: "update" });
        return json({ ok: true, item: record });
      }
      if (request.method === "DELETE") {
        await deleteById(env.DB, collection.table, id);
        log({ msg: "planner.write", collection: collection.name, id, who: auth.who, action: "delete" });
        return json({ ok: true });
      }
    }
    return json({ error: "method" }, 405);
  }

  return json({ error: "not found" }, 404);
}

export function createApp(deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch.bind(globalThis);
  return {
    async fetch(request, env) {
      try {
        return await route(request, env, fetchImpl);
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (status === 500) {
          console.log(JSON.stringify({ level: "error", message: String(err && err.message || err) }));
        }
        return json({ error: status === 500 ? "server" : err.message }, status);
      }
    },
  };
}

export default createApp();
