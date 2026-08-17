// 아이모드 AI 친구 플로팅 버튼의 3D 감정 표정 — public/assets/ai-buddy/*.webp (256px, 투명 배경).
// 혜니 캐릭터 대신 "표정만 읽히는 심플한 이모티콘"이 필요해서 만든 정본 에셋이다.
// 기존 place/cat 3D 에셋과 같은 클레이 톤(소프트 그라디언트 + 스페큘러 + 접지 그림자)을 쓰되,
// 64px 플로팅 버튼에서도 표정이 읽히도록 눈·입을 굵게 그린다.
// 실행: node scripts/generate-ai-buddy-faces.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/assets/ai-buddy";
mkdirSync(OUT, { recursive: true });

const CX = 128;
const CY = 120;
const R = 92;
const INK = "#4A2F1B";
const STROKE = 10;

const defs = `
  <defs>
    <radialGradient id="ball" cx="34%" cy="26%" r="82%">
      <stop offset="0" stop-color="#FFF4D2"/>
      <stop offset="0.42" stop-color="#FFDD93"/>
      <stop offset="0.78" stop-color="#F9BC60"/>
      <stop offset="1" stop-color="#E29A3C"/>
    </radialGradient>
    <radialGradient id="depth" cx="72%" cy="80%" r="62%">
      <stop offset="0" stop-color="#C97A25" stop-opacity="0.32"/>
      <stop offset="0.7" stop-color="#C97A25" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#C97A25" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gloss" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/>
      <stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

// 접지 그림자 → 본체 → 깊이(우하단) → 상단 림라이트 → 스페큘러 순으로 3D 를 만든다.
const ballBody = `
  <ellipse cx="${CX}" cy="228" rx="62" ry="12" fill="#3A2F45" opacity="0.12"/>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#ball)"/>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#depth)"/>
  <path d="M ${CX - R} ${CY} a ${R} ${R} 0 0 1 ${R * 2} 0 Z" fill="url(#rim)" opacity="0.55"/>
  <ellipse cx="94" cy="66" rx="42" ry="27" fill="url(#gloss)" transform="rotate(-22 94 66)"/>
  <circle cx="171" cy="72" r="8" fill="#FFFFFF" opacity="0.4"/>`;

function svg(face) {
  return Buffer.from(
    `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">`
    + `${defs}${ballBody}${face}</svg>`,
  );
}

const line = (d, width = STROKE, color = INK) =>
  `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;

/** 동그란 눈 + 캐치라이트(살아 있는 느낌의 핵심). */
function roundEye(cx, cy, rx = 13, ry = 16) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}"/>`
    + `<circle cx="${cx + 4}" cy="${cy - 5}" r="4.6" fill="#FFFFFF" opacity="0.95"/>`;
}

/** 웃는 눈(^ ^). */
const arcEye = (cx, cy) => line(`M ${cx - 15} ${cy + 5} q 15 -19 30 0`);
/** 감은 눈(u u) — 깜빡임·졸림. */
const closedEye = (cx, cy) => line(`M ${cx - 15} ${cy - 3} q 15 15 30 0`);
/**
 * 걱정 눈썹 — 안쪽 끝이 올라가고 바깥 끝이 내려간다.
 * 반대로(아치로) 그리면 화난 표정으로 읽혀서 다독임이 되지 않는다.
 */
const worryBrow = (cx, cy, flip = false) => {
  const outer = flip ? cx + 19 : cx - 19;
  const inner = flip ? cx - 17 : cx + 17;
  const mid = flip ? cx + 1 : cx - 1;
  return line(`M ${outer} ${cy + 6} Q ${mid} ${cy - 4} ${inner} ${cy - 8}`, 7);
};

const blush = (cx, cy) => `<ellipse cx="${cx}" cy="${cy}" rx="16" ry="10" fill="#FF8FA6" opacity="0.42"/>`;
const sparkle = (cx, cy, s = 1) =>
  `<path d="M ${cx} ${cy - 13 * s} q 3 10 13 13 q -10 3 -13 13 q -3 -10 -13 -13 q 10 -3 13 -13 Z" fill="#FFFFFF" opacity="0.92"/>`;

const EYE_L = 98;
const EYE_R = 158;
const EYE_Y = 112;

