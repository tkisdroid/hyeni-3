import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../routes/legal.ts", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../index.ts", import.meta.url), "utf8");

test("공개 법적 문서는 자연스러운 서비스명 조사와 최신 갱신일을 사용한다", () => {
  assert.match(source, /lastUpdated:\s*"2026-09-01"/);
  assert.match(source, /\$\{META\.serviceName\}가 어떤 정보를/);
  assert.match(source, /\$\{META\.serviceName\}의 계정과 데이터를/);
  assert.doesNotMatch(source, /\$\{META\.serviceName\}이 어떤 정보를/);
  assert.doesNotMatch(source, /\$\{META\.serviceName\}\(이하 '서비스'\)은/);
  assert.doesNotMatch(source, /\$\{META\.serviceName\}\(이하 '서비스'\)이 제공/);
  assert.doesNotMatch(source, /\$\{META\.serviceName\}은 이용자가/);
});

test("공개 법적 문서의 기본 아이콘 요청은 캐시 가능한 SVG로 응답한다", () => {
  assert.match(source, /export const LEGAL_FAVICON_SVG/);
  assert.match(source, /image\/svg\+xml/);
  assert.match(indexSource, /app\.get\("\/favicon\.ico"/);
});

test("공개 법적 HTML은 Worker 응답 자체에서 브라우저 보안 헤더를 강제한다", () => {
  for (const header of [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ]) {
    assert.match(source, new RegExp(`"${header}"`));
  }
  assert.match(source, /default-src 'none'/);
  assert.match(source, /frame-ancestors 'none'/);
  assert.match(source, /camera=\(\), microphone=\(\), geolocation=\(\)/);
});

test("주변 소리 처리와 세션 기록을 실제 동작대로 구분해 고지한다", () => {
  assert.match(source, /최대 1분 동안 실시간으로 전송/);
  assert.match(source, /실시간 음성 청크는[^\n]+장기 보관하지 않습니다/);
  assert.match(source, /세션 기록은 오남용 방지와 이용 내역 확인/);
  assert.match(source, /자녀 기기에 지속 알림/);
});

test("계정 삭제와 Google Play 구독 해지를 별도 절차로 안내한다", () => {
  assert.match(source, /계정 삭제만으로 Google Play 구독이 자동 해지되지는 않습니다/);
  assert.match(source, /결제 및 정기 결제/);
});

test("이용약관은 안전 기능 한계, 투명한 주변 소리 실행, 구독 해지를 실제 동작대로 안내한다", () => {
  assert.match(source, /export function termsOfServiceHtml/);
  assert.match(source, /아이가 별도 허용 버튼을 누르지 않아도 최대 1분/);
  assert.match(source, /듣는 동안 자녀 기기 화면과 알림에 실행 사실이 계속 표시/);
  assert.match(source, /이용 내역이 기록/);
  assert.doesNotMatch(source, /자녀 기기에서 동의한 경우 최대 1분/);
  assert.match(source, /112 또는 119/);
  assert.match(source, /앱 계정 삭제만으로 Google Play 구독이 자동 해지되지는 않습니다/);
});

test("이용약관은 UGC 금지 콘텐츠, 앱 내 신고·메모 차단과 안전 알림 예외를 고지한다", () => {
  assert.match(source, /이용자 콘텐츠·AI 답변 신고와 메모 차단/);
  assert.match(source, /괴롭힘, 혐오·차별, 성적·폭력적 내용/);
  assert.match(source, /메모 조회·푸시에만 적용/);
  assert.match(source, /위치 공유, SOS, 도착·위험장소 등 안전 알림은 중단하지 않습니다/);
  assert.match(source, /상대가 보낸 가족 메모를 길게 눌러/);
  assert.match(source, /AI 친구 답변을 길게 눌러 '이 답변 신고'/);
  assert.doesNotMatch(source, /해당 메시지 아래의 '신고·차단'|답변 아래의 '이 답변 신고'/);
  assert.match(source, /이의가 있는 경우/);
});

test("처리방침은 AI·UGC·음성 인식·설치 앱의 실제 처리 범위를 포함한다", () => {
  assert.match(source, /일정 사진·텍스트 분석 및 AI 요약/);
  assert.match(source, /설치된 앱 이름·패키지 식별자/);
  assert.match(source, /AI 답변·가족 메모 신고/);
  assert.match(source, /운영체제 또는 브라우저의 음성 인식 서비스/);
  assert.match(source, /일정·AI 친구 음성 입력/);
  assert.match(source, /Worker와 OpenAI에는 음성 원본이 아니라 인식된 텍스트만 전송/);
  assert.match(source, /Android TextToSpeech/);
  assert.match(source, /Web speechSynthesis/);
  assert.match(source, /합성할 AI 답변 텍스트/);
  assert.match(source, /진단 정보 함께 보내기/);
  assert.match(source, /최근 24시간의 정규화된 오류 최대 12건/);
  assert.match(source, /위치 좌표·사진·비밀번호·로그인 및 구매 토큰·원문 오류 제외/);
});

test("위치정보 확인자료는 좌표 없는 고정 항목·자동 기록·최소 6개월·동의철회 예외를 정확히 고지한다", () => {
  assert.match(source, /위치정보 수집·이용·제공사실 확인자료/);
  assert.match(source, /행위 구분.*위치정보주체·요청자·제공받는 자의 최소 내부 식별자/);
  assert.match(source, /수집 방법·취득 경로·서비스·전달 방법·목적 코드/);
  assert.match(source, /실제 위도·경도·주소와 자유 형식 내용은 저장하지 않습니다/);
  assert.match(source, /전자적으로 자동 기록/);
  assert.match(source, /법정 최소 보존기간인 6개월 이상/);
  assert.match(source, /6개월보다 오래된 기록부터 순차 삭제/);
  assert.match(source, /동의 철회·권한 해제·페어링 해제·계정 삭제.*최소 6개월 동안 분리 보관/);
  assert.match(source, /본인 또는 같은 가족의 활성 자녀 범위 기록을 조회/);
});

test("처리방침은 실제 외부 전송업체·필드를 열거하고 증거 전 서비스 제공자 예외를 단정하지 않는다", () => {
  for (const processor of [
    "Cloudflare",
    "Firebase Cloud Messaging",
    "Google Play",
    "OpenAI",
    "Kakao",
    "Google OAuth",
    "Kakao OAuth",
    "Naver OAuth",
    "Resend",
    "NCP SENS",
    "공개 OSRM",
    "SpeechRecognizer",
    "Web Speech",
    "TextToSpeech",
    "speechSynthesis",
  ]) {
    assert.match(source, new RegExp(processor));
  }
  for (const field of [
    "senderName",
    "senderEmail",
    "senderRole",
    "senderUserId",
    "familyId",
    "content",
    "currentScreen",
    "deviceInfo",
    "errorLogs",
    "전화번호",
    "6자리 OTP",
    "출발·도착 좌표",
  ]) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /계약[^\n]*보관[^\n]*2차 이용/);
  assert.match(source, /증거가 모두 확보되기 전[^\n]*서비스 제공자 예외[^\n]*적용하지 않습니다/);
  assert.doesNotMatch(source, /개인정보를 정보주체\(또는 법정대리인\)의 동의 없이 외부에 제공하지 않습니다/);
});

