import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createMemoryD1 } from "../d1-shim.js";
import { createApp } from "../src/index.js";
import {
  FEW_PHOTO_MAX,
  STALE_DAYS,
  buildShotLists,
  findModels,
  fixtureShotPosts,
  flagsFor,
  mediaBasenames,
  normalizeVehicle,
  overusedPosts,
  shootFolder,
} from "../src/shots.js";
import { addDays } from "../src/time.js";

const NOW = "2026-11-02T15:00:00.000Z";
const TODAY = "2026-11-02";

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
  if (opts.body) headers.set("Content-Type", "application/json");
  const response = await app.fetch(new Request(`https://hub.thecoopbrla.com${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }), env);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, json, text };
}

function modelRow(stores, storeId, key) {
  const store = stores.find((item) => item.id === storeId);
  return store.models.find((item) => item.key === key) || null;
}

describe("model normalization", () => {
  test("brand and model, with the year kept off the key", () => {
    const x5 = normalizeVehicle("2026 BMW X5 M60");
    assert.deepEqual(x5.models, [{ brand: "BMW", model: "X5", key: "BMW X5" }]);
    assert.deepEqual(x5.years, ["2026"]);
    assert.equal(x5.other, false);

    const again = normalizeVehicle("2025 BMW X5 xDrive40i");
    assert.equal(again.models[0].key, "BMW X5");
    assert.deepEqual(again.years, ["2025"]);

    assert.equal(normalizeVehicle("Porsche 911 Carrera").models[0].key, "Porsche 911");
    assert.equal(normalizeVehicle("2024 porsche cayenne").models[0].key, "Porsche Cayenne");
    assert.equal(normalizeVehicle("Audi Q7").models[0].key, "Audi Q7");
  });

  test("performance names stay distinct and trims collapse", () => {
    assert.deepEqual(findModels("2026 Audi SQ7"), [{ brand: "Audi", model: "SQ7", key: "Audi SQ7" }]);
    assert.deepEqual(findModels("Audi RS Q8"), [{ brand: "Audi", model: "RS Q8", key: "Audi RS Q8" }]);
    assert.deepEqual(findModels("rsq8"), [{ brand: "Audi", model: "RS Q8", key: "Audi RS Q8" }]);
    assert.deepEqual(findModels("BMW M3"), [{ brand: "BMW", model: "M3", key: "BMW M3" }]);
    assert.deepEqual(findModels("2026 BMW M340i"), [{ brand: "BMW", model: "3 Series", key: "BMW 3 Series" }]);
    assert.deepEqual(findModels("Q7 and S5"), [
      { brand: "Audi", model: "Q7", key: "Audi Q7" },
      { brand: "Audi", model: "S5", key: "Audi S5" },
    ]);
  });

  test("lifestyle and unknown copy bucket as Other", () => {
    const life = normalizeVehicle("weekend lifestyle at the park");
    assert.equal(life.other, true);
    assert.equal(life.models[0].key, "Other");
    assert.equal(normalizeVehicle("").models[0].key, "Other");
    assert.equal(normalizeVehicle("SAMPLE silver wagon").models[0].key, "Other");
  });

  test("photo names ignore the query string and a bare id is not a folder", () => {
    assert.deepEqual(
      mediaBasenames(JSON.stringify([
        "https://cdn.example.com/sample/white-coupe.jpg?size=large",
        "https://cdn.example.com/sample/white-coupe.jpg?size=small",
        "https://cdn.example.com/sample/blue-sedan.jpg",
      ])),
      ["white-coupe.jpg", "blue-sedan.jpg"],
    );
    assert.equal(shootFolder("sample/picnic-lawn/q3-1.jpg"), "picnic-lawn");
    assert.equal(shootFolder("https://files.example.com/sample/picnic-lawn/q3-1.jpg"), "picnic-lawn");
    assert.equal(shootFolder("file-abc"), "");
  });
});

describe("shot flags", () => {
  test("few, stale, and overused thresholds", () => {
    assert.equal(FEW_PHOTO_MAX, 4);
    assert.equal(STALE_DAYS, 60);
    const today = "2026-11-04";
    assert.deepEqual(flagsFor({ postCount: 0, photoCount: 0, lastUsed: null, overused: false, today }), ["none"]);
    assert.deepEqual(flagsFor({ postCount: 2, photoCount: 4, lastUsed: today, overused: false, today }), ["few"]);
    assert.deepEqual(flagsFor({ postCount: 2, photoCount: 5, lastUsed: today, overused: false, today }), []);
    assert.deepEqual(flagsFor({
      postCount: 3,
      photoCount: 8,
      lastUsed: addDays(today, -60),
      overused: false,
      today,
    }), []);
    assert.deepEqual(flagsFor({
      postCount: 3,
      photoCount: 8,
      lastUsed: addDays(today, -61),
      overused: false,
      today,
    }), ["stale"]);
    assert.deepEqual(flagsFor({ postCount: 4, photoCount: 6, lastUsed: null, overused: true, today }), ["overused", "stale"]);
  });

  test("one photo or one shoot folder, not a single post", () => {
    assert.equal(overusedPosts([{ basenames: ["a.jpg"], folder: "only", sourceId: "only/a.jpg" }]), false);
    const even = Array.from({ length: 5 }, (_, index) => ({
      basenames: [`p${index}.jpg`],
      folder: index < 2 ? "same" : `other-${index}`,
      sourceId: `same/p${index}.jpg`,
    }));
    assert.equal(overusedPosts(even), false);
    const heavy = even.map((post, index) => (index < 3 ? { ...post, folder: "same" } : post));
    assert.equal(overusedPosts(heavy), true);
    const repeats = [
      { basenames: ["hero.jpg", "a.jpg"], folder: "a", sourceId: "a/1" },
      { basenames: ["hero.jpg", "b.jpg"], folder: "b", sourceId: "b/2" },
      { basenames: ["hero.jpg", "c.jpg"], folder: "c", sourceId: "c/3" },
      { basenames: ["d.jpg"], folder: "d", sourceId: "d/4" },
      { basenames: ["e.jpg"], folder: "e", sourceId: "e/5" },
    ];
    assert.equal(overusedPosts(repeats), true);
  });

  test("groups posts by model and keeps a calendar-only model", () => {
    const posts = [
      {
        dealershipId: 3,
        status: "published",
        vehicleInfo: "SAMPLE 2026 Audi Q7",
        mediaUrls: ["https://example.com/sample/q7-a.jpg", "https://example.com/sample/q7-b.jpg"],
        folderSource: "sample/lot/q7-a.jpg",
        publishedAt: "2026-10-20T18:00:00.000Z",
      },
      {
        dealershipId: 3,
        status: "draft",
        vehicleInfo: "SAMPLE 2026 Audi A4",
        mediaUrls: ["https://example.com/sample/hidden.jpg"],
        publishedAt: "2026-10-20T18:00:00.000Z",
      },
      {
        dealershipId: 3,
        status: "rejected",
        vehicleInfo: "SAMPLE 2026 Audi A4",
        mediaUrls: ["https://example.com/sample/nope.jpg"],
        publishedAt: "2026-10-01T18:00:00.000Z",
      },
      {
        dealershipId: 3,
        status: "queued",
        vehicleInfo: "SAMPLE 2026 Audi Q5",
        mediaUrls: ["https://example.com/sample/q5-a.jpg"],
        folderSource: "sample/lot/q5-a.jpg",
        scheduledFor: "2026-11-06T18:00:00.000Z",
      },
      {
        id: "old",
        dealershipId: 4,
        status: "published",
        vehicleInfo: "SAMPLE Porsche 911",
        mediaUrls: ["https://example.com/sample/911-a.jpg?v=1", "https://example.com/sample/911-a.jpg?v=2"],
        folderSource: "file-911",
        publishedAt: "2026-08-01T18:00:00.000Z",
      },
    ];
    for (let i = 0; i < 5; i += 1) {
      posts.push({
        dealershipId: 4,
        status: "published",
        vehicleInfo: "SAMPLE Porsche 911",
        mediaUrls: [`https://example.com/sample/911-extra-${i}.jpg`],
        folderSource: `sample/bay-${i}/911-extra-${i}.jpg`,
        publishedAt: "2026-08-01T18:00:00.000Z",
      });
    }
    posts.push({
      dealershipId: 6,
      status: "published",
      vehicleInfo: "SAMPLE 2026 Audi Q7",
      mediaUrls: ["https://example.com/sample/coop.jpg"],
      publishedAt: "2026-10-20T18:00:00.000Z",
    });
    const calendar = [
      { id: "cal-q9", storeId: "abr", title: "SAMPLE — Audi Q9 hero", subject: "SAMPLE 2027 Audi Q9", startsOn: "2026-11-12", status: "planned" },
      { id: "cal-old", storeId: "abr", title: "SAMPLE — Audi Q6 recap", startsOn: "2026-10-01", status: "planned" },
      { id: "cal-drop", storeId: "abr", title: "SAMPLE — Audi A5 still", startsOn: "2026-11-20", status: "dropped" },
      { id: "cal-q7", storeId: "abr", title: "SAMPLE — Q7 offer", subject: "Audi Q7", startsOn: "2026-11-08", status: "planned" },
    ];
    const stores = buildShotLists({ posts, calendar, today: TODAY });
    assert.deepEqual(stores.map((store) => store.id), ["abr", "hp", "bhbmw", "bmwj"]);
    const q7 = modelRow(stores, "abr", "Audi Q7");
    assert.equal(q7.photoCount, 2);
    assert.equal(q7.postCount, 1);
    assert.deepEqual(q7.years, ["2026"]);
    assert.deepEqual(q7.flags, ["few"]);
    assert.equal(q7.neededFor.length, 1);
    assert.equal(q7.neededFor[0].id, "cal-q7");
    const q9 = modelRow(stores, "abr", "Audi Q9");
    assert.deepEqual(q9.flags, ["none"]);
    assert.equal(q9.postCount, 0);
    assert.equal(q9.photoCount, 0);
    assert.deepEqual(q9.years, ["2027"]);
    assert.equal(q9.neededFor[0].title, "SAMPLE — Audi Q9 hero");
    assert.equal(modelRow(stores, "abr", "Audi A4"), null);
    assert.equal(modelRow(stores, "abr", "Audi Q6"), null);
    assert.equal(modelRow(stores, "abr", "Audi A5"), null);
    const q5 = modelRow(stores, "abr", "Audi Q5");
    assert.equal(q5.postCount, 1);
    assert.equal(q5.lastUsed, null);
    assert.deepEqual(q5.flags, ["few", "stale"]);
    const porsche = modelRow(stores, "hp", "Porsche 911");
    assert.equal(porsche.photoCount, 6);
    assert.ok(porsche.flags.includes("stale"));
    assert.equal(porsche.flags.includes("few"), false);
    assert.equal(modelRow(stores, "abr", "Audi Q7").postCount, 1);
  });

  test("the sample feed is fictional and flags the obvious gaps", () => {
    const stores = buildShotLists({ posts: fixtureShotPosts(), calendar: [], today: TODAY });
    const blob = JSON.stringify(stores);
    assert.equal(blob.includes("example.com/sample/"), false);
    assert.deepEqual(modelRow(stores, "abr", "Audi Q7").flags, ["few"]);
    assert.deepEqual(modelRow(stores, "abr", "Audi Q3").flags, ["overused"]);
    assert.ok(modelRow(stores, "abr", "Other").flags.includes("stale"));
    assert.deepEqual(modelRow(stores, "hp", "Porsche 911").flags, ["stale"]);
    assert.deepEqual(modelRow(stores, "bhbmw", "BMW X5").flags, []);
    assert.deepEqual(modelRow(stores, "bhbmw", "BMW X5").years, ["2026"]);
    assert.deepEqual(modelRow(stores, "bmwj", "BMW X3").flags, ["few"]);
  });
});

