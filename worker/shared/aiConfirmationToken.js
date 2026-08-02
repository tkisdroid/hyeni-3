function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort()
            .reduce((acc, key) => {
                acc[key] = canonicalize(value[key]);
                return acc;
            }, {});
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

function bytesToBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function timingSafeEqual(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return diff === 0;
}

async function signPayloadPart(payloadPart, secret) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(String(secret || "")),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
    return bytesToBase64Url(new Uint8Array(signature));
}

function matchesExpectedPayload(payload, expected) {
    const normalizedPayload = canonicalize(payload || {});
    const normalizedExpected = canonicalize(expected || {});
    return Object.entries(normalizedExpected).every(([key, expectedValue]) => {
        if (expectedValue && typeof expectedValue === "object") {
            return canonicalJson(normalizedPayload[key]) === canonicalJson(expectedValue);
        }
        return normalizedPayload[key] === expectedValue;
    });
}

export async function createAiToolConfirmationToken(payload, secret) {
    if (!secret) throw new Error("confirmation secret required");
    const payloadPart = bytesToBase64Url(new TextEncoder().encode(canonicalJson(payload || {})));
    const signaturePart = await signPayloadPart(payloadPart, secret);
    return `${payloadPart}.${signaturePart}`;
}

export async function verifyAiToolConfirmationToken(token, expectedPayload, secret) {
    if (!token) return { ok: false, error: "confirmation_token_required" };
    if (!secret) return { ok: false, error: "confirmation_secret_missing" };

    const [payloadPart, signaturePart, extraPart] = String(token).split(".");
    if (!payloadPart || !signaturePart || extraPart !== undefined) {
        return { ok: false, error: "confirmation_token_invalid" };
    }

    const expectedSignature = await signPayloadPart(payloadPart, secret);
    if (!timingSafeEqual(signaturePart, expectedSignature)) {
        return { ok: false, error: "confirmation_token_invalid" };
    }

    let payload = null;
    try {
        payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
    } catch {
        return { ok: false, error: "confirmation_token_invalid" };
    }

    const expiresAt = Number(payload?.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
        return { ok: false, error: "confirmation_token_expired" };
    }

    if (!matchesExpectedPayload(payload, expectedPayload)) {
        return { ok: false, error: "confirmation_payload_mismatch" };
    }

    return { ok: true, payload };
}
