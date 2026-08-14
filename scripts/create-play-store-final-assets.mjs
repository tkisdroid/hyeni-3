import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PLAY_STORE_FINAL_DIR = resolve(ROOT_DIR, "output/play-store-final-v1");
export const PLAY_STORE_SOURCE_ICON = resolve(ROOT_DIR, "assets/11-store-listing/store-icon-512.png");
export const PLAY_STORE_SOURCE_UI_DIR = resolve(ROOT_DIR, "output/store-ui-candidates-v1");

export const PLAY_STORE_SCREENSHOTS = Object.freeze([
  Object.freeze({
    file: "01-parent-home.png",
    source: "01-parent-home-ui.png",
    headline: "오늘 일정과 아이 상태를 한눈에",
    description: "가족 일정, 최근 위치, 알림을 홈에서 바로 확인하세요.",
    alt: "오늘 일정과 아이 안전 상태를 확인하는 보호자 홈",
  }),
  Object.freeze({
    file: "02-family-calendar.png",
    source: "02-family-calendar-ui.png",
    headline: "가족 일정을 한 달에 담아요",
    description: "누가 언제 무엇을 하는지, 일정과 준비물을 함께 봅니다.",
    alt: "가족 일정을 월간으로 확인하는 가족 캘린더",
  }),
  Object.freeze({
    file: "03-family-conversation.png",
    source: "03-family-memo-ui.png",
    headline: "‘어디야?’ 대신 대화 한 번",
    description: "아이별 대화에서 메시지, 사진, 위치를 나눌 수 있어요.",
    alt: "보호자와 아이가 메시지와 위치를 나누는 가족 대화",
  }),
  Object.freeze({
    file: "04-daily-safety-report.png",
    source: "04-daily-safety-report-ui.png",
    headline: "하루의 안전 신호를 모아 봐요",
    description: "최근 위치, 일정, 준비물, 기기 상태를 한 화면에 정리합니다.",
    alt: "아이의 하루 안전 정보를 보여 주는 안심 리포트",
  }),
  Object.freeze({
    file: "05-weekly-family-report.png",
    source: "05-weekly-family-report-ui.png",
    headline: "한 주 흐름을 짧게 정리해요",
    description: "가족 일정과 대화 기록을 주간 리포트로 확인하세요.",
    alt: "가족의 한 주 일정과 대화를 요약한 주간 리포트",
  }),
  Object.freeze({
    file: "06-child-home-sos.png",
    source: "06-child-home-ui.png",
    headline: "아이도 쉽게, 일정과 SOS",
    description: "오늘 할 일을 보고, 필요할 때 SOS를 3초 눌러 알려요.",
    alt: "오늘 일정과 SOS 버튼을 쉽게 사용할 수 있는 아이 홈",
  }),
]);

export const PLAY_STORE_FINAL_IMAGES = Object.freeze([
  Object.freeze({ file: "play-icon-512.png", width: 512, height: 512, alpha: true, kind: "icon" }),
  Object.freeze({
    file: "play-feature-graphic-1024x500.png",
    width: 1024,
    height: 500,
    alpha: false,
    kind: "featureGraphic",
  }),
  ...PLAY_STORE_SCREENSHOTS.map((shot) => Object.freeze({
    file: shot.file,
    width: 1080,
    height: 1920,
    alpha: false,
    kind: "phoneScreenshot",
  })),
]);

