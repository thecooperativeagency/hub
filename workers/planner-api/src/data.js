import { STEPS, STORES } from "./constants.js";
import { HttpError } from "./http.js";
import { SCHEMA } from "./schema.js";
import { fixtureRecords } from "./seed.js";
import { monthBounds } from "./time.js";

async function all(db, sql, ...args) {
  const result = await db.prepare(sql).bind(...args).all();
  return result.results || [];
}

async function first(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

async function run(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}

function changed(result) {
  return Boolean(result && result.meta && Number(result.meta.changes) > 0);
}

function flag(value) {
  return value === 1 || value === true;
}

function mapStore(row) {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    postengineId: row.postengine_id,
    cadenceDays: row.cadence_days,
    market: row.market,
  };
}

function mapCalendar(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    title: row.title,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    channel: row.channel,
    owner: row.owner,
    status: row.status,
    notes: row.notes,
    fixture: flag(row.fixture),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShoot(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    shootOn: row.shoot_on,
    startTime: row.start_time,
    endTime: row.end_time,
    shooter: row.shooter,
    location: row.location,
    brief: row.brief,
    status: row.status,
    fixture: flag(row.fixture),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    title: row.title,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    decision: row.decision,
    offer: row.offer,
    notes: row.notes,
    owner: row.owner,
    fixture: flag(row.fixture),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    storeId: row.store_id,
    dueOn: row.due_on,
    status: row.status,
    notes: row.notes,
    fixture: flag(row.fixture),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApproval(row) {
  return {
    id: row.id,
    title: row.title,
    storeId: row.store_id,
    kind: row.kind,
    requestedBy: row.requested_by,
    status: row.status,
    notes: row.notes,
    dueOn: row.due_on,
    fixture: flag(row.fixture),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ready(env, nowIso, today) {
  if (!env.DB) throw new HttpError(500, "planner database is not bound");
  await env.DB.exec(SCHEMA);
  for (const store of STORES) {
    await run(
      env.DB,
      `INSERT OR IGNORE INTO stores (id, name, short_name, postengine_id, cadence_days, market, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      store.id,
      store.name,
      store.shortName,
      store.postengineId,
      store.cadenceDays,
      store.market,
      store.sortOrder,
    );
  }
  const seeded = await first(env.DB, "SELECT value FROM planner_meta WHERE key = 'seeded'");
  if (!seeded) {
    await seedFixtures(env.DB, today, nowIso);
    await run(env.DB, "INSERT INTO planner_meta (key, value) VALUES ('seeded', ?)", today.slice(0, 7));
    console.log(JSON.stringify({ level: "info", msg: "planner.seed", month: today.slice(0, 7) }));
  }
}

async function seedFixtures(db, today, nowIso) {
  const records = fixtureRecords(today, nowIso);
  for (const rollout of records.rollouts) {
    await run(
      db,
      `INSERT OR IGNORE INTO rollouts (id, store_id, month, program_name, notes, fixture) VALUES (?, ?, ?, ?, ?, 1)`,
      rollout.id,
      rollout.storeId,
      rollout.month,
      rollout.programName,
      rollout.notes,
    );
    await run(
      db,
      `UPDATE rollouts SET program_name = ?, notes = ?, fixture = 1 WHERE id = ?`,
      rollout.programName,
      rollout.notes,
      rollout.id,
    );
    for (const step of rollout.steps) {
      await run(
        db,
        `INSERT OR IGNORE INTO rollout_steps (id, rollout_id, step_key, status, owner, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        step.id,
        rollout.id,
        step.stepKey,
        step.status,
        step.owner,
        step.note,
        nowIso,
      );
      await run(
        db,
        `UPDATE rollout_steps SET status = ?, owner = ?, note = ?, updated_at = ? WHERE id = ?`,
        step.status,
        step.owner,
        step.note,
        nowIso,
        step.id,
      );
    }
  }
  for (const item of records.calendar) {
    await run(
      db,
      `INSERT OR IGNORE INTO calendar_items
        (id, store_id, title, starts_on, ends_on, channel, owner, status, notes, fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      item.id, item.storeId, item.title, item.startsOn, item.endsOn, item.channel, item.owner, item.status, item.notes, nowIso, nowIso,
    );
  }
  for (const item of records.shoots) {
    await run(
      db,
      `INSERT OR IGNORE INTO shoots
        (id, store_id, shoot_on, start_time, end_time, shooter, location, brief, status, fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      item.id, item.storeId, item.shootOn, item.startTime, item.endTime, item.shooter, item.location, item.brief, item.status, nowIso, nowIso,
    );
  }
  for (const item of records.events) {
    await run(
      db,
      `INSERT OR IGNORE INTO events
        (id, store_id, title, starts_on, ends_on, decision, offer, notes, owner, fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      item.id, item.storeId, item.title, item.startsOn, item.endsOn, item.decision, item.offer, item.notes, item.owner, nowIso, nowIso,
    );
  }
  for (const item of records.tasks) {
    await run(
      db,
      `INSERT OR IGNORE INTO tasks
        (id, title, owner, store_id, due_on, status, notes, fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      item.id, item.title, item.owner, item.storeId, item.dueOn, item.status, item.notes, nowIso, nowIso,
    );
  }
  for (const item of records.approvals) {
    await run(
      db,
      `INSERT OR IGNORE INTO approvals
        (id, title, store_id, kind, requested_by, status, notes, due_on, fixture, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      item.id, item.title, item.storeId, item.kind, item.requestedBy, item.status, item.notes, item.dueOn, nowIso, nowIso,
    );
  }
}

export async function ensureRollouts(db, month, nowIso) {
  for (const store of STORES) {
    const id = `rl-${store.id}-${month}`;
    await run(
      db,
      `INSERT OR IGNORE INTO rollouts (id, store_id, month, program_name, notes, fixture) VALUES (?, ?, ?, '', '', 0)`,
      id,
      store.id,
      month,
    );
    for (const step of STEPS) {
      await run(
        db,
        `INSERT OR IGNORE INTO rollout_steps (id, rollout_id, step_key, status, owner, note, updated_at)
         VALUES (?, ?, ?, 'not_started', NULL, '', ?)`,
        `rs-${store.id}-${month}-${step.key}`,
        id,
        step.key,
        nowIso,
      );
    }
  }
}

export async function listStores(db) {
  const rows = await all(db, "SELECT * FROM stores ORDER BY sort_order");
  return rows.map(mapStore);
}

export async function listCalendar(db, from, to) {
  const rows = await all(
    db,
    `SELECT * FROM calendar_items
     WHERE starts_on <= ? AND COALESCE(ends_on, starts_on) >= ?
     ORDER BY starts_on, title`,
    to,
    from,
  );
  return rows.map(mapCalendar);
}

export async function listShoots(db, from, to) {
  const rows = await all(
    db,
    "SELECT * FROM shoots WHERE shoot_on >= ? AND shoot_on <= ? ORDER BY shoot_on, start_time",
    from,
    to,
  );
  return rows.map(mapShoot);
}

export async function listEvents(db) {
  const rows = await all(db, "SELECT * FROM events ORDER BY CASE decision WHEN 'pending' THEN 0 ELSE 1 END, starts_on, title");
  return rows.map(mapEvent);
}

export async function listTasks(db) {
  const rows = await all(db, "SELECT * FROM tasks ORDER BY CASE status WHEN 'done' THEN 1 WHEN 'parked' THEN 2 ELSE 0 END, due_on, title");
  return rows.map(mapTask);
}

export async function listApprovals(db) {
  const rows = await all(
    db,
    "SELECT * FROM approvals ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, due_on, title",
  );
  return rows.map(mapApproval);
}

export async function listRollouts(db, month) {
  const rows = await all(
    db,
    `SELECT rollouts.* FROM rollouts
     JOIN stores ON stores.id = rollouts.store_id
     WHERE rollouts.month = ?
     ORDER BY stores.sort_order`,
    month,
  );
  const steps = await all(
    db,
    `SELECT rollout_steps.* FROM rollout_steps
     JOIN rollouts ON rollouts.id = rollout_steps.rollout_id
     WHERE rollouts.month = ?`,
    month,
  );
  const byRollout = new Map();
  for (const step of steps) {
    const list = byRollout.get(step.rollout_id) || [];
    list.push(step);
    byRollout.set(step.rollout_id, list);
  }
  const order = new Map(STEPS.map((step, index) => [step.key, index]));
  return rows.map((row) => ({
    id: row.id,
    storeId: row.store_id,
    month: row.month,
    programName: row.program_name,
    notes: row.notes,
    fixture: flag(row.fixture),
    steps: (byRollout.get(row.id) || [])
      .slice()
      .sort((a, b) => (order.get(a.step_key) ?? 0) - (order.get(b.step_key) ?? 0))
      .map((step) => ({
        id: step.id,
        stepKey: step.step_key,
        status: step.status,
        owner: step.owner,
        note: step.note,
        updatedAt: step.updated_at,
      })),
  }));
}

export async function fixtureRowCount(db) {
  const tables = ["calendar_items", "shoots", "events", "tasks", "approvals", "rollouts"];
  let total = 0;
  for (const table of tables) {
    const row = await first(db, `SELECT COUNT(*) AS n FROM ${table} WHERE fixture = 1`);
    total += Number(row && row.n || 0);
  }
  return total;
}

export async function clearFixtures(db) {
  const rolloutIds = await all(db, "SELECT id FROM rollouts WHERE fixture = 1");
  for (const row of rolloutIds) {
    await run(db, "DELETE FROM rollout_steps WHERE rollout_id = ?", row.id);
  }
  await run(db, "DELETE FROM rollouts WHERE fixture = 1");
  await run(db, "DELETE FROM calendar_items WHERE fixture = 1");
  await run(db, "DELETE FROM shoots WHERE fixture = 1");
  await run(db, "DELETE FROM events WHERE fixture = 1");
  await run(db, "DELETE FROM tasks WHERE fixture = 1");
  await run(db, "DELETE FROM approvals WHERE fixture = 1");
  await run(db, "UPDATE planner_meta SET value = 'cleared' WHERE key = 'seeded'");
}

export function rangeFor(month) {
  return monthBounds(month);
}

export async function insertCalendar(db, item) {
  await run(
    db,
    `INSERT INTO calendar_items
      (id, store_id, title, starts_on, ends_on, channel, owner, status, notes, fixture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    item.id, item.storeId, item.title, item.startsOn, item.endsOn, item.channel, item.owner, item.status, item.notes, item.nowIso, item.nowIso,
  );
  return mapCalendar(await first(db, "SELECT * FROM calendar_items WHERE id = ?", item.id));
}

export async function updateCalendar(db, id, item) {
  if (!(await first(db, "SELECT id FROM calendar_items WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    `UPDATE calendar_items
     SET store_id = ?, title = ?, starts_on = ?, ends_on = ?, channel = ?, owner = ?, status = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    item.storeId, item.title, item.startsOn, item.endsOn, item.channel, item.owner, item.status, item.notes, item.nowIso, id,
  );
  return mapCalendar(await first(db, "SELECT * FROM calendar_items WHERE id = ?", id));
}

export async function deleteById(db, table, id) {
  const allowed = new Set(["calendar_items", "shoots", "events", "tasks", "approvals"]);
  if (!allowed.has(table)) throw new HttpError(400, "unknown collection");
  const result = await run(db, `DELETE FROM ${table} WHERE id = ?`, id);
  if (!changed(result)) throw new HttpError(404, "not found");
}

export async function insertShoot(db, item) {
  await run(
    db,
    `INSERT INTO shoots
      (id, store_id, shoot_on, start_time, end_time, shooter, location, brief, status, fixture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    item.id, item.storeId, item.shootOn, item.startTime, item.endTime, item.shooter, item.location, item.brief, item.status, item.nowIso, item.nowIso,
  );
  return mapShoot(await first(db, "SELECT * FROM shoots WHERE id = ?", item.id));
}

export async function updateShoot(db, id, item) {
  if (!(await first(db, "SELECT id FROM shoots WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    `UPDATE shoots
     SET store_id = ?, shoot_on = ?, start_time = ?, end_time = ?, shooter = ?, location = ?, brief = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    item.storeId, item.shootOn, item.startTime, item.endTime, item.shooter, item.location, item.brief, item.status, item.nowIso, id,
  );
  return mapShoot(await first(db, "SELECT * FROM shoots WHERE id = ?", id));
}

export async function insertEvent(db, item) {
  await run(
    db,
    `INSERT INTO events
      (id, store_id, title, starts_on, ends_on, decision, offer, notes, owner, fixture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    item.id, item.storeId, item.title, item.startsOn, item.endsOn, item.decision, item.offer, item.notes, item.owner, item.nowIso, item.nowIso,
  );
  return mapEvent(await first(db, "SELECT * FROM events WHERE id = ?", item.id));
}

export async function updateEvent(db, id, item) {
  if (!(await first(db, "SELECT id FROM events WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    `UPDATE events
     SET store_id = ?, title = ?, starts_on = ?, ends_on = ?, decision = ?, offer = ?, notes = ?, owner = ?, updated_at = ?
     WHERE id = ?`,
    item.storeId, item.title, item.startsOn, item.endsOn, item.decision, item.offer, item.notes, item.owner, item.nowIso, id,
  );
  return mapEvent(await first(db, "SELECT * FROM events WHERE id = ?", id));
}

export async function insertTask(db, item) {
  await run(
    db,
    `INSERT INTO tasks
      (id, title, owner, store_id, due_on, status, notes, fixture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    item.id, item.title, item.owner, item.storeId, item.dueOn, item.status, item.notes, item.nowIso, item.nowIso,
  );
  return mapTask(await first(db, "SELECT * FROM tasks WHERE id = ?", item.id));
}

export async function updateTask(db, id, item) {
  if (!(await first(db, "SELECT id FROM tasks WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    `UPDATE tasks
     SET title = ?, owner = ?, store_id = ?, due_on = ?, status = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    item.title, item.owner, item.storeId, item.dueOn, item.status, item.notes, item.nowIso, id,
  );
  return mapTask(await first(db, "SELECT * FROM tasks WHERE id = ?", id));
}

export async function insertApproval(db, item) {
  await run(
    db,
    `INSERT INTO approvals
      (id, title, store_id, kind, requested_by, status, notes, due_on, fixture, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    item.id, item.title, item.storeId, item.kind, item.requestedBy, item.status, item.notes, item.dueOn, item.nowIso, item.nowIso,
  );
  return mapApproval(await first(db, "SELECT * FROM approvals WHERE id = ?", item.id));
}

export async function updateApproval(db, id, item) {
  if (!(await first(db, "SELECT id FROM approvals WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    `UPDATE approvals
     SET title = ?, store_id = ?, kind = ?, requested_by = ?, status = ?, notes = ?, due_on = ?, updated_at = ?
     WHERE id = ?`,
    item.title, item.storeId, item.kind, item.requestedBy, item.status, item.notes, item.dueOn, item.nowIso, id,
  );
  return mapApproval(await first(db, "SELECT * FROM approvals WHERE id = ?", id));
}

export async function updateStoreCadence(db, id, cadenceDays) {
  if (!(await first(db, "SELECT id FROM stores WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(db, "UPDATE stores SET cadence_days = ? WHERE id = ?", cadenceDays, id);
  return mapStore(await first(db, "SELECT * FROM stores WHERE id = ?", id));
}

export async function updateRollout(db, storeId, month, item) {
  const id = `rl-${storeId}-${month}`;
  if (!(await first(db, "SELECT id FROM rollouts WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(db, "UPDATE rollouts SET program_name = ?, notes = ? WHERE id = ?", item.programName, item.notes, id);
  const rows = await listRollouts(db, month);
  return rows.find((row) => row.id === id) || null;
}

export async function updateStep(db, storeId, month, stepKey, item) {
  const id = `rs-${storeId}-${month}-${stepKey}`;
  if (!(await first(db, "SELECT id FROM rollout_steps WHERE id = ?", id))) throw new HttpError(404, "not found");
  await run(
    db,
    "UPDATE rollout_steps SET status = ?, owner = ?, note = ?, updated_at = ? WHERE id = ?",
    item.status,
    item.owner,
    item.note,
    item.nowIso,
    id,
  );
  const rows = await listRollouts(db, month);
  const rollout = rows.find((row) => row.storeId === storeId);
  return rollout ? rollout.steps.find((step) => step.stepKey === stepKey) : null;
}
