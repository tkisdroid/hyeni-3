import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, extname, resolve } from "node:path";
import test, { after } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Hono } from "hono";

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = resolve(workerDir, "..");
const cloudflareWorkersShim = new URL("./helpers/cloudflareWorkersShim.mjs", import.meta.url).href;
const typeScriptResolutionHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: cloudflareWorkersShim, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !extname(specifier)) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".js"]) {
        const candidate = new URL(`${base.href}${extension}`);
        if (existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => typeScriptResolutionHook.deregister());

const storageRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/storage.ts")).href)).default;
const teacherNoticeRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/teacher-notices.ts")).href)).default;
const familyRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/family.ts")).href)).default;
const accountRoutes = (await import(pathToFileURL(resolve(workerDir, "routes/account.ts")).href)).default;
const workerEntry = (await import(pathToFileURL(resolve(workerDir, "index.ts")).href)).default;
const {
  claimStorageUploadQuota,
  claimStorageUploadQuotaScopes,
  cleanupStorageUploadDailyUsage,
} = await import(pathToFileURL(resolve(workerDir, "lib/storageUploadQuota.ts")).href);
const { readStorageRequestBodyCapped } = await import(
  pathToFileURL(resolve(workerDir, "lib/storageObjectValidation.ts")).href
);
const {
  attachStorageUploadJournalMultipart,
  beginStorageUploadJournal,
  processPendingStorageInvalidUploadCleanups,
  processStorageInvalidUploadCleanup,
} = await import(pathToFileURL(resolve(workerDir, "lib/storageInvalidUploadCleanup.ts")).href);

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.bindings = bindings;
  }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.bindings);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class Db {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

let nextObjectEtag = 1;

function storedObject(key, bytes, contentType, customMetadata = {}) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const etag = `etag-${nextObjectEtag++}`;
  return {
    key,
    body,
    size: body.byteLength,
    etag,
    httpEtag: `"${etag}"`,
    httpMetadata: { contentType },
    customMetadata,
    writeHttpMetadata(headers) {
      if (contentType) headers.set("Content-Type", contentType);
    },
  };
}

class PhotosBucket {
  constructor(entries = []) {
    this.objects = new Map(entries.map(({ key, bytes, contentType, customMetadata }) => [
      key,
      storedObject(key, bytes, contentType, customMetadata),
    ]));
    this.multipartUploads = new Map();
    this.nextMultipartId = 1;
    this.abortCalls = 0;
  }
  async put(key, value, options = {}) {
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) return null;
    if (
      options.onlyIf?.etagMatches
      && this.objects.get(key)?.etag !== options.onlyIf.etagMatches
    ) return null;
    const bytes = typeof value === "string"
      ? new TextEncoder().encode(value)
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(await value.arrayBuffer());
    this.objects.set(
      key,
      storedObject(key, bytes, options.httpMetadata?.contentType, options.customMetadata),
    );
    return this.objects.get(key);
  }
  async head(key) {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return {
      key,
      size: obj.size,
      etag: obj.etag,
      httpMetadata: { ...obj.httpMetadata },
      httpEtag: obj.httpEtag,
      customMetadata: { ...obj.customMetadata },
    };
  }
  async get(key) {
    return this.objects.get(key) ?? null;
  }
  async list({ prefix = "", limit = 1000, startAfter } = {}) {
    const matching = [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix) && (!startAfter || key > startAfter))
      .sort();
    const keys = matching.slice(0, limit);
    return {
      objects: keys.map((key) => this.objects.get(key)),
      truncated: matching.length > keys.length,
    };
  }
  async delete(input) {
    for (const key of Array.isArray(input) ? input : [input]) this.objects.delete(key);
  }

  async createMultipartUpload(key, options = {}) {
    const uploadId = `multipart-${this.nextMultipartId++}`;
    const state = {
      key,
      uploadId,
      options,
      status: "active",
      parts: new Map(),
    };
    this.multipartUploads.set(uploadId, state);
    return this.multipartHandle(state);
  }

  resumeMultipartUpload(key, uploadId) {
    const state = this.multipartUploads.get(uploadId) ?? {
      key,
      uploadId,
      options: {},
      status: "missing",
      parts: new Map(),
    };
    return this.multipartHandle(state);
  }

  multipartHandle(state) {
    return {
      key: state.key,
      uploadId: state.uploadId,
      uploadPart: (partNumber, value) => this.uploadMultipartPart(state, partNumber, value),
      complete: (parts) => this.completeMultipartUpload(state, parts),
      abort: () => this.abortMultipartUpload(state),
    };
  }

  async uploadMultipartPart(state, partNumber, value) {
    if (state.status !== "active") throw new Error("NoSuchUpload");
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(await value.arrayBuffer());
    const uploadedPart = { partNumber, etag: `part-${state.uploadId}-${partNumber}` };
    state.parts.set(partNumber, bytes);
    return uploadedPart;
  }

  async completeMultipartUpload(state, parts) {
    if (state.status !== "active") throw new Error("NoSuchUpload");
    const chunks = parts.map(({ partNumber }) => state.parts.get(partNumber));
    if (chunks.some((chunk) => !chunk)) throw new Error("InvalidPart");
    const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    state.status = "completed";
    this.objects.set(
      state.key,
      storedObject(
        state.key,
        bytes,
        state.options.httpMetadata?.contentType,
        state.options.customMetadata,
      ),
    );
    return this.objects.get(state.key);
  }

  async abortMultipartUpload(state) {
    this.abortCalls += 1;
    if (state.status !== "active") throw new Error("NoSuchUpload");
    state.status = "aborted";
    state.parts.clear();
  }
}

class FailingPhotosBucket extends PhotosBucket {
  async createMultipartUpload() {
    throw new Error("r2_unavailable");
  }
}

class PoisonAbortPhotosBucket extends PhotosBucket {
  constructor(entries = []) {
    super(entries);
    this.poisonAbortCalls = 0;
  }

  resumeMultipartUpload(key, uploadId) {
    if (key.startsWith("family-a/poison-")) {
      return {
        key,
        uploadId,
        abort: async () => {
          this.poisonAbortCalls += 1;
          throw new Error("r2_transient_abort");
        },
      };
    }
    return super.resumeMultipartUpload(key, uploadId);
  }
}

class PausingPutPhotosBucket extends PhotosBucket {
  constructor(pausePhase) {
    super();
    this.pausePhase = pausePhase;
    this.putPaused = new Promise((resolve) => { this.markPutPaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumePut = resolve; });
    this.didPause = false;
  }

  async put(key, value, options = {}) {
    if (this.didPause) return super.put(key, value, options);
    this.didPause = true;
    if (this.pausePhase === "before") {
      this.markPutPaused(key);
      await this.resumePromise;
      return super.put(key, value, options);
    }
    const stored = await super.put(key, value, options);
    this.markPutPaused(key);
    await this.resumePromise;
    return stored;
  }

  async completeMultipartUpload(state, parts) {
    if (this.didPause) return super.completeMultipartUpload(state, parts);
    this.didPause = true;
    if (this.pausePhase === "before") {
      this.markPutPaused(state.key);
      await this.resumePromise;
      return super.completeMultipartUpload(state, parts);
    }
    const stored = await super.completeMultipartUpload(state, parts);
    this.markPutPaused(state.key);
    await this.resumePromise;
    return stored;
  }

  resume() {
    this.resumePut();
  }
}

class PausingCreateMultipartPhotosBucket extends PhotosBucket {
  constructor() {
    super();
    this.createPaused = new Promise((resolve) => { this.markCreatePaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeCreate = resolve; });
  }
  async createMultipartUpload(key, options = {}) {
    this.markCreatePaused(key);
    await this.resumePromise;
    return super.createMultipartUpload(key, options);
  }
  resume() { this.resumeCreate(); }
}

class PausingReservationStartPhotosBucket extends PhotosBucket {
  constructor() {
    super();
    this.startPaused = new Promise((resolve) => { this.markStartPaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeStart = resolve; });
    this.didPause = false;
  }
  async createMultipartUpload(key, options = {}) {
    if (!this.didPause) {
      this.didPause = true;
      this.markStartPaused(key);
      await this.resumePromise;
    }
    return super.createMultipartUpload(key, options);
  }
  async put(key, value, options = {}) {
    if (!this.didPause && options.customMetadata?.storageState === "reservation") {
      this.didPause = true;
      this.markStartPaused(key);
      await this.resumePromise;
    }
    return super.put(key, value, options);
  }
  resume() { this.resumeStart(); }
}

class PausingReservationDataPutPhotosBucket extends PhotosBucket {
  constructor() {
    super();
    this.dataPutPaused = new Promise((resolve) => { this.markDataPutPaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeDataPut = resolve; });
    this.didPause = false;
  }
  async put(key, value, options = {}) {
    if (!this.didPause && options.customMetadata?.storageState !== "reservation") {
      this.didPause = true;
      this.markDataPutPaused(key);
      await this.resumePromise;
    }
    return super.put(key, value, options);
  }
  resume() { this.resumeDataPut(); }
}

class PausingUploadPartPhotosBucket extends PhotosBucket {
  constructor() {
    super();
    this.partPaused = new Promise((resolve) => { this.markPartPaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumePart = resolve; });
  }
  async uploadMultipartPart(state, partNumber, value) {
    this.markPartPaused(state.key);
    await this.resumePromise;
    return super.uploadMultipartPart(state, partNumber, value);
  }
  resume() { this.resumePart(); }
}

class GenericAbortFailurePhotosBucket extends PausingPutPhotosBucket {
  constructor() { super("before"); }
  async abortMultipartUpload() {
    throw new Error("r2_abort_temporarily_unavailable");
  }
}

class LegacyWriterRacePhotosBucket extends PhotosBucket {
  constructor(key, bytes) {
    super();
    this.raceKey = key;
    this.raceBytes = bytes;
    this.injected = false;
  }
  injectLegacyObject() {
    if (this.injected) return;
    this.injected = true;
    this.objects.set(
      this.raceKey,
      storedObject(this.raceKey, this.raceBytes, "image/jpeg", { legacyWriter: "true" }),
    );
  }
  async put(key, value, options = {}) {
    if (key === this.raceKey && options.customMetadata?.storageState === "reservation") {
      this.injectLegacyObject();
    }
    return super.put(key, value, options);
  }
  async completeMultipartUpload(state, parts) {
    if (state.key === this.raceKey) this.injectLegacyObject();
    return super.completeMultipartUpload(state, parts);
  }
}

