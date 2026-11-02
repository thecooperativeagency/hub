import { identify } from "./auth.js";
import {
  CHANNELS,
  JOB_ROLES,
  OWNERS,
  STEPS,
  storeById,
} from "./constants.js";
import {
  clearFixtures,
  deleteById,
  deliverJob,
  ensureCreativeApproval,
  ensureRollouts,
  fixtureRowCount,
  getCalendarItem,
  getJob,
  insertApproval,
  insertAsset,
  insertCalendar,
  insertEvent,
  insertJob,
  insertShoot,
  insertTask,
  listApprovals,
  listAssets,
  listBriefs,
  listCalendar,
  listEvents,
  listJobs,
  listQuarterBundle,
  listRollouts,
  listShoots,
  listShootsAll,
  listStores,
  listTasks,
  rangeFor,
  ready,
  replaceQuarter,
  setBriefPipeline,
  setBriefQueued,
  updateApproval,
  updateCalendar,
  updateEvent,
  updateRollout,
  updateShoot,
  updateStep,
  updateStoreCadence,
  updateTask,
} from "./data.js";
import { annotateChain, nextQuarter, previousQuarter, quarterMonths, quarterOf, rollQuarter, templateQuarter } from "./derive.js";
import { CORS, HttpError, json, readBody } from "./http.js";
import { loadPosting } from "./posting.js";
import { peWriteEnabled, queueDraft } from "./postengine-write.js";
import { chicagoNow, zonedParts } from "./time.js";
import { choice, channel, clock, day, enums, monthKey, owner, recordId, storeId, text } from "./validate.js";

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function formatsOf(value) {
  const list = stringList(value);
  if (list.some((item) => item !== "photo" && item !== "reel")) throw new HttpError(400, "formats must be photo or reel");
  return list;
}

function channelsOf(value, primary) {
  const list = stringList(value);
  if (!list.length && primary) return [primary];
  for (const item of list) channel(item);
  return list;
}

function assetUrlsOf(value) {
  const list = Array.isArray(value) ? value : [];
  if (list.length > 12) throw new HttpError(400, "too many asset urls");
  return list.map((url) => {
    if (typeof url !== "string" || !/^https?:\/\//.test(url) && !url.startsWith("sample://")) {
      throw new HttpError(400, "asset url must be http(s) or a sample link");
    }
    return url.trim();
  });
}

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
  const briefs = await listBriefs(env.DB);
  const jobs = await listJobs(env.DB);
  const assets = await listAssets(env.DB);
  const allShoots = await listShootsAll(env.DB);
  const approvals = await listApprovals(env.DB);
  const pePosts = posting.posts
    .filter((post) => post.source === "postengine")
    .map((post) => ({
      peId: String(post.id).replace(/^postengine:/, "").replace(/^fixture:postengine:/, ""),
      status: post.status,
    }));
  const chain = annotateChain({
    posts: briefs,
    assets,
    shoots: allShoots,
    jobs,
    approvals,
    pePosts,
    peWriteEnabled: peWriteEnabled(env),
  });
  const stageById = new Map(chain.posts.map((post) => [post.id, post]));
  const quarter = quarterOf(zoned.month);
  const qMonths = quarterMonths(quarter);
  const plans = await listQuarterBundle(env.DB, quarter);
  const events = await listEvents(env.DB);
  const quarterPlans = plans.map((plan) => ({
    ...plan,
    months: plan.months.map((month) => ({ ...month })),
    slots: plan.slots.map((slot) => ({
      ...slot,
      filled: briefs.filter((brief) => brief.storeId === plan.storeId
        && brief.startsOn.slice(0, 7) === slot.month
        && (brief.channels.includes(slot.channel) || brief.channel === slot.channel)).length,
    })),
    events: events.filter((event) => event.storeId === plan.storeId && event.startsOn && qMonths.includes(event.startsOn.slice(0, 7))),
  }));
  return {
    zoned,
    nowIso,
    month,
    range,
    stores,
    quarter: { quarter, months: qMonths, next: nextQuarter(quarter), plans: quarterPlans },
    needs: chain.needs,
    suggestedShoots: chain.suggestedShoots,
    jobs: chain.jobs,
    peWrite: peWriteEnabled(env),
    posting: {
      mode: posting.mode,
      zernio: posting.zernio,
      postengine: posting.postengine,
      warnings: posting.warnings,
      stores: posting.stores,
    },
    posts,
    calendar: (await listCalendar(env.DB, range.from, range.to)).map((item) => {
      const stage = stageById.get(item.id);
      return stage ? { ...item, stage: stage.stage, blockedBy: stage.blockedBy, approvalId: stage.approvalId } : item;
    }),
    shoots: await listShoots(env.DB, range.from, range.to),
    rollouts: await listRollouts(env.DB, month),
    events: await listEvents(env.DB),
    tasks: await listTasks(env.DB),
    approvals: await listApprovals(env.DB),
    fixtureRows: (await fixtureRowCount(env.DB)) > 0,
  };
}

