import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(resolve(rootDir, relativePath), "utf8");
}

test("1.4.4 Play 문서는 최종 서명 AAB와 사용자 직접 제출 상태를 기록한다", () => {
  const releaseNotes = read("docs/store/play-release-notes-v1.4.4.md");
  const submission = read("docs/store/play-console-submission-v1.4.4.md");

  assert.match(releaseNotes, /Android 15/);
  assert.match(releaseNotes, /기기 재시작/);
  assert.match(releaseNotes, /카카오·Google 로그인/);
  assert.match(releaseNotes, /소셜 계정 없이 QR 또는 연결 코드/);
  assert.match(releaseNotes, /온보딩 제목 줄바꿈/);
  assert.match(submission, /BOOT_COMPLETED/);
  assert.match(submission, /AmbientListenService/);
  assert.match(submission, /versionCode 16/);
  assert.match(submission, /eccef55d6b57bf8f8929ed9bc193c034355f7489/);
  assert.match(submission, /13,065,652 bytes/);
  assert.match(submission, /b449ce0aaa7b381c24dada4ecc2125ab8bddbf6a70b2c6d235358a2df2ed1ac4/);
  assert.match(submission, /32f729e8/);
  assert.match(submission, /사용자가 Play Console.*직접 제출/s);
  assert.match(submission, /검토 중인 변경사항/);
  assert.match(submission, /production/);
  assert.match(submission, /혜니캘린더 1\.4\.4 \(16\)/);
  assert.match(submission, /전체 출시 시작/);
  assert.doesNotMatch(submission, /최종 커밋에서 새 서명 AAB 생성 필요/);
  assert.match(submission, /eda3907d96e0046804c2d39eb4c2c310f4b1dfeb/);
  assert.match(submission, /45e66db8d6a60cae1a9a4c33105f285c85886d92b4aea588425d0010a5343a91/);
  assert.match(submission, /이전 후보/);
  assert.match(submission, /oauth-exchange-recovery\.sql/);
  assert.match(submission, /D1.*Worker/s);
  assert.match(submission, /A17.*아이/s);
  assert.match(submission, /S25.*부모/s);
  assert.match(submission, /target SDK 36/);
  assert.match(submission, /viewport-fit=cover/);
  assert.match(submission, /Capacitor 8\.4\.1 `SystemBars`/);
  assert.match(submission, /제스처·3버튼 내비게이션/);
});
