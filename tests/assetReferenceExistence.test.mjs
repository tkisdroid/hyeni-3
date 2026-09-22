/**
 * `asset("…")` 로 참조하는 정적 파일이 실제로 있는지 전수 확인한다.
 *
 * 왜 필요한가: 없는 경로는 빌드·typecheck·기존 테스트를 모두 통과한다. 화면에서는
 * 컨테이너 크기만큼의 **깨진 이미지 상자**가 그려진다. 2026-08-25 A17 실기기에서
 * 히어로 소식 슬라이드가 `ui/clay/book.webp`·`ui/clay/star.webp` 를 가리켜
 * 히어로 오른쪽에 128×146 빈 상자가 노출됐고, DOM 텍스트만 보는 CDP 스모크는 이를 놓쳤다.
 *
 * 정적 리터럴만 검사한다. 런타임에 조립되는 경로(`asset(variable)`)는 여기서 판정할 수 없으므로
 * 그런 호출이 있으면 목록으로 보고해 사람이 직접 확인하게 한다.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const publicAssets = join(repoRoot, "public", "assets");

function collectSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!entry.isFile()) return [];
    return /\.(?:tsx?|mts|mjs)$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  });
}

const sources = collectSources(join(repoRoot, "src"));

test("asset() 정적 참조는 public/assets 에 실제로 존재한다", () => {
  const missing = [];
  let checked = 0;

  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\basset\(\s*(["'`])([^"'`$\n]+)\1/g)) {
      const reference = match[2];
      checked += 1;
      if (existsSync(join(publicAssets, reference))) continue;
      const line = source.slice(0, match.index).split("\n").length;
      missing.push(`${relative(repoRoot, path).replaceAll("\\", "/")}:${line} → assets/${reference}`);
    }
  }

  assert.ok(checked > 50, `asset() 참조를 ${checked}건만 찾았습니다 — 스캐너가 깨졌는지 확인해 주세요.`);
  assert.deepEqual(missing, [], `존재하지 않는 정적 에셋 ${missing.length}건:\n${missing.join("\n")}`);
});

test("히어로 소식 슬라이드는 실제 마스코트 이미지를 쓴다", () => {
  // 캐러셀은 히어로 자리라서 깨진 이미지가 첫 화면에 그대로 보인다 — 개별로도 못박는다.
  const component = readFileSync(join(repoRoot, "src/components/ParentHomeHeroCarousel.tsx"), "utf8");
  const images = [...component.matchAll(/image:\s*"([^"]+)"/g)].map(([, value]) => value);
  assert.equal(images.length, 2, "소식 슬라이드 이미지가 2개여야 합니다");
  for (const image of images) {
    assert.ok(existsSync(join(publicAssets, image)), `assets/${image} 가 없습니다`);
  }
});

test("표에서 조립되는 icon 필드도 public/assets 에 실제로 존재한다", () => {
  // 이런 아이콘은 표에 `icon: "…"` 로 적히고 화면이 `asset(option.icon)` 로 조립하므로
  // 위 정적 스캐너가 잡지 못한다. 2026-09-22 R3CN400MGNW 실기기 E2E 에서 피드백
  // '사용 방법 질문' 타일만 깨진 상자로 보였고(naturalWidth 0 · settings-faq.svg 404 3회),
  // DOM 텍스트만 보는 CDP 스모크는 통과했다. 같은 실수를 한 파일에 묶어 막지 않는다 —
  // src 전체를 훑어 새 표가 생겨도 자동으로 걸리게 한다.
  const missing = [];
  let checked = 0;
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\bicon:\s*"([^"]+)"/g)) {
      const reference = match[1];
      checked += 1;
      const line = source.slice(0, match.index).split("\n").length;
      const where = `${relative(repoRoot, path).replaceAll("\\", "/")}:${line}`;
      if (reference.endsWith(".svg")) {
        missing.push(`${where} → SVG 원본이 아니라 webp 슬러그를 씁니다: assets/${reference}`);
        continue;
      }
      if (existsSync(join(publicAssets, reference))) continue;
      missing.push(`${where} → assets/${reference}`);
    }
  }
  // 표가 줄어 스캐너가 무력해지면 통과처럼 보인다 — 하한을 둔다.
  assert.ok(checked >= 20, `icon: 참조를 ${checked}건만 찾았습니다 — 스캐너가 깨졌는지 확인해 주세요.`);
  assert.deepEqual(missing, [], `존재하지 않는 icon 자산 ${missing.length}건:\n${missing.join("\n")}`);
});

// 참고: 런타임에 조립되는 `asset(변수)` 경로는 여기서 판정하지 않는다. 그런 경로는 각 기능이
// 자기 자산 목록 테스트로 지킨다(AI 친구 표정 = tests/aiBuddyCharacterAssets.test.mjs,
// 3D 아이콘 = tests/iconConsistency.test.mjs, 장소 이미지 = resolvePlaceVisual 정적 매핑).