function calendarInput(body, nowIso) {
  const kind = choice(body.kind, ["note", "post"], "kind", "note");
  const primary = channel(body.channel);
  const channels = channelsOf(body.channels, primary);
  const subject = text(body.subject, 180, { name: "subject", required: kind === "post" });
  return {
    storeId: storeId(body.storeId, { required: true }),
    title: text(body.title, 180, { required: true, name: "title" }),
    startsOn: day(body.startsOn, { required: true, name: "startsOn" }),
    endsOn: day(body.endsOn, { name: "endsOn" }),
    channel: primary || channels[0] || null,
    channels,
    owner: owner(body.owner, false),
    status: choice(body.status, enums.calendar, "status", "planned"),
    notes: text(body.notes, 2000, { name: "notes" }),
    kind,
    goal: text(body.goal, 500, { name: "goal" }),
    offerLink: text(body.offerLink, 300, { name: "offerLink" }),
    creativeRequest: text(body.creativeRequest, 2000, { name: "creativeRequest" }),
    subject,
    formats: formatsOf(body.formats),
    pipeline: kind === "post" ? "brief" : "",
    caption: text(body.caption, 2000, { name: "caption" }),
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

async function queueApprovedBrief(env, fetchImpl, approval, nowIso) {
  const brief = await getCalendarItem(env.DB, approval.briefId);
  if (!brief) return { queued: false, reason: "missing_brief" };
  const jobs = await listJobs(env.DB);
  const copy = jobs.find((job) => job.briefId === brief.id && job.role === "copy" && job.captionDraft);
  const caption = (copy && copy.captionDraft) || brief.caption || approval.notes || "";
  const assetUrls = [...new Set(jobs.filter((job) => job.briefId === brief.id).flatMap((job) => job.assetUrls || []))];
  const store = storeById(brief.storeId);
  try {
    const result = await queueDraft({ env, fetchImpl, brief, store, caption, assetUrls });
    if (result.queued) await setBriefQueued(env.DB, brief.id, result.id, caption, nowIso);
    else await setBriefPipeline(env.DB, brief.id, "approved", nowIso);
    return result;
  } catch (err) {
    await setBriefPipeline(env.DB, brief.id, "approved", nowIso);
    console.log(JSON.stringify({ level: "warn", source: "postengine-import", message: String(err && err.message || err) }));
    return { queued: false, reason: "upstream" };
  }
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
  const deliverMatch = path.match(/^\/api\/planner\/jobs\/([^/]+)\/deliver$/);
  if (auth.mode === "bot") {
    const allowed = (path === "/api/planner/jobs" && request.method === "GET") || (deliverMatch && request.method === "POST");
    if (!allowed) return json({ error: "forbidden" }, 403);
  }

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
      roles: JOB_ROLES,
      peWrite: data.peWrite,
      posting: data.posting,
      posts: data.posts,
      calendar: data.calendar,
      quarter: data.quarter,
      needs: data.needs,
      suggestedShoots: data.suggestedShoots,
      jobs: data.jobs,
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

  if (path === "/api/planner/jobs" && request.method === "GET") {
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const requested = url.searchParams.get("assignee") || "";
    if (auth.mode === "bot" && requested && requested !== auth.assignee) return json({ error: "forbidden" }, 403);
    const assignee = auth.mode === "bot" ? auth.assignee : (requested || null);
    const jobs = await listJobs(env.DB, assignee);
    const briefs = await listBriefs(env.DB);
    const chain = annotateChain({
      posts: briefs,
      assets: await listAssets(env.DB),
      shoots: await listShootsAll(env.DB),
      jobs,
      approvals: await listApprovals(env.DB),
      pePosts: [],
      peWriteEnabled: peWriteEnabled(env),
    });
    return json({ ok: true, assignee: assignee || null, jobs: chain.jobs });
  }

  if (deliverMatch && request.method === "POST") {
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const id = recordId(decodeURIComponent(deliverMatch[1]));
    const job = await getJob(env.DB, id);
    if (!job) return json({ error: "not found" }, 404);
    if (auth.mode === "bot" && job.assignee !== auth.assignee) return json({ error: "forbidden" }, 403);
    const body = await readBody(request);
    const delivered = await deliverJob(env.DB, id, {
      captionDraft: text(body.captionDraft, 2000, { name: "captionDraft" }),
      assetUrls: assetUrlsOf(body.assetUrls),
      notes: text(body.note || body.notes, 2000, { name: "note" }),
      nowIso,
    });
    const brief = await getCalendarItem(env.DB, job.briefId);
    if (brief && delivered.role === "shoot") {
      for (const format of brief.formats.length ? brief.formats : ["photo"]) {
        await insertAsset(env.DB, {
          id: crypto.randomUUID(),
          storeId: brief.storeId,
          subject: brief.subject || brief.title,
          format,
          source: "delivered",
          url: delivered.assetUrls[0] || "",
          shootId: null,
          nowIso,
        });
      }
    }
    if (brief) {
      const siblings = await listJobs(env.DB);
      const creative = siblings.filter((item) => item.briefId === brief.id && item.role !== "shoot");
      const ready = creative.length && creative.every((item) => item.status === "delivered" || item.status === "approved");
      if (ready) {
        const caption = creative.find((item) => item.role === "copy" && item.captionDraft)?.captionDraft
          || delivered.captionDraft
          || brief.caption;
        await ensureCreativeApproval(env.DB, brief, caption, nowIso);
      }
    }
    log({ msg: "planner.deliver", id, who: auth.who });
    return json({ ok: true, job: delivered });
  }

  const jobsForBrief = path.match(/^\/api\/planner\/calendar\/([^/]+)\/jobs$/);
  if (jobsForBrief && request.method === "POST") {
    if (auth.mode === "bot") return json({ error: "forbidden" }, 403);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const brief = await getCalendarItem(env.DB, recordId(decodeURIComponent(jobsForBrief[1])));
    if (!brief || brief.kind !== "post") return json({ error: "not found" }, 404);
    const existing = (await listJobs(env.DB)).filter((job) => job.briefId === brief.id);
    const created = [];
    for (const role of JOB_ROLES) {
      if (existing.some((job) => job.role === role.role)) continue;
      created.push(await insertJob(env.DB, {
        id: crypto.randomUUID(),
        briefId: brief.id,
        role: role.role,
        assignee: role.assignee,
        title: `${brief.title} · ${role.label}`,
        dueOn: brief.startsOn,
        nowIso,
      }));
    }
    log({ msg: "planner.jobs", id: brief.id, who: auth.who, count: created.length });
    return json({ ok: true, jobs: created }, 201);
  }

  if (path === "/api/planner/quarters/roll" && request.method === "POST") {
    if (auth.mode === "bot") return json({ error: "forbidden" }, 403);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const body = await readBody(request);
    const id = storeId(body.storeId, { required: true });
    const quarter = text(body.quarter, 8, { required: true, name: "quarter" });
    if (!quarterMonths(quarter).length) throw new HttpError(400, "quarter must be YYYY-Q#");
    const source = choice(body.source, ["template", "previous"], "source", "template");
    let plan;
    if (source === "template") {
      plan = templateQuarter(id, quarter);
    } else {
      const prior = previousQuarter(quarter);
      const rows = await listQuarterBundle(env.DB, prior);
      const found = rows.find((row) => row.storeId === id);
      if (!found) throw new HttpError(400, "no previous quarter to roll");
      plan = rollQuarter({ ...found, storeId: id, quarter: prior }, quarter);
    }
    const saved = await replaceQuarter(env.DB, { ...plan, storeId: id }, nowIso);
    log({ msg: "planner.quarter", id: `${id}:${quarter}`, who: auth.who, source });
    return json({ ok: true, plan: saved }, 201);
  }

  if (path === "/api/planner/shoots/accept" && request.method === "POST") {
    if (auth.mode === "bot") return json({ error: "forbidden" }, 403);
    await ready(env, nowIso, clockFrom(env).zoned.date);
    const body = await readBody(request);
    const shoot = await insertShoot(env.DB, {
      id: crypto.randomUUID(),
      storeId: storeId(body.storeId, { required: true }),
      shootOn: day(body.shootOn, { required: true, name: "shootOn" }),
      startTime: clock(body.startTime, "startTime"),
      endTime: clock(body.endTime, "endTime"),
      shooter: text(body.shooter, 80, { name: "shooter" }) || "Lance",
      location: text(body.location, 180, { name: "location" }) || "Lot",
      brief: text(body.brief, 2000, { name: "brief" }),
      status: "confirmed",
      durationMin: Number.isInteger(Number(body.durationMin)) ? Number(body.durationMin) : 60,
      shotList: Array.isArray(body.shotList) ? body.shotList : [],
      windowStart: body.windowStart || null,
      windowEnd: body.windowEnd || null,
      nowIso,
    });
    log({ msg: "planner.write", collection: "shoots", id: shoot.id, who: auth.who, action: "accept" });
    return json({ ok: true, item: shoot }, 201);
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
        if (collection.name === "approvals" && record.status === "approved" && record.briefId) {
          const queued = await queueApprovedBrief(env, fetchImpl, record, nowIso);
          return json({ ok: true, item: record, postengine: queued });
        }
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