const FEATURE_FAMILY_IMAGE = resolve(ROOT_DIR, "public/assets/mascot/family.webp");
const FONT_STACK = "Pretendard, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function featureGraphicSvg() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
      <rect width="1024" height="500" fill="#F8F3F5"/>
      <path d="M72 74h44" stroke="#B6326C" stroke-width="6" stroke-linecap="round"/>
      <text x="72" y="116" font-family="${FONT_STACK}" font-size="29" font-weight="700" fill="#B6326C">혜니캘린더</text>
      <text x="72" y="196" font-family="${FONT_STACK}" font-size="54" font-weight="800" letter-spacing="-2" fill="#2F2830">가족 일정과</text>
      <text x="72" y="260" font-family="${FONT_STACK}" font-size="54" font-weight="800" letter-spacing="-2" fill="#2F2830">아이 안전을</text>
      <text x="72" y="324" font-family="${FONT_STACK}" font-size="54" font-weight="800" letter-spacing="-2" fill="#2F2830">한 곳에서</text>
      <text x="72" y="389" font-family="${FONT_STACK}" font-size="27" font-weight="600" letter-spacing="-0.5" fill="#6A5E66">캘린더 · 위치 · 안심 알림</text>
      <path d="M72 428h418" stroke="#E5DADF" stroke-width="2"/>
    </svg>
  `);
}

function screenshotBaseSvg(shot) {
  const headline = escapeXml(shot.headline);
  const description = escapeXml(shot.description);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      <rect width="1080" height="1920" fill="#F8F4F6"/>
      <text x="80" y="76" font-family="${FONT_STACK}" font-size="27" font-weight="700" fill="#B6326C">혜니캘린더</text>
      <text x="80" y="164" font-family="${FONT_STACK}" font-size="54" font-weight="800" letter-spacing="-2" fill="#2F2830">${headline}</text>
      <text x="80" y="244" font-family="${FONT_STACK}" font-size="28" font-weight="500" letter-spacing="-0.5" fill="#655B62">${description}</text>
      <rect x="89" y="319" width="902" height="1601" rx="29" fill="#FFFFFF" stroke="#E5DADF" stroke-width="2"/>
    </svg>
  `);
}