class TransientCleanupPhotosBucket extends PausingPutPhotosBucket {
  constructor() {
    super("before");
    this.abortFailures = 1;
    this.headFailures = 0;
  }

  async completeMultipartUpload(state, parts) {
    if (!this.didPause) this.headFailures = 1;
    return super.completeMultipartUpload(state, parts);
  }

  async abortMultipartUpload(state) {
    if (this.abortFailures > 0) {
      this.abortFailures -= 1;
      throw new Error("r2_abort_temporarily_unavailable");
    }
    return super.abortMultipartUpload(state);
  }

  async head(key) {
    if (this.headFailures > 0) {
      this.headFailures -= 1;
      throw new Error("r2_head_temporarily_unavailable");
    }
    return super.head(key);
  }
}

class PausingCleanupClaimStatement {
  constructor(owner, statement, sql) {
    this.owner = owner;
    this.statement = statement;
    this.sql = sql;
  }
  bind(...bindings) {
    return new PausingCleanupClaimStatement(this.owner, this.statement.bind(...bindings), this.sql);
  }
  async first() {
    const result = await this.statement.first();
    if (
      !this.owner.didPause
      && !this.owner.sawCleanupClaim
      && this.sql.includes("FROM storage_invalid_upload_cleanup_jobs WHERE object_key")
    ) {
      this.owner.didPause = true;
      this.owner.markPaused();
      await this.owner.resumePromise;
    }
    return result;
  }
  all() { return this.statement.all(); }
  async run() {
    if (!this.owner.didPause && this.sql.includes("cleanup_started_at")) {
      this.owner.didPause = true;
      this.owner.markPaused();
      await this.owner.resumePromise;
    }
    return this.statement.run();
  }
}

class PausingCleanupClaimDb {
  constructor(delegate) {
    this.delegate = delegate;
    this.didPause = false;
    this.sawCleanupClaim = false;
    this.paused = new Promise((resolve) => { this.markPaused = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeClaim = resolve; });
  }
  prepare(sql) {
    if (sql.includes("cleanup_started_at")) this.sawCleanupClaim = true;
    return new PausingCleanupClaimStatement(this, this.delegate.prepare(sql), sql);
  }
  batch(statements) { return this.delegate.batch(statements); }
  resume() { this.resumeClaim(); }
}

class FailingDeletePhotosBucket extends PhotosBucket {
  constructor(entries = []) {
    super(entries);
    this.failDelete = true;
  }

  async put(key, value, options = {}) {
    if (this.failDelete && options.customMetadata?.storageState === "cleanup") {
      throw new Error("r2_cleanup_marker_failed");
    }
    return super.put(key, value, options);
  }
}

class PausingCleanupMarkerPhotosBucket extends PhotosBucket {
  constructor(entries = []) {
    super(entries);
    this.markerWritten = new Promise((resolve) => { this.markMarkerWritten = resolve; });
    this.resumePromise = new Promise((resolve) => { this.resumeMarker = resolve; });
    this.didPause = false;
  }
  async put(key, value, options = {}) {
    const stored = await super.put(key, value, options);
    if (!this.didPause && options.customMetadata?.storageState === "cleanup" && stored) {
      this.didPause = true;
      this.markMarkerWritten(key);
      await this.resumePromise;
    }
    return stored;
  }
  resume() { this.resumeMarker(); }
}

class LostJournalAckStatement {
  constructor(owner, delegate, sql) {
    this.owner = owner;
    this.delegate = delegate;
    this.sql = sql;
  }
  bind(...bindings) {
    return new LostJournalAckStatement(this.owner, this.delegate.bind(...bindings), this.sql);
  }
  first() {
    const isBeginReadback = this.sql.includes("SELECT 1 AS owned FROM storage_invalid_upload_cleanup_jobs");
    const isCommitReadback = this.sql.includes("SELECT committed_at FROM storage_invalid_upload_cleanup_jobs");
    if (
      this.owner.failReadback
      && this.owner.didLoseAck
      && ((this.owner.phase === "begin" && isBeginReadback) || (this.owner.phase === "commit" && isCommitReadback))
    ) {
      throw new Error(`simulated_${this.owner.phase}_readback_loss`);
    }
    return this.delegate.first();
  }
  all() { return this.delegate.all(); }
  async run() {
    const result = await this.delegate.run();
    const matches = this.owner.phase === "begin"
      ? this.sql.includes("INSERT INTO storage_invalid_upload_cleanup_jobs")
      : this.sql.includes("SET committed_at=COALESCE");
    if (matches && !this.owner.didLoseAck) {
      this.owner.didLoseAck = true;
      throw new Error(`simulated_${this.owner.phase}_ack_loss`);
    }
    return result;
  }
}

class LostJournalAckDb {
  constructor(delegate, phase, failReadback = false) {
    this.delegate = delegate;
    this.phase = phase;
    this.failReadback = failReadback;
    this.didLoseAck = false;
  }
  prepare(sql) { return new LostJournalAckStatement(this, this.delegate.prepare(sql), sql); }
  batch(statements) { return this.delegate.batch(statements); }
}

function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(resolve(repoDir, "cloudflare/schema_d1.sql"), "utf8"));
  return { sqlite, db: new Db(sqlite) };
}

function addFamily(sqlite) {
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-a',0),('child-a',0)").run();
  sqlite.prepare("INSERT INTO families(id,parent_id,pair_code) VALUES ('family-a','parent-a','PAIR-A')").run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('parent-member-a','family-a','parent-a','parent','부모',1),
            ('child-member-a','family-a','child-a','child','아이',1)`,
  ).run();
}

function addTeacher(sqlite, suffix) {
  const userId = `teacher-${suffix}`;
  const teacherId = `teacher-profile-${suffix}`;
  const classId = `class-${suffix}`;
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES (?,0)").run(userId);
  sqlite.prepare(
    "INSERT INTO teacher_profiles(id,user_id,display_name,created_at,updated_at) VALUES (?,?,?,'2026-07-14','2026-07-14')",
  ).run(teacherId, userId, userId);
  sqlite.prepare(
    "INSERT INTO teacher_classes(id,teacher_id,class_name,created_at,updated_at) VALUES (?,?,?,'2026-07-14','2026-07-14')",
  ).run(classId, teacherId, `반-${suffix}`);
  return { userId, teacherId, classId };
}

function count(sqlite, table, where = "1=1") {
  return Number(sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).get().count);
}

function pendingJournalCount(sqlite, where = "1=1") {
  return count(
    sqlite,
    "storage_invalid_upload_cleanup_jobs",
    `committed_at IS NULL AND cleaned_at IS NULL AND (${where})`,
  );
}

function assertCleanupTombstone(photos, objectKey) {
  const object = photos.objects.get(objectKey);
  assert.ok(object, `${objectKey} cleanup tombstone이 있어야 합니다`);
  assert.equal(object.customMetadata?.storageState, "cleanup");
  assert.match(new TextDecoder().decode(object.body), /^[0-9a-f-]{36}$/i);
}

function journalNonce(sqlite, objectKey) {
  return String(sqlite.prepare(
    "SELECT upload_nonce FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
  ).get(objectKey)?.upload_nonce ?? "");
}

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const jwtPrivateKey = JSON.stringify(await exportJWK(privateKey));
const jwtPublicKey = JSON.stringify(await exportJWK(publicKey));

async function authorization(sub, role, familyId = null) {
  const token = await new SignJWT({ role, family_id: familyId, is_anonymous: false })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return `Bearer ${token}`;
}

async function request(db, photos, path, actor, init = {}) {
  const app = new Hono();
  app.route("/api/storage", storageRoutes);
  app.route("/api/teacher", teacherNoticeRoutes);
  app.route("/api/family", familyRoutes);
  app.route("/api/account", accountRoutes);
  return app.request(
    `http://test.local${path}`,
    {
      ...init,
      headers: {
        Authorization: await authorization(actor.sub, actor.role, actor.familyId),
        ...(init.headers ?? {}),
      },
    },
    {
      DB: db,
      PHOTOS: photos,
      JWT_PRIVATE_KEY: jwtPrivateKey,
      JWT_PUBLIC_KEY: jwtPublicKey,
      FAMILY_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
      TEACHER_ROOM: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
      },
    },
  );
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PDF = new TextEncoder().encode("%PDF-1.7\n");

test("브라우저 child-photo 업로드 preflight는 목적·대상 헤더를 정확히 허용한다", async () => {
  const response = await workerEntry.fetch(new Request(
    "http://test.local/api/storage/child-photo-uploads/family-a",
    {
      method: "OPTIONS",
      headers: {
        Origin: "https://hyeni-calendar.pages.dev",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": [
          "authorization",
          "content-type",
          "x-hyeni-upload-purpose",
          "x-hyeni-target-member-id",
          "x-hyeni-upload-request-id",
        ].join(", "),
      },
    },
  ), {});
  assert.equal(response.status, 204, await response.clone().text());
  const allowed = new Set(
    String(response.headers.get("Access-Control-Allow-Headers") ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const name of [
    "authorization",
    "content-type",
    "x-hyeni-upload-purpose",
    "x-hyeni-target-member-id",
    "x-hyeni-upload-request-id",
  ]) {
    assert.ok(allowed.has(name), `${name}가 preflight 허용 목록에 있어야 합니다`);
  }
});