describe("shot list endpoint", () => {
  test("open mode does not call PostEngine and serves the sample", async () => {
    let called = false;
    const { app, env } = boot({}, async () => {
      called = true;
      throw new Error("should not call");
    });
    const res = await send(app, env, "/api/planner/shots");
    assert.equal(res.status, 200);
    assert.equal(called, false);
    assert.equal(res.json.mode, "fixture");
    assert.equal(res.json.checklist.length, 6);
    assert.equal(res.json.stores.length, 4);
    assert.deepEqual(modelRow(res.json.stores, "abr", "Audi Q7").flags, ["few"]);
  });

  test("a mocked PostEngine read builds the store list", async () => {
    const calls = [];
    const posts = [
      {
        id: "s-q7",
        dealershipId: 3,
        status: "published",
        vehicleInfo: "SAMPLE 2026 Audi Q7",
        mediaUrls: JSON.stringify([
          "https://cdn.example.com/sample/q7-a.jpg?w=1",
          "https://cdn.example.com/sample/q7-a.jpg?w=2",
          "https://cdn.example.com/sample/q7-b.jpg",
          "https://cdn.example.com/sample/q7-c.jpg",
        ]),
        folderSource: "sample/lot-a/q7-a.jpg",
        publishedAt: "2026-10-22T18:00:00.000Z",
      },
      {
        id: "s-q3",
        dealershipId: 3,
        status: "published",
        vehicleInfo: "SAMPLE Audi Q3",
        mediaUrls: ["https://cdn.example.com/sample/q3-1.jpg"],
        folderSource: "sample/picnic-lawn/q3-1.jpg",
        publishedAt: "2026-10-18T18:00:00.000Z",
      },
    ];
    for (let i = 2; i <= 5; i += 1) {
      posts.push({
        id: `s-q3-${i}`,
        dealershipId: 3,
        status: "published",
        vehicleInfo: "SAMPLE Audi Q3",
        mediaUrls: [`https://cdn.example.com/sample/q3-${i}.jpg`],
        folderSource: `sample/picnic-lawn/q3-${i}.jpg`,
        publishedAt: "2026-10-10T18:00:00.000Z",
      });
    }
    posts.push(
      {
        id: "s-life",
        dealershipId: 3,
        status: "published",
        vehicleInfo: "SAMPLE lifestyle picnic",
        mediaUrls: ["https://cdn.example.com/sample/picnic.jpg"],
        folderSource: "sample/picnic-lawn/picnic.jpg",
        publishedAt: "2026-10-11T18:00:00.000Z",
      },
      {
        id: "s-draft",
        dealershipId: 3,
        status: "draft",
        vehicleInfo: "SAMPLE 2026 Audi A4",
        mediaUrls: ["https://cdn.example.com/sample/hidden.jpg"],
      },
      {
        id: "s-x5a",
        dealershipId: 2,
        status: "published",
        vehicleInfo: "SAMPLE 2026 BMW X5 M60",
        mediaUrls: ["https://cdn.example.com/sample/x5-a.jpg", "https://cdn.example.com/sample/x5-b.jpg", "https://cdn.example.com/sample/x5-c.jpg"],
        folderSource: "sample/line/x5-a.jpg",
        publishedAt: "2026-10-28T18:00:00.000Z",
      },
      {
        id: "s-x5b",
        dealershipId: 2,
        status: "published",
        vehicleInfo: "SAMPLE 2025 BMW X5",
        mediaUrls: ["https://cdn.example.com/sample/x5-d.jpg", "https://cdn.example.com/sample/x5-e.jpg", "https://cdn.example.com/sample/x5-f.jpg"],
        folderSource: "sample/line-b/x5-d.jpg",
        publishedAt: "2026-10-27T18:00:00.000Z",
      },
    );
    const fetchImpl = async (url, init) => {
      calls.push({ url: String(url), method: init && init.method, headers: init && init.headers });
      if (String(url).includes("postengine.thecoopbrla.com/api/posts")) {
        return new Response(JSON.stringify({ posts }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    };
    const { app, env } = boot({
      PLANNER_PIN: "correct-horse",
      POSTENGINE_PIN: "postengine-test-pin",
    }, fetchImpl);
    const locked = await send(app, env, "/api/planner/shots");
    assert.equal(locked.status, 401);
    assert.equal(calls.length, 0);

    const created = await send(app, env, "/api/planner/calendar", {
      method: "POST",
      pin: "correct-horse",
      body: {
        storeId: "abr",
        title: "SAMPLE — Audi Q9 hero",
        startsOn: "2026-11-12",
        kind: "post",
        subject: "SAMPLE 2027 Audi Q9",
        channel: "instagram",
      },
    });
    assert.equal(created.status, 201);

    const res = await send(app, env, "/api/planner/shots", { pin: "correct-horse" });
    assert.equal(res.status, 200);
    assert.equal(res.json.mode, "live");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[0].headers["x-dashboard-pin"], "postengine-test-pin");
    assert.equal(res.text.includes("postengine-test-pin"), false);
    assert.equal(res.text.includes("correct-horse"), false);
    assert.equal(res.text.includes("q7-a.jpg"), false);
    const q7 = modelRow(res.json.stores, "abr", "Audi Q7");
    assert.equal(q7.photoCount, 3);
    assert.deepEqual(q7.flags, ["few"]);
    const q3 = modelRow(res.json.stores, "abr", "Audi Q3");
    assert.equal(q3.photoCount, 5);
    assert.equal(q3.postCount, 5);
    assert.deepEqual(q3.flags, ["overused"]);
    const q9 = modelRow(res.json.stores, "abr", "Audi Q9");
    assert.deepEqual(q9.flags, ["none"]);
    assert.equal(q9.postCount, 0);
    assert.equal(q9.neededFor[0].title, "SAMPLE — Audi Q9 hero");
    assert.equal(modelRow(res.json.stores, "abr", "Audi A4"), null);
    assert.equal(modelRow(res.json.stores, "abr", "Other").key, "Other");
    const x5 = modelRow(res.json.stores, "bhbmw", "BMW X5");
    assert.deepEqual(x5.years, ["2025", "2026"]);
    assert.equal(x5.photoCount, 6);
    assert.deepEqual(x5.flags, []);
    assert.deepEqual(res.json.thresholds, { fewPhotos: 4, staleDays: 60, overusedShare: 0.4, overusedRepeats: 3 });
  });
});
