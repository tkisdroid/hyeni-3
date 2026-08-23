import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const poseDir = fileURLToPath(new URL("../public/assets/ai-buddy/poses/", import.meta.url));

const expectedPoses = [
  "welcome",
  "polite",
  "heart-hug",
  "jump",
  "crown",
  "thinking",
  "tablet",
  "idea",
  "headphones",
  "explore",
  "rush",
  "peek",
  "sleep",
  "heart-send",
  "expecting",
  "worried",
  "thumbs-up",
  "rocket",
];

async function webpNames() {
  try {
    return (await readdir(poseDir))
      .filter((name) => name.endsWith(".webp"))
      .toSorted();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

test("3D AI 친구 18개 포즈가 투명하고 선명한 모바일 자산으로 준비된다", async () => {
  const names = await webpNames();
  assert.deepEqual(names, expectedPoses.map((pose) => `${pose}.webp`).toSorted());

  let totalBytes = 0;
  for (const name of names) {
    const file = `${poseDir}/${name}`;
    const [{ size }, metadata, { data, info }] = await Promise.all([
      stat(file),
      sharp(file).metadata(),
      sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    totalBytes += size;

    assert.equal(metadata.format, "webp", `${name}: WebP가 아니다`);
    assert.equal(metadata.width, 320, `${name}: 가로 크기가 다르다`);
    assert.equal(metadata.height, 320, `${name}: 세로 크기가 다르다`);
    assert.equal(metadata.hasAlpha, true, `${name}: 투명 배경이 아니다`);
    assert.ok(size >= 8 * 1024, `${name}: 디테일이 지나치게 압축됐다(${size}B)`);
    assert.ok(size <= 80 * 1024, `${name}: 모바일 자산 상한을 넘었다(${size}B)`);

    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
    for (const [x, y] of [[0, 0], [319, 0], [0, 319], [319, 319]]) {
      assert.equal(alphaAt(x, y), 0, `${name}: 모서리 배경이 투명하지 않다`);
    }

    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (alphaAt(x, y) <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    assert.ok(maxX >= minX && maxY >= minY, `${name}: 보이는 캐릭터가 없다`);
    const longestVisibleSide = Math.max(maxX - minX + 1, maxY - minY + 1) / info.width;
    assert.ok(longestVisibleSide >= 0.84, `${name}: 캐릭터가 너무 작다(${longestVisibleSide})`);
    assert.ok(longestVisibleSide <= 0.92, `${name}: 캐릭터가 잘릴 위험이 있다(${longestVisibleSide})`);
  }

  assert.ok(totalBytes <= 1_100 * 1024, `18종 합계가 너무 크다(${totalBytes}B)`);

  const manifest = await readFile(`${poseDir}/manifest.txt`, "utf8");
  for (const pose of expectedPoses) {
    assert.match(manifest, new RegExp(`^${pose}\\t`, "m"), `${pose}: manifest 누락`);
  }
});