test("child-photos 업로드는 8MB·허용 image MIME·magic byte를 서버에서 검증한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const photos = new PhotosBucket();

  const tooLarge = await request(db, photos, "/api/storage/child-photo-uploads/family-a", actor, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: new Uint8Array(8 * 1024 * 1024 + 1),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(
    Number(sqlite.prepare("SELECT COUNT(*) AS count FROM storage_upload_daily_usage").get().count),
    0,
    "본문 상한에서 거절된 요청은 quota와 R2를 소비하면 안 됩니다",
  );
  assert.equal(photos.objects.size, 0);

  const spoofed = await request(db, photos, "/api/storage/child-photo-uploads/family-a", actor, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: new TextEncoder().encode("<script>alert(1)</script>"),
  });
  assert.equal(spoofed.status, 415);

  const wrongDeclaredType = await request(db, photos, "/api/storage/child-photo-uploads/family-a", actor, {
    method: "POST",
    headers: {
      "Content-Type": "text/html",
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: JPEG,
  });
  assert.equal(wrongDeclaredType.status, 415);

  const valid = await request(db, photos, "/api/storage/child-photo-uploads/family-a", actor, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: JPEG,
  });
  assert.equal(valid.status, 200, await valid.clone().text());
  const { path } = await valid.json();
  assert.match(path, /^family-a\/uploads\/parent-a\/[0-9a-f-]+\.jpg$/);
  assert.equal(photos.objects.get(path)?.httpMetadata.contentType, "image/jpeg");
});

test("신규 서버키 업로드는 raw body만 받고 multipart 전체 파싱 경로를 열지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const photos = new PhotosBucket();
  const form = new FormData();
  form.append("file", new Blob([JPEG], { type: "image/jpeg" }), "photo.jpg");
  form.append("unused", "x".repeat(1024));
  const response = await request(db, photos, "/api/storage/child-photo-uploads/family-a", actor, {
    method: "POST",
    headers: {
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: form,
  });
  assert.equal(response.status, 415, await response.text());
  assert.equal(photos.objects.size, 0);
});

test("bounded body reader는 실제 stream 초과·길이 위조·read 오류를 fail-closed 처리한다", async () => {
  let cancelled = false;
  const overflowing = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
      controller.enqueue(new Uint8Array([6, 7, 8, 9]));
    },
    cancel() { cancelled = true; },
  });
  const overflow = await readStorageRequestBodyCapped(new Request("http://test.local/upload", {
    method: "POST",
    body: overflowing,
    duplex: "half",
  }), 8);
  assert.deepEqual(overflow, { ok: false, error: "file_too_large" });
  assert.equal(cancelled, true, "상한 초과 stream은 즉시 cancel되어야 합니다");

  const mismatch = await readStorageRequestBodyCapped(new Request("http://test.local/upload", {
    method: "POST",
    headers: { "Content-Length": "2" },
    body: new Uint8Array([1, 2, 3]),
  }), 8);
  assert.deepEqual(mismatch, { ok: false, error: "body_length_mismatch" });

  const failed = await readStorageRequestBodyCapped(new Request("http://test.local/upload", {
    method: "POST",
    body: new ReadableStream({ start(controller) { controller.error(new Error("read failed")); } }),
    duplex: "half",
  }), 8);
  assert.deepEqual(failed, { ok: false, error: "body_read_failed" });
});

test("legacy client key 업로드는 기존 키를 덮지 않고 create-only 호환·폐기 안내를 제공한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const original = new Uint8Array([...JPEG, 0x11]);
  const replacement = new Uint8Array([...JPEG, 0x22]);
  const photos = new PhotosBucket([
    { key: "family-a/memo-1720930000000-1.jpg", bytes: original, contentType: "image/jpeg" },
  ]);
  const child = { sub: "child-a", role: "child", familyId: "family-a" };
  const parent = { sub: "parent-a", role: "parent", familyId: "family-a" };

  const overwrite = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/memo-1720930000000-1.jpg",
    child,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(overwrite.status, 409, await overwrite.text());
  assert.deepEqual(
    [...photos.objects.get("family-a/memo-1720930000000-1.jpg").body],
    [...original],
    "기존 객체 바이트는 그대로여야 합니다",
  );

  const legacyCreated = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/memo-1720930000001-999999.jpg",
    child,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(legacyCreated.status, 200, await legacyCreated.clone().text());
  assert.equal(legacyCreated.headers.get("Deprecation"), "true");
  assert.match(legacyCreated.headers.get("Link") ?? "", /child-photo-uploads/);
  assert.deepEqual(await legacyCreated.json(), { path: "family-a/memo-1720930000001-999999.jpg" });
  const legacyMetadata = photos.objects.get("family-a/memo-1720930000001-999999.jpg")?.customMetadata;
  assert.deepEqual({ ...legacyMetadata, uploadNonce: undefined }, {
    familyId: "family-a",
    ownerUserId: "child-a",
    purpose: "legacy",
    legacyKind: "memo",
    uploadNonce: undefined,
  });
  assert.match(String(legacyMetadata?.uploadNonce ?? ""), /^[0-9a-f-]{36}$/i);

  const childProfileWrite = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/child-member-a-1720930000002.jpg",
    child,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(childProfileWrite.status, 403, await childProfileWrite.text());

  const parentProfileWrite = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/child-member-a-1720930000002.jpg",
    parent,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(parentProfileWrite.status, 200, await parentProfileWrite.text());
  assert.equal(
    photos.objects.get("family-a/child-member-a-1720930000002.jpg")?.customMetadata?.legacyKind,
    "profile",
  );

  const placeholderWrite = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/child-1-1720930000003-0.jpg",
    parent,
    { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(placeholderWrite.status, 200, await placeholderWrite.text());
  assert.equal(
    photos.objects.get("family-a/child-1-1720930000003-0.jpg")?.customMetadata?.legacyKind,
    "placeholder",
  );

  const unknownPath = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/arbitrary.jpg",
    parent,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(unknownPath.status, 400, await unknownPath.text());

  const created = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    child,
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: replacement,
    },
  );
  assert.equal(created.status, 200, await created.clone().text());
  const { path } = await created.json();
  assert.match(path, /^family-a\/uploads\/child-a\/[0-9a-f-]+\.jpg$/);
  assert.ok(photos.objects.has(path));
});

test("precheck 뒤 구 Worker writer가 먼저 저장해도 legacy 고정키를 덮지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const objectKey = "family-a/memo-1720930000099-9.jpg";
  const legacyBytes = new Uint8Array([...JPEG, 0x31]);
  const replacement = new Uint8Array([...JPEG, 0x32]);
  const photos = new LegacyWriterRacePhotosBucket(objectKey, legacyBytes);
  const response = await request(
    db,
    photos,
    `/api/storage/child-photos/${objectKey}`,
    { sub: "child-a", role: "child", familyId: "family-a" },
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: replacement },
  );
  assert.equal(response.status, 409, await response.clone().text());
  assert.deepEqual([...photos.objects.get(objectKey).body], [...legacyBytes]);
  assert.equal(photos.objects.get(objectKey)?.customMetadata?.legacyWriter, "true");
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
});

test("memo 업로드 목적은 정확한 활성 아이 대상만 허용한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('child-b',0)").run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('child-member-b','family-a','child-b','child','형제',1)`,
  ).run();
  const photos = new PhotosBucket();
  const child = { sub: "child-a", role: "child", familyId: "family-a" };

  const siblingTarget = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    child,
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-b",
      },
      body: JPEG,
    },
  );
  assert.equal(siblingTarget.status, 403, await siblingTarget.text());

  const missingPurpose = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    child,
    { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: JPEG },
  );
  assert.equal(missingPurpose.status, 400, await missingPurpose.text());
  assert.equal(photos.objects.size, 0);
});

test("부모 본인 프로필 사진은 자기 멤버 행만 올리고 가족은 그 아바타를 볼 수 있다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  // 주 보호자가 아닌 공동 보호자 — 자기 사진은 스스로 정할 수 있어야 한다.
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('parent-b',0)").run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('parent-member-b','family-a','parent-b','parent','공동 보호자',1)`,
  ).run();
  const photos = new PhotosBucket();
  const coParent = { sub: "parent-b", role: "parent", familyId: "family-a" };
  const child = { sub: "child-a", role: "child", familyId: "family-a" };
  const uploadHeaders = (targetMemberId) => ({
    "Content-Type": "image/jpeg",
    "X-Hyeni-Upload-Purpose": "parent_profile",
    "X-Hyeni-Target-Member-Id": targetMemberId,
  });

  // 다른 보호자의 사진을 대신 바꾸지 못한다.
  const otherParent = await request(db, photos, "/api/storage/child-photo-uploads/family-a", coParent, {
    method: "POST",
    headers: uploadHeaders("parent-member-a"),
    body: JPEG,
  });
  assert.equal(otherParent.status, 403, await otherParent.text());

  // 아이는 부모 프로필 목적을 쓸 수 없다.
  const childAttempt = await request(db, photos, "/api/storage/child-photo-uploads/family-a", child, {
    method: "POST",
    headers: uploadHeaders("parent-member-b"),
    body: JPEG,
  });
  assert.equal(childAttempt.status, 403, await childAttempt.text());
  assert.equal(photos.objects.size, 0);

  const created = await request(db, photos, "/api/storage/child-photo-uploads/family-a", coParent, {
    method: "POST",
    headers: uploadHeaders("parent-member-b"),
    body: JPEG,
  });
  assert.equal(created.status, 200, await created.clone().text());
  const { path } = await created.json();
  assert.match(path, /^family-a\/uploads\/parent-b\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(photos.objects.get(path)?.customMetadata?.purpose, "parent_profile");
  assert.equal(
    sqlite.prepare(
      "SELECT authorization_kind FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
    ).get(path)?.authorization_kind,
    "parent_profile",
  );

  // photo_url 은 본인 멤버 행 + 서버 발급 키만 받는다.
  const savePhoto = (memberId, url, actor = coParent) => request(
    db,
    photos,
    "/api/family/member/photo",
    actor,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: "family-a", member_id: memberId, url }),
    },
  );

  const foreignMember = await savePhoto("parent-member-a", path);
  assert.equal(foreignMember.status, 403, await foreignMember.text());
  const arbitraryUrl = await savePhoto("parent-member-b", "https://evil.example/avatar.jpg");
  assert.equal(arbitraryUrl.status, 403, await arbitraryUrl.text());
  const otherOwnerKey = await savePhoto(
    "parent-member-b",
    "family-a/uploads/parent-a/11111111-2222-3333-4444-555555555555.jpg",
  );
  assert.equal(otherOwnerKey.status, 403, await otherOwnerKey.text());

  const saved = await savePhoto("parent-member-b", path);
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(
    sqlite.prepare("SELECT photo_url FROM family_members WHERE id='parent-member-b'").get()?.photo_url,
    path,
  );

  // 같은 가족의 아이도 부모 아바타를 표시할 수 있어야 한다.
  const read = await request(db, photos, `/api/storage/child-photos/${path}`, child);
  assert.equal(read.status, 200, await read.clone().text());
});

