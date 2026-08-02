function normalizeHexSignature(signature) {
  const value = String(signature || "").trim();
  const withoutPrefix = value.toLowerCase().startsWith("sha256=") ? value.slice(7) : value;
  return /^[0-9a-f]{64}$/i.test(withoutPrefix) ? withoutPrefix.toLowerCase() : "";
}

async function hmacHex(rawBody, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function authorizeQonversionWebhook({ rawBody, signature, secret }) {
  const normalizedSecret = String(secret || "");
  if (!normalizedSecret) {
    return { ok: false, status: 503, error: "Webhook secret is not configured" };
  }

  const normalizedSignature = normalizeHexSignature(signature);
  if (!normalizedSignature) {
    return { ok: false, status: 401, error: "Invalid webhook signature" };
  }
  const expected = await hmacHex(String(rawBody || ""), normalizedSecret);
  return timingSafeEqual(expected, normalizedSignature)
    ? { ok: true, status: 200 }
    : { ok: false, status: 401, error: "Invalid webhook signature" };
}
