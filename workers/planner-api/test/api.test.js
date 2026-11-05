import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createMemoryD1 } from "../d1-shim.js";
import { safeEqual } from "../src/auth.js";
import { createApp } from "../src/index.js";
import { SCHEMA } from "../src/schema.js";
import { chicagoNow } from "../src/time.js";
import { STORES, matchStoreName } from "../src/constants.js";
import { buildHealth, normalizePostEnginePost, readOnlyGet, readOnlyUrl } from "../src/posting.js";

const NOW = "2026-11-02T15:00:00.000Z";
const FORBIDDEN = [
  "Francisville",
  "LeBlanc",
  "McFarlin",
  "VinSolutions",
  "Riemer",
  "Bill Smith",
  "RS 3",
  "Driver's Cut",
  "4,000",
  "4000",
];

function boot(extra = {}, fetchImpl = null) {
  const env = {
    DB: createMemoryD1(),
    PLANNER_NOW: NOW,
    ...extra,
  };
  const app = createApp({ fetchImpl: fetchImpl || (async () => {
    throw new Error("outbound fetch is not allowed in this test");
  }) });
  return { app, env };
}

async function send(app, env, path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.pin) {
    headers.set("X-Planner-Pin", opts.pin);
    headers.set("Authorization", `Bearer ${opts.pin}`);
  }
  if (opts.token) headers.set("Authorization", `Bearer ${opts.token}`);
  if (opts.body) headers.set("Content-Type", "application/json");
  const response = await app.fetch(new Request(`https://hub.thecoopbrla.com${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }), env);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, json, text, headers: response.headers };
}

describe("auth", () => {
  test("timing-safe compare rejects different lengths and values", async () => {
    assert.equal(await safeEqual("abcd", "abc"), false);
    assert.equal(await safeEqual("abcd", "abce"), false);
    assert.equal(await safeEqual("abcd", "abcd"), true);
    assert.equal(await safeEqual("", "abcd"), false);
  });

  test("open mode serves the sample desk and does not call upstream", async () => {
    let called = false;
    const { app, env } = boot({}, async () => {
      called = true;
      throw new Error("should not call");
    });
    const res = await send(app, env, "/api/planner");
    assert.equal(res.status, 200);
    assert.equal(res.json.auth.mode, "open");
    assert.equal(res.json.posting.mode, "fixture");
    assert.equal(called, false);
    assert.equal(res.json.tasks.length, 7);
    assert.deepEqual(res.json.tasks.map((task) => task.owner).sort(), ["Ansel", "Daisy", "Della", "Eleanor", "Frances", "Lance", "Steve"]);
    assert.deepEqual(res.json.rollouts.map((row) => row.storeId), ["bhbmw", "abr", "hp", "bmwj", "coop"]);
    assert.equal(res.json.rollouts[0].steps.length, 10);
    assert.match(res.json.notice, /fictional sample/i);
  });

  test("pin and bearer token are required when configured", async () => {
    const { app, env } = boot({ PLANNER_PIN: "correct-horse", PLANNER_TOKEN: "script-token-value" });
    const locked = await send(app, env, "/api/planner");
    assert.equal(locked.status, 401);
    assert.equal(JSON.stringify(locked.json).includes("correct-horse"), false);
    assert.equal(JSON.stringify(locked.json).includes("script-token"), false);

    const wrong = await send(app, env, "/api/planner", { pin: "nope" });
    assert.equal(wrong.status, 401);

    const pin = await send(app, env, "/api/planner", { pin: "correct-horse" });
    assert.equal(pin.status, 200);
    assert.equal(pin.json.auth.mode, "pin");

    const token = await send(app, env, "/api/planner", { token: "script-token-value" });
    assert.equal(token.status, 200);
    assert.equal(token.json.auth.mode, "token");

    const session = await send(app, env, "/api/planner/session", { method: "POST", body: { pin: "correct-horse" } });
    assert.equal(session.status, 200);
    const badSession = await send(app, env, "/api/planner/session", { method: "POST", body: { pin: "short" } });
    assert.equal(badSession.status, 401);
  });

  test("health check and preflight do not require a pin or return planner rows", async () => {
    const { app, env } = boot({ PLANNER_PIN: "correct-horse" });
    const health = await send(app, env, "/api/planner/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.tasks, undefined);
    const opt = await send(app, env, "/api/planner", { method: "OPTIONS" });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get("Access-Control-Allow-Origin"), "*");
  });

  test("a locked request does not call Zernio or PostEngine", async () => {
    let called = false;
    const { app, env } = boot({
      PLANNER_PIN: "correct-horse",
      ZERNIO_API_KEY: "live-key",
      POSTENGINE_PIN: "live-pin",
    }, async () => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    const res = await send(app, env, "/api/planner");
    assert.equal(res.status, 401);
    assert.equal(called, false);
  });
});

describe("desk crud", () => {
  test("creates, updates, and deletes a task and rejects a bad owner", async () => {
    const { app, env } = boot();
    const created = await send(app, env, "/api/planner/tasks", {
      method: "POST",
      body: { title: "Write the fixture caption", owner: "Frances", storeId: "abr", dueOn: "2026-11-06", notes: "Made in a test." },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.item.fixture, false);
    assert.equal(created.json.item.owner, "Frances");

    const updated = await send(app, env, `/api/planner/tasks/${created.json.item.id}`, {
      method: "PATCH",
      body: { title: "Write the fixture caption", owner: "Frances", storeId: "abr", dueOn: "2026-11-07", status: "doing", notes: "Moved." },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.item.status, "doing");

    const bad = await send(app, env, "/api/planner/tasks", {
      method: "POST",
      body: { title: "Nope", owner: "Someone Else" },
    });
    assert.equal(bad.status, 400);

    const removed = await send(app, env, `/api/planner/tasks/${created.json.item.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const missing = await send(app, env, `/api/planner/tasks/${created.json.item.id}`, { method: "DELETE" });
    assert.equal(missing.status, 404);
  });

  test("approval decisions, event decisions, cadence, and rollout steps save", async () => {
    const { app, env } = boot();
    const approval = await send(app, env, "/api/planner/approvals", {
      method: "POST",
      body: { title: "SAMPLE — test still", storeId: "bhbmw", kind: "creative", requestedBy: "Daisy", status: "pending" },
    });
    assert.equal(approval.status, 201);
    const decided = await send(app, env, `/api/planner/approvals/${approval.json.item.id}`, {
      method: "PATCH",
      body: { title: "SAMPLE — test still", storeId: "bhbmw", kind: "creative", requestedBy: "Daisy", status: "approved", notes: "Yes." },
    });
    assert.equal(decided.json.item.status, "approved");

    const event = await send(app, env, "/api/planner/events", {
      method: "POST",
      body: { title: "SAMPLE — test booth", storeId: "coop", decision: "maybe" },
    });
    assert.equal(event.status, 400);
    const yes = await send(app, env, "/api/planner/events", {
      method: "POST",
      body: { title: "SAMPLE — test booth", storeId: "coop", decision: "yes", notes: "Fictional." },
    });
    assert.equal(yes.status, 201);
    assert.equal(yes.json.item.decision, "yes");

    const cadence = await send(app, env, "/api/planner/stores/bhbmw", {
      method: "PATCH",
      body: { cadenceDays: 3 },
    });
    assert.equal(cadence.status, 200);
    assert.equal(cadence.json.store.cadenceDays, 3);

    const step = await send(app, env, "/api/planner/rollouts/abr/2026-11/steps/banners", {
      method: "PATCH",
      body: { status: "in_progress", owner: "Eleanor", note: "Sample banners." },
    });
    assert.equal(step.status, 200);
    assert.equal(step.json.step.status, "in_progress");
    assert.equal(step.json.step.owner, "Eleanor");

    const badOwner = await send(app, env, "/api/planner/rollouts/abr/2026-11/steps/banners", {
      method: "PATCH",
      body: { status: "done", owner: "Newsy" },
    });
    assert.equal(badOwner.status, 400);
  });

  test("clearing sample rows does not bring them back", async () => {
    const { app, env } = boot();
    const before = await send(app, env, "/api/planner");
    assert.equal(before.json.fixtureRows, true);
    const cleared = await send(app, env, "/api/planner/fixtures", { method: "DELETE" });
    assert.equal(cleared.status, 200);
    const after = await send(app, env, "/api/planner");
    assert.equal(after.json.fixtureRows, false);
    assert.equal(after.json.tasks.length, 0);
    assert.equal(after.json.approvals.length, 0);
    assert.equal(after.json.calendar.length, 0);
    assert.ok(after.json.rollouts.every((rollout) => rollout.fixture === false));
    assert.ok(after.json.rollouts.every((rollout) => rollout.steps.every((step) => step.status === "not_started")));
  });

  test("sample copy stays fictional", async () => {
    const { app, env } = boot();
    const res = await send(app, env, "/api/planner");
    const blob = JSON.stringify(res.json);
    for (const word of FORBIDDEN) assert.equal(blob.includes(word), false, word);
    for (const task of res.json.tasks) assert.match(task.title, /^SAMPLE/);
    for (const item of res.json.calendar) assert.match(item.title, /^SAMPLE/);
    for (const approval of res.json.approvals) assert.match(approval.title, /^SAMPLE/);
    for (const post of res.json.posting.stores) {
      if (post.lastPostTitle) assert.match(post.lastPostTitle, /^SAMPLE/);
    }
  });
});

