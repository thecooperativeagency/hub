import { BOT_ASSIGNEES } from "./constants.js";

function nonempty(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

export function botTokens(env) {
  const raw = env && typeof env.PLANNER_BOT_TOKENS === "string" ? env.PLANNER_BOT_TOKENS.trim() : "";
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed)
      .map(([name, token]) => {
        const key = String(name || "").trim().toLowerCase();
        const assignee = BOT_ASSIGNEES[key];
        if (!assignee || typeof token !== "string" || !token.trim()) return null;
        return { name: key, assignee, token: token.trim() };
      })
      .filter(Boolean);
  } catch {
    console.log(JSON.stringify({ level: "warn", msg: "planner.bot_tokens_invalid" }));
    return [];
  }
}

export async function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  // Workers expose timingSafeEqual on Web Crypto. Node's test runner does not, yet.
  if (crypto.subtle && typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(x, y);
  }
  let mismatch = 0;
  for (let i = 0; i < x.length; i += 1) mismatch |= x[i] ^ y[i];
  return mismatch === 0;
}

export async function identify(request, env) {
  const pinSecret = nonempty(env.PLANNER_PIN);
  const tokenSecret = nonempty(env.PLANNER_TOKEN);
  const bots = botTokens(env);
  if (!pinSecret && !tokenSecret && !bots.length) return { ok: true, mode: "open", who: "open" };

  const headerPin = request.headers.get("X-Planner-Pin") || "";
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (pinSecret && (await safeEqual(headerPin, pinSecret) || await safeEqual(bearer, pinSecret))) {
    return { ok: true, mode: "pin", who: "pin" };
  }
  if (tokenSecret && (await safeEqual(bearer, tokenSecret) || await safeEqual(headerPin, tokenSecret))) {
    return { ok: true, mode: "token", who: "token" };
  }
  for (const bot of bots) {
    if (await safeEqual(bearer, bot.token)) {
      return { ok: true, mode: "bot", who: bot.name, assignee: bot.assignee };
    }
  }
  return { ok: false, mode: "denied", who: null };
}