test("신규 memo 객체 조회는 부모와 대상 아이만 허용하고 형제는 차단한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('child-b',0)").run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('child-member-b','family-a','child-b','child','형제',1)`,
  ).run();
  const photos = new PhotosBucket([
    { key: "family-a/legacy.jpg", bytes: JPEG, contentType: "image/jpeg" },
  ]);
  const childA = { sub: "child-a", role: "child", familyId: "family-a" };
  const childB = { sub: "child-b", role: "child", familyId: "family-a" };
  const parent = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const created = await request(db, photos, "/api/storage/child-photo-uploads/family-a", childA, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Hyeni-Upload-Purpose": "memo",
      "X-Hyeni-Target-Member-Id": "child-member-a",
    },
    body: JPEG,
  });
  assert.equal(created.status, 200, await created.clone().text());
  const { path } = await created.json();

  for (const actor of [childA, parent]) {
    const allowed = await request(db, photos, `/api/storage/child-photos/${path}`, actor);
    assert.equal(allowed.status, 200, await allowed.text());
  }
  const sibling = await request(db, photos, `/api/storage/child-photos/${path}`, childB);
  assert.equal(sibling.status, 403, await sibling.text());

  const formerOwnerPath = "family-a/uploads/former-user/shared-with-b.jpg";
  photos.objects.set(
    formerOwnerPath,
    storedObject(formerOwnerPath, JPEG, "image/jpeg", {
      familyId: "family-a",
      ownerUserId: "former-user",
      purpose: "memo",
      targetMemberId: "child-member-b",
    }),
  );
  for (const actor of [childB, parent]) {
    const retainedReference = await request(
      db,
      photos,
      `/api/storage/child-photos/${formerOwnerPath}`,
      actor,
    );
    assert.equal(retainedReference.status, 200, await retainedReference.text());
  }
  const formerOwnerSibling = await request(
    db,
    photos,
    `/api/storage/child-photos/${formerOwnerPath}`,
    childA,
  );
  assert.equal(formerOwnerSibling.status, 403, await formerOwnerSibling.text());

  const retainedProfilePath = "family-a/uploads/former-user/shared-profile.jpg";
  photos.objects.set(
    retainedProfilePath,
    storedObject(retainedProfilePath, JPEG, "image/jpeg", {
      familyId: "family-a",
      ownerUserId: "former-user",
      purpose: "profile",
      targetMemberId: "removed-member",
    }),
  );
  for (const actor of [childA, childB, parent]) {
    const retainedProfile = await request(
      db,
      photos,
      `/api/storage/child-photos/${retainedProfilePath}`,
      actor,
    );
    assert.equal(retainedProfile.status, 200, await retainedProfile.text());
  }

  sqlite.prepare(
    `INSERT INTO user_interaction_blocks(family_id,blocker_user_id,blocked_user_id,created_at)
     VALUES ('family-a','child-a','parent-a','2026-07-14')`,
  ).run();
  const blockedParent = await request(db, photos, `/api/storage/child-photos/${path}`, parent);
  assert.equal(blockedParent.status, 403, await blockedParent.text());
  const ownerStillAllowed = await request(db, photos, `/api/storage/child-photos/${path}`, childA);
  assert.equal(ownerStillAllowed.status, 200, await ownerStillAllowed.text());

  photos.objects.set(
    "family-a/uploads/child-a/broken.jpg",
    storedObject(
      "family-a/uploads/child-a/broken.jpg",
      JPEG,
      "image/jpeg",
      { purpose: "memo", ownerUserId: "child-a" },
    ),
  );
  const incompleteMetadata = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/uploads/child-a/broken.jpg",
    childA,
  );
  assert.equal(incompleteMetadata.status, 403, await incompleteMetadata.text());

  const legacy = await request(db, photos, "/api/storage/child-photos/family-a/legacy.jpg", childB);
  assert.equal(legacy.status, 200, await legacy.text());
});

test("사용자 일일 업로드 개수 한도는 원자 claim 뒤 429와 UTC 자정 Retry-After를 반환한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS storage_upload_daily_usage (
    user_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    object_count INTEGER NOT NULL DEFAULT 0,
    byte_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, day_key)
  )`);
  const dayKey = new Date().toISOString().slice(0, 10);
  sqlite.prepare(
    "INSERT INTO storage_upload_daily_usage(user_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("child-a", dayKey, 200, 0, new Date().toISOString());
  const photos = new PhotosBucket();
  const response = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 429, await response.clone().text());
  assert.match(response.headers.get("Retry-After") ?? "", /^\d+$/);
  assert.equal(photos.objects.size, 0);
});

test("동시 quota 경계 claim은 한 요청만 허용하고 오래된 일일 행은 8일 보존 뒤 정리한다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date("2026-07-14T12:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO storage_upload_daily_usage(user_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("child-a", "2026-07-14", 199, 0, now.toISOString());
  sqlite.prepare(
    "INSERT INTO storage_upload_daily_usage(user_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("old-user", "2026-07-05", 1, 1, "2026-07-05T00:00:00.000Z");

  const claims = await Promise.all([
    claimStorageUploadQuota(db, "child-a", JPEG.length, now),
    claimStorageUploadQuota(db, "child-a", JPEG.length, now),
  ]);
  assert.deepEqual(claims.map((claim) => claim.status).sort(), ["claimed", "limited"]);
  const usage = sqlite.prepare(
    "SELECT object_count, byte_count FROM storage_upload_daily_usage WHERE user_id='child-a' AND day_key='2026-07-14'",
  ).get();
  assert.equal(usage?.object_count, 200);
  assert.equal(usage?.byte_count, JPEG.length);

  assert.equal(await cleanupStorageUploadDailyUsage(db, now), 1);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM storage_upload_daily_usage WHERE user_id='old-user'").get().count,
    0,
  );
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS count FROM storage_upload_daily_usage WHERE user_id='child-a'").get().count,
    1,
  );
});

test("가족 quota 경계 경합은 사용자 여러 명 중 한 요청만 원자 허용한다", async () => {
  const { sqlite, db } = createDb();
  const now = new Date("2026-07-14T12:00:00.000Z");
  sqlite.prepare(
    "INSERT INTO storage_upload_family_daily_usage(family_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("family-a", "2026-07-14", 199, 0, now.toISOString());

  const claims = await Promise.all([
    claimStorageUploadQuotaScopes(db, {
      userId: "child-a", familyId: "family-a", byteCount: JPEG.length, now,
    }),
    claimStorageUploadQuotaScopes(db, {
      userId: "child-b", familyId: "family-a", byteCount: JPEG.length, now,
    }),
  ]);
  assert.deepEqual(claims.map((claim) => claim.status).sort(), ["claimed", "limited"]);
  const familyUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_family_daily_usage WHERE family_id='family-a' AND day_key='2026-07-14'",
  ).get();
  assert.equal(familyUsage?.object_count, 200);
  assert.equal(familyUsage?.byte_count, JPEG.length);
  const userUsage = sqlite.prepare(
    "SELECT SUM(object_count) AS object_count,SUM(byte_count) AS byte_count FROM storage_upload_daily_usage WHERE day_key='2026-07-14'",
  ).get();
  assert.equal(userUsage?.object_count, 1, "가족 claim 실패 요청의 선행 user claim은 rollback되어야 합니다");
  assert.equal(userUsage?.byte_count, JPEG.length);
});

test("같은 가족의 새 사용자도 가족 quota를 우회하지 못하고 선행 user claim을 되돌린다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('child-rejoined',1)").run();
  sqlite.prepare(
    `INSERT INTO family_members(id,family_id,user_id,role,name,is_active)
     VALUES ('child-member-rejoined','family-a','child-rejoined','child','재가입',1)`,
  ).run();
  const dayKey = new Date().toISOString().slice(0, 10);
  sqlite.prepare(
    "INSERT INTO storage_upload_family_daily_usage(family_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("family-a", dayKey, 200, 0, new Date().toISOString());

  const response = await request(
    db,
    new PhotosBucket(),
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-rejoined", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-rejoined",
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 429, await response.clone().text());
  const userUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_daily_usage WHERE user_id='child-rejoined' AND day_key=?",
  ).get(dayKey);
  assert.equal(Number(userUsage?.object_count ?? 0), 0);
  assert.equal(Number(userUsage?.byte_count ?? 0), 0);
});

test("legacy client-key 사진 업로드도 같은 가족 quota를 우회하지 못한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const dayKey = new Date().toISOString().slice(0, 10);
  sqlite.prepare(
    "INSERT INTO storage_upload_family_daily_usage(family_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run("family-a", dayKey, 200, 0, new Date().toISOString());
  const photos = new PhotosBucket();

  const response = await request(
    db,
    photos,
    "/api/storage/child-photos/family-a/memo-1720930000999-1.jpg",
    { sub: "child-a", role: "child", familyId: "family-a" },
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: JPEG },
  );
  assert.equal(response.status, 429, await response.clone().text());
  assert.equal(photos.objects.size, 0);
  const userUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_daily_usage WHERE user_id='child-a' AND day_key=?",
  ).get(dayKey);
  assert.equal(Number(userUsage?.object_count ?? 0), 0);
  assert.equal(Number(userUsage?.byte_count ?? 0), 0);
});

test("quota migration 누락은 업로드를 무제한 허용하지 않고 503으로 닫는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.exec("DROP TABLE storage_upload_daily_usage");
  const photos = new PhotosBucket();
  const response = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "storage_quota_unavailable" });
  assert.equal(photos.objects.size, 0);
});

test("가족 quota migration 누락도 user claim을 되돌리고 가족 업로드를 503으로 닫는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.exec("DROP TABLE storage_upload_family_daily_usage");
  const response = await request(
    db,
    new PhotosBucket(),
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 503, await response.clone().text());
  const usage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_daily_usage WHERE user_id='child-a'",
  ).get();
  assert.equal(Number(usage?.object_count ?? 0), 0);
  assert.equal(Number(usage?.byte_count ?? 0), 0);
});