describe("posting health", () => {
  test("chicago clock and days behind the cadence", () => {
    assert.equal(chicagoNow(new Date(NOW)).date, "2026-11-02");
    assert.equal(chicagoNow(new Date("2026-11-02T05:30:00.000Z")).date, "2026-11-01");
    const stores = STORES.map((store) => ({ ...store }));
    const posts = [
      { storeId: "bhbmw", status: "published", at: "2026-10-25T15:00:00.000Z", date: "2026-10-25", title: "a", channels: ["IG"] },
      { storeId: "bmwj", status: "published", at: "2026-10-31T15:00:00.000Z", date: "2026-10-31", title: "b", channels: ["IG"] },
    ];
    const health = buildHealth(stores, posts, "2026-11-02");
    const bh = health.find((row) => row.storeId === "bhbmw");
    const bmwj = health.find((row) => row.storeId === "bmwj");
    const coop = health.find((row) => row.storeId === "coop");
    assert.equal(bh.daysSince, 8);
    assert.equal(bh.daysBehind, 6);
    assert.equal(bh.status, "most_behind");
    assert.equal(bmwj.daysSince, 2);
    assert.equal(bmwj.daysBehind, 0);
    assert.equal(bmwj.status, "on_pace");
    assert.equal(coop.status, "no_posts");
  });

  test("fixture feed reports the sample cadence gap", async () => {
    const { app, env } = boot();
    const res = await send(app, env, "/api/planner");
    const byId = Object.fromEntries(res.json.posting.stores.map((row) => [row.storeId, row]));
    assert.equal(byId.bhbmw.daysSince, 8);
    assert.equal(byId.bhbmw.daysBehind, 6);
    assert.equal(byId.bhbmw.status, "most_behind");
    assert.equal(byId.abr.daysBehind, 3);
    assert.equal(byId.abr.scheduled, 1);
    assert.equal(byId.hp.scheduled, 1);
    assert.equal(byId.bmwj.status, "on_pace");
    assert.equal(byId.coop.status, "on_pace");
    assert.equal(byId.coop.daysBehind, 0);
    assert.deepEqual(res.json.stores.map((store) => store.postengineId), [2, 3, 4, 1, 6]);
  });

  test("live reads are GET-only and replace the sample feed", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init && init.method, headers: init && init.headers });
      const target = String(url);
      if (target.includes("/api/v1/accounts")) {
        return new Response(JSON.stringify({ accounts: [{ _id: "acc-bmw", displayName: "Brian Harris BMW", platform: "instagram" }] }), { status: 200 });
      }
      if (target.includes("source=external")) return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      if (target.includes("status=scheduled")) return new Response(JSON.stringify({ posts: [] }), { status: 200 });
      if (target.includes("zernio.com/api/v1/posts")) {
        return new Response(JSON.stringify({
          posts: [{
            _id: "post-1",
            status: "published",
            publishedAt: "2026-11-01T15:00:00.000Z",
            content: "Live mock coupe",
            platforms: [{ platform: "instagram", accountId: "acc-bmw" }],
          }],
        }), { status: 200 });
      }
      if (target.includes("postengine.thecoopbrla.com/api/posts")) {
        return new Response(JSON.stringify({
          posts: [{
            id: "pe-1",
            dealership_id: 3,
            status: "scheduled",
            scheduled_for: "2026-11-03T15:00:00.000Z",
            caption: "Live mock service still",
            platforms: ["instagram"],
          }],
        }), { status: 200 });
      }
      throw new Error(`unexpected url ${target}`);
    };
    const { app, env } = boot({
      ZERNIO_API_KEY: "zernio-test-key",
      POSTENGINE_PIN: "postengine-test-pin",
    }, fetchImpl);
    const res = await send(app, env, "/api/planner");
    assert.equal(res.status, 200);
    assert.equal(res.json.posting.mode, "live");
    assert.equal(calls.length > 0, true);
    for (const call of calls) {
      assert.equal(call.method, "GET");
      assert.equal(readOnlyUrl(call.url), true);
      assert.equal(String(call.url).includes("/review"), false);
    }
    const zernioCall = calls.find((call) => String(call.url).includes("zernio.com"));
    assert.equal(zernioCall.headers.Authorization, "Bearer zernio-test-key");
    const peCall = calls.find((call) => String(call.url).includes("postengine"));
    assert.equal(peCall.headers["x-dashboard-pin"], "postengine-test-pin");
    assert.equal(res.text.includes("zernio-test-key"), false);
    assert.equal(res.text.includes("postengine-test-pin"), false);
    const bh = res.json.posting.stores.find((row) => row.storeId === "bhbmw");
    const abr = res.json.posting.stores.find((row) => row.storeId === "abr");
    assert.equal(bh.lastPostTitle, "Live mock coupe");
    assert.equal(bh.status, "on_pace");
    assert.equal(bh.daysSince, 1);
    assert.equal(abr.scheduled, 1);
    assert.equal(abr.lastPostTitle, "");
    assert.equal(res.json.posts.some((post) => post.title.startsWith("SAMPLE")), false);
  });

  test("upstream failure falls back to the sample feed", async () => {
    const fetchImpl = async () => new Response("nope", { status: 503 });
    const { app, env } = boot({ ZERNIO_API_KEY: "zernio-test-key", POSTENGINE_PIN: "postengine-test-pin" }, fetchImpl);
    const res = await send(app, env, "/api/planner");
    assert.equal(res.status, 200);
    assert.equal(res.json.posting.zernio, "error");
    assert.equal(res.json.posting.postengine, "error");
    assert.match(res.json.posting.stores.find((row) => row.storeId === "bhbmw").lastPostTitle, /^SAMPLE/);
    assert.match(res.json.notice, /failed/i);
  });

  test("read-only guard refuses publish paths and other hosts", async () => {
    assert.equal(readOnlyUrl("https://zernio.com/api/v1/posts"), true);
    assert.equal(readOnlyUrl("https://zernio.com/api/v1/posts?status=published"), true);
    assert.equal(readOnlyUrl("https://zernio.com/api/v1/posts/abc/review"), false);
    assert.equal(readOnlyUrl("https://evil.example/api/v1/posts"), false);
    assert.equal(readOnlyUrl("https://postengine.thecoopbrla.com/api/posts"), true);
    assert.equal(readOnlyUrl("https://postengine.thecoopbrla.com/api/posts/publish"), false);
    await assert.rejects(() => readOnlyGet("https://zernio.com/api/v1/posts/abc/review", {}, async () => {
      throw new Error("must not fetch");
    }));
  });

  test("postengine normalizer keeps dealership ids and skips drafts", () => {
    const published = normalizePostEnginePost({
      id: 9,
      dealership_id: 1,
      status: "published",
      published_at: "2026-11-01T15:00:00.000Z",
      caption: "Jackson sample",
      platforms: ["facebook", "google business"],
    });
    assert.equal(published.storeId, "bmwj");
    assert.deepEqual(published.channels, ["FB", "GBP"]);
    assert.equal(normalizePostEnginePost({ dealership_id: 2, status: "draft", caption: "hidden" }), null);
    assert.equal(normalizePostEnginePost({ dealership_id: 99, status: "published", published_at: "2026-11-01T15:00:00.000Z" }), null);
  });

  test("account name matching prefers the specific rooftop", () => {
    assert.equal(matchStoreName("BMW of Jackson"), "bmwj");
    assert.equal(matchStoreName("Brian Harris BMW"), "bhbmw");
    assert.equal(matchStoreName("Harris Porsche"), "hp");
    assert.equal(matchStoreName("Audi Baton Rouge"), "abr");
    assert.equal(matchStoreName("The Cooperative Agency"), "coop");
  });
});

