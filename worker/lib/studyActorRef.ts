function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function actorRefForStudy(
  userId: string,
  secret: string,
): Promise<string> {
  const secretBytes = new TextEncoder().encode(secret);
  if (secretBytes.byteLength < 32) {
    throw new Error("study_actor_ref_secret_too_short");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`study-actor-ref:v1:${userId}`),
  );
  return base64Url(new Uint8Array(signature));
}
