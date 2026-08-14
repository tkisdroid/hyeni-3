import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SAFE_STORE_CREATIVE_DRAFT_DIR = resolve(ROOT_DIR, "output/store-safe-assets-v1");

export const STORE_ASSET_WIDTH = 1080;
export const STORE_ASSET_HEIGHT = 1920;
export const SAFE_DEMO_FOOTER = "모든 인물·일정·위치 정보는 합성 데모 데이터입니다";

const COLORS = Object.freeze({
  app: "#FBF7F4",
  card: "#FFFFFF",
  ink: "#201A1D",
  body: "#3A3236",
  muted: "#70666A",
  line: "#E9E0E5",
  rose: "#D93072",
  roseSoft: "#FDE7F1",
  roseText: "#A94475",
  mint: "#1C865E",
  mintSoft: "#E7F8F0",
  mintText: "#087653",
  blue: "#2E6DA4",
  blueSoft: "#E6F2FB",
  lavender: "#7E63D4",
  lavenderSoft: "#EFE8FF",
  gold: "#89610C",
  goldSoft: "#FFF6DC",
});

/**
 * 업로드 대상은 아래 정적 문구만 렌더한다. 사용자 데이터, API 응답, 환경변수,
 * 기기 캡처를 입력으로 받지 않으므로 같은 소스에서 언제든 다시 만들 수 있다.
 */
export const SAFE_STORE_ASSETS = Object.freeze([
  {
    file: "01-family-day-demo.png",
    kind: "home",
    accent: COLORS.rose,
    soft: COLORS.roseSoft,
    content: {
      headline: ["가족의 하루를", "한눈에 안심하게"],
      subtitle: "일정과 아이 안전 정보를 한곳에서 확인하세요",
      appTitle: "혜니캘린더",
      demoBadge: "합성 데모",
      familyTitle: "데모 가족",
      familyStatus: "자녀 1 · 위치 공유 정상",
      today: "오늘의 가족 일정",
      rows: [
        ["08:00", "가족 일정", "준비물 확인"],
        ["16:00", "방과 후 활동", "도착 알림 켜짐"],
      ],
      signals: ["위치 정상", "알림 정상", "일정 2건"],
    },
  },
  {
    file: "02-free-core-demo.png",
    kind: "freeCore",
    accent: COLORS.blue,
    soft: COLORS.blueSoft,
    content: {
      headline: ["일정·메모·스티커는", "Free도 무제한"],
      subtitle: "준비물·숙제는 아이별 하루 각각 8개까지 제공해요",
      appTitle: "가족 캘린더",
      demoBadge: "Free 포함 · 합성 데모",
      month: "8월",
      weekday: ["월", "화", "수", "목", "금"],
      dates: ["3", "4", "5", "6", "7"],
      rows: [
        ["가족 일정", "모든 티어 무제한"],
        ["가족 메모", "모든 티어 무제한"],
        ["스티커", "모든 티어 무제한"],
        ["준비물·숙제", "아이별 하루 각각 8개"],
      ],
    },
  },
  {
    file: "03-location-tiers-demo.png",
    kind: "location",
    accent: COLORS.mint,
    soft: COLORS.mintSoft,
    content: {
      headline: ["Free도 위치 확인", "Premium은 실시간"],
      subtitle: "두 플랜의 위치 차이를 정확히 비교해 보세요",
      appTitle: "위치 확인",
      demoBadge: "합성 데모",
      freeTitle: "Free",
      premiumTitle: "Premium",
      freeRows: ["약 10분 간격 위치", "지금 위치 요청 최근 24시간 5회", "오늘 위치 이력"],
      premiumRows: ["실시간 위치", "지금 위치 요청 제한 없음", "최근 30일 위치 이력"],
      disclosure: "표시 위치는 합성 도형이며 실제 장소나 좌표가 아닙니다",
    },
  },
  {
    file: "04-free-safety-demo.png",
    kind: "safety",
    accent: COLORS.mint,
    soft: COLORS.mintSoft,
    content: {
      headline: ["SOS와 긴급 알림은", "항상 무료"],
      subtitle: "핵심 안전 기능을 유료 플랜으로 잠그지 않아요",
      appTitle: "안전 알림",
      demoBadge: "Free 포함 · 합성 데모",
      alertTitle: "긴급 알림",
      alertBody: "아이 기기에서 SOS를 보냈어요",
      rows: ["SOS 알림", "긴급 안전 알림", "기본 안전 알림"],
      disclosure: "기기 권한·네트워크·GPS 상태에 따라 알림과 위치가 늦을 수 있어요",
    },
  },
  {
    file: "05-premium-insights-demo.png",
    kind: "premium",
    accent: COLORS.lavender,
    soft: COLORS.lavenderSoft,
    content: {
      headline: ["Premium으로", "더 자세한 안심"],
      subtitle: "두 아이의 위치 흐름과 AI 리포트를 더 깊게 확인하세요",
      appTitle: "혜니 Premium",
      demoBadge: "합성 데모",
      rows: [
        ["아이 2명", "일정과 위치를 함께 관리"],
        ["장소·위험구역 제한 없음", "필요한 안심 장소를 등록"],
        ["자동 안전 인사이트", "위치 끊김·미등록 체류 자동 알림"],
        ["AI 상세 리포트", "AI 하루 요약·주간 가족 리포트"],
        ["투명한 1분 주변 소리", "아이 화면·알림에 계속 표시"],
      ],
    },
  },
  {
    file: "06-premium-price-demo.png",
    kind: "price",
    accent: COLORS.rose,
    soft: COLORS.roseSoft,
    content: {
      headline: ["월 4,900원", "연 39,000원"],
      subtitle: "초기 출시 Premium 가격은 두 가지로 명확하게 제공해요",
      appTitle: "프리미엄 구독",
      demoBadge: "가격 안내 · 합성 데모",
      annualTitle: "연간 구독",
      annualPrice: "연 39,000원",
      monthlyTitle: "월간 구독",
      monthlyPrice: "월 4,900원",
      freeRows: ["Free · 아이 1명", "약 10분 간격 위치", "오늘 위치 이력"],
      premiumRows: ["Premium · 아이 2명", "실시간 위치", "최근 30일 위치 이력"],
      trial: "7일 무료 체험은 Google Play에서 해당 계정에 제공되는 경우에만 표시돼요",
      disclosure: "결제 전 Google Play에 표시된 금액과 조건을 확인해 주세요",
    },
  },
]);