describe("pipeline", () => {
  test("quarter plans, needs, and the bot job queue stay inside the desk", async () => {
    const { app, env } = boot();
    const res = await send(app, env, "/api/planner");
    assert.equal(res.json.quarter.quarter, "2026-Q4");
    assert.equal(res.json.quarter.plans.length, 5);
    assert.equal(res.json.peWrite, false);
    const photo = res.json.needs.find((need) => need.subject === "SAMPLE red coupe" && need.format === "photo");
    const reel = res.json.needs.find((need) => need.subject === "SAMPLE red coupe" && need.format === "reel");
    assert.equal(photo.covered, true);
    assert.equal(photo.coveredBy.source, "drive");
    assert.equal(reel.covered, false);
    assert.match(reel.blockedBy[0], /shoot/);
    const copy = res.json.jobs.find((job) => job.role === "copy");
    assert.equal(copy.assignee, "Frances");
    assert.match(copy.blockedBy[0], /reel/);
    const brief = res.json.calendar.find((item) => item.id === "fx-cal-coupe");
    assert.equal(brief.kind, "post");
    assert.equal(brief.goal.length > 0, true);
  });

  test("roll a quarter from the template", async () => {
    const { app, env } = boot();
    const rolled = await send(app, env, "/api/planner/quarters/roll", {
      method: "POST",
      body: { storeId: "bmwj", quarter: "2027-Q1", source: "template" },
    });
    assert.equal(rolled.status, 201);
    assert.deepEqual(rolled.json.plan.months.map((month) => month.month), ["2027-01", "2027-02", "2027-03"]);
    const again = await send(app, env, "/api/planner/quarters/roll", {
      method: "POST",
      body: { storeId: "bmwj", quarter: "2027-Q2", source: "previous" },
    });
    assert.equal(again.status, 201);
    assert.equal(again.json.plan.months[0].theme, rolled.json.plan.months[0].theme);
    assert.equal(again.json.plan.months[0].month, "2027-04");
  });

  test("bot tokens can poll and deliver only their own jobs", async () => {
    const { app, env } = boot({
      PLANNER_PIN: "correct-horse",
      PLANNER_BOT_TOKENS: JSON.stringify({ frances: "frances-bot", eleanor: "eleanor-bot" }),
    });
    const denied = await send(app, env, "/api/planner", { token: "frances-bot" });
    assert.equal(denied.status, 403);
    const queue = await send(app, env, "/api/planner/jobs?assignee=Frances", { token: "frances-bot" });
    assert.equal(queue.status, 200);
    assert.ok(queue.json.jobs.every((job) => job.assignee === "Frances"));
    const cross = await send(app, env, "/api/planner/jobs?assignee=Eleanor", { token: "frances-bot" });
    assert.equal(cross.status, 403);
    const job = queue.json.jobs[0];
    const delivered = await send(app, env, `/api/planner/jobs/${job.id}/deliver`, {
      method: "POST",
      token: "frances-bot",
      body: { assetUrls: ["https://example.com/sample-caption.txt"], captionDraft: "SAMPLE caption for the coupe." },
    });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.json.job.status, "delivered");
    assert.equal(delivered.json.job.captionDraft, "SAMPLE caption for the coupe.");
    const steal = await send(app, env, `/api/planner/jobs/${job.id}/deliver`, {
      method: "POST",
      token: "eleanor-bot",
      body: { assetUrls: ["https://example.com/nope.txt"], captionDraft: "no" },
    });
    assert.equal(steal.status, 403);
  });

  test("Lance approve does not call PostEngine while the write flag is off", async () => {
    let called = false;
    const { app, env } = boot({}, async () => {
      called = true;
      throw new Error("should not call");
    });
    const res = await send(app, env, "/api/planner/approvals/fx-approval-still", {
      method: "PATCH",
      body: {
        title: "SAMPLE — approve the red coupe still",
        storeId: "bhbmw",
        kind: "creative",
        requestedBy: "Daisy",
        status: "approved",
        notes: "Yes, queue it when the flag is on.",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.postengine.reason, "write_off");
    assert.equal(called, false);
  });

  test("with the write flag on, approve queues a draft and never publishes", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init && init.method, body: init && init.body, headers: init && init.headers });
      if (String(url).endsWith("/api/import/posts") && init.method === "POST") {
        return new Response(JSON.stringify({ id: 440, status: "queued" }), { status: 201 });
      }
      if (String(url).includes("/api/posts") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (String(url).includes("/api/v1/")) {
        return new Response(JSON.stringify({ posts: [], accounts: [] }), { status: 200 });
      }
      throw new Error(`unexpected ${init && init.method} ${url}`);
    };
    const { app, env } = boot({
      PLANNER_PE_WRITE: "1",
      POSTENGINE_IMPORT_TOKEN: "import-test-token",
      ZERNIO_API_KEY: "zernio-test-key",
      POSTENGINE_PIN: "postengine-test-pin",
    }, fetchImpl);
    const res = await send(app, env, "/api/planner/approvals/fx-approval-still", {
      method: "PATCH",
      body: {
        title: "SAMPLE — approve the red coupe still",
        storeId: "bhbmw",
        kind: "creative",
        requestedBy: "Daisy",
        status: "approved",
        notes: "Queue the draft.",
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.postengine.queued, true);
    assert.equal(res.json.postengine.id, "440");
    const write = calls.find((call) => call.method === "POST");
    assert.equal(write.url, "https://postengine.thecoopbrla.com/api/import/posts");
    assert.equal(write.headers.Authorization, "Bearer import-test-token");
    const body = JSON.parse(write.body);
    assert.equal(body.status, "queued");
    assert.equal(body.dealershipId, 2);
    assert.equal(calls.some((call) => String(call.url).includes("publish")), false);
    assert.equal(res.text.includes("import-test-token"), false);
  });
});

