import { STORES, matchStoreName, storeByPostengineId } from "./constants.js";
import { addDays, daysBetween } from "./time.js";

const ZERNIO_ACCOUNTS = "https://zernio.com/api/v1/accounts";
const ZERNIO_POSTS = "https://zernio.com/api/v1/posts";
const POSTENGINE_POSTS = "https://postengine.thecoopbrla.com/api/posts";
const MAX_BYTES = 1_000_000;

const ALLOWED = [
  /^https:\/\/zernio\.com\/api\/v1\/accounts(\?|$)/,
  /^https:\/\/zernio\.com\/api\/v1\/posts(\?|$)/,
  /^https:\/\/postengine\.thecoopbrla\.com\/api\/posts(\?|$)/,
];

const CHANNEL_SHORT = {
  instagram: "IG",
  facebook: "FB",
  meta: "Meta",
  gbp: "GBP",
  google: "GBP",
  googlebusiness: "GBP",
  google_business: "GBP",
  gmb: "GBP",
  tiktok: "TikTok",
  youtube: "YT",
  email: "Email",
  web: "Web",
};

export function shortChannel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (CHANNEL_SHORT[key]) return CHANNEL_SHORT[key];
  const compact = key.replace(/_/g, "");
  if (compact.includes("instagram")) return "IG";
  if (compact.includes("facebook")) return "FB";
  if (compact.includes("google")) return "GBP";
  return raw;
}

export function readOnlyUrl(url) {
  if (typeof url !== "string" || !ALLOWED.some((pattern) => pattern.test(url))) return false;
  if (url.includes("/review") || url.toLowerCase().includes("publishnow")) return false;
  return true;
}

export async function readOnlyGet(url, headers, fetchImpl) {
  if (!readOnlyUrl(url)) throw new Error("refusing outbound url");
  const response = await fetchImpl(url, {
    method: "GET",
    headers,
  });
  return response;
}

async function readJsonLimited(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("upstream response too large");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel();
      throw new Error("upstream response too large");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(buf);
  if (!text) return null;
  return JSON.parse(text);
}

function asList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ["posts", "accounts", "data", "items", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && Array.isArray(payload[key].posts)) return payload[key].posts;
    if (payload[key] && Array.isArray(payload[key].accounts)) return payload[key].accounts;
  }
  return [];
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && obj[key] !== "") return obj[key];
  }
  return null;
}

export function accountStoreMap(accounts, mapJson) {
  const map = new Map();
  if (typeof mapJson === "string" && mapJson.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(mapJson);
    } catch {
      throw new Error("ZERNIO_ACCOUNT_MAP is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("ZERNIO_ACCOUNT_MAP must be an object");
    }
    for (const [storeId, ids] of Object.entries(parsed)) {
      if (!Array.isArray(ids)) continue;
      for (const id of ids) map.set(String(id), storeId);
    }
    return { map, mappedBy: "explicit" };
  }
  for (const account of accounts || []) {
    const id = String(account._id || account.id || "");
    const hay = [account.displayName, account.username, account.name, account.platform].filter(Boolean).join(" ");
    const storeId = matchStoreName(hay);
    if (id && storeId) map.set(id, storeId);
  }
  return { map, mappedBy: "name" };
}

function platformPublishedAt(platforms) {
  for (const platform of platforms) {
    const at = firstValue(platform, ["publishedAt", "published_at", "postedAt", "posted_at"]);
    if (at) return at;
  }
  return null;
}

function channelList(values) {
  const out = [];
  for (const value of values) {
    const short = shortChannel(value);
    if (short && !out.includes(short)) out.push(short);
  }
  return out;
}