test("가족 외 사용자는 대상 멤버 존재 여부를 응답으로 구분할 수 없다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.prepare("INSERT INTO users(id,is_anonymous) VALUES ('outsider-a',0)").run();
  const photos = new PhotosBucket();
  const outsider = { sub: "outsider-a", role: "parent", familyId: null };

  for (const targetMemberId of ["child-member-a", "missing-child-member"]) {
    const response = await request(
      db,
      photos,
      "/api/storage/child-photo-uploads/family-a",
      outsider,
      {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "X-Hyeni-Upload-Purpose": "memo",
          "X-Hyeni-Target-Member-Id": targetMemberId,
        },
        body: JPEG,
      },
    );
    assert.equal(response.status, 403, await response.text());

    const legacyProfile = await request(
      db,
      photos,
      `/api/storage/child-photos/family-a/${targetMemberId}-1720930000000.jpg`,
      outsider,
      { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: JPEG },
    );
    assert.equal(legacyProfile.status, 403, await legacyProfile.text());
  }
  assert.equal(photos.objects.size, 0);
});

test("R2 신규 업로드 실패는 저장 성공으로 오인하지 않고 재시도 가능한 503을 반환한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };
  const response = await request(
    db,
    new FailingPhotosBucket(),
    "/api/storage/child-photo-uploads/family-a",
    actor,
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "profile",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "storage_upload_failed" });
  const usage = sqlite.prepare(
    "SELECT object_count, byte_count FROM storage_upload_daily_usage WHERE user_id='parent-a'",
  ).get();
  assert.equal(usage?.object_count, 0);
  assert.equal(usage?.byte_count, 0);
  const familyUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_family_daily_usage WHERE family_id='family-a'",
  ).get();
  assert.equal(familyUsage?.object_count, 0);
  assert.equal(familyUsage?.byte_count, 0);
});

test("권한 해제가 PUT보다 먼저 끝나도 PII 대신 tombstone만 남기고 quota를 반환한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("before");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  await photos.putPaused;
  assert.equal(
    count(sqlite, "storage_invalid_upload_cleanup_jobs"),
    1,
    "R2 PUT 전에 crash-safe cleanup journal이 먼저 확정돼야 합니다",
  );

  // 최신 unpair endpoint는 child lease와 선형화되지만, 구 Worker·직접 D1 writer가
  // 권한을 바꾼 경우에도 post-PUT 방어가 객체와 quota를 회수해야 한다.
  sqlite.prepare(
    "UPDATE family_members SET is_active=0 WHERE family_id='family-a' AND user_id='child-a'",
  ).run();

  photos.resume();
  const uploadResponse = await uploadPromise;
  assert.equal(uploadResponse.status, 409, await uploadResponse.clone().text());
  assert.deepEqual(await uploadResponse.json(), { error: "storage_scope_changed" });
  const [objectKey] = photos.objects.keys();
  assertCleanupTombstone(photos, objectKey);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
});

test("PUT 저장 뒤 레거시 권한 해제가 교차해도 post-PUT 검증이 quota를 정확히 한 번 회수한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("after");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  await photos.putPaused;
  assert.equal(photos.objects.size, 1, "unpair scan 전에 R2 객체가 실제 저장돼야 합니다");

  sqlite.prepare(
    "UPDATE family_members SET is_active=0 WHERE family_id='family-a' AND user_id='child-a'",
  ).run();

  photos.resume();
  const uploadResponse = await uploadPromise;
  assert.equal(uploadResponse.status, 409, await uploadResponse.clone().text());
  assert.deepEqual(await uploadResponse.json(), { error: "storage_scope_changed" });
  const [objectKey] = photos.objects.keys();
  assertCleanupTombstone(photos, objectKey);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
});

test("multipart complete가 무제한 지연돼도 cleanup이 먼저면 늦은 파일 객체가 생기지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("before");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.putPaused;
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "complete");
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(photos.objects.has(objectKey), false, "cleanup 뒤 늦은 complete가 민감 객체를 만들면 안 됩니다");
});

test("createMultipart 반환 전 cleanup이면 늦은 attach가 실패하고 part를 올리지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingCreateMultipartPhotosBucket();
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.createPaused;
  const journal = sqlite.prepare(
    "SELECT multipart_upload_id FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
  ).get(objectKey);
  assert.equal(journal?.multipart_upload_id, null);
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "complete");

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(photos.objects.has(objectKey), false);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
});

test("legacy reservation 반환 전 cleanup은 create-only tombstone으로 늦은 marker를 차단한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const objectKey = "family-a/memo-1720930000199-19.jpg";
  const photos = new PausingReservationStartPhotosBucket();
  const dayKey = new Date().toISOString().slice(0, 10);
  sqlite.prepare(
    `INSERT INTO storage_upload_daily_usage(user_id,day_key,object_count,byte_count,updated_at)
     VALUES ('child-a',?,1,100,?)`,
  ).run(dayKey, new Date().toISOString());
  sqlite.prepare(
    `INSERT INTO storage_upload_family_daily_usage(family_id,day_key,object_count,byte_count,updated_at)
     VALUES ('family-a',?,1,100,?)`,
  ).run(dayKey, new Date().toISOString());
  const uploadPromise = request(
    db,
    photos,
    `/api/storage/child-photos/${objectKey}`,
    { sub: "child-a", role: "child", familyId: "family-a" },
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: JPEG },
  );
  await photos.startPaused;
  const firstCleanup = await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    String(sqlite.prepare(
      "SELECT upload_nonce FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
    ).get(objectKey).upload_nonce),
  );
  photos.resume();
  const response = await uploadPromise;

  assert.equal(firstCleanup, "complete", "HEAD null을 tombstone으로 선형화해 queue를 막지 않아야 합니다");
  assert.equal(response.status, 503, await response.clone().text());
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  const userUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_daily_usage WHERE user_id='child-a' AND day_key=?",
  ).get(dayKey);
  const familyUsage = sqlite.prepare(
    "SELECT object_count,byte_count FROM storage_upload_family_daily_usage WHERE family_id='family-a' AND day_key=?",
  ).get(dayKey);
  assert.equal(Number(userUsage.object_count), 1);
  assert.equal(Number(userUsage.byte_count), 100);
  assert.equal(Number(familyUsage.object_count), 1);
  assert.equal(Number(familyUsage.byte_count), 100);
});

test("legacy reservation attach 뒤 cleanup tombstone은 늦은 PII CAS writer를 영구 차단한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const objectKey = "family-a/memo-1720930000200-20.jpg";
  const photos = new PausingReservationDataPutPhotosBucket();
  const uploadPromise = request(
    db,
    photos,
    `/api/storage/child-photos/${objectKey}`,
    { sub: "child-a", role: "child", familyId: "family-a" },
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: JPEG },
  );
  await photos.dataPutPaused;
  const row = sqlite.prepare(
    `SELECT upload_nonce,reservation_etag,cleaned_at
       FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?`,
  ).get(objectKey);
  assert.ok(row.reservation_etag, "민감 데이터 PUT 전에 reservation ETag가 원장에 붙어야 합니다");

  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    String(row.upload_nonce),
  ), "complete");
  assertCleanupTombstone(photos, objectKey);
  photos.resume();

  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("attach 뒤 uploadPart 지연 중 cleanup abort가 이기면 complete와 객체 생성을 막는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingUploadPartPhotosBucket();
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.partPaused;
  const journal = sqlite.prepare(
    "SELECT multipart_upload_id FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
  ).get(objectKey);
  assert.match(String(journal?.multipart_upload_id ?? ""), /^multipart-/);
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "complete");

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(photos.objects.has(objectKey), false);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
});

test("정상 journal commit이 cleanup claim보다 먼저면 cleanup은 성공 객체를 건드리지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("after");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "profile",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.putPaused;
  const cleanupDb = new PausingCleanupClaimDb(db);
  const cleanupPromise = processStorageInvalidUploadCleanup(
    { DB: cleanupDb, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  );
  await cleanupDb.paused;

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 200, await response.clone().text());
  cleanupDb.resume();
  assert.equal(await cleanupPromise, "complete");
  assert.equal(photos.objects.has(objectKey), true, "200으로 확정된 객체를 뒤늦은 cleanup이 지우면 안 됩니다");
  assert.equal(photos.abortCalls, 0, "journal commit 뒤 cleanup은 R2 multipart를 건드리면 안 됩니다");
});

test("complete 뒤 cleanup claim이 먼저면 요청은 성공하지 않고 같은 nonce 객체를 회수한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("after");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "profile",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.putPaused;
  assert.equal(photos.objects.has(objectKey), true);
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "complete");

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='parent-a' AND object_count<>0"), 0);
});

test("abort와 HEAD가 일시 실패하면 job과 quota를 보존하고 재시도에서 정확히 한 번 정리한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new TransientCleanupPhotosBucket();
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.putPaused;
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "pending");
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"), 1);

  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "complete");
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assert.equal(photos.objects.has(objectKey), false);
});

test("generic abort 실패와 strong HEAD null은 완료 증거가 아니므로 pending을 유지한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new GenericAbortFailurePhotosBucket();
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  const objectKey = await photos.putPaused;
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    journalNonce(sqlite, objectKey),
  ), "pending");
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"), 1);

  photos.resume();
  const response = await uploadPromise;
  assert.equal(response.status, 503, await response.clone().text());
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
});

