// 장소 3D(클레이 스타일) 아이콘 생성 — public/assets/place/*.webp (256px, 투명 배경).
// 기존 cat/ui 에셋의 파스텔·소프트 섀도 톤에 맞춘 SVG → sharp 렌더.
// 실행: node scripts/generate-place-assets.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const OUT = "public/assets/place";
mkdirSync(OUT, { recursive: true });

const defs = `
  <defs>
    <linearGradient id="cream" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff7ec"/><stop offset="1" stop-color="#f3dfc3"/>
    </linearGradient>
    <linearGradient id="rose" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd9e4"/><stop offset="1" stop-color="#f2a9c0"/>
    </linearGradient>
    <linearGradient id="roseDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f79cb8"/><stop offset="1" stop-color="#e06d96"/>
    </linearGradient>
    <linearGradient id="mint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8f0dd"/><stop offset="1" stop-color="#8fd8b6"/>
    </linearGradient>
    <linearGradient id="mintDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7ccfa8"/><stop offset="1" stop-color="#4aab7f"/>
    </linearGradient>
    <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d6e9ff"/><stop offset="1" stop-color="#a3c8f0"/>
    </linearGradient>
    <linearGradient id="blueDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fc4ee"/><stop offset="1" stop-color="#6e9ed8"/>
    </linearGradient>
    <linearGradient id="lav" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e9e0ff"/><stop offset="1" stop-color="#c3aef2"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe9b8"/><stop offset="1" stop-color="#f3c96b"/>
    </linearGradient>
    <linearGradient id="brown" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d9b18c"/><stop offset="1" stop-color="#b58963"/>
    </linearGradient>
    <linearGradient id="white" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eee7f2"/>
    </linearGradient>
  </defs>`;

const shadow = `<ellipse cx="128" cy="228" rx="76" ry="14" fill="#3a2f45" opacity="0.10"/>`;

function svg(body) {
  return Buffer.from(
    `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">${defs}${shadow}${body}</svg>`,
  );
}

