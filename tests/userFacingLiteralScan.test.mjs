/**
 * 사용자 노출 literal 게이트 회귀.
 *
 * 두 가지를 함께 지킨다.
 *  ① 저장소 전체에 allowlist 밖 위반이 0이다(새 원문 문구가 조용히 들어오지 못한다).
 *  ② 게이트 자체가 동작한다 — 심어 둔 위반을 잡고, 모듈을 건너 흐르는 값을 추적하고,
 *    message API 를 거친 값은 통과시키고, 쓰이지 않는 allowlist 항목은 실패시킨다.
 *
 * ①만 검사하면 스캐너가 아무것도 못 잡는 상태로 퇴행해도 초록으로 보인다.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditUserFacingLiterals,
  isLinguisticCopy,
  scanUserFacingLiterals,
} from "../scripts/i18n/scan-user-facing-literals.mjs";

const ALLOWED_REASON_PREFIX = /^(?:data|protocol|brand|bootstrap|accessibility|admin|legal|dev|universal):/;

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "hyeni-literal-scan-"));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, source, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function findingKinds(findings) {
  return findings.map((finding) => `${finding.kind}:${finding.snippet}`);
}

test("저장소 전체에 allowlist 밖 사용자 노출 literal 위반이 없다", async () => {
  const { errors, violations } = await auditUserFacingLiterals();
  assert.deepEqual(
    violations.map((violation) => `${violation.file}:${violation.line}:${violation.snippet}`),
    [],
    "catalog 밖 사용자 노출 문구가 새로 들어왔습니다. locale JSON 으로 옮기거나 사유와 함께 allowlist 에 등록하세요.",
  );
  assert.deepEqual(errors, [], errors.join("\n"));
});

test("allowlist 는 모든 항목에 경로·정규식·횟수·상태·사유를 요구한다", async () => {
  const allowlist = JSON.parse(
    await (await import("node:fs/promises")).readFile(
      new URL("../scripts/i18n/user-facing-literal-allowlist.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(allowlist) && allowlist.length > 0);
  for (const entry of allowlist) {
    assert.equal(typeof entry.path, "string", JSON.stringify(entry));
    assert.match(entry.path, /^src\/.+\.tsx?$/);
    assert.equal(typeof entry.pattern, "string");
    assert.doesNotThrow(() => new RegExp(entry.pattern));
    assert.ok(Number.isInteger(entry.occurrences) && entry.occurrences >= 1);
    assert.ok(["exempt", "pending-migration"].includes(entry.status), entry.status);
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.reason.trim().length > 0);
    if (entry.status === "exempt") {
      // 영구 면제는 "왜 번역 대상이 아닌가"를 분류 접두어로 밝혀야 한다.
      assert.match(entry.reason, ALLOWED_REASON_PREFIX);
      assert.equal(entry.plan, undefined, "면제 항목에 계획 참조를 붙이지 않는다");
      assert.equal(entry.migrateTo, undefined);
    } else {
      // 이관 잔여는 면제가 아니다 — 어디로 옮길지와 어느 계획이 책임지는지 남긴다.
      assert.doesNotMatch(entry.reason, ALLOWED_REASON_PREFIX, "이관 잔여를 면제 사유로 위장하지 않는다");
      assert.match(String(entry.plan), /^docs\/.+\.md$/);
      assert.ok(String(entry.migrateTo).trim().length > 0);
    }
  }
});

test("사용자 표시 문구 판정은 한국어·다국어 문장과 기계 식별자를 구분한다", () => {
  for (const copy of ["꾹 누르면 바로 말할 수 있어!", "오늘 받았어", "Hyeni Calendar", "Premium", "今日の安心レポート"]) {
    assert.equal(isLinguisticCopy(copy), true, copy);
  }
  for (const code of [
    "not_arrived",
    "standalone",
    "portrait",
    "REQUEST_LOCATION",
    "assets/ui/sos-shield.webp",
    "https://hyeni-calendar.pages.dev",
    "kdock__tab hy-press",
    "16px",
    "",
    "·",
  ]) {
    assert.equal(isLinguisticCopy(code), false, code);
  }
});

test("스캐너는 JSX text·문구 attribute·표시 sink 의 원문 literal을 잡는다", async () => {
  await withFixture({
    "src/Screen.tsx": `
export function Screen({ show }: { show: (message: string) => void }) {
  return (
    <div>
      원문 제목
      <button type="button" aria-label="닫기" onClick={() => show("저장하지 못했어요")}>
        <img src="/x.webp" alt="" className="icon" />
      </button>
      <input placeholder="이름을 입력해 주세요" />
    </div>
  );
}
`,
  }, async (root) => {
    const { findings } = await scanUserFacingLiterals(root);
    const kinds = findingKinds(findings);
    assert.ok(kinds.some((entry) => entry.startsWith("jsx_text:")), kinds.join("\n"));
    assert.equal(kinds.filter((entry) => entry.startsWith("jsx_attribute:")).length, 2, kinds.join("\n"));
    assert.ok(kinds.some((entry) => entry.startsWith("display_sink:")), kinds.join("\n"));
    // 기계용 속성(className·src)과 빈 alt 는 문구가 아니다.
    assert.ok(!kinds.some((entry) => entry.includes("className")), kinds.join("\n"));
  });
});

test("스캐너는 모듈 세 개를 건너 흐르는 원문 문구를 추적한다", async () => {
  await withFixture({
    "src/transform/hint.ts": `export const HINT_LINE = "꾹 누르면 바로 말할 수 있어!";\n`,
    "src/transform/prompt.ts": `
import { HINT_LINE } from "./hint.ts";
export function resolveBubbleLine(voiceHint: boolean): string | null {
  return voiceHint ? HINT_LINE : null;
}
`,
    "src/app/Fab.tsx": `
import { resolveBubbleLine } from "@/transform/prompt";
export function Fab({ voiceHint }: { voiceHint: boolean }) {
  const bubbleLine = resolveBubbleLine(voiceHint);
  return <span>{bubbleLine}</span>;
}
`,
  }, async (root) => {
    const { findings } = await scanUserFacingLiterals(root);
    assert.deepEqual(
      findings.map((finding) => `${finding.file}:${finding.kind}`),
      ["src/app/Fab.tsx:jsx_child_expression"],
      JSON.stringify(findings, null, 2),
    );
  });
});

test("스캐너는 message API 를 거친 값과 사용자 데이터를 통과시킨다", async () => {
  await withFixture({
    "src/Screen.tsx": `
import { useIntl } from "react-intl";
export function Screen({ childName }: { childName: string }) {
  const intl = useIntl();
  return (
    <div>
      <span>{intl.formatMessage({ id: "core.brand.name" })}</span>
      <span aria-label={intl.formatMessage({ id: "core.action.retry" })}>{childName}</span>
    </div>
  );
}
`,
  }, async (root) => {
    const { findings } = await scanUserFacingLiterals(root);
    assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
  });
});

test("스캐너는 조건 렌더의 조건식과 사용자 데이터 속성을 오탐하지 않는다", async () => {
  await withFixture({
    "src/transform/view.ts": `
export interface EventView { title: string; tagLabel: string }
export function eventToView(event: { title: string }): EventView {
  return { title: event.title, tagLabel: "진행 중" };
}
`,
    "src/Screen.tsx": `
import { eventToView } from "@/transform/view";
export function Screen({ event }: { event: { title: string } | null }) {
  const view = event ? eventToView(event) : null;
  const hasError = false;
  return (
    <div>
      {hasError && <span>{view?.title}</span>}
      {view ? <strong>{view.title}</strong> : null}
    </div>
  );
}
`,
  }, async (root) => {
    const { findings } = await scanUserFacingLiterals(root);
    assert.deepEqual(
      findings.map((finding) => `${finding.file}:${finding.snippet}`),
      [],
      JSON.stringify(findings, null, 2),
    );
  });
});

test("쓰이지 않는 allowlist 항목과 초과 사용은 실패한다", async () => {
  await withFixture({
    "src/Screen.tsx": `export function Screen() { return <div aria-label="닫기" />; }\n`,
    "scripts/i18n/user-facing-literal-allowlist.json": JSON.stringify([
      {
        path: "src/Screen.tsx",
        pattern: "aria-label",
        occurrences: 3,
        status: "exempt",
        reason: "data: 시험용",
      },
      {
        path: "src/Missing.tsx",
        pattern: "없는 파일",
        occurrences: 1,
        status: "exempt",
        reason: "data: 시험용",
      },
    ]),
  }, async (root) => {
    const { errors } = await auditUserFacingLiterals(root);
    assert.ok(errors.some((error) => error.startsWith("stale_allowlist:1:")), errors.join("\n"));
    assert.ok(errors.some((error) => error.startsWith("stale_allowlist:2:")), errors.join("\n"));
  });
});

test("이관 잔여 항목은 계획·이관 대상 없이는 등록되지 않는다", async () => {
  await withFixture({
    "src/Screen.tsx": `export function Screen() { return <div aria-label="닫기" />; }\n`,
    "scripts/i18n/user-facing-literal-allowlist.json": JSON.stringify([
      {
        path: "src/Screen.tsx",
        pattern: "aria-label",
        occurrences: 1,
        status: "pending-migration",
        reason: "원문 한국어 라벨",
      },
    ]),
  }, async (root) => {
    const { errors } = await auditUserFacingLiterals(root);
    assert.ok(errors.includes("invalid_allowlist_plan:1"), errors.join("\n"));
    assert.ok(errors.includes("invalid_allowlist_migrate_target:1"), errors.join("\n"));
  });
});