test("신규 결제는 Android Google Play 전용이고 iPhone·웹의 이용 범위를 정확히 고지한다", () => {
  assert.match(source, /신규 구독과 AI 크레딧 구매는 Android 앱의 Google Play에서만 가능/);
  assert.match(source, /iPhone과 웹에서는 무료 기능과 무료 AI 제공량/);
  assert.match(source, /Android에서 같은 계정으로 구독한 프리미엄 권한은 iPhone과 웹에서도 이용/);
  assert.match(source, /구독 변경·해지는 Android 앱의 Google Play/);
  assert.match(source, /카드번호·유효기간·CVC 원문을 수집하거나 저장하지 않습니다/);
  assert.match(source, /환불과 청약철회는 관계 법령 및 Google Play/);
  assert.doesNotMatch(source, /Toss Payments|iPhone 홈 화면 웹 구독|웹 자동결제/);
});

test("Google Play AI 크레딧은 일회성 결제·환불 회수·토큰 최소처리를 고지한다", () => {
  assert.match(source, /Android Google Play의 AI 크레딧 팩/);
  assert.match(source, /전액 취소된 구매를 확인하면 지급분을 한 번 회수/);
  assert.match(source, /이미 사용한 수량은 다음 유료 크레딧 충전에서 먼저 상계/);
  assert.match(source, /구매 token은 비가역 해시만 저장/);
});

test("Google Play 환불 상계와 추천 보상 조건·최소 수집 항목을 정확히 고지한다", () => {
  assert.match(source, /Google Play에서 전액 취소된 구매를 확인하면 지급분을 한 번 회수/);
  assert.match(source, /친구 초대 보상은 유료 구독권이 아니라 양쪽 가족에 각각 AI 대화 50회/);
  assert.match(source, /초대 가족 수 상한은 없습니다/);
  assert.doesNotMatch(source, /양쪽 가족에 AI 대화 10회|최대 3가족/);
  assert.match(source, /신규 가족 생성 72시간 경과와 첫 실제 위치 저장 후 48시간 유지/);
  assert.match(source, /위치 좌표·주소·이름은 추천 기록에 저장하지 않음/);
});

test("공개 삭제 안내는 주 보호자·공동 보호자·아이·선생님 계약을 구분하고 즉시 전체 삭제를 과장하지 않는다", () => {
  assert.match(source, /주 보호자[^\n]*소유한 가족 범위/);
  assert.match(source, /독립 로그인[^\n]*다른 가족[^\n]*선생님 관계/);
  assert.match(source, /공동 보호자[^\n]*본인 계정[^\n]*다른 가족 구성원의 계정과 가족 데이터는 유지/);
  assert.match(source, /아이 계정[^\n]*본인 계정과 본인 연결[^\n]*가족 소유 데이터는 유지/);
  assert.match(source, /선생님[^\n]*본인 계정[^\n]*반·학생 연결·알림장·출결/);
  assert.match(source, /삭제 작업이 끝난 뒤 성공으로 안내/);
  assert.doesNotMatch(source, /가족·자녀 데이터가 즉시 영구 삭제/);
});
