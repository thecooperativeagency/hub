function nonempty(value) {
  return typeof value === "string" && value.trim() ? value : "";
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
  if (!pinSecret && !tokenSecret) return { ok: true, mode: "open", who: "open" };

  const headerPin = request.headers.get("X-Planner-Pin") || "";
  const bearer = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (pinSecret && (await safeEqual(headerPin, pinSecret) || await safeEqual(bearer, pinSecret))) {
    return { ok: true, mode: "pin", who: "pin" };
  }
  if (tokenSecret && (await safeEqual(bearer, tokenSecret) || await safeEqual(headerPin, tokenSecret))) {
    return { ok: true, mode: "token", who: "token" };
  }
  return { ok: false, mode: "denied", who: null };
}
