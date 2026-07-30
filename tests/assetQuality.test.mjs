import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(rootDir, "public");

const NORMALIZED_ASSETS = [
  "assets/status/safe.webp",
  "assets/place/apartment.webp",
  "assets/place/church.webp",
  "assets/place/hospital.webp",
  "assets/place/library.webp",
  "assets/place/mart.webp",
  "assets/place/park.webp",
  "assets/ui/battery.webp",
  "assets/ui/clock-3d.webp",
  "assets/ui/lock-open-3d.webp",
  "assets/ui/wifi-3d.webp",
];

const UNUSED_PRECACHE_ASSETS = [
  "assets/family/daughter.webp",
  "assets/status/busy.webp",
  "assets/status/danger.webp",
  "assets/status/happy.webp",
  "assets/status/late.webp",
  "assets/status/love.webp",
  "assets/status/scheduled.webp",
  "assets/ui/gift.webp",
  "assets/ui/pin-lavender.webp",
  "assets/ui/place-frequent.webp",
  "assets/ui/rainbow.webp",
  "pwa-180x180.png",
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function alphaBounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] <= 10) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(maxX >= 0 && maxY >= 0, `${relative(rootDir, file)} 피사체가 비어 있음`);
  return {
    widthRatio: (maxX - minX + 1) / info.width,
    heightRatio: (maxY - minY + 1) / info.height,
    cornerAlpha: [
      data[3],
      data[(info.width - 1) * 4 + 3],
      data[((info.height - 1) * info.width) * 4 + 3],
      data[(info.width * info.height - 1) * 4 + 3],
    ],
  };
}

test("사용 중 장소·안전 자산은 512px 투명 캔버스와 72~90% optical bbox를 쓴다", async () => {
  for (const assetPath of NORMALIZED_ASSETS) {
    const file = resolve(publicDir, assetPath);
    assert.ok(existsSync(file), `${assetPath} 누락`);
    const metadata = await sharp(file).metadata();
    assert.equal(metadata.width, 512, `${assetPath} width`);
    assert.equal(metadata.height, 512, `${assetPath} height`);
    assert.equal(metadata.hasAlpha, true, `${assetPath} alpha 누락`);
    const bounds = await alphaBounds(file);
    const opticalRatio = Math.max(bounds.widthRatio, bounds.heightRatio);
    assert.ok(
      opticalRatio >= 0.72 && opticalRatio <= 0.9,
      `${assetPath} optical bbox ${(opticalRatio * 100).toFixed(1)}%`,
    );
    assert.deepEqual(bounds.cornerAlpha, [0, 0, 0, 0], `${assetPath} 모서리가 투명하지 않음`);
  }
});

test("정적 이미지에는 SHA-256 완전 중복 파일이 없다", () => {
  const byHash = new Map();
  for (const file of walk(publicDir)) {
    if (!new Set([".webp", ".png", ".svg"]).has(extname(file).toLowerCase())) continue;
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    const paths = byHash.get(hash) ?? [];
    paths.push(relative(publicDir, file).replaceAll("\\", "/"));
    byHash.set(hash, paths);
  }
  const duplicates = [...byHash.values()].filter((paths) => paths.length > 1);
  assert.deepEqual(duplicates, [], `중복 이미지:\n${duplicates.map((paths) => paths.join(" = ")).join("\n")}`);
});

test("미사용 12개 자산은 PWA precache에서 제외되고 앱 소스가 참조하지 않는다", () => {
  const viteConfig = readFileSync(resolve(rootDir, "vite.config.ts"), "utf8");
  const sourceBody = walk(resolve(rootDir, "src"))
    .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  for (const assetPath of UNUSED_PRECACHE_ASSETS) {
    assert.match(viteConfig, new RegExp(assetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${assetPath} globIgnore 누락`);
    const sourcePath = assetPath.replace(/^assets\//, "");
    assert.equal(sourceBody.includes(sourcePath), false, `${sourcePath} 앱 참조가 남아 있음`);
  }
});

test("장소 관리 이미지는 menu-place-manager 한 정본만 사용한다", () => {
  const visual = readFileSync(resolve(rootDir, "src/transform/placeVisual.ts"), "utf8");
  const manager = readFileSync(resolve(rootDir, "src/screens/feature/PlaceManager.tsx"), "utf8");
  assert.doesNotMatch(`${visual}\n${manager}`, /ui\/place-frequent\.webp/);
  // 메뉴 타일·히어로는 menu-place-manager 를 쓰고, 목록의 미매칭 장소는 중립 핀을 쓴다
  // (지도+톱니 아이콘이 목록에서 '설정'처럼 읽히고 여러 행에 반복돼 미완성처럼 보였다).
  assert.match(manager, /ui\/menu-place-manager\.webp/);
  assert.match(visual, /ui\/pin\.webp/);
  assert.doesNotMatch(visual, /ui\/menu-place-manager\.webp/);
});

test("manifest 필수 PWA 아이콘은 삭제·precache 제외하지 않는다", () => {
  const viteConfig = readFileSync(resolve(rootDir, "vite.config.ts"), "utf8");
  for (const icon of [
    "apple-touch-icon.png",
    "favicon-32x32.png",
    "pwa-192x192.png",
    "pwa-512x512.png",
    "pwa-maskable-512x512.png",
  ]) {
    assert.ok(existsSync(resolve(publicDir, icon)), `${icon} 누락`);
    assert.match(viteConfig, new RegExp(icon.replaceAll(".", "\\.")), `${icon} manifest/includeAssets 누락`);
  }
});