const SOURCE_CONTRACTS = Object.freeze([
  {
    path: "src/transform/webBilling.ts",
    patterns: [
      /month:\s*4_900/,
      /year:\s*39_000/,
      /month:\s*"월 4,900원"/,
      /year:\s*"연 39,000원"/,
    ],
  },
  {
    path: "src/screens/feature/Subscription.tsx",
    patterns: [
      /COMPARE_COLS:\s*readonly Tier\[\]\s*=\s*\[TIERS\.FREE,\s*TIERS\.PREMIUM\]/,
      /label:\s*"일정·메모·스티커"[^\n]+"무제한"/,
      /label:\s*"준비물·숙제"[^\n]+아이별 하루 각각/,
      /label:\s*"SOS · 긴급 알림"[^\n]+safe:\s*true/,
      /label:\s*"주변 소리 듣기"[^\n]+"최대 1분"/,
    ],
  },
  {
    path: "src/transform/tierPolicy.ts",
    patterns: [
      /\[TIERS\.FREE\]:\s*1,\s*\n\s*\[TIERS\.REVIEWED\]:\s*1,\s*\n\s*\[TIERS\.PREMIUM\]:\s*2/,
      /\[TIERS\.FREE\]:\s*5,\s*\n\s*\[TIERS\.REVIEWED\]:\s*5,\s*\n\s*\[TIERS\.PREMIUM\]:\s*Infinity/,
      /\[TIERS\.FREE\]:\s*1,\s*\n\s*\[TIERS\.REVIEWED\]:\s*1,\s*\n\s*\[TIERS\.PREMIUM\]:\s*30/,
      /if \(tier === TIERS\.PREMIUM\) return "realtime"/,
    ],
  },
]);

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textLines(lines, x, y, className, lineHeight, anchor = "start") {
  const spans = lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${className}">${spans}</text>`;
}