const ICONS = {
  // 성당 — 크림 본체 + 로즈 지붕 + 종탑 + 십자가, 아치 문/창.
  church: svg(`
    <rect x="58" y="120" width="140" height="106" rx="18" fill="url(#cream)"/>
    <path d="M50 128 L128 74 L206 128 Z" fill="url(#rose)"/>
    <rect x="106" y="52" width="44" height="86" rx="14" fill="url(#cream)"/>
    <path d="M100 64 L128 40 L156 64 Z" fill="url(#roseDeep)"/>
    <rect x="124" y="16" width="8" height="26" rx="4" fill="url(#gold)"/>
    <rect x="115" y="24" width="26" height="8" rx="4" fill="url(#gold)"/>
    <path d="M112 226 v-40 a16 16 0 0 1 32 0 v40 Z" fill="url(#roseDeep)"/>
    <circle cx="128" cy="106" r="10" fill="url(#gold)"/>
    <path d="M74 170 v-16 a9 9 0 0 1 18 0 v16 Z" fill="url(#blue)"/>
    <path d="M164 170 v-16 a9 9 0 0 1 18 0 v16 Z" fill="url(#blue)"/>
    <ellipse cx="96" cy="86" rx="20" ry="8" fill="#ffffff" opacity="0.35"/>
  `),
  // 아파트 — 두 동 파스텔 블록 + 창문 그리드.
  apartment: svg(`
    <rect x="46" y="76" width="86" height="150" rx="16" fill="url(#blue)"/>
    <rect x="124" y="106" width="86" height="120" rx="16" fill="url(#lav)"/>
    <rect x="46" y="76" width="86" height="18" rx="9" fill="url(#blueDeep)"/>
    <rect x="124" y="106" width="86" height="16" rx="8" fill="#b49ae6"/>
    ${[0, 1, 2].map((r) =>
      [0, 1].map(
        (c) => `<rect x="${64 + c * 34}" y="${108 + r * 32}" width="18" height="18" rx="5" fill="url(#white)"/>`,
      ).join(""),
    ).join("")}
    ${[0, 1].map((r) =>
      [0, 1].map(
        (c) => `<rect x="${142 + c * 32}" y="${134 + r * 32}" width="16" height="16" rx="5" fill="url(#white)"/>`,
      ).join(""),
    ).join("")}
    <rect x="78" y="196" width="22" height="30" rx="7" fill="url(#roseDeep)"/>
    <ellipse cx="80" cy="88" rx="24" ry="7" fill="#ffffff" opacity="0.4"/>
  `),
  // 공원 — 큰 나무 + 작은 수풀 + 벤치 느낌 받침.
  park: svg(`
    <ellipse cx="118" cy="106" rx="62" ry="56" fill="url(#mint)"/>
    <ellipse cx="80" cy="130" rx="34" ry="30" fill="url(#mintDeep)" opacity="0.85"/>
    <ellipse cx="156" cy="128" rx="38" ry="32" fill="url(#mint)"/>
    <path d="M112 226 v-70 q2 -12 6 0 v70 Z" fill="url(#brown)"/>
    <path d="M118 176 q16 -14 30 -18" stroke="#b58963" stroke-width="9" stroke-linecap="round" fill="none"/>
    <ellipse cx="196" cy="206" rx="30" ry="18" fill="url(#mintDeep)"/>
    <ellipse cx="52" cy="210" rx="24" ry="14" fill="url(#mint)"/>
    <circle cx="96" cy="88" r="7" fill="#ffe9b8"/>
    <circle cx="142" cy="112" r="6" fill="#ffd9e4"/>
    <ellipse cx="98" cy="72" rx="24" ry="9" fill="#ffffff" opacity="0.35"/>
  `),
  // 마트 — 스토어프론트 + 줄무늬 어닝 + 카트 바퀴 느낌 문.
  mart: svg(`
    <rect x="48" y="108" width="160" height="118" rx="16" fill="url(#cream)"/>
    <rect x="40" y="76" width="176" height="30" rx="12" fill="url(#roseDeep)"/>
    ${[0, 1, 2, 3, 4].map(
      (i) => `<path d="M${44 + i * 34} 104 a17 13 0 0 0 34 0 Z" fill="${i % 2 ? "url(#rose)" : "#ffffff"}"/>`,
    ).join("")}
    <rect x="66" y="134" width="52" height="44" rx="10" fill="url(#blue)"/>
    <rect x="140" y="134" width="50" height="92" rx="10" fill="url(#mint)"/>
    <rect x="146" y="150" width="38" height="8" rx="4" fill="#ffffff" opacity="0.7"/>
    <circle cx="92" cy="204" r="14" fill="url(#gold)"/>
    <ellipse cx="86" cy="88" rx="26" ry="7" fill="#ffffff" opacity="0.35"/>
  `),
  // 병원 — 화이트 본체 + 로즈 십자 + 캐노피.
  hospital: svg(`
    <rect x="52" y="88" width="152" height="138" rx="18" fill="url(#white)"/>
    <rect x="52" y="88" width="152" height="20" rx="10" fill="url(#blue)"/>
    <rect x="112" y="124" width="32" height="12" rx="6" fill="url(#roseDeep)"/>
    <rect x="122" y="114" width="12" height="32" rx="6" fill="url(#roseDeep)"/>
    <rect x="70" y="162" width="24" height="22" rx="7" fill="url(#blue)"/>
    <rect x="162" y="162" width="24" height="22" rx="7" fill="url(#blue)"/>
    <path d="M108 226 v-32 a20 14 0 0 1 40 0 v32 Z" fill="url(#mint)"/>
    <ellipse cx="92" cy="98" rx="26" ry="6" fill="#ffffff" opacity="0.6"/>
  `),
  // 도서관 — 펼친 책 + 북엔드 건물 느낌.
  library: svg(`
    <rect x="56" y="96" width="144" height="130" rx="16" fill="url(#gold)"/>
    <rect x="56" y="96" width="144" height="18" rx="9" fill="url(#brown)"/>
    <path d="M76 140 q26 -14 52 0 v56 q-26 -12 -52 0 Z" fill="url(#white)"/>
    <path d="M180 140 q-26 -14 -52 0 v56 q26 -12 52 0 Z" fill="url(#blue)"/>
    <path d="M128 138 v58" stroke="#c3aef2" stroke-width="5" stroke-linecap="round"/>
    <rect x="92" y="152" width="24" height="4" rx="2" fill="#c9bfd6"/>
    <rect x="92" y="164" width="24" height="4" rx="2" fill="#c9bfd6"/>
    <ellipse cx="94" cy="106" rx="24" ry="6" fill="#ffffff" opacity="0.4"/>
  `),
};

for (const [name, buf] of Object.entries(ICONS)) {
  await sharp(buf).webp({ quality: 92, alphaQuality: 100 }).toFile(`${OUT}/${name}.webp`);
  console.log("generated", `${OUT}/${name}.webp`);
}