test("명시적 NoSuchUpload와 strong HEAD null이면 future complete가 없어 안전 종료한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/uploads/child-a/no-such-upload.jpg";
  const uploadNonce = "55555555-5555-4555-8555-555555555555";
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  assert.equal(await attachStorageUploadJournalMultipart(
    db,
    objectKey,
    uploadNonce,
    "missing-upload-id",
  ), true);

  const photos = new PhotosBucket();
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    uploadNonce,
  ), "complete");
  assert.equal(photos.objects.has(objectKey), false);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("자녀 업로드 lease와 공식 unpair는 선형화되어 완료된 업로드 객체를 후속 정리한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const photos = new PausingPutPhotosBucket("after");
  const uploadPromise = request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "child-a", role: "child", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "memo",
        "X-Hyeni-Target-Member-Id": "child-member-a",
      },
      body: JPEG,
    },
  );
  await photos.putPaused;

  const blockedUnpair = await request(
    db,
    photos,
    "/api/family/unpair",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: "family-a", child_user_id: "child-a" }),
    },
  );
  assert.equal(blockedUnpair.status, 409, await blockedUnpair.clone().text());
  assert.deepEqual(await blockedUnpair.json(), { error: "child_mutation_in_progress" });
  assert.equal(count(sqlite, "family_unpair_cleanup_jobs", "child_user_id='child-a'"), 0);

  photos.resume();
  const uploadResponse = await uploadPromise;
  assert.equal(uploadResponse.status, 200, await uploadResponse.clone().text());
  assert.equal(photos.objects.size, 1);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "committed_at IS NOT NULL"), 1);

  const completedUnpair = await request(
    db,
    photos,
    "/api/family/unpair",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: "family-a", child_user_id: "child-a" }),
    },
  );
  assert.equal(completedUnpair.status, 200, await completedUnpair.clone().text());
  assert.equal(photos.objects.size, 0, "후속 unpair가 완료된 업로드 객체를 회수해야 합니다");
  assert.equal(count(sqlite, "family_members", "user_id='child-a'"), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 0);
  assert.equal(
    count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"),
    1,
    "정상 완료된 업로드는 abuse 방지 일일 quota에 1회 남아야 합니다",
  );
});

test("선생님 첨부 lease가 먼저면 계정 삭제를 재시도로 닫고 후속 삭제가 객체까지 회수한다", async () => {
  const { sqlite, db } = createDb();
  const teacher = addTeacher(sqlite, "delete-race");
  const photos = new PausingPutPhotosBucket("before");
  const uploadPromise = request(
    db,
    photos,
    `/api/storage/teacher-notices/${teacher.userId}/race.pdf`,
    { sub: teacher.userId, role: "teacher", familyId: null },
    { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: PDF },
  );
  await photos.putPaused;
  assert.equal(
    count(sqlite, "storage_invalid_upload_cleanup_jobs"),
    1,
    "선생님 첨부도 R2 PUT 전에 cleanup journal을 확정해야 합니다",
  );

  const deletionResponse = await request(
    db,
    photos,
    "/api/account/delete",
    { sub: teacher.userId, role: "teacher", familyId: null },
    { method: "POST" },
  );
  assert.equal(deletionResponse.status, 409, await deletionResponse.clone().text());
  assert.deepEqual(await deletionResponse.json(), { error: "account_deletion_conflict" });

  photos.resume();
  const uploadResponse = await uploadPromise;
  assert.equal(uploadResponse.status, 200, await uploadResponse.clone().text());
  assert.equal(photos.objects.size, 1);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "committed_at IS NOT NULL"), 1);

  const deletionRetry = await request(
    db,
    photos,
    "/api/account/delete",
    { sub: teacher.userId, role: "teacher", familyId: null },
    { method: "POST" },
  );
  assert.equal(deletionRetry.status, 200, await deletionRetry.clone().text());
  assert.equal(photos.objects.size, 0);
  assert.equal(count(sqlite, "users", `id='${teacher.userId}'`), 0);
});

test("PUT 직후 Worker가 종료돼도 만료 journal이 같은 nonce 객체와 quota를 회수한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/uploads/child-a/crash.jpg";
  const uploadNonce = "11111111-1111-4111-8111-111111111111";
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  const photos = new PhotosBucket();
  await photos.put(objectKey, JPEG.buffer, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { uploadNonce },
  });

  const early = await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(now.getTime() + 6 * 60 * 1000),
  );
  assert.deepEqual(early, { processed: 0, pending: 0 });
  assert.equal(photos.objects.has(objectKey), true, "1시간 grace 안의 active PUT 객체를 cron이 지우면 안 됩니다");
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 1);

  const result = await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(now.getTime() + 61 * 60 * 1000),
  );
  assert.deepEqual(result, { processed: 1, pending: 0 });
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("pending journal과 nonce가 다른 기존 legacy 객체는 삭제하지 않고 quota만 반환한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/memo-1720930000000-1.jpg";
  const uploadNonce = "22222222-2222-4222-8222-222222222222";
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  const original = new Uint8Array([...JPEG, 0x41]);
  const photos = new PhotosBucket([{
    key: objectKey,
    bytes: original,
    contentType: "image/jpeg",
    customMetadata: { uploadNonce: "33333333-3333-4333-8333-333333333333" },
  }]);

  await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(now.getTime() + 61 * 60 * 1000),
  );
  assert.deepEqual([...photos.objects.get(objectKey).body], [...original]);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
});

test("stale cron이 고른 과거 nonce는 같은 키의 새 journal을 claim하지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/memo-1720930000999-99.jpg";
  const currentNonce = "66666666-6666-4666-8666-666666666666";
  const staleNonce = "77777777-7777-4777-8777-777777777777";
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce: currentNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
  }), "created");
  const photos = new PhotosBucket();
  await photos.put(objectKey, JPEG.buffer, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: { uploadNonce: currentNonce },
  });

  assert.equal(
    await processStorageInvalidUploadCleanup({ DB: db, PHOTOS: photos }, objectKey, staleNonce),
    "complete",
  );
  assert.equal(photos.objects.has(objectKey), true);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `upload_nonce='${currentNonce}'`), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"), 1);
});

test("R2 cleanup 실패 job은 quota를 먼저 풀지 않고 재시도 성공 뒤 정확히 한 번 반환한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/uploads/child-a/retry.jpg";
  const uploadNonce = "44444444-4444-4444-8444-444444444444";
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  const photos = new FailingDeletePhotosBucket([{
    key: objectKey,
    bytes: JPEG,
    contentType: "image/jpeg",
    customMetadata: { uploadNonce },
  }]);

  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    uploadNonce,
  ), "pending");
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"), 1);
  photos.failDelete = false;
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    uploadNonce,
  ), "complete");
  assert.equal(await processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    uploadNonce,
  ), "complete");
  assertCleanupTombstone(photos, objectKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("1시간 lease가 끝난 뒤 unpair가 완료되면 지연된 begin도 실제 활성 멤버 권한으로 차단한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  sqlite.prepare(
    `INSERT INTO account_mutation_leases(id,user_id,family_id,expires_at,created_at)
     VALUES ('expired-storage-lease','child-a','family-a','2000-01-01T01:00:00.000Z','2000-01-01T00:00:00.000Z')`,
  ).run();

  const unpair = await request(
    db,
    new PhotosBucket(),
    "/api/family/unpair",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ family_id: "family-a", child_user_id: "child-a" }),
    },
  );
  assert.equal(unpair.status, 200, await unpair.clone().text());
  assert.equal(count(sqlite, "family_members", "family_id='family-a' AND user_id='child-a'"), 0);
  assert.equal(count(sqlite, "account_mutation_leases", "id='expired-storage-lease'"), 0);

  const delayedBegin = await beginStorageUploadJournal(db, {
    objectKey: "family-a/uploads/child-a/delayed-after-unpair.jpg",
    uploadNonce: crypto.randomUUID(),
    claims: {
      user: { userId: "child-a", dayKey: "2026-07-14", byteCount: JPEG.byteLength },
      family: { familyId: "family-a", dayKey: "2026-07-14", byteCount: JPEG.byteLength },
    },
    authorization: { kind: "child_memo", targetMemberId: "child-member-a" },
  });
  assert.equal(delayedBegin, "conflict");
  assert.equal(pendingJournalCount(sqlite), 0);
});

test("40개 unattached reservation 뒤의 실제 PII cleanup도 다음 제한 배치에서 굶지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");

  for (let index = 0; index < 40; index += 1) {
    const quota = await claimStorageUploadQuotaScopes(db, {
      userId: "child-a",
      familyId: "family-a",
      byteCount: JPEG.byteLength,
      now,
    });
    assert.equal(quota.status, "claimed");
    const suffix = String(index).padStart(2, "0");
    assert.equal(await beginStorageUploadJournal(db, {
      objectKey: `family-a/a-reservation-${suffix}.jpg`,
      uploadNonce: crypto.randomUUID(),
      uploadProtocol: "reservation",
      claims: quota.claims,
      authorization: { kind: "family_member" },
      now,
    }), "created");
  }

  const piiQuota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(piiQuota.status, "claimed");
  const piiKey = "family-a/zz-sensitive-pii.jpg";
  const piiNonce = crypto.randomUUID();
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey: piiKey,
    uploadNonce: piiNonce,
    claims: piiQuota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  const photos = new PhotosBucket([{
    key: piiKey,
    bytes: JPEG,
    contentType: "image/jpeg",
    customMetadata: { uploadNonce: piiNonce },
  }]);

  const firstBatch = await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(now.getTime() + 61 * 60 * 1000),
  );
  assert.deepEqual(firstBatch, { processed: 40, pending: 0 });
  assert.equal(pendingJournalCount(sqlite, `object_key='${piiKey}'`), 1);
  assert.deepEqual([...photos.objects.get(piiKey).body], [...JPEG]);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count=1"), 1);

  const secondBatch = await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(now.getTime() + 61 * 60 * 1000),
  );
  assert.deepEqual(secondBatch, { processed: 1, pending: 0 });
  assertCleanupTombstone(photos, piiKey);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='child-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("실패한 storage cleanup은 1·5·15·30·60분 bounded backoff로 재예약한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now: createdAt,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/poison-backoff.jpg";
  const uploadNonce = crypto.randomUUID();
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    uploadProtocol: "multipart",
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now: createdAt,
  }), "created");
  assert.equal(await attachStorageUploadJournalMultipart(
    db,
    objectKey,
    uploadNonce,
    "poison-backoff-upload",
  ), true);

  const photos = new PoisonAbortPhotosBucket();
  const expectedMinutes = [1, 5, 15, 30, 60, 60];
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    for (const [index, minutes] of expectedMinutes.entries()) {
      const before = Date.now();
      assert.equal(
        await processStorageInvalidUploadCleanup({ DB: db, PHOTOS: photos }, objectKey, uploadNonce),
        "pending",
      );
      const after = Date.now();
      const row = sqlite.prepare(
        "SELECT attempts,cleanup_after FROM storage_invalid_upload_cleanup_jobs WHERE object_key=?",
      ).get(objectKey);
      assert.equal(Number(row.attempts), index + 1);
      const retryAt = Date.parse(String(row.cleanup_after));
      assert.ok(retryAt >= after + minutes * 60 * 1000 - 2_000);
      assert.ok(retryAt <= before + minutes * 60 * 1000 + 2_000);
    }
  } finally {
    console.error = originalConsoleError;
  }
});

