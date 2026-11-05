import { storeById, storeByPostengineId } from "./constants.js";
import { listUpcomingCalendar } from "./data.js";
import { loadPostEngineRows } from "./posting.js";
import { daysBetween, zonedParts } from "./time.js";

/** Distinct photos at or under this count are flagged few. Zero posts are none, not few. */
export const FEW_PHOTO_MAX = 4;
/** No publish in more than this many days is stale. */
export const STALE_DAYS = 60;
/** One photo above this share of a model's posts is overused. */
export const OVERUSED_SHARE = 0.4;
/** One photo used this many times is overused even below the share. */
export const OVERUSED_REPEATS = 3;
/** A single post is 100% of itself, so the share rule starts at this many posts. */
export const OVERUSED_MIN_POSTS = 3;

export const SHOT_STORE_IDS = ["abr", "hp", "bhbmw", "bmwj"];

const STORE_BRAND = {
  abr: "Audi",
  hp: "Porsche",
  bhbmw: "BMW",
  bmwj: "BMW",
};

export const SHOT_CHECKLIST = [
  { id: "front-34", label: "Exterior 3/4 front" },
  { id: "profile", label: "Profile" },
  { id: "rear-34", label: "Rear 3/4" },
  { id: "interior", label: "Interior" },
  { id: "cargo", label: "Cargo / detail" },
  { id: "vertical", label: "Vertical 9:16" },
];

const PUBLISHED = new Set(["published", "posted", "live", "sent", "complete", "completed"]);
const SCHEDULED = new Set(["scheduled", "queued", "queue", "approved", "pending_publish"]);
const SKIP = new Set(["draft", "failed", "rejected", "error", "deleted", "archived"]);

const FLAG_RANK = { none: 0, few: 1, overused: 2, stale: 3 };

const MODEL_PATTERNS = [
  { brand: "Audi", source: "\\bRS\\s*Q\\d\\b", flags: "gi", label: (raw) => `RS ${raw.toUpperCase().replace(/\s+/g, "").slice(2)}` },
  { brand: "Audi", source: "\\bRS\\s*\\d\\b", flags: "gi", label: (raw) => `RS ${raw.toUpperCase().replace(/\s+/g, "").slice(2)}` },
  { brand: "Audi", source: "\\bSQ\\d\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "Audi", source: "\\bS\\d\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "Audi", source: "\\bQ\\d\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "Audi", source: "\\bA\\d\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "Audi", source: "\\be-?tron\\b", flags: "gi", label: () => "e-tron" },
  { brand: "Audi", source: "\\bTT\\b", flags: "gi", label: () => "TT" },
  { brand: "Audi", source: "\\bR8\\b", flags: "gi", label: () => "R8" },
  { brand: "Porsche", source: "\\b(?:911|718|Cayenne|Macan|Panamera|Taycan|Boxster|Cayman)\\b", flags: "gi", label: porscheLabel },
  { brand: "BMW", source: "\\bX[1-7]\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "BMW", source: "\\bXM\\b", flags: "gi", label: () => "XM" },
  { brand: "BMW", source: "\\biX\\d?\\b", flags: "gi", label: (raw) => `i${raw.slice(1).toUpperCase()}` },
  { brand: "BMW", source: "\\bi[4-8]\\b", flags: "gi", label: (raw) => `i${raw.slice(1)}` },
  { brand: "BMW", source: "\\bZ4\\b", flags: "gi", label: () => "Z4" },
  { brand: "BMW", source: "\\bM[2-8]\\b", flags: "gi", label: (raw) => raw.toUpperCase() },
  { brand: "BMW", source: "\\b([2-8])\\s*Series\\b", flags: "gi", label: (raw) => `${raw.match(/[2-8]/)[0]} Series` },
  { brand: "BMW", source: "\\bM?([2-8])\\d{2}[a-z]?\\b", flags: "gi", label: (raw) => `${raw.match(/[2-8]/)[0]} Series` },
];

function porscheLabel(raw) {
  const lower = raw.toLowerCase();
  if (lower === "911" || lower === "718") return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== "") return obj[key];
  }
  return null;
}

