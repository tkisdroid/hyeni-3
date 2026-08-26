import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

function readStudySources() {
  return [
    "src/screens/feature/StudyManagement.tsx",
    "src/components/study/StudyChildTabs.tsx",
    "src/components/study/StudyReportPanel.tsx",
    "src/components/study/StudyDevicesPanel.tsx",
    "src/components/study/StudyPairingPanel.tsx",
    "src/components/study/StudyClaimGate.tsx",
  ].map(read).join("\n");
}

function filesUnder(path) {
  const directory = new URL(path, root);
  return readdirSync(directory, { recursive: true })
    .filter((entry) => typeof entry === "string" && /\.(?:json|ts)$/.test(entry))
    .map((entry) => readFileSync(new URL(entry, directory), "utf8"))
    .join("\n");
}

test("Study UI는 locale catalog 대신 하나의 한국어 문구 모듈을 쓴다", async () => {
  const { STUDY_COPY_KO } = await import("../src/components/study/studyCopy.ko.ts");
  assert.equal(STUDY_COPY_KO.card.description, "아이의 오늘 공부와 진도를 확인해요");
  assert.ok(Object.keys(STUDY_COPY_KO).length >= 8);

  const studySources = readStudySources();
  assert.doesNotMatch(studySources, /useIntl|intl\.formatMessage|FormattedMessage|parent\.study\./);
  assert.match(studySources, /STUDY_COPY_KO/);
});

test("Study 문구는 리포트·기기·QR·claim의 한국어 상태를 빠짐없이 가진다", async () => {
  const { STUDY_COPY_KO } = await import("../src/components/study/studyCopy.ko.ts");
  for (const key of ["common", "card", "screen", "tabs", "report", "devices", "pairing", "claim"]) {
    assert.ok(key in STUDY_COPY_KO, `${key} 한국어 문구 묶음 누락`);
  }
  assert.equal(STUDY_COPY_KO.report.gradeSuffix, "학년");
  assert.match(STUDY_COPY_KO.pairing.expires, /10분/);
  assert.match(STUDY_COPY_KO.pairing.copy, /복사/);
  assert.notEqual(STUDY_COPY_KO.claim.expired, STUDY_COPY_KO.claim.reused);
  assert.match(STUDY_COPY_KO.devices.primaryOnly, /주 보호자/);
});

test("기존 Calendar locale 및 생성 catalog에 Study message id를 추가하지 않는다", () => {
  const catalogs = filesUnder("locales/") + filesUnder("src/i18n/generated/");
  assert.doesNotMatch(catalogs, /(?:parent|shared)\.study\./);
});