test("앞 40개 abort 실패가 반복돼도 41번째 PII cleanup은 다음 cron에서 정리한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const firstCronAt = new Date();
  const poisonCreatedAt = new Date(firstCronAt.getTime() - 2 * 60 * 60 * 1000);
  const piiCreatedAt = new Date(poisonCreatedAt.getTime() + 60 * 1000);

  for (let index = 0; index < 40; index += 1) {
    const quota = await claimStorageUploadQuotaScopes(db, {
      userId: "child-a",
      familyId: "family-a",
      byteCount: JPEG.byteLength,
      now: poisonCreatedAt,
    });
    assert.equal(quota.status, "claimed");
    const suffix = String(index).padStart(2, "0");
    const objectKey = `family-a/poison-${suffix}.jpg`;
    const uploadNonce = crypto.randomUUID();
    assert.equal(await beginStorageUploadJournal(db, {
      objectKey,
      uploadNonce,
      uploadProtocol: "multipart",
      claims: quota.claims,
      authorization: { kind: "family_member" },
      now: poisonCreatedAt,
    }), "created");
    assert.equal(await attachStorageUploadJournalMultipart(
      db,
      objectKey,
      uploadNonce,
      `poison-upload-${suffix}`,
    ), true);
  }

  const piiQuota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now: piiCreatedAt,
  });
  assert.equal(piiQuota.status, "claimed");
  const piiKey = "family-a/sensitive-after-poison.jpg";
  const piiNonce = crypto.randomUUID();
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey: piiKey,
    uploadNonce: piiNonce,
    uploadProtocol: "multipart",
    claims: piiQuota.claims,
    authorization: { kind: "family_member" },
    now: piiCreatedAt,
  }), "created");
  assert.equal(await attachStorageUploadJournalMultipart(
    db,
    piiKey,
    piiNonce,
    "completed-pii-upload",
  ), true);
  const photos = new PoisonAbortPhotosBucket([{
    key: piiKey,
    bytes: JPEG,
    contentType: "image/jpeg",
    customMetadata: { uploadNonce: piiNonce },
  }]);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      await processPendingStorageInvalidUploadCleanups({ DB: db, PHOTOS: photos }, 40, firstCronAt),
      { processed: 0, pending: 40 },
    );
    assert.equal(pendingJournalCount(sqlite, `object_key='${piiKey}'`), 1);
    assert.deepEqual([...photos.objects.get(piiKey).body], [...JPEG]);

    assert.deepEqual(
      await processPendingStorageInvalidUploadCleanups(
        { DB: db, PHOTOS: photos },
        40,
        new Date(firstCronAt.getTime() + 61 * 1000),
      ),
      { processed: 1, pending: 39 },
    );
  } finally {
    console.error = originalConsoleError;
  }

  assertCleanupTombstone(photos, piiKey);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `object_key='${piiKey}' AND cleaned_at IS NOT NULL`), 1);
  assert.equal(photos.poisonAbortCalls, 79);
});

test("24시간 지난 terminal upload journal은 cron에서 정리하고 최신 terminal은 보존한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const createdAt = new Date("2026-07-14T01:00:00.000Z");
  const claims = {
    user: { userId: "child-a", dayKey: "2026-07-14", byteCount: JPEG.byteLength },
    family: { familyId: "family-a", dayKey: "2026-07-14", byteCount: JPEG.byteLength },
  };
  const keys = [
    "family-a/uploads/child-a/old-committed.jpg",
    "family-a/uploads/child-a/old-cleaned.jpg",
    "family-a/uploads/child-a/fresh-committed.jpg",
  ];
  for (const objectKey of keys) {
    assert.equal(await beginStorageUploadJournal(db, {
      objectKey,
      uploadNonce: crypto.randomUUID(),
      claims,
      authorization: { kind: "family_member" },
      now: createdAt,
    }), "created");
  }
  sqlite.prepare(
    "UPDATE storage_invalid_upload_cleanup_jobs SET committed_at='2026-07-13T00:00:00.000Z' WHERE object_key=?",
  ).run(keys[0]);
  sqlite.prepare(
    "UPDATE storage_invalid_upload_cleanup_jobs SET cleanup_started_at='2026-07-13T00:00:00.000Z',cleaned_at='2026-07-13T00:00:00.000Z' WHERE object_key=?",
  ).run(keys[1]);
  sqlite.prepare(
    "UPDATE storage_invalid_upload_cleanup_jobs SET committed_at='2026-07-15T00:30:00.000Z' WHERE object_key=?",
  ).run(keys[2]);

  assert.deepEqual(await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: new PhotosBucket() },
    40,
    new Date("2026-07-15T01:00:00.000Z"),
  ), { processed: 0, pending: 0 });
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `object_key='${keys[0]}'`), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `object_key='${keys[1]}'`), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `object_key='${keys[2]}'`), 1);
});

test("cleanup marker CAS 직후 다른 writer가 저장해도 cleanup은 그 객체를 무조건 삭제하지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const now = new Date("2026-07-14T01:00:00.000Z");
  const quota = await claimStorageUploadQuotaScopes(db, {
    userId: "child-a",
    familyId: "family-a",
    byteCount: JPEG.byteLength,
    now,
  });
  assert.equal(quota.status, "claimed");
  const objectKey = "family-a/uploads/child-a/cleanup-cas-race.jpg";
  const uploadNonce = crypto.randomUUID();
  assert.equal(await beginStorageUploadJournal(db, {
    objectKey,
    uploadNonce,
    claims: quota.claims,
    authorization: { kind: "family_member" },
    now,
  }), "created");
  const photos = new PausingCleanupMarkerPhotosBucket([{
    key: objectKey,
    bytes: JPEG,
    contentType: "image/jpeg",
    customMetadata: { uploadNonce },
  }]);

  const cleanupPromise = processStorageInvalidUploadCleanup(
    { DB: db, PHOTOS: photos },
    objectKey,
    uploadNonce,
  );
  await photos.markerWritten;
  const laterBytes = new Uint8Array([...JPEG, 0x7f]);
  const laterNonce = crypto.randomUUID();
  photos.objects.set(
    objectKey,
    storedObject(objectKey, laterBytes, "image/jpeg", { uploadNonce: laterNonce, storageState: "stored" }),
  );
  photos.resume();

  assert.equal(await cleanupPromise, "complete");
  assert.deepEqual([...photos.objects.get(objectKey).body], [...laterBytes]);
  assert.equal(photos.objects.get(objectKey).customMetadata.uploadNonce, laterNonce);
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "cleaned_at IS NOT NULL"), 1);
});

test("journal begin INSERT ACK가 유실돼도 exact nonce readback으로 quota를 이중 반환하지 않는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const lostAckDb = new LostJournalAckDb(db, "begin");
  const photos = new PhotosBucket();
  const response = await request(
    lostAckDb,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "profile",
        "X-Hyeni-Target-Member-Id": "child-member-a",
        "X-Hyeni-Upload-Request-Id": crypto.randomUUID(),
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(lostAckDb.didLoseAck, true);
  assert.equal(photos.objects.size, 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='parent-a' AND object_count=1"), 1);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count=1"), 1);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", "committed_at IS NOT NULL"), 1);
});

test("begin ACK와 readback이 함께 유실되면 PII를 쓰지 않고 quota를 cron 원장에 보존한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const ambiguousDb = new LostJournalAckDb(db, "begin", true);
  const photos = new PhotosBucket();
  const response = await request(
    ambiguousDb,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    { sub: "parent-a", role: "parent", familyId: "family-a" },
    {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg",
        "X-Hyeni-Upload-Purpose": "profile",
        "X-Hyeni-Target-Member-Id": "child-member-a",
        "X-Hyeni-Upload-Request-Id": crypto.randomUUID(),
      },
      body: JPEG,
    },
  );
  assert.equal(response.status, 503, await response.clone().text());
  assert.deepEqual(await response.json(), { error: "storage_journal_unavailable" });
  assert.equal(photos.objects.size, 0);
  assert.equal(pendingJournalCount(sqlite), 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='parent-a' AND object_count=1"), 1);
  const cleanupAfter = String(sqlite.prepare(
    "SELECT cleanup_after FROM storage_invalid_upload_cleanup_jobs LIMIT 1",
  ).get().cleanup_after);
  assert.deepEqual(await processPendingStorageInvalidUploadCleanups(
    { DB: db, PHOTOS: photos },
    40,
    new Date(Date.parse(cleanupAfter) + 1),
  ), { processed: 1, pending: 0 });
  assert.equal(pendingJournalCount(sqlite), 0);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='parent-a' AND object_count<>0"), 0);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count<>0"), 0);
});

test("commit ACK 유실 뒤 같은 request id 재시도는 동일 경로를 복구하고 quota를 한 번만 쓴다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const lostAckDb = new LostJournalAckDb(db, "commit", true);
  const photos = new PhotosBucket();
  const requestId = crypto.randomUUID();
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
      "X-Hyeni-Upload-Purpose": "profile",
      "X-Hyeni-Target-Member-Id": "child-member-a",
      "X-Hyeni-Upload-Request-Id": requestId,
    },
    body: JPEG,
  };
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };

  const first = await request(
    lostAckDb,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    actor,
    init,
  );
  assert.equal(first.status, 503, await first.clone().text());
  assert.deepEqual(await first.json(), { error: "storage_commit_unavailable" });
  assert.equal(lostAckDb.didLoseAck, true);
  const firstPath = String(sqlite.prepare(
    "SELECT object_key FROM storage_invalid_upload_cleanup_jobs WHERE request_id=?",
  ).get(requestId).object_key);
  assert.equal(photos.objects.has(firstPath), true);

  const retry = await request(
    db,
    photos,
    "/api/storage/child-photo-uploads/family-a",
    actor,
    init,
  );
  assert.equal(retry.status, 200, await retry.clone().text());
  assert.equal((await retry.json()).path, firstPath);
  assert.equal(photos.objects.size, 1);
  assert.equal(count(sqlite, "storage_upload_daily_usage", "user_id='parent-a' AND object_count=1"), 1);
  assert.equal(count(sqlite, "storage_upload_family_daily_usage", "family_id='family-a' AND object_count=1"), 1);
  assert.equal(count(sqlite, "storage_invalid_upload_cleanup_jobs", `request_id='${requestId}' AND committed_at IS NOT NULL`), 1);
});