function roundedMaskSvg() {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600" viewBox="0 0 900 1600">
      <rect width="900" height="1600" rx="28" fill="#FFFFFF"/>
    </svg>
  `);
}

async function verifyUiSources() {
  const [manifest, review] = await Promise.all([
    readFile(resolve(PLAY_STORE_SOURCE_UI_DIR, "manifest.json"), "utf8").then(JSON.parse),
    readFile(resolve(PLAY_STORE_SOURCE_UI_DIR, "technical-review.json"), "utf8").then(JSON.parse),
  ]);
  if (manifest.source !== "local-production-dist-with-static-demo-session") {
    throw new Error("실제 production UI 데모 캡처 manifest가 아닙니다.");
  }
  if (review.verdict !== "TECHNICAL_REVIEW_PASSED") {
    throw new Error("UI 후보의 기술 검토가 통과되지 않았습니다.");
  }
  for (const shot of PLAY_STORE_SCREENSHOTS) {
    const artifact = manifest.artifacts.find((item) => item.file === shot.source);
    if (!artifact) throw new Error(`UI 원본 manifest 누락: ${shot.source}`);
    const sourcePath = resolve(PLAY_STORE_SOURCE_UI_DIR, shot.source);
    const [metadata, actualHash] = await Promise.all([sharp(sourcePath).metadata(), sha256File(sourcePath)]);
    if (metadata.width !== 1080 || metadata.height !== 1920 || metadata.hasAlpha) {
      throw new Error(`UI 원본 형식 오류: ${shot.source}`);
    }
    if (artifact.sha256 !== actualHash) throw new Error(`UI 원본 해시 불일치: ${shot.source}`);
  }
  return { manifest, review };
}

async function artifact(path, spec) {
  const [buffer, metadata, fileStats] = await Promise.all([readFile(path), sharp(path).metadata(), stat(path)]);
  if (metadata.width !== spec.width || metadata.height !== spec.height || metadata.hasAlpha !== spec.alpha) {
    throw new Error(`최종 자산 형식 오류: ${spec.file}`);
  }
  if (metadata.exif || metadata.iptc || metadata.xmp) throw new Error(`최종 자산 메타데이터 오류: ${spec.file}`);
  return { file: spec.file, kind: spec.kind, bytes: fileStats.size, sha256: sha256(buffer) };
}

export async function generatePlayStoreFinalAssets({
  outputDir = PLAY_STORE_FINAL_DIR,
  approveAfterVisualReview = false,
} = {}) {
  const targetDir = resolve(outputDir);
  await mkdir(targetDir, { recursive: true });
  const sourceReview = await verifyUiSources();

  await sharp(PLAY_STORE_SOURCE_ICON)
    .rotate()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
    .toFile(resolve(targetDir, "play-icon-512.png"));

  const family = await sharp(FEATURE_FAMILY_IMAGE)
    .resize({ width: 404, height: 330, fit: "contain", withoutEnlargement: true })
    .webp({ quality: 100, alphaQuality: 100 })
    .toBuffer();
  await sharp(featureGraphicSvg())
    .composite([{ input: family, left: 588, top: 84 }])
    .flatten({ background: "#F8F3F5" })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
    .toFile(resolve(targetDir, "play-feature-graphic-1024x500.png"));

  for (const shot of PLAY_STORE_SCREENSHOTS) {
    const resizedUi = await sharp(resolve(PLAY_STORE_SOURCE_UI_DIR, shot.source))
      .resize({ width: 900, height: 1600, fit: "cover" })
      .composite([{ input: roundedMaskSvg(), blend: "dest-in" }])
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
      .toBuffer();
    await sharp(screenshotBaseSvg(shot))
      .composite([{ input: resizedUi, left: 90, top: 320 }])
      .flatten({ background: "#F8F4F6" })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
      .toFile(resolve(targetDir, shot.file));
  }

  const artifacts = [];
  for (const spec of PLAY_STORE_FINAL_IMAGES) artifacts.push(await artifact(resolve(targetDir, spec.file), spec));

  const generatedAt = new Date().toISOString();
  const sourceManifestPath = resolve(PLAY_STORE_SOURCE_UI_DIR, "manifest.json");
  const manifest = {
    schemaVersion: 1,
    generatedAt,
    source: "local-production-ui-with-static-demo-data",
    sourceUiManifestSha256: await sha256File(sourceManifestPath),
    sourceIconSha256: await sha256File(PLAY_STORE_SOURCE_ICON),
    listingStyle: "flat-brand-header-with-full-bleed-actual-app-ui",
    screenshots: PLAY_STORE_SCREENSHOTS,
    artifacts,
  };
  const technicalReview = {
    schemaVersion: 1,
    reviewedAt: generatedAt,
    verdict: "TECHNICAL_REVIEW_PASSED",
    playUploadApproved: Boolean(approveAfterVisualReview),
    reviewAuthority: approveAfterVisualReview ? "user-delegated-ai-visual-review" : null,
    checks: {
      actualProductionUiSources: true,
      staticDemoDataOnly: true,
      sourceTechnicalReviewPassed: sourceReview.review.verdict === "TECHNICAL_REVIEW_PASSED",
      exactPlayDimensions: true,
      opaqueScreenshotsAndFeatureGraphic: true,
      metadataFree: true,
      pricingOrPromotionOverlayAbsent: true,
      decorativeBadgesAndOrdinalMarkersAbsent: true,
    },
  };
  await Promise.all([
    writeFile(resolve(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    writeFile(resolve(targetDir, "technical-review.json"), `${JSON.stringify(technicalReview, null, 2)}\n`, "utf8"),
  ]);

  return { outputDir: targetDir, artifacts, playUploadApproved: technicalReview.playUploadApproved };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await generatePlayStoreFinalAssets({
    approveAfterVisualReview: process.argv.includes("--approve-after-visual-review"),
  });
  process.stdout.write(
    `Play 최종 자산 ${result.artifacts.length}개 생성 완료: ${result.outputDir}\n` +
      `Play 업로드 승인: ${result.playUploadApproved ? "예" : "아니요, 육안 검토 후 승인 플래그로 다시 생성"}\n`,
  );
}