describe("repo guards", () => {
  test("migration matches the worker schema", () => {
    const file = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");
    assert.equal(file, SCHEMA);
  });

  test("worker source never sends a publish or a non-GET upstream call", () => {
    const posting = readFileSync(new URL("../src/posting.js", import.meta.url), "utf8");
    const writer = readFileSync(new URL("../src/postengine-write.js", import.meta.url), "utf8");
    assert.doesNotMatch(posting, /publishNow/);
    assert.doesNotMatch(posting, /method:\s*["'](?!GET)[A-Z]+["']/);
    assert.match(posting, /method:\s*"GET"/);
    assert.match(writer, /\/api\/import\/posts/);
    assert.doesNotMatch(writer, /publishNow/);
    assert.doesNotMatch(writer, /\/publish/);
    assert.doesNotMatch(writer, /bulk-approve/);
    assert.equal(writer.includes("status: \"queued\""), true);
  });

  test("committed planner files do not carry the draft's real items", () => {
    const files = [
      new URL("../src/seed.js", import.meta.url),
      new URL("../src/posting.js", import.meta.url),
      new URL("../src/shots.js", import.meta.url),
      new URL("../../../planner.html", import.meta.url),
      new URL("../../../planner.js", import.meta.url),
    ];
    const blob = files.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const word of FORBIDDEN) assert.equal(blob.includes(word), false, word);
  });
});