test("선생님 첨부도 같은 사용자 일일 byte quota를 적용한다", async () => {
  const { sqlite, db } = createDb();
  const teacher = addTeacher(sqlite, "quota");
  const dayKey = new Date().toISOString().slice(0, 10);
  sqlite.prepare(
    "INSERT INTO storage_upload_daily_usage(user_id,day_key,object_count,byte_count,updated_at) VALUES (?,?,?,?,?)",
  ).run(teacher.userId, dayKey, 0, 256 * 1024 * 1024 - PDF.length + 1, new Date().toISOString());
  const photos = new PhotosBucket();
  const response = await request(
    db,
    photos,
    `/api/storage/teacher-notices/${teacher.userId}/quota.pdf`,
    { sub: teacher.userId, role: "teacher", familyId: null },
    { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: PDF },
  );
  assert.equal(response.status, 429, await response.clone().text());
  assert.match(response.headers.get("Retry-After") ?? "", /^\d+$/);
  assert.equal(photos.objects.size, 0);
});

test("가족 없는 선생님 첨부는 family quota 테이블과 무관하게 owner user quota만 사용한다", async () => {
  const { sqlite, db } = createDb();
  const teacher = addTeacher(sqlite, "owner-scope");
  sqlite.exec("DROP TABLE storage_upload_family_daily_usage");
  const photos = new PhotosBucket();
  const response = await request(
    db,
    photos,
    `/api/storage/teacher-notices/${teacher.userId}/owner.pdf`,
    { sub: teacher.userId, role: "teacher", familyId: null },
    { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: PDF },
  );
  assert.equal(response.status, 200, await response.clone().text());
  assert.ok(photos.objects.has(`teacher-notices/${teacher.userId}/owner.pdf`));
});

test("선생님 알림장 publish는 호출자 prefix·R2 존재·실제 MIME/size를 검증한다", async () => {
  const { sqlite, db } = createDb();
  const teacherA = addTeacher(sqlite, "a");
  addTeacher(sqlite, "b");
  const photos = new PhotosBucket([
    { key: "teacher-notices/teacher-a/valid.pdf", bytes: PDF, contentType: "application/pdf" },
    { key: "teacher-notices/teacher-b/foreign.pdf", bytes: PDF, contentType: "application/pdf" },
  ]);
  const actor = { sub: teacherA.userId, role: "teacher", familyId: null };
  const base = {
    class_id: teacherA.classId,
    title: "알림장",
    body: "내용",
    source_type: "photo",
    events: [],
  };

  const foreign = await request(db, photos, "/api/teacher/notices", actor, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      attachments: [{ name: "foreign.pdf", path: "teacher-notices/teacher-b/foreign.pdf", contentType: "application/pdf", size: PDF.length }],
    }),
  });
  assert.equal(foreign.status, 403);

  const missing = await request(db, photos, "/api/teacher/notices", actor, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      attachments: [{ name: "missing.pdf", path: "teacher-notices/teacher-a/missing.pdf", contentType: "application/pdf", size: 1 }],
    }),
  });
  assert.equal(missing.status, 400);

  const valid = await request(db, photos, "/api/teacher/notices", actor, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      attachments: [{ name: "valid.pdf", path: "teacher-notices/teacher-a/valid.pdf", contentType: "image/png", size: 1 }],
    }),
  });
  assert.equal(valid.status, 200, await valid.text());
  const persisted = JSON.parse(sqlite.prepare("SELECT attachments FROM teacher_notices ORDER BY created_at DESC LIMIT 1").get().attachments);
  assert.deepEqual(persisted, [{
    name: "valid.pdf",
    path: "teacher-notices/teacher-a/valid.pdf",
    contentType: "application/pdf",
    size: PDF.length,
  }]);
  assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM teacher_notices").get().count), 1);
});

test("알림장 첨부 조회는 JSON path 정확 일치만 허용하고 부분문자열 IDOR를 막는다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const teacherA = addTeacher(sqlite, "a");
  sqlite.prepare(
    `INSERT INTO teacher_notices
      (id,teacher_id,class_id,title,body,source_type,has_schedule,attachments,created_at,updated_at)
      VALUES ('notice-a',?,?, '알림','내용','photo',0,?,'2026-07-14','2026-07-14')`,
  ).run(
    teacherA.teacherId,
    teacherA.classId,
    JSON.stringify([{ name: "attachment", path: "teacher-notices/teacher-a/file.pdf.bak" }]),
  );
  sqlite.prepare(
    `INSERT INTO teacher_notice_recipients
      (id,notice_id,child_member_id,family_id,event_ids,read_by,created_at)
      VALUES ('recipient-a','notice-a','child-member-a','family-a','{}','{}','2026-07-14')`,
  ).run();
  const photos = new PhotosBucket([
    { key: "teacher-notices/teacher-a/file.pdf", bytes: PDF, contentType: "application/pdf" },
    { key: "teacher-notices/teacher-a/file.pdf.bak", bytes: PDF, contentType: "application/pdf" },
  ]);
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };

  const substring = await request(
    db, photos, "/api/storage/teacher-notices/teacher-a/file.pdf", actor,
  );
  assert.equal(substring.status, 403);

  const exact = await request(
    db, photos, "/api/storage/teacher-notices/teacher-a/file.pdf.bak", actor,
  );
  assert.equal(exact.status, 200, await exact.text());
});

test("선생님 첨부 업로드도 HTML·SVG·MIME 위장을 거부하고 실제 PDF만 저장한다", async () => {
  const { sqlite, db } = createDb();
  const teacherA = addTeacher(sqlite, "a");
  const actor = { sub: teacherA.userId, role: "teacher", familyId: null };
  const photos = new PhotosBucket();
  const cases = [
    ["html.html", "text/html", new TextEncoder().encode("<script>alert(1)</script>")],
    ["svg.svg", "image/svg+xml", new TextEncoder().encode("<svg><script>alert(1)</script></svg>")],
    ["spoof.pdf", "application/pdf", JPEG],
  ];
  for (const [name, contentType, body] of cases) {
    const response = await request(
      db,
      photos,
      `/api/storage/teacher-notices/teacher-a/${name}`,
      actor,
      { method: "PUT", headers: { "Content-Type": contentType }, body },
    );
    assert.equal(response.status, 415, String(name));
  }
  const valid = await request(
    db,
    photos,
    "/api/storage/teacher-notices/teacher-a/valid.pdf",
    actor,
    { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: PDF },
  );
  assert.equal(valid.status, 200, await valid.text());
  assert.equal(photos.objects.get("teacher-notices/teacher-a/valid.pdf")?.httpMetadata.contentType, "application/pdf");

  const original = [...photos.objects.get("teacher-notices/teacher-a/valid.pdf").body];
  const overwrite = await request(
    db,
    photos,
    "/api/storage/teacher-notices/teacher-a/valid.pdf",
    actor,
    { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array([...PDF, 0x20]) },
  );
  assert.equal(overwrite.status, 409, await overwrite.text());
  assert.deepEqual(
    [...photos.objects.get("teacher-notices/teacher-a/valid.pdf").body],
    original,
    "이미 발송될 수 있는 알림장 첨부는 같은 키로 교체되면 안 됩니다",
  );
});

test("legacy 비허용 R2 MIME은 실행하지 않고 attachment로 강등하며 모든 응답에 nosniff를 설정한다", async () => {
  const { sqlite, db } = createDb();
  addFamily(sqlite);
  const teacherA = addTeacher(sqlite, "a");
  sqlite.prepare(
    `INSERT INTO teacher_notices
      (id,teacher_id,class_id,title,body,source_type,has_schedule,attachments,created_at,updated_at)
      VALUES ('notice-legacy',?,?, '알림','내용','photo',0,?,'2026-07-14','2026-07-14')`,
  ).run(
    teacherA.teacherId,
    teacherA.classId,
    JSON.stringify([{ name: "legacy", path: "teacher-notices/teacher-a/legacy.svg" }]),
  );
  sqlite.prepare(
    `INSERT INTO teacher_notice_recipients
      (id,notice_id,child_member_id,family_id,event_ids,read_by,created_at)
      VALUES ('recipient-legacy','notice-legacy','child-member-a','family-a','{}','{}','2026-07-14')`,
  ).run();
  const photos = new PhotosBucket([
    {
      key: "family-a/legacy.html",
      bytes: new TextEncoder().encode("<script>location='https://evil.test/?t='+location.search</script>"),
      contentType: "text/html",
    },
    {
      key: "family-a/valid.jpg",
      bytes: JPEG,
      contentType: "image/jpeg",
    },
    {
      key: "teacher-notices/teacher-a/legacy.svg",
      bytes: new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
      contentType: "image/svg+xml",
    },
  ]);
  const actor = { sub: "parent-a", role: "parent", familyId: "family-a" };

  for (const path of [
    "/api/storage/child-photos/family-a/legacy.html",
    "/api/storage/teacher-notices/teacher-a/legacy.svg",
  ]) {
    const response = await request(db, photos, path, actor);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(response.headers.get("content-disposition"), "attachment");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }

  const valid = await request(db, photos, "/api/storage/child-photos/family-a/valid.jpg", actor);
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("content-type"), "image/jpeg");
  assert.equal(valid.headers.get("x-content-type-options"), "nosniff");
  assert.equal(valid.headers.get("cache-control"), "private, no-store");
});