function icon(type, x, y, color) {
  const common = `fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"`;
  if (type === "calendar") {
    return `<g transform="translate(${x} ${y})" ${common}><rect x="-27" y="-23" width="54" height="49" rx="10"/><path d="M-27 -7h54M-14 -31v14M14 -31v14"/></g>`;
  }
  if (type === "pin") {
    return `<g transform="translate(${x} ${y})" ${common}><path d="M0 31s25-24 25-43a25 25 0 1 0-50 0C-25 7 0 31 0 31Z"/><circle cx="0" cy="-12" r="8"/></g>`;
  }
  if (type === "shield") {
    return `<g transform="translate(${x} ${y})" ${common}><path d="M0-31 25-21v20c0 17-10 27-25 35C-15 26-25 16-25-1v-20Z"/><path d="m-11 1 8 8 15-18"/></g>`;
  }
  if (type === "spark") {
    return `<g transform="translate(${x} ${y})" ${common}><path d="M0-30c4 17 13 26 30 30C13 4 4 13 0 30-4 13-13 4-30 0-13-4-4-13 0-30Z"/></g>`;
  }
  if (type === "chat") {
    return `<g transform="translate(${x} ${y})" ${common}><path d="M-29-22h58v42h-33l-16 14 3-14h-12Z"/><path d="M-13-2h26"/></g>`;
  }
  return `<g transform="translate(${x} ${y})" ${common}><path d="m-23 0 15 15 31-31"/></g>`;
}

