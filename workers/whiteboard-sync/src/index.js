const KEY = "ops";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
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
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
      });
    }

    if (request.method === "PUT") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (!env.SAVE_TOKEN || token !== env.SAVE_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, 400);
      }
      if (!body || !Array.isArray(body.boards) || !body.boards.length) {
        return json({ error: "need boards[]" }, 400);
      }
      body.updatedAt = body.updatedAt || new Date().toISOString();
      body.updatedBy = body.updatedBy || "browser";
      await env.BOARD.put(KEY, JSON.stringify(body));
      return json({ ok: true, updatedAt: body.updatedAt });
    }

    return json({ error: "method" }, 405);
  },
};