export function findModels(text) {
  const source = String(text || "");
  const claimed = [];
  const found = [];
  const seen = new Set();
  for (const pattern of MODEL_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(source))) {
      const start = match.index;
      const end = start + match[0].length;
      if (claimed.some(([from, to]) => start < to && end > from)) continue;
      claimed.push([start, end]);
      const model = pattern.label(match[0]);
      const key = `${pattern.brand} ${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ brand: pattern.brand, model, key, start });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found.map(({ brand, model, key }) => ({ brand, model, key }));
}

export function yearsIn(text) {
  const years = new Set();
  const re = /\b(?:19|20)\d{2}\b/g;
  const source = String(text || "");
  let match;
  while ((match = re.exec(source))) years.add(match[0]);
  return [...years].sort();
}

/**
 * Brand + model, year kept separately. Lifestyle copy and anything we cannot
 * name lands on Other — it is not given a made-up model.
 */
export function normalizeVehicle(text) {
  const models = findModels(text);
  const years = yearsIn(text);
  if (!models.length) return { models: [{ key: "Other", brand: "", model: "Other" }], years, other: true };
  return { models, years, other: false };
}

function fileBase(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let path = raw.split("#")[0].split("?")[0];
  try {
    if (/^https?:\/\//i.test(path)) path = decodeURIComponent(new URL(path).pathname);
  } catch {
    /* keep the raw path */
  }
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

export function mediaBasenames(value) {
  let list = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        list = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else {
      list = [trimmed];
    }
  }
  if (!Array.isArray(list)) return [];
  const names = [];
  const seen = new Set();
  for (const item of list) {
    const raw = typeof item === "string"
      ? item
      : (item && typeof item === "object" ? (item.url || item.src || item.href || "") : "");
    const base = fileBase(raw);
    if (!base) continue;
    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(key);
  }
  return names;
}

/**
 * PostEngine folderSource is `{categoryFolderId}/{fileId}`. The first segment
 * is a Drive category such as New Cars, shared by the whole store, not a shoot.
 * The photo is the last segment.
 */
export function driveFileId(folderSource) {
  return fileBase(folderSource).toLowerCase();
}

function modelForStore(storeId, model) {
  const expected = STORE_BRAND[storeId];
  if (expected && model.brand && model.brand !== expected) {
    return { key: "Other", brand: "", model: "Other" };
  }
  return model;
}

export function classifyShotPost(row) {
  if (!row || typeof row !== "object") return null;
  const status = String(firstValue(row, ["status", "state"]) || "").toLowerCase();
  const publishedAt = firstValue(row, ["publishedAt", "published_at", "postedAt", "posted_at"]);
  const scheduledAt = firstValue(row, ["scheduledFor", "scheduled_for", "scheduledAt", "scheduled_at"]);
  if (SKIP.has(status)) return null;
  if (PUBLISHED.has(status)) return { kind: "published", at: publishedAt || scheduledAt || null };
  if (SCHEDULED.has(status)) return { kind: "scheduled", at: scheduledAt || publishedAt || null };
  if (publishedAt) return { kind: "published", at: publishedAt };
  if (scheduledAt) return { kind: "scheduled", at: scheduledAt };
  return null;
}

function chicagoDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  return zonedParts(when).date;
}

function shareHit(count, total) {
  return total >= OVERUSED_MIN_POSTS && count / total > OVERUSED_SHARE;
}

export function overusedPosts(posts) {
  const total = posts.length;
  const photos = new Map();
  const files = new Map();
  for (const post of posts) {
    for (const name of new Set(post.basenames || [])) photos.set(name, (photos.get(name) || 0) + 1);
    if (post.fileId) files.set(post.fileId, (files.get(post.fileId) || 0) + 1);
  }
  for (const counts of [photos, files]) {
    for (const count of counts.values()) {
      if (count >= OVERUSED_REPEATS || shareHit(count, total)) return true;
    }
  }
  return false;
}

export function flagsFor({ postCount, photoCount, lastUsed, overused, today }) {
  if (!postCount) return ["none"];
  const flags = [];
  if (photoCount <= FEW_PHOTO_MAX) flags.push("few");
  if (overused) flags.push("overused");
  const stale = !lastUsed || daysBetween(lastUsed, today) > STALE_DAYS;
  if (stale) flags.push("stale");
  return flags;
}

function rowRank(flags) {
  if (!flags.length) return 4;
  return Math.min(...flags.map((flag) => FLAG_RANK[flag] ?? 4));
}

function compareRows(a, b) {
  const rank = rowRank(a.flags) - rowRank(b.flags);
  if (rank) return rank;
  return a.key.localeCompare(b.key);
}

function blankRow(model) {
  return {
    key: model.key,
    brand: model.brand,
    model: model.model,
    years: new Set(),
    basenames: new Set(),
    posts: [],
    neededFor: [],
  };
}

function finalize(row, today) {
  const postCount = row.posts.length;
  const published = row.posts.map((post) => post.publishedOn).filter(Boolean).sort();
  const lastUsed = published.length ? published[published.length - 1] : null;
  const overused = postCount > 0 && overusedPosts(row.posts);
  return {
    key: row.key,
    brand: row.brand,
    model: row.model,
    years: [...row.years].sort(),
    photoCount: row.basenames.size,
    postCount,
    lastUsed,
    flags: flagsFor({
      postCount,
      photoCount: row.basenames.size,
      lastUsed,
      overused,
      today,
    }),
    neededFor: row.neededFor,
  };
}

export function buildShotLists({ posts, calendar, today }) {
  const buckets = new Map();
  function take(storeId, model) {
    let store = buckets.get(storeId);
    if (!store) {
      store = new Map();
      buckets.set(storeId, store);
    }
    let row = store.get(model.key);
    if (!row) {
      row = blankRow(model);
      store.set(model.key, row);
    }
    return row;
  }

  for (const raw of posts || []) {
    const classified = classifyShotPost(raw);
    if (!classified) continue;
    const dealer = firstValue(raw, ["dealershipId", "dealership_id", "dealerId", "dealer_id", "storeId", "store_id"]);
    const store = storeByPostengineId(dealer);
    if (!store || !SHOT_STORE_IDS.includes(store.id)) continue;
    const info = String(firstValue(raw, ["vehicleInfo", "vehicle_info"]) || "");
    const normalized = normalizeVehicle(info);
    const names = mediaBasenames(firstValue(raw, ["mediaUrls", "media_urls"]));
    const fileId = driveFileId(firstValue(raw, ["folderSource", "folder_source"]));
    const publishedOn = classified.kind === "published" ? chicagoDate(classified.at) : null;
    const seen = new Set();
    for (const model of normalized.models) {
      const placed = modelForStore(store.id, model);
      if (seen.has(placed.key)) continue;
      seen.add(placed.key);
      const row = take(store.id, placed);
      if (!normalized.other && placed.brand) {
        for (const year of normalized.years) row.years.add(year);
      }
      for (const name of names) row.basenames.add(name);
      row.posts.push({ basenames: names, fileId, publishedOn });
    }
  }

  for (const item of calendar || []) {
    if (!item || !SHOT_STORE_IDS.includes(item.storeId)) continue;
    if (!item.startsOn || item.startsOn < today) continue;
    if (item.status === "dropped" || item.status === "done") continue;
    const hay = [item.title, item.subject, item.notes, item.goal, item.creativeRequest].filter(Boolean).join("\n");
    const models = findModels(hay);
    for (const model of models) {
      const placed = modelForStore(item.storeId, model);
      if (!placed.brand) continue;
      const row = take(item.storeId, placed);
      if (!row.posts.length) {
        for (const year of yearsIn(hay)) row.years.add(year);
      }
      if (row.neededFor.some((need) => need.id === item.id) || row.neededFor.length >= 8) continue;
      row.neededFor.push({ id: item.id, title: item.title, startsOn: item.startsOn });
    }
  }

  return SHOT_STORE_IDS.map((id) => {
    const store = storeById(id);
    const models = [...(buckets.get(id)?.values() || [])].map((row) => finalize(row, today)).sort(compareRows);
    return { id, name: store.name, shortName: store.shortName, models };
  });
}

export function fixtureShotPosts() {
  const row = (id, dealershipId, vehicleInfo, mediaUrls, folderSource, publishedAt) => ({
    id,
    dealershipId,
    status: "published",
    vehicleInfo,
    mediaUrls,
    folderSource,
    publishedAt,
  });
  return [
    row("fx-shot-q7", 3, "SAMPLE 2026 Audi Q7", [
      "https://example.com/sample/q7-front.jpg",
      "https://example.com/sample/q7-side.jpg",
    ], "sample/lot/q7-front.jpg", "2026-10-20T18:00:00.000Z"),
    row("fx-shot-q3-a", 3, "SAMPLE Audi Q3", ["https://example.com/sample/q3-1.jpg"], "sample/picnic-lawn/q3-1.jpg", "2026-10-18T18:00:00.000Z"),
    row("fx-shot-q3-b", 3, "SAMPLE Audi Q3", ["https://example.com/sample/q3-2.jpg"], "sample/picnic-lawn/q3-2.jpg", "2026-10-12T18:00:00.000Z"),
    row("fx-shot-q3-c", 3, "SAMPLE Audi Q3", ["https://example.com/sample/q3-3.jpg"], "sample/picnic-lawn/q3-3.jpg", "2026-10-02T18:00:00.000Z"),
    row("fx-shot-q3-d", 3, "SAMPLE Audi Q3", ["https://example.com/sample/q3-4.jpg"], "sample/picnic-lawn/q3-4.jpg", "2026-09-28T18:00:00.000Z"),
    row("fx-shot-q3-e", 3, "SAMPLE Audi Q3", ["https://example.com/sample/q3-5.jpg"], "sample/picnic-lawn/q3-5.jpg", "2026-09-20T18:00:00.000Z"),
    row("fx-shot-life", 3, "SAMPLE lifestyle afternoon", ["https://example.com/sample/picnic.jpg"], "sample/picnic-lawn/picnic.jpg", "2026-09-01T18:00:00.000Z"),
    row("fx-shot-911", 4, "SAMPLE Porsche 911", [
      "https://example.com/sample/911-a.jpg",
      "https://example.com/sample/911-b.jpg",
      "https://example.com/sample/911-c.jpg",
      "https://example.com/sample/911-d.jpg",
      "https://example.com/sample/911-e.jpg",
      "https://example.com/sample/911-f.jpg",
    ], "sample/canopy/911-a.jpg", "2026-08-01T18:00:00.000Z"),
    row("fx-shot-x5", 2, "SAMPLE 2026 BMW X5 M60", [
      "https://example.com/sample/x5-a.jpg",
      "https://example.com/sample/x5-b.jpg",
      "https://example.com/sample/x5-c.jpg",
      "https://example.com/sample/x5-d.jpg",
      "https://example.com/sample/x5-e.jpg",
      "https://example.com/sample/x5-f.jpg",
    ], "sample/front-line/x5-a.jpg", "2026-10-28T18:00:00.000Z"),
    row("fx-shot-x3", 1, "SAMPLE BMW X3", [
      "https://example.com/sample/x3-a.jpg",
      "https://example.com/sample/x3-b.jpg",
    ], "sample/showroom/x3-a.jpg", "2026-10-30T18:00:00.000Z"),
  ];
}

export async function loadShotLists({ env, fetchImpl, db, today }) {
  const calendar = await listUpcomingCalendar(db, today);
  let mode = "fixture";
  let warning = "";
  let posts;
  if (env.POSTENGINE_PIN) {
    try {
      posts = await loadPostEngineRows(env, fetchImpl);
      mode = "live";
    } catch (err) {
      mode = "error";
      warning = "PostEngine read failed. Showing a sample shot list.";
      console.log(JSON.stringify({ level: "warn", source: "postengine", message: String(err && err.message || err) }));
      posts = fixtureShotPosts();
    }
  } else {
    posts = fixtureShotPosts();
  }
  return {
    mode,
    warning,
    today,
    thresholds: {
      fewPhotos: FEW_PHOTO_MAX,
      staleDays: STALE_DAYS,
      overusedShare: OVERUSED_SHARE,
      overusedRepeats: OVERUSED_REPEATS,
    },
    checklist: SHOT_CHECKLIST,
    stores: buildShotLists({ posts, calendar, today }),
  };
}