export function normalizeZernioPost(post, accountStore) {
  if (!post || typeof post !== "object") return [];
  const platforms = Array.isArray(post.platforms) ? post.platforms : [];
  const storeIds = new Set();
  const channels = [];
  for (const platform of platforms) {
    const accountId = firstValue(platform, ["accountId", "account_id"]);
    const storeId = accountId != null ? accountStore.get(String(accountId)) : null;
    if (storeId) storeIds.add(storeId);
    const name = firstValue(platform, ["platform", "network"]);
    if (name) channels.push(name);
  }
  if (!storeIds.size) return [];
  const status = String(post.status || "").toLowerCase();
  let kind = null;
  if (status === "published" || status === "partial") kind = "published";
  else if (status === "scheduled") kind = "scheduled";
  else return [];
  const at = kind === "scheduled"
    ? firstValue(post, ["scheduledFor", "scheduled_for"])
    : firstValue(post, ["publishedAt", "published_at"]) || platformPublishedAt(platforms) || firstValue(post, ["scheduledFor", "scheduled_for", "updatedAt", "updated_at"]);
  if (!at) return [];
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return [];
  const title = String(firstValue(post, ["title", "content", "caption"]) || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const id = String(post._id || post.id || "");
  return [...storeIds].map((storeId) => ({
    id: id ? `zernio:${id}:${storeId}` : `zernio:${storeId}:${at}`,
    storeId,
    status: kind,
    at: when.toISOString(),
    title,
    channels: channelList(channels),
    source: "zernio",
    readOnly: true,
  }));
}

const PUBLISHED_WORDS = new Set(["published", "posted", "live", "sent", "complete", "completed"]);
const SCHEDULED_WORDS = new Set(["scheduled", "queued", "queue", "approved", "pending_publish"]);
const SKIP_WORDS = new Set(["draft", "failed", "rejected", "error", "deleted", "archived"]);

export function normalizePostEnginePost(row) {
  if (!row || typeof row !== "object") return null;
  const dealer = firstValue(row, ["dealership_id", "dealershipId", "dealer_id", "dealerId", "store_id", "storeId"]);
  const store = storeByPostengineId(dealer);
  if (!store) return null;
  const statusRaw = String(firstValue(row, ["status", "state"]) || "").toLowerCase();
  const publishedAt = firstValue(row, ["published_at", "publishedAt", "posted_at", "postedAt"]);
  const scheduledAt = firstValue(row, ["scheduled_for", "scheduledFor", "scheduled_at", "scheduledAt", "publish_at", "publishAt"]);
  let kind = null;
  let at = null;
  if (SKIP_WORDS.has(statusRaw)) return null;
  if (PUBLISHED_WORDS.has(statusRaw)) {
    kind = "published";
    at = publishedAt || scheduledAt;
  } else if (SCHEDULED_WORDS.has(statusRaw)) {
    kind = "scheduled";
    at = scheduledAt || publishedAt;
  } else if (publishedAt) {
    kind = "published";
    at = publishedAt;
  } else if (scheduledAt) {
    kind = "scheduled";
    at = scheduledAt;
  }
  if (!kind || !at) return null;
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  const channelValues = [];
  const rawChannels = firstValue(row, ["platforms", "channels", "networks"]);
  if (Array.isArray(rawChannels)) {
    for (const entry of rawChannels) {
      if (typeof entry === "string") channelValues.push(entry);
      else if (entry && typeof entry === "object") {
        const name = firstValue(entry, ["platform", "network", "name", "channel"]);
        if (name) channelValues.push(name);
      }
    }
  } else if (typeof rawChannels === "string") {
    channelValues.push(...rawChannels.split(/[,/|]/));
  }
  const single = firstValue(row, ["platform", "network", "channel"]);
  if (single) channelValues.push(single);
  const title = String(firstValue(row, ["caption", "content", "text", "body", "title"]) || "").replace(/\s+/g, " ").trim().slice(0, 180);
  const id = String(firstValue(row, ["id", "_id"]) || `${store.id}:${at}`);
  return {
    id: `postengine:${id}`,
    storeId: store.id,
    status: kind,
    at: when.toISOString(),
    title,
    channels: channelList(channelValues),
    source: "postengine",
    readOnly: true,
  };
}

export function stampDates(posts, zone) {
  return posts.map((post) => {
    const when = new Date(post.at);
    const date = zone(when);
    return { ...post, date };
  });
}

export function fixturePosts(today) {
  const on = (offset) => addDays(today, offset);
  const row = (source, storeId, offset, status, title, channels) => ({
    id: `fixture:${source}:${storeId}:${status}:${offset}`,
    storeId,
    status,
    at: `${on(offset)}T15:00:00.000Z`,
    date: on(offset),
    title,
    channels,
    source,
    readOnly: true,
  });
  const published = [
    ["bhbmw", -8, "SAMPLE — red coupe on the front line", ["IG", "FB", "GBP"]],
    ["abr", -5, "SAMPLE — silver wagon at the service drive", ["IG", "FB"]],
    ["hp", -3, "SAMPLE — white coupe under the canopy", ["GBP"]],
    ["bmwj", -2, "SAMPLE — blue sedan by the showroom door", ["IG", "FB", "GBP"]],
    ["coop", -3, "SAMPLE — agency desk, not a client car", ["IG"]],
  ];
  const posts = [];
  for (const [storeId, offset, title, channels] of published) {
    posts.push(row("zernio", storeId, offset, "published", title, channels));
    posts.push(row("postengine", storeId, offset, "published", title, channels));
  }
  posts.push(row("postengine", "abr", 1, "scheduled", "SAMPLE — scheduled service still", ["IG"]));
  posts.push(row("zernio", "hp", 4, "scheduled", "SAMPLE — scheduled canopy frame", ["GBP"]));
  return posts;
}

export function dedupePosts(posts) {
  const map = new Map();
  for (const post of posts) {
    const key = [post.storeId, post.status, post.date, post.title].join("|");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...post, sources: [post.source], channels: [...(post.channels || [])] });
      continue;
    }
    if (!existing.sources.includes(post.source)) existing.sources.push(post.source);
    for (const channel of post.channels || []) {
      if (!existing.channels.includes(channel)) existing.channels.push(channel);
    }
    if (post.at > existing.at) existing.at = post.at;
  }
  return [...map.values()];
}