function shell(asset, inner) {
  const { content, accent, soft } = asset;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${STORE_ASSET_WIDTH}" height="${STORE_ASSET_HEIGHT}" viewBox="0 0 ${STORE_ASSET_WIDTH} ${STORE_ASSET_HEIGHT}">
    <defs>
      <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#201A1D" flood-opacity="0.14"/>
      </filter>
      <linearGradient id="soft-glow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${soft}"/>
        <stop offset="1" stop-color="#FFFFFF"/>
      </linearGradient>
      <style>
        text { font-family: "Pretendard", "Malgun Gothic", "Noto Sans KR", Arial, sans-serif; }
        .eyebrow { font-size: 28px; font-weight: 750; fill: ${accent}; letter-spacing: -0.5px; }
        .headline { font-size: 68px; font-weight: 850; fill: ${COLORS.ink}; letter-spacing: -2.4px; }
        .subtitle { font-size: 30px; font-weight: 550; fill: ${COLORS.body}; letter-spacing: -0.8px; }
        .app-title { font-size: 34px; font-weight: 800; fill: ${COLORS.ink}; letter-spacing: -1px; }
        .demo { font-size: 22px; font-weight: 750; fill: ${accent}; }
        .section { font-size: 32px; font-weight: 800; fill: ${COLORS.ink}; letter-spacing: -0.8px; }
        .body { font-size: 27px; font-weight: 600; fill: ${COLORS.body}; letter-spacing: -0.5px; }
        .body-strong { font-size: 28px; font-weight: 800; fill: ${COLORS.ink}; letter-spacing: -0.6px; }
        .small { font-size: 23px; font-weight: 600; fill: ${COLORS.muted}; letter-spacing: -0.3px; }
        .chip { font-size: 23px; font-weight: 750; fill: ${accent}; }
        .white { fill: #FFFFFF; }
      </style>
    </defs>
    <rect width="1080" height="1920" fill="${COLORS.app}"/>
    <circle cx="980" cy="128" r="200" fill="${soft}" opacity="0.72"/>
    <circle cx="50" cy="430" r="120" fill="${soft}" opacity="0.45"/>
    <rect x="72" y="76" width="210" height="52" rx="26" fill="${soft}"/>
    <text x="177" y="112" text-anchor="middle" class="eyebrow">혜니캘린더</text>
    ${textLines(content.headline, 72, 210, "headline", 82)}
    <text x="72" y="405" class="subtitle">${escapeXml(content.subtitle)}</text>
    <g filter="url(#card-shadow)">
      <rect x="72" y="500" width="936" height="1230" rx="64" fill="${COLORS.card}"/>
    </g>
    <rect x="72" y="500" width="936" height="150" rx="64" fill="url(#soft-glow)"/>
    <rect x="72" y="590" width="936" height="60" fill="url(#soft-glow)"/>
    <text x="124" y="585" class="app-title">${escapeXml(content.appTitle)}</text>
    <rect x="735" y="541" width="221" height="54" rx="27" fill="#FFFFFF" stroke="${accent}" stroke-width="2"/>
    <text x="845.5" y="576" text-anchor="middle" class="demo">${escapeXml(content.demoBadge)}</text>
    ${inner}
    <text x="540" y="1830" text-anchor="middle" class="small">${escapeXml(SAFE_DEMO_FOOTER)}</text>
  </svg>`;
}

function renderHome(asset) {
  const c = asset.content;
  const rowSvg = c.rows
    .map(([time, title, detail], index) => {
      const y = 1234 + index * 150;
      return `<g><rect x="130" y="${y}" width="820" height="122" rx="24" fill="${index === 0 ? COLORS.roseSoft : COLORS.blueSoft}"/>
        <text x="168" y="${y + 49}" class="chip">${escapeXml(time)}</text>
        <text x="292" y="${y + 47}" class="body-strong">${escapeXml(title)}</text>
        <text x="292" y="${y + 84}" class="small">${escapeXml(detail)}</text>
      </g>`;
    })
    .join("");
  const signals = c.signals
    .map((signal, index) => {
      const x = 130 + index * 274;
      return `<g><rect x="${x}" y="1002" width="244" height="112" rx="24" fill="${COLORS.mintSoft}"/>
        ${icon("check", x + 39, 1058, COLORS.mint)}
        <text x="${x + 76}" y="1067" class="body">${escapeXml(signal)}</text></g>`;
    })
    .join("");
  return shell(
    asset,
    `<g>
      <rect x="122" y="700" width="836" height="236" rx="36" fill="${asset.soft}"/>
      <circle cx="230" cy="818" r="70" fill="#FFFFFF"/>
      <circle cx="230" cy="790" r="24" fill="${asset.accent}" opacity="0.8"/>
      <path d="M190 853c8-33 72-33 80 0" fill="none" stroke="${asset.accent}" stroke-width="18" stroke-linecap="round"/>
      <text x="330" y="799" class="section">${escapeXml(c.familyTitle)}</text>
      <text x="330" y="852" class="body">${escapeXml(c.familyStatus)}</text>
      <rect x="330" y="873" width="182" height="42" rx="21" fill="#FFFFFF"/>
      <text x="421" y="902" text-anchor="middle" class="chip">안전 상태 확인</text>
      ${signals}
      <text x="130" y="1195" class="section">${escapeXml(c.today)}</text>
      ${rowSvg}
    </g>`,
  );
}

function renderFreeCore(asset) {
  const c = asset.content;
  const calendar = c.weekday
    .map((day, index) => {
      const x = 188 + index * 164;
      return `<g><text x="${x}" y="793" text-anchor="middle" class="small">${escapeXml(day)}</text>
        <circle cx="${x}" cy="852" r="45" fill="${index === 2 ? asset.accent : "#FFFFFF"}" stroke="${COLORS.line}" stroke-width="2"/>
        <text x="${x}" y="864" text-anchor="middle" class="body-strong ${index === 2 ? "white" : ""}">${escapeXml(c.dates[index])}</text></g>`;
    })
    .join("");
  const rows = c.rows
    .map(([title, detail], index) => {
      const y = 1010 + index * 142;
      const iconType = ["calendar", "chat", "spark", "check"][index];
      return `<g><rect x="128" y="${y}" width="824" height="116" rx="24" fill="${index === 3 ? COLORS.goldSoft : "#FAF7F9"}"/>
        <circle cx="188" cy="${y + 58}" r="38" fill="${asset.soft}"/>
        ${icon(iconType, 188, y + 58, asset.accent)}
        <text x="250" y="${y + 49}" class="body-strong">${escapeXml(title)}</text>
        <text x="250" y="${y + 84}" class="small">${escapeXml(detail)}</text>
      </g>`;
    })
    .join("");
  return shell(
    asset,
    `<text x="130" y="735" class="section">${escapeXml(c.month)}</text>
     <rect x="128" y="755" width="824" height="165" rx="28" fill="${asset.soft}" opacity="0.55"/>
     ${calendar}
     ${rows}`,
  );
}

function planCard({ x, title, rows, color, soft, iconType }) {
  const rowSvg = rows
    .map((row, index) => `<g>${icon("check", x + 56, 1005 + index * 95, color)}
      <text x="${x + 98}" y="1014" dy="${index * 95}" class="body">${escapeXml(row)}</text></g>`)
    .join("");
  return `<g><rect x="${x}" y="800" width="390" height="512" rx="34" fill="${soft}"/>
    <circle cx="${x + 62}" cy="875" r="42" fill="#FFFFFF"/>
    ${icon(iconType, x + 62, 875, color)}
    <text x="${x + 122}" y="889" class="section">${escapeXml(title)}</text>
    <line x1="${x + 34}" y1="946" x2="${x + 356}" y2="946" stroke="${color}" stroke-opacity="0.25" stroke-width="2"/>
    ${rowSvg}
  </g>`;
}

function renderLocation(asset) {
  const c = asset.content;
  return shell(
    asset,
    `<g>
      <rect x="128" y="700" width="824" height="76" rx="24" fill="${asset.soft}"/>
      ${icon("pin", 172, 738, asset.accent)}
      <path d="M234 744c80-86 163 66 246-16s164 66 245-12 134 30 184-8" fill="none" stroke="${asset.accent}" stroke-width="8" stroke-linecap="round" stroke-dasharray="2 20"/>
      ${planCard({ x: 128, title: c.freeTitle, rows: c.freeRows, color: COLORS.blue, soft: COLORS.blueSoft, iconType: "pin" })}
      ${planCard({ x: 562, title: c.premiumTitle, rows: c.premiumRows, color: COLORS.mint, soft: COLORS.mintSoft, iconType: "spark" })}
      <rect x="128" y="1360" width="824" height="138" rx="28" fill="#FAF7F9"/>
      <text x="540" y="1419" text-anchor="middle" class="body-strong">위치 차이를 숨기지 않고 표시해요</text>
      <text x="540" y="1462" text-anchor="middle" class="small">${escapeXml(c.disclosure)}</text>
    </g>`,
  );
}

function renderSafety(asset) {
  const c = asset.content;
  const rows = c.rows
    .map((row, index) => {
      const y = 1110 + index * 130;
      return `<g><rect x="150" y="${y}" width="780" height="100" rx="24" fill="${COLORS.mintSoft}"/>
        ${icon("shield", 205, y + 50, COLORS.mint)}
        <text x="265" y="${y + 61}" class="body-strong">${escapeXml(row)}</text>
        <rect x="778" y="${y + 25}" width="118" height="50" rx="25" fill="#FFFFFF"/>
        <text x="837" y="${y + 59}" text-anchor="middle" class="chip">무료</text>
      </g>`;
    })
    .join("");
  return shell(
    asset,
    `<g>
      <rect x="128" y="710" width="824" height="310" rx="36" fill="#FFF3F5" stroke="#F8CBD8" stroke-width="3"/>
      <circle cx="220" cy="815" r="58" fill="#FFFFFF"/>
      ${icon("shield", 220, 815, COLORS.rose)}
      <text x="310" y="800" class="section">${escapeXml(c.alertTitle)}</text>
      <text x="310" y="852" class="body">${escapeXml(c.alertBody)}</text>
      <rect x="166" y="914" width="748" height="66" rx="24" fill="#FFFFFF"/>
      <text x="540" y="956" text-anchor="middle" class="body-strong">Premium 여부와 관계없이 전달</text>
      ${rows}
      <text x="540" y="1555" text-anchor="middle" class="small">${escapeXml(c.disclosure)}</text>
    </g>`,
  );
}

function renderPremium(asset) {
  const c = asset.content;
  const rows = c.rows
    .map(([title, detail], index) => {
      const y = 710 + index * 164;
      const types = ["check", "pin", "shield", "spark", "chat"];
      return `<g><rect x="128" y="${y}" width="824" height="138" rx="28" fill="${index % 2 === 0 ? asset.soft : "#FAF7F9"}"/>
        <circle cx="198" cy="${y + 69}" r="42" fill="#FFFFFF"/>
        ${icon(types[index], 198, y + 69, asset.accent)}
        <text x="266" y="${y + 58}" class="body-strong">${escapeXml(title)}</text>
        <text x="266" y="${y + 96}" class="small">${escapeXml(detail)}</text>
      </g>`;
    })
    .join("");
  return shell(asset, `<g>${rows}</g>`);
}

function renderPrice(asset) {
  const c = asset.content;
  const compareRows = [...c.freeRows, ...c.premiumRows]
    .map((row, index) => {
      const column = index < c.freeRows.length ? 0 : 1;
      const rowIndex = index % c.freeRows.length;
      const x = column === 0 ? 160 : 580;
      const y = 1230 + rowIndex * 88;
      const color = column === 0 ? COLORS.blue : COLORS.rose;
      return `<g>${icon("check", x, y, color)}<text x="${x + 42}" y="${y + 9}" class="small">${escapeXml(row)}</text></g>`;
    })
    .join("");
  return shell(
    asset,
    `<g>
      <rect x="128" y="710" width="824" height="224" rx="36" fill="${asset.soft}"/>
      <text x="176" y="778" class="body-strong">${escapeXml(c.annualTitle)}</text>
      <text x="176" y="852" class="section">${escapeXml(c.annualPrice)}</text>
      <rect x="690" y="765" width="210" height="104" rx="28" fill="${asset.accent}"/>
      <text x="795" y="828" text-anchor="middle" class="body-strong white">추천 플랜</text>
      <rect x="128" y="960" width="824" height="168" rx="36" fill="#FAF7F9" stroke="${COLORS.line}" stroke-width="2"/>
      <text x="176" y="1022" class="body-strong">${escapeXml(c.monthlyTitle)}</text>
      <text x="176" y="1081" class="section">${escapeXml(c.monthlyPrice)}</text>
      <text x="160" y="1188" class="chip" fill="${COLORS.blue}">Free</text>
      <text x="580" y="1188" class="chip">Premium</text>
      ${compareRows}
      <rect x="128" y="1515" width="824" height="122" rx="28" fill="${COLORS.goldSoft}"/>
      <text x="540" y="1562" text-anchor="middle" class="small">${escapeXml(c.trial)}</text>
      <text x="540" y="1604" text-anchor="middle" class="small">${escapeXml(c.disclosure)}</text>
    </g>`,
  );
}

const RENDERERS = Object.freeze({
  home: renderHome,
  freeCore: renderFreeCore,
  location: renderLocation,
  safety: renderSafety,
  premium: renderPremium,
  price: renderPrice,
});

export async function verifyStoreAssetSourceContracts() {
  for (const contract of SOURCE_CONTRACTS) {
    const source = await readFile(resolve(ROOT_DIR, contract.path), "utf8");
    for (const pattern of contract.patterns) {
      if (!pattern.test(source)) {
        throw new Error(`스토어 자산 정본 불일치: ${contract.path} / ${pattern}`);
      }
    }
  }
}

export async function generateSafeStoreAssets({ outputDir = SAFE_STORE_CREATIVE_DRAFT_DIR } = {}) {
  await verifyStoreAssetSourceContracts();
  const targetDir = resolve(outputDir);
  await mkdir(targetDir, { recursive: true });

  const generated = [];
  for (const asset of SAFE_STORE_ASSETS) {
    const render = RENDERERS[asset.kind];
    if (!render) throw new Error(`지원하지 않는 스토어 자산 유형: ${asset.kind}`);
    const svg = render(asset);
    const outputPath = resolve(targetDir, asset.file);
    await sharp(Buffer.from(svg))
      .flatten({ background: COLORS.app })
      .removeAlpha()
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, effort: 10 })
      .toFile(outputPath);
    generated.push(outputPath);
  }
  return generated;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = await generateSafeStoreAssets();
  process.stdout.write(`개인정보 없는 내부 creative draft ${files.length}개 생성 완료: ${SAFE_STORE_CREATIVE_DRAFT_DIR}\n`);
}
