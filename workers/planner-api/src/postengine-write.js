// Draft import only. See docs/POSTENGINE_CONTRACT.md.
// PostEngine's create route has no import token, and a separate route publishes.
// This adapter calls only the import path below.

const IMPORT_PATH = "/api/import/posts";

export function peWriteEnabled(env) {
  return String(env && env.PLANNER_PE_WRITE || "0") === "1";
}

export function importUrl(base) {
  const url = new URL(IMPORT_PATH, base || "https://postengine.thecoopbrla.com");
  if (url.protocol !== "https:" || url.host !== "postengine.thecoopbrla.com" || url.pathname !== IMPORT_PATH) {
    throw new Error("refusing outbound url");
  }
  return url.toString();
}

export function draftBody({ brief, store, caption, assetUrls }) {
  const channels = Array.isArray(brief.channels) && brief.channels.length
    ? brief.channels
    : (brief.channel ? [brief.channel] : ["instagram"]);
  return {
    dealershipId: store.postengineId,
    status: "queued",
    postType: "inventory",
    vehicleInfo: brief.subject || brief.title,
    caption: caption || brief.caption || "",
    mediaUrls: JSON.stringify(assetUrls || []),
    mediaType: (brief.formats || []).includes("reel") ? "video" : "image",
    platforms: JSON.stringify(channels),
    scheduledFor: brief.startsOn ? `${brief.startsOn}T15:00:00.000Z` : null,
    notes: `planner:${brief.id}`,
  };
}

export async function queueDraft({ env, fetchImpl, brief, store, caption, assetUrls }) {
  if (!peWriteEnabled(env)) return { queued: false, reason: "write_off" };
  const token = typeof env.POSTENGINE_IMPORT_TOKEN === "string" ? env.POSTENGINE_IMPORT_TOKEN.trim() : "";
  if (!token) return { queued: false, reason: "missing_token" };
  const url = importUrl(env.POSTENGINE_URL);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(draftBody({ brief, store, caption, assetUrls })),
  });
  if (!response.ok) {
    const error = new Error(`upstream ${response.status}`);
    error.status = 502;
    throw error;
  }
  const payload = await response.json();
  const id = payload && (payload.id || payload.post && payload.post.id);
  if (id == null) {
    const error = new Error("import response missing id");
    error.status = 502;
    throw error;
  }
  return { queued: true, id: String(id), status: payload.status || "queued" };
}
