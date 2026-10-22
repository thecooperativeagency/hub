const KEY = "ops";
const LOG_KEY = "save-log";
const LOG_MAX = 200;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Base-Rev, X-Base-Updated-At",
  "Access-Control-Expose-Headers": "X-Board-Rev",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

// Returns the identity for a token, or null. Per-agent keys win; SAVE_TOKEN is legacy.
function identify(token, env) {
  const agents = [
    ["grokbot", env.WB_KEY_GROKBOT],
    ["ada", env.WB_KEY_ADA],
    ["lance", env.WB_KEY_LANCE],
  ];
  for (const [who, k] of agents) if (safeEqual(token, k)) return { who, legacy: false };
  if (safeEqual(token, env.SAVE_TOKEN)) return { who: null, legacy: true };
  return null;
}

async function appendLog(env, entry) {
  try {
    const raw = await env.BOARD.get(LOG_KEY);
    let list = [];
    try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list.push(entry);
    if (list.length > LOG_MAX) list = list.slice(-LOG_MAX);
    await env.BOARD.put(LOG_KEY, JSON.stringify(list));
  } catch (e) {
    console.log("log append failed", String(e));
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/whiteboard")) {
      return json({ error: "not found" }, 404);
    }

    if (request.method === "GET") {
      const raw = await env.BOARD.get(KEY);
      if (!raw) return json({ error: "empty" }, 404);
      return new Response(raw, {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
      });
    }

    if (request.method === "PUT") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      const id = identify(token, env);
      if (!id) return json({ error: "unauthorized" }, 401);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body || !Array.isArray(body.boards) || !body.boards.length) {
        return json({ error: "need boards[]" }, 400);
      }

      // Base version: header or body field. Absent => legacy client, no check.
      const hRev = request.headers.get("X-Base-Rev");
      const hAt = request.headers.get("X-Base-Updated-At");
      const baseRev = hRev != null && hRev !== "" ? hRev : body.baseRev;
      const baseAt = hAt != null && hAt !== "" ? hAt : body.baseUpdatedAt;
      delete body.baseRev;
      delete body.baseUpdatedAt;

      const curRaw = await env.BOARD.get(KEY);
      let cur = null;
      try { cur = curRaw ? JSON.parse(curRaw) : null; } catch { cur = null; }
      const curRev = cur && Number.isFinite(Number(cur.rev)) ? Number(cur.rev) : 0;
      const curAt = cur ? cur.updatedAt || null : null;

      if (baseRev != null && baseRev !== "") {
        if (Number(baseRev) !== curRev) {
          return json({ error: "conflict", reason: "rev", rev: curRev, updatedAt: curAt, updatedBy: cur && cur.updatedBy }, 409);
        }
      } else if (baseAt != null && baseAt !== "") {
        if (String(baseAt) !== String(curAt)) {
          return json({ error: "conflict", reason: "updatedAt", rev: curRev, updatedAt: curAt, updatedBy: cur && cur.updatedBy }, 409);
        }
      }

      const now = new Date().toISOString();
      body.rev = curRev + 1;
      if (id.legacy) {
        body.updatedAt = body.updatedAt || now;
        body.updatedBy = body.updatedBy || "browser";
      } else {
        body.updatedAt = now;
        body.updatedBy = id.who;
      }
      await env.BOARD.put(KEY, JSON.stringify(body));
      const entry = {
        who: id.legacy ? "legacy:" + body.updatedBy : id.who,
        at: now,
        rev: body.rev,
        baseRev: baseRev != null && baseRev !== "" ? Number(baseRev) : null,
        baseUpdatedAt: baseAt || null,
        checked: (baseRev != null && baseRev !== "") || (baseAt != null && baseAt !== ""),
      };
      console.log("whiteboard save", JSON.stringify(entry));
      await appendLog(env, entry);
      return new Response(JSON.stringify({ ok: true, rev: body.rev, updatedAt: body.updatedAt, updatedBy: body.updatedBy }), {
        headers: { "Content-Type": "application/json; charset=utf-8", "X-Board-Rev": String(body.rev), ...CORS },
      });
    }

    return json({ error: "method" }, 405);
  },
};