export function buildHealth(stores, posts, today) {
  const rows = stores.map((store) => {
    const mine = posts.filter((post) => post.storeId === store.id);
    const published = mine
      .filter((post) => post.status === "published" && post.date)
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    const last = published[0] || null;
    const daysSince = last ? Math.max(0, daysBetween(last.date, today)) : null;
    const daysBehind = daysSince == null ? null : Math.max(0, daysSince - store.cadenceDays);
    const scheduled = mine.filter((post) => post.status === "scheduled").length;
    return {
      storeId: store.id,
      name: store.name,
      shortName: store.shortName,
      cadenceDays: store.cadenceDays,
      lastPostAt: last ? last.at : null,
      lastPostDate: last ? last.date : null,
      lastPostTitle: last ? last.title : "",
      channels: last ? last.channels : [],
      daysSince,
      daysBehind,
      scheduled,
      status: "no_posts",
    };
  });
  const worst = rows.reduce((max, row) => Math.max(max, row.daysBehind || 0), 0);
  for (const row of rows) {
    if (row.daysSince == null) row.status = "no_posts";
    else if (!row.daysBehind) row.status = "on_pace";
    else if (row.daysBehind === worst) row.status = "most_behind";
    else row.status = "behind";
  }
  return rows;
}

async function upstreamJson(url, headers, fetchImpl) {
  const response = await readOnlyGet(url, headers, fetchImpl);
  if (!response.ok) {
    const error = new Error(`upstream ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return readJsonLimited(response);
}

export async function loadZernio(env, fetchImpl) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${env.ZERNIO_API_KEY}`,
  };
  let accounts = [];
  if (!(typeof env.ZERNIO_ACCOUNT_MAP === "string" && env.ZERNIO_ACCOUNT_MAP.trim())) {
    const payload = await upstreamJson(`${ZERNIO_ACCOUNTS}?limit=50&category=social`, headers, fetchImpl);
    accounts = asList(payload);
  }
  const { map } = accountStoreMap(accounts, env.ZERNIO_ACCOUNT_MAP);
  const queries = [
    `${ZERNIO_POSTS}?status=published&source=zernio&limit=50`,
    `${ZERNIO_POSTS}?status=scheduled&limit=50`,
  ];
  const posts = [];
  for (const url of queries) {
    const payload = await upstreamJson(url, headers, fetchImpl);
    for (const post of asList(payload)) posts.push(...normalizeZernioPost(post, map));
  }
  try {
    const payload = await upstreamJson(`${ZERNIO_POSTS}?status=published&source=external&limit=50`, headers, fetchImpl);
    for (const post of asList(payload)) posts.push(...normalizeZernioPost(post, map));
  } catch (err) {
    const warning = new Error("Zernio external history was not read");
    warning.posts = posts;
    warning.cause = err;
    throw warning;
  }
  return posts;
}

export async function loadPostEngine(env, fetchImpl) {
  const payload = await upstreamJson(POSTENGINE_POSTS, {
    Accept: "application/json",
    "x-dashboard-pin": env.POSTENGINE_PIN,
  }, fetchImpl);
  const posts = [];
  for (const row of asList(payload)) {
    const post = normalizePostEnginePost(row);
    if (post) posts.push(post);
  }
  return posts;
}

function withDates(posts, todayFromInstant) {
  return posts.map((post) => (post.date ? post : { ...post, date: todayFromInstant(new Date(post.at)) }));
}

export async function loadPosting({ env, fetchImpl, today, dateOf, stores }) {
  const warnings = [];
  let zernio = env.ZERNIO_API_KEY ? "live" : "fixture";
  let postengine = env.POSTENGINE_PIN ? "live" : "fixture";
  const posts = [];

  if (env.ZERNIO_API_KEY) {
    try {
      const live = await loadZernio(env, fetchImpl);
      posts.push(...withDates(live, dateOf));
    } catch (err) {
      if (err && Array.isArray(err.posts)) {
        posts.push(...withDates(err.posts, dateOf));
        warnings.push("Zernio external history was not read. Published and scheduled posts from Zernio still count.");
        console.log(JSON.stringify({ level: "warn", source: "zernio", message: String(err.cause && err.cause.message || err.message) }));
      } else {
        zernio = "error";
        warnings.push("Zernio read failed. Showing the sample feed for that source.");
        console.log(JSON.stringify({ level: "warn", source: "zernio", message: String(err && err.message || err) }));
      }
    }
  }

  if (env.POSTENGINE_PIN) {
    try {
      const live = await loadPostEngine(env, fetchImpl);
      posts.push(...withDates(live, dateOf));
    } catch (err) {
      postengine = "error";
      warnings.push("PostEngine read failed. Showing the sample feed for that source.");
      console.log(JSON.stringify({ level: "warn", source: "postengine", message: String(err && err.message || err) }));
    }
  }

  const samples = fixturePosts(today);
  if (zernio !== "live") posts.push(...samples.filter((post) => post.source === "zernio"));
  if (postengine !== "live") posts.push(...samples.filter((post) => post.source === "postengine"));

  let mode = "partial";
  if (zernio === "fixture" && postengine === "fixture") mode = "fixture";
  else if (zernio === "live" && postengine === "live") mode = "live";
  else if (zernio === "error" && postengine === "error") mode = "error";

  const merged = dedupePosts(posts);
  return {
    mode,
    zernio,
    postengine,
    warnings,
    posts: merged,
    stores: buildHealth(stores, merged, today),
  };
}