const FACES = {
  // 대기 — 편안한 기본 미소. 항상 화면에 떠 있는 얼굴이라 과하지 않게.
  idle: svg(`
    ${roundEye(EYE_L, EYE_Y)}
    ${roundEye(EYE_R, EYE_Y)}
    ${line(`M 106 156 q 22 20 44 0`)}
  `),
  // 깜빡임 — 대기 애니메이션 전용 프레임(표정은 idle 과 동일).
  blink: svg(`
    ${closedEye(EYE_L, EYE_Y)}
    ${closedEye(EYE_R, EYE_Y)}
    ${line(`M 106 156 q 22 20 44 0`)}
  `),
  // 기쁨 — 웃는 눈 + 활짝 웃는 입 + 볼터치.
  happy: svg(`
    ${blush(76, 140)}
    ${blush(180, 140)}
    ${arcEye(EYE_L, EYE_Y)}
    ${arcEye(EYE_R, EYE_Y)}
    <path d="M 92 148 q 36 44 72 0 Z" fill="${INK}"/>
    <path d="M 112 172 q 16 18 32 0 Z" fill="#FF8FA6"/>
  `),
  // 신남 — 크게 뜬 눈 + 벌린 입 + 반짝. 도구 실행 성공·칭찬에 쓴다.
  excited: svg(`
    ${blush(74, 142)}
    ${blush(182, 142)}
    ${roundEye(EYE_L, EYE_Y - 2, 15, 18)}
    ${roundEye(EYE_R, EYE_Y - 2, 15, 18)}
    <ellipse cx="128" cy="166" rx="22" ry="26" fill="${INK}"/>
    <ellipse cx="128" cy="180" rx="13" ry="11" fill="#FF8FA6"/>
    ${sparkle(206, 44)}
    ${sparkle(48, 60, 0.7)}
  `),
  // 생각 중 — 위를 올려다보는 눈 + 한쪽만 올라간 눈썹 + 오므린 입. 답변 대기 상태.
  // 흰 생각풍선은 밝은 배경에서 안 보여 쓰지 않고, 얼굴 안에서만 표현한다.
  thinking: svg(`
    ${line(`M ${EYE_L - 18} 82 Q ${EYE_L} 72 ${EYE_L + 16} 76`, 7)}
    ${line(`M ${EYE_R - 16} 86 Q ${EYE_R} 80 ${EYE_R + 18} 84`, 7)}
    ${roundEye(EYE_L, EYE_Y - 2, 12, 14)}
    ${roundEye(EYE_R, EYE_Y - 2, 12, 14)}
    ${line(`M 112 162 q 10 -7 19 0 q 9 7 18 0`, 8)}
  `),
  // 다독임 — 처진 눈썹 + 부드러운 미소. 아이가 속상할 때 곁에 있는 얼굴.
  caring: svg(`
    ${worryBrow(EYE_L, 84)}
    ${worryBrow(EYE_R, 84, true)}
    ${roundEye(EYE_L, EYE_Y + 4, 12, 14)}
    ${roundEye(EYE_R, EYE_Y + 4, 12, 14)}
    ${line(`M 108 160 q 20 14 40 0`, 9)}
    ${blush(78, 146)}
    ${blush(178, 146)}
  `),
  // 슬픔 — 아래로 굽은 입 + 눈물. 아이 감정을 따라가는 표정.
  sad: svg(`
    ${worryBrow(EYE_L, 82)}
    ${worryBrow(EYE_R, 82, true)}
    ${roundEye(EYE_L, EYE_Y + 6, 12, 15)}
    ${roundEye(EYE_R, EYE_Y + 6, 12, 15)}
    <path d="M 166 128 q 9 14 0 22 q -9 -8 0 -22 Z" fill="#7EC8F2" opacity="0.9"/>
    ${line(`M 108 176 q 20 -16 40 0`, 9)}
  `),
  // 졸림 — 반쯤 감은 눈 + 하품 + Z. 늦은 시간 대기 표정.
  sleepy: svg(`
    ${closedEye(EYE_L, EYE_Y + 4)}
    ${closedEye(EYE_R, EYE_Y + 4)}
    <ellipse cx="128" cy="168" rx="15" ry="18" fill="${INK}"/>
    ${line(`M 196 60 h 24 l -24 26 h 24`, 7, "#FFFFFF")}
    ${line(`M 214 26 h 16 l -16 18 h 16`, 5.5, "#FFFFFF")}
  `),
  // 응원 — 윙크 + 웃음 + 반짝. 칭찬·성공·격려.
  cheer: svg(`
    ${blush(74, 142)}
    ${blush(182, 142)}
    ${arcEye(EYE_L, EYE_Y)}
    ${roundEye(EYE_R, EYE_Y, 14, 17)}
    <path d="M 96 150 q 32 40 64 0 Z" fill="${INK}"/>
    ${sparkle(50, 52)}
  `),
};

for (const [name, buf] of Object.entries(FACES)) {
  await sharp(buf).webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/${name}.webp`);
  console.log("generated", `${OUT}/${name}.webp`);
}
