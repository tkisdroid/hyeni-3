# 혜니캘린더 글로벌 Google 지도·위치 설계

- 작성일: 2026-08-26
- 상태: 대화 설계 승인, 구현 계획 작성 완료
- 대상: PWA, Capacitor Android, Cloudflare Worker, D1
- 확정 정책: `KR → Kakao`, 승인된 비중국 국가 → Google Maps, `CN/ZZ → 미지원`
- 자격 상태: Google Maps Platform 결제 프로젝트·API 키·서비스 계정 미발급

> 이 문서는 `docs/superpowers/specs/2026-08-15-global-version-design.md`와
> `docs/superpowers/plans/2026-08-15-global-timezone-maps-auth.md`의 **지도 공급자 부분만** 대체한다.
> 두 문서의 Mapbox 구현 지시는 실행하지 않는다. 국가·시간대·해외 로그인에 관한 나머지 계약은 유지하며,
> 특히 비한국 국가 활성화 전에 기존 시간대 계획을 먼저 완료해야 한다.
> 구현 순서와 TDD 단위의 정본은
> `docs/superpowers/plans/2026-08-26-global-locale-google-maps.md`다. 비지도 기능은 기존 locale 번역 체계를
> 유지하고, 공급자 변경은 지도 렌더링·검색·역지오코딩·경로·외부 링크에만 적용한다.
>
> **2026-08-26 최종 범위 재확인:** 이번 실행에서는 가족 시간대/DST, Google Place ID 장기 저장·refresh,
> 장소 provider metadata, 친구놀이 snapshot/v2 table을 구현하지 않는다. 검색·주소·경로의 Google 데이터는
> 해당 요청과 화면에서만 임시 사용하고, 저장이 필요하면 기존 schema에 사용자가 직접 입력한 별칭과 별도로
> 확정한 핀 좌표만 기록한다. 시간대/DST는 non-KR 출시의 별도 선행 gate이며 이 문서의 구현 범위가 아니다.

## 배경과 문제

현재 지도 소비 화면은 `KakaoMap`과 Kakao SDK에 직접 결합돼 있다. 부모 위치·위치 이력·SOS·장소 및 위험구역 등록,
일정 장소 선택, 메모 위치, 길찾기가 모두 Kakao 로더나 `/api/kakao/*` API를 직접 사용한다. 해외에서 GPS 좌표가
수집되더라도 지도 표시, 장소 검색, 역지오코딩, 도보경로를 끝까지 사용할 수 있다는 보장이 없다.

지도 장애가 위치 수집·SOS·지오펜스까지 멈추게 해서는 안 된다. 반대로 지도 화면만 바꾸고 Worker의 Kakao
역지오코딩·경로 경계를 그대로 두면 해외 좌표가 계속 한국 공급자로 전송된다. 따라서 지도 렌더러, 지도 서비스,
국가 정책, 장소 식별자를 함께 공급자 중립 경계로 옮긴다.

## 목표

1. 한국 가족은 기존 Kakao 지도 동작을 그대로 유지한다.
2. 승인된 중국 외 국가에서 웹은 Google Maps JavaScript API, Android는 Maps SDK for Android를 사용한다.
3. 중국 본토와 국가 미확정 상태에서는 외부 지도 호출을 하지 않는다.
4. 부모 위치·위치 이력·SOS·장소·위험구역·일정 장소·메모 위치·길찾기를 하나의 지도 계약으로 제공한다.
5. GPS 수집, 위치 저장, SOS, 등록장소 지오펜스와 도착·출발 상태머신을 지도 공급자 장애와 분리한다.
6. 기존 가족·장소·친구놀이 내부 ID와 위치 기록을 파괴적으로 변경하지 않는다.
7. Google 자격이 없는 동안에도 코드·마이그레이션·자동 테스트는 완료할 수 있고, 실제 API 경로는 fail-closed한다.

## 비목표

- 중국용 Amap·Baidu·Tencent 지도는 이번 범위에 넣지 않는다.
- 지도 내 턴바이턴 내비게이션을 새로 만들지 않는다.
- Google 실패 시 Kakao·ORS·OSRM으로 자동 전환하지 않는다.
- 기존 실사용 가족의 국가·역할·세션·페어링을 시험 목적으로 변경하지 않는다.
- Google Maps Platform 자격 생성, 결제 연결, 운영 secret 변경, D1 운영 migration, Pages·Worker·Play 배포를
  자동 수행하지 않는다.
- 사용 국가를 GPS 좌표나 IP만으로 추정해 기존 가족의 정본 국가를 덮어쓰지 않는다.

## 국가와 공급자 정본

### 가족 국가

- 지도 공급자 선택에 필요한 `families.country_code`만 서버 정본으로 추가한다.
- 기존 가족은 정확히 `KR`로 유지한다.
- 신규 가족은 가입 과정에서 지원 국가를 명시 선택한다. edge country는 초기 제안값일 뿐이며 사용자가 확인한
  값만 저장한다. locale이나 GPS 좌표를 가족 국가로 대신 사용하지 않는다.
- 가입 전 `GET /api/access-region` 결과는 제안값일 뿐이다. 로그인·가족 생성 후에는 지도 공급자 결정에 쓰지 않는다.
- 가족 국가 변경은 주 보호자만 할 수 있고, 기존 UTC 시각·`date_key`·장소 좌표를 재작성하지 않는다.
- 가족 시간대와 DST 보정은 이 변경에 포함하지 않는다. 별도 시간대 계획의 검증 증거가 없으면 non-KR 출시는
  계속 `HOLD`다.

### 공급자 정책

```ts
type MapProvider = "kakao" | "google" | "unsupported";

type MapPolicy =
  | { provider: "kakao"; countryCode: "KR" }
  | { provider: "google"; countryCode: string }
  | { provider: "unsupported"; reason: "country_unresolved" | "china_unsupported" | "country_not_enabled" };
```

- `KR`은 Kakao다.
- `CN`은 `china_unsupported`, `ZZ`·누락·형식 오류는 `country_unresolved`이다.
- 그 밖의 ISO 국가 중 운영 allowlist에 활성화된 국가만 Google이다.
- 제품 목표는 중국을 제외한 국가를 순차 지원하는 것이지만, 실제 스토어 국가는 지도 타일·Geocoding·Walking
  coverage와 실기기 검증을 통과한 순서대로 활성화한다.
- 비한국 allowlist는 별도 글로벌 시간대 계획의 `family_day`, 수신자 quiet hours, 위치 이력 오전 8시 경계,
  위치 보존·quota, 일정·도착 겹침과 cron의 DST 회귀가 모두 완료되기 전까지 비활성 상태로 둔다. 지도만 통과했다고
  비한국 국가를 열지 않는다. 기존 `date_key` 인코딩과 모든 시간 판정은 이번 작업에서 변경하지 않는다.
- 공급자 정책은 클라이언트와 Worker가 같은 table-driven fixture를 공유해 드리프트를 막는다.
- 가족 국가를 벗어난 여행·국경 횡단 경로의 자동 공급자 전환은 1차 범위에 넣지 않는다.

## 플랫폼 아키텍처

### 선택안

비한국 Google 지도는 공식 `@capacitor/google-maps@8.0.1`을 exact dependency로 사용한다. 이후 버전 갱신은
별도 호환성 검증 없이 자동 적용하지 않는다.

| 실행 환경 | 렌더러 | 자격 제한 |
|---|---|---|
| 웹·iPhone 홈 화면 PWA | Maps JavaScript API | 운영 HTTPS origin + Maps JavaScript API |
| Capacitor Android | Maps SDK for Android | `com.hyeni.calendar` + debug/release/Play App Signing SHA-1 |
| 한국 웹·Android | 기존 Kakao JavaScript SDK | 기존 Kakao 앱 제한 유지 |

Android 번들 문서는 `https://localhost` WebView에서 열리므로 website-referrer 제한을 운영 보안 경계로 사용하지
않는다. Android는 네이티브 SDK 키를 AndroidManifest metadata로 주입하고, 웹 키와 Android 키를 재사용하지 않는다.
공식 플러그인 `8.0.1`의 Android `create()`는 JavaScript의 `apiKey` 값을 사용하지 않고 Manifest metadata를 읽는다.
따라서 별도 key bridge를 만들지 않고 native create에는 TypeScript 계약을 위한 빈 sentinel `apiKey: ""`만 전달한다.
실제 키 값은 로그·진단·PWA bundle에 넣지 않는다. 키는 APK에서 추출될 수 있음을 전제로 package+SHA-1 restriction과
API restriction을 실제 보안 경계로 삼고, 이 플러그인 소스 계약을 pinned-version 테스트로 고정한다.

Android 네이티브 지도는 WebView 아래에 렌더되므로 지도 route가 활성인 동안 map host부터 WebView root까지 필요한
배경 계층을 투명하게 만들고, route를 벗어나면 모두 원래의 불투명 배경으로 복원한다. 모달·바텀시트는 투명 지도
위의 DOM overlay로 유지한다. 포인터 이벤트·스크롤·앱 background·route 전환·재진입에서 map view가 다른 화면 위에
남거나 비지도 화면이 투명해지는지를 전용 회귀로 검증한다.

### 공급자 중립 컴포넌트

화면은 `KakaoMap`이나 Google SDK 타입을 직접 import하지 않고 `FamilyMap`만 사용한다.

```ts
interface MapScene {
  center?: LatLngPoint | null;
  centerLevel?: number | null;
  recenterKey?: number;
  viewportPadding?: Partial<MapViewportPadding>;
  child?: MapChild | null;
  zones?: MapZone[];
  places?: MapPlace[];
  picked?: LatLngPoint | null;
  destination?: MapPlace | null;
  route?: LocationRoutePoint[];
  stays?: MapStay[];
  onPick?: (lat: number, lng: number) => void;
  accessibility?: {
    selectedItemId?: string | null;
    onSelectItem?: (itemId: string) => void;
    onRecenter?: () => void;
    onUseDeviceLocation?: () => void;
    onSubmitCoordinates?: (lat: number, lng: number) => void;
  };
}

interface MapAdapter {
  mount(host: HTMLElement, scene: MapScene, lifecycle: { signal: AbortSignal; generation: number }): Promise<MapController>;
  update(controller: MapController, scene: MapScene, lifecycle: { signal: AbortSignal; generation: number }): Promise<void>;
  destroy(controller: MapController): Promise<void>;
}

class MapAdapterError extends Error {
  code: MapErrorCode;
  retryable: boolean;
}
```

- `FamilyMap`은 가족 국가가 확정된 뒤 `KakaoMapAdapter`, `GoogleMapAdapter`, `UnsupportedMap` 중 하나를
  lazy import한다.
- 셸과 부모 홈의 무조건 `warmKakaoMaps()`는 제거한다. 지도 route 진입 전에는 어떤 공급자 SDK도 받지 않는다.
- 기존 `KakaoMap`의 명시 중심 우선순위, `recenterKey`, viewport padding, 사용자 확대 존중, bounds,
  마커·위험구역 원·경로·체류선·아이 아바타 계약을 두 adapter에 동일하게 구현한다.
- `FamilyMap`은 mount/update마다 generation과 `AbortSignal`을 소유한다. 늦게 끝난 create/update는 현재 generation을
  확인한 뒤 즉시 destroy하고 state를 갱신하지 않는다. `destroy`는 부분 생성·중복 호출에도 안전한 idempotent다.
  adapter는 임의 문자열이나 provider 원문을 throw하지 않고 `MapAdapterError`만 throw하며 `FamilyMap`이 code와
  retryable만 상태·locale 문구로 변환한다. 원래 cause는 사용자 응답이나 일반 운영 로그에 노출하지 않는다.
- Google native marker가 DOM custom overlay를 지원하지 않는 경우 아바타 이미지를 안전하게 래스터화한 marker와
  별도 DOM 접근성 목록·동일 액션을 사용한다. `FamilyMap`은 scene의 아이·장소·목적지·경로 지점을 DOM 목록으로
  렌더하고 선택·재중앙·기기 위치 사용을 제공한다. picker에는 검색과 분리된 위도·경도 숫자 입력도 제공해 키보드·
  스크린리더가 직접 핀과 동등하게 선택할 수 있게 한다. native 지도는 시각적 보조이며 사용자 문자열을 HTML로
  조합하지 않는다.
- 공급자를 바꿀 때 이전 controller와 listener를 먼저 destroy해 지도·클릭 이벤트가 겹치지 않게 한다.
- 웹 Google 지도는 앱 locale을 Google 지원 BCP 47 `language`로 정규화하고 가족 국가를 `region`으로 사용한다.
  공식 Capacitor 플러그인의 `language`·`region` 설정은 web-only이므로 Android native 지도는 Maps SDK·기기 locale을
  따른다. 앱 locale과 지도 라벨이 다른 실기기 조합을 각 출시 locale에서 검증하고, 사용자 이해를 해치는 조합은
  그 locale의 Android 활성화를 막거나 다른 native 해법을 선택한다. 지도 공급자가 반환한 장소명과 주소를 앱
  번역문처럼 재번역하지 않는다.

#### Android native surface 수명

- ref-counted `NativeMapTransparencyLease`가 첫 Google native map에서 map host→WebView root의 기존 inline/computed
  배경값을 한 번 보존하고 투명화한다. 마지막 lease의 정상 unmount, provider 교체, create/update 실패, abort,
  route 이탈에서 `finally`로 원래 값을 정확히 복원한다. Kakao WebView와 unsupported/pending 상태는 lease를 얻지 않는다.
- controller는 host의 `ResizeObserver`, scroll, visual viewport·orientation 변화를 받아 native rect를 동기화한다.
  앱 background에서는 surface를 숨기고 foreground에서 현재 generation·host 연결 여부를 확인한 뒤 rect와 visibility를
  복원한다.
- DOM modal·bottom sheet·scrim이 열린 영역은 native touch forwarding에서 제외한다. 중첩 picker와 크기가 변하는
  등록 폼을 포함해 overlay 위 ghost touch, 닫힌 route의 listener, 뒤 화면에 남는 surface를 차단한다.

### 지도 소비 화면

다음 화면은 모두 `FamilyMap`과 공급자 중립 지도 서비스만 사용해야 한다.

- 부모 현재 위치와 위치 이력
- SOS 수신
- 저장장소 등록·편집
- 위험구역 등록·편집
- 일정 장소 선택
- 메모 위치 공유·열기
- 길찾기와 아이 RouteSheet

비시각 지도 소비처도 같은 범위다. `useLocationLabels()`를 쓰는 부모 홈, 가족 목록, 자녀 상세, 위치 상태,
안심리포트, 주변소리 화면은 `/api/kakao/reverse-geocode`를 직접 호출하지 않고 공통 reverse API를 사용한다.
`RouteSheet`와 `useWalkingRoute`는 공통 directions API로 옮기고, `RouteView`의 직접 Google URL을 포함한 모든 외부
링크는 공통 helper만 사용한다. `MapPickerSheet`·장소·위험구역·`RouteView`의 Kakao client geocoder/search와
`MemoChat`의 Kakao geocoder·직접 Kakao 외부 링크도 각각 공통 search/reverse/helper로 이관한다.

외부 지도 링크도 `buildExternalMapUrl(provider, kind, point, label)` 하나를 거친다. `CN`과 미지원 국가는 외부
지도 링크를 만들지 않는다.

## Worker 지도 서비스

### 공통 endpoint

```text
POST /api/maps/search
POST /api/maps/reverse
POST /api/maps/directions
```

- 모든 endpoint는 access JWT를 요구한다.
- Worker는 요청의 `countryCode`를 신뢰하지 않고 사용자의 활성 가족과 `families.country_code`를 읽는다.
- body의 `familyId`는 selector일 뿐이며 `assertFamilyAccess`를 통과해야 한다.
- 교사 세션은 지도 proxy를 사용할 수 없다.
- `CN`, 미확정 국가, 비활성 국가, 자격 누락, quota DB 실패는 외부 fetch 전에 닫는다.
- 응답은 `Cache-Control: private, no-store`다.

### 검색

`/api/maps/search`는 검색어, locale, Worker가 발급한 autocomplete session handle, 선택적인 location bias를 받는다.

- 최소 입력 길이, 최대 길이, 허용 문자 수, debounce 계약과 가족·사용자 단위 rate limit을 적용한다.
- Google은 Places API (New) v1과 최소 field mask만 사용한다.
- 검색 결과는 메모리 UI 상태에만 두며 Worker·D1·브라우저 저장소에 캐시하지 않는다.
- session handle은 사용자·가족·provider·무작위 nonce·5분 만료를 묶어 Worker HMAC으로 서명한다. provider session
  token은 nonce와 Worker secret에서 결정적인 UUID 형식으로 파생해 isolate가 달라도 재현하되 handle에 넣지 않는다. D1에는
  handle의 별도 HMAC digest와 consumed/expiry 상태만 두고 raw token을 로그·응답·D1에 평문으로 저장하지 않는다.
- 사용자가 결과를 선택하면 같은 handle과 Place ID로 1회 Details를 조회한다. 원자적인 digest consume으로 재사용·
  타 사용자·타 가족·만료 handle을 provider fetch 전에 거부하고 session을 종료한다.
- 결과의 `providerPlaceId`, 표시명, 주소, 좌표는 저장 확정 전까지 ephemeral이다.
- Google 결과 선택이나 단순 확인은 Google 이름·주소·좌표를 장기 저장할 수 있는 근거가 아니다. 결과는 지도 preview와
  검색 세션에만 쓰고, 안전 장소를 저장하려면 별도 단계에서 사용자가 직접 별칭을 입력하고 GPS 또는 직접 탭·이동한
  핀을 확정해야 한다. 검색 결과 좌표를 그대로 둔 채 저장 버튼만 누르는 동선은 허용하지 않는다.

### 역지오코딩

`/api/maps/reverse` 입력은 다음 union만 허용한다.

```ts
type ReverseSource =
  | { kind: "child_location"; childUserId: string; recordedAt?: string }
  | { kind: "saved_place"; savedPlaceId: string }
  | { kind: "academy"; academyId: string }
  | { kind: "event"; eventId: string }
  | { kind: "picker_pin" | "memo_share"; lat: number; lng: number };
```

- 객체 참조는 Worker가 가족 소유권과 실제 좌표를 다시 읽는다.
- `child_location.recordedAt`이 있으면 그 아이의 정확히 같은 측정 행만 읽고, 없으면 최신 행과 실제 `measuredAt`을
  응답한다. 역지오코딩은 과거 위치도 표시할 수 있지만 측정 시각을 숨기지 않는다.
- saved place·academy·event는 현재 활성 가족 소유권을 다시 확인한다.
- 새 핀과 메모 위치처럼 저장 전 좌표가 필요한 두 목적만 원시 좌표를 허용한다.
- 원시 좌표는 소수점 이하 최대 7자리, 범위·payload 크기·전용 저quota를 적용하고 요청 처리 뒤 Worker가 보존하지
  않으며 로그·cache key에 넣지 않는다.
- Google은 Geocoding API v4를 사용한다. 주소는 사용자 표시용이며 지오펜스 판정 입력으로 사용하지 않는다.

### 도보 경로

`/api/maps/directions`는 서버가 확인할 수 있는 child/event/place ref를 우선 사용하고, 부모·아이 기기의 현재
좌표가 필요한 경우에만 `device_coordinate` 입력을 허용한다.

```ts
type WalkingRouteResponse =
  | {
      policyProvider: "kakao" | "google";
      routeSource: "kakao" | "ors" | "osrm" | "google";
      distanceMeters: number;
      durationSeconds: number | null;
      points: LatLngPoint[];
      quality: "provider_route";
      warnings: Array<"walking_data_incomplete">;
    }
  | {
      policyProvider: "kakao" | "google";
      routeSource: "none";
      distanceMeters: null;
      durationSeconds: null;
      points: [];
      quality: "unavailable";
      warnings: Array<"walking_data_incomplete">;
    };
```

- Google은 Routes API v2의 `WALK`와 최소 field mask를 사용한다.
- 최신 아이 위치를 origin으로 쓰면 측정 시각이 요청 시각 기준 5분 이내여야 하며 아니면
  `409 map_location_stale`로 닫는다. 저장장소·학원·일정 ref는 활성 가족 소유권을 확인하고, 원시 기기 좌표는
  소수점 이하 최대 7자리·요청 전용·저quota 계약을 적용한다.
- Google 도보 데이터의 불완전 가능성을 모든 locale에서 안내한다.
- Google 정책 가족은 `routeSource=google|none`만 허용하고 다른 공급자로 fallback하지 않는다. 한국은 기존
  `Kakao → ORS → OSRM` 순서를 보존하되 실제 공급자를 `routeSource`에 그대로 노출한다.
- provider route 실패 시 서버는 합성선을 반환하지 않는다. 클라이언트가 로컬에서 명시적 `straight_line` 참고선을
  만들 때 거리·시간은 모두 `null`이며 실제 도보경로로 표시하지 않는다. 재시도와 허용된 외부 지도 버튼을 함께 제공한다.

### cron과 백그라운드 경로

`arrivalDetect`, 미등록 체류, 위치 라벨 생성은 직접 Kakao helper를 호출하지 않고 공통 map service를 사용한다.
cron은 대상 가족의 `country_code`를 D1에서 읽는다. 국가나 자격이 불명확하면 외부 호출 없이 locale별 일반 장소명으로
강등하며 도착·출발 상태머신은 계속 진행한다.

## 자격 증명과 비용 경계

지도 자격은 Google 로그인 OAuth와 완전히 분리한다.

| 용도 | 저장 위치 | 제한 |
|---|---|---|
| PWA 지도 키 | Pages build env(클라이언트 공개값) | 운영 origin과 Maps JavaScript API |
| Android 지도 키 | 로컬/CI Gradle property → AndroidManifest placeholder | package + SHA-1과 Maps SDK for Android |
| Worker 지도 서비스 계정 | Wrangler secrets | Places·Geocoding·Routes에 필요한 최소 OAuth scope |

- 웹 키를 Android에, Android 키를 PWA에, 로그인 OAuth client를 지도 호출에 재사용하지 않는다.
- PWA 운영 키의 허용 origin은 정확히 `https://hyenicalendar.com`, `https://www.hyenicalendar.com`,
  `https://hyeni-calendar.pages.dev`다. 임시 Pages preview hash나 wildcard를 운영 키에 넣지 않고, staging은 별도
  프로젝트·키와 정확한 staging origin을 사용한다.
- PWA bundle에는 Worker 서비스 계정과 Android key를 넣지 않는다.
- Worker는 서비스 계정 JWT로 짧은 access token을 발급받고 만료보다 짧게 메모리 캐시한다.
- 필요한 Google endpoint가 서비스 계정 OAuth를 지원하지 않는 것으로 구현 중 확인되면 unrestricted API key로
  강등하지 않고 해당 기능을 blocked로 보고한다.
- Google Cloud project는 web·android·worker를 비용과 사고 범위별로 분리할 수 있게 구성한다.
- Budget alert는 차단 장치가 아니므로 API별 quota cap과 앱/Worker rate limit을 함께 적용한다.
- wildcard field mask는 금지한다.
- Google Maps Platform 약관 적용 주체가 결제 계정 주소에 따라 달라질 수 있으므로, EEA 등 출시 국가는 실제 billing
  entity·주소 기준 약관과 개인정보 이전 조건을 법률 검토한 뒤에만 allowlist를 연다.

현재 자격이 없으므로 설정 예시에는 빈 변수 이름만 추가한다. 가짜 키·다른 Google OAuth 자격·기존 Play 서비스
계정을 재사용하지 않는다.

## 저장 경계와 기존 데이터 보존

- `saved_places.id`, `academies.id`, `public_places.id`, `public_place_id`, 기존 `kakao_place_id`, 친구놀이 invite/session
  schema와 기존 위치 bytes를 그대로 유지한다. provider field, provider Place ID, refresh metadata, v2 장소 JSON,
  친구놀이 snapshot table을 추가하지 않는다.
- Google Autocomplete의 Place ID·표시명·주소·좌표는 5분 검색 session과 1회 Details 선택 화면에서만 임시 사용한다.
  D1 업무 table, `edge_cache`, 브라우저 저장소, 분석 이벤트, 운영 로그에 장기 저장하지 않는다.
- 검색 결과 선택은 지도 중심을 이동시키는 preview다. 기존 장소·위험구역·일정에 저장하려면 사용자가 검색 결과와
  분리된 단계에서 핀을 직접 탭하거나 드래그해 좌표를 확정하고, 저장할 별칭도 직접 입력해야 한다. 이 두 값만 기존
  provider-neutral 저장 필드에 전달한다.
- 기존 `events.location` JSON은 일괄 rewrite하거나 새 schema로 변환하지 않는다. 새 write도 현재 reader가 지원하는
  `lat`·`lng`·사용자 입력 label 형식을 유지하고 Google Place ID·formatted address를 추가하지 않는다.
- 기존 메모 `[[loc:lat,lng|주소]]`는 byte-for-byte 보존한다. 새 메모는 기기 GPS 또는 사용자가 확정한 핀과 locale의
  일반 “공유한 위치”/직접 입력 label만 사용하며 Google 이름·주소·Place ID를 marker에 복사하지 않는다.
- `public_places.kakao_place_id`의 `current:*` 값과 친구놀이 참조는 이번 지도 공급자 전환에서 읽기·쓰기 의미를
  변경하지 않는다. 별도 정규화가 필요하면 독립 설계와 migration 승인을 받아 진행한다.
- 기존 위치 JSON, 이벤트·위험구역 좌표와 위치 이력은 재투영·반올림하지 않는다. 지오펜스의 20m 중복 장소 정규화,
  saved place 우선, dwell·leave timer와 10분 presence dedupe 결과를 유지한다.

## 개인정보·로그·캐시

- 지도 좌표, 검색어, 주소, provider response, Place ID, family/user ID를 분석 이벤트에 넣지 않는다.
- 구조화 운영 로그는 allowlist event name, provider, 내부 오류 코드, HTTP status, latency bucket만 허용한다.
- raw URL과 query string을 로그에 남기지 않는다.
- Google 검색·Geocoding·Routes 응답은 D1 `edge_cache`에 저장하지 않는다.
- 기존 Kakao `edge_cache` 정리는 이번 범위에 포함하지 않는다. Google 경로는 이를 읽거나 쓰지 않으며 Kakao cache
  miss는 기능 실패로 취급하지 않는다.
- 가족 삭제 시 이 작업에서 추가한 autocomplete digest와 family-scoped 지도 quota 행을 정리한다.
- 개인정보처리방침과 데이터 안전 문서에는 Kakao와 Google에 전달되는 데이터 종류·목적·보존 여부·외부 링크를
  실제 코드와 동일하게 반영한다.

## 오류와 사용자 경험

```ts
type MapErrorCode =
  | "map_country_unresolved"
  | "map_country_unsupported"
  | "map_provider_unavailable"
  | "map_google_play_services_unavailable"
  | "map_location_stale"
  | "map_quota_exceeded"
  | "map_network_unavailable"
  | "map_search_failed"
  | "map_reverse_failed"
  | "map_directions_failed";
```

- 국가 확인 중 `pending`은 SDK·preconnect·upstream 호출 없이 자리표시자만 표시하고 provider 재시도 loop를 만들지
  않는다. 서버에 canonical 국가가 없는 `map_country_unresolved`는 지도 재시도가 아니라 가족 국가 설정 action을
  제공한다. `CN`과 allowlist 밖 국가는 영구 미지원 안내다.
- 키 누락, quota, 일시 provider 장애, offline을 서로 다른 오류로 매핑한다.
- Android는 지도 생성 전에 Google Play services 가용성·버전을 확인하고, 없거나 지원되지 않으면
  `map_google_play_services_unavailable`로 닫아 설치·업데이트 안내와 접근 가능한 좌표 목록을 제공한다.
- 지도 실패 시에도 마지막 GPS 측정 시각·정확도·위치 수신 상태는 계속 표시한다.
- SOS는 지도·주소 변환과 독립적으로 좌표, 측정 시각, 긴급 연락·소리·메시지 동선을 유지한다.
- 장소·위험구역 편집 중 오류가 나면 이름·반경·선택 좌표를 보존하고 저장을 성공으로 위장하지 않는다.
- 모든 앱 오류·도보 경고는 10개 locale catalog를 사용한다. Google attribution은 번역 문구가 아니며 공급자가
  그린 UI 또는 공식 요구 형태의 정확한 `Google Maps` 표기를 `translate="no"`로 유지한다. 수정·번역·축약하지 않는다.
- Google·Kakao attribution을 가리거나 다른 공급자 지도 위에 표시하지 않는다. safe area, 바텀시트, dark/light
  theme에서도 attribution이 읽을 수 있게 보이는지를 전용 QA로 확인한다.

## 테스트 설계

### 순수 함수·프런트 회귀

- 국가 matrix: `KR=kakao`, `CN/ZZ=unsupported`, enabled non-CN=`google`, disabled non-CN=`unsupported`.
- policy `pending/unresolved/CN/disabled`에서 SDK import·script injection·preconnect·upstream API 호출 0회, 다른
  공급자 SDK 자동 fallback 0회.
- `FamilyMap` adapter parity: child/place/destination marker, danger circle, route/stay line, click picker,
  center/recenter/bounds/viewport padding, resize와 destroy.
- Android native 지도와 같은 정보·액션을 제공하는 DOM 위치 목록, 재중앙·선택 controls의 키보드·스크린리더 회귀.
- 부모 위치·이력, SOS, 장소·위험구역, 일정 장소, 메모 위치, `RouteSheet`·`RouteView` 길찾기 전체 wiring.
- 부모 홈·가족 목록·자녀 상세·위치 상태·안심리포트·주변소리의 위치 label이 공통 reverse API만 사용하고
  `CN/disabled`에서 Kakao/Google upstream을 부르지 않음.
- 사용자 문자열은 `innerHTML` 없이 DOM/text API로만 렌더.
- 지도 adapter는 lazy route chunk에만 포함되고 초기 bundle 예산을 넘지 않음.
- CSP는 Google과 Kakao의 필요한 정확한 host만 허용하며 broad wildcard를 추가하지 않음.
- `index.html`의 무조건 Kakao preconnect와 `AppShell`·부모 홈 warm-load 제거. `loadKakaoMaps`와 `/api/kakao/*` 참조는
  한국 adapter/한국 Worker allowlist 밖에 있으면 정적 테스트 실패.
- 기존 `mapPerf`, `kakaoMapDomSafety`, `kakaoMapRetry`, `parentLocationScrubFocus`, `locationRouteAccuracy` 회귀는
  삭제하지 않고 provider-neutral lazy-load·DOM safety·retry 분류·bounds/scrub focus·route source 테스트로 이관.
- key/quota/network 오류 때 각 소비 화면의 최신 좌표·안전 상태와 장소/위험구역/일정/memo picker draft 보존.
- 10개 locale key completeness와 공급자 중립 문구 검사. Google attribution 문자열은 locale catalog에 넣지 않고
  정확한 표기·`translate=no`·bottom sheet/safe area/dark/light 가시성을 검사한다.

### Worker·DB 회귀

- 무인증, 타 가족, 교사, 타 아이, 잘못된 객체 ref가 provider fetch 전에 401/403/404.
- `CN/ZZ/disabled`, secret 누락, OAuth 실패, quota DB 실패가 provider fetch 전에 fail-closed.
- raw pin 좌표의 범위·정밀도·목적·rate limit 검증.
- autocomplete handle의 사용자·가족 binding, 5분 TTL, isolate 간 결정적 provider UUID, Details 원자 1회 consume,
  raw token 비노출과 최소 field mask.
- Google 응답·좌표·주소·식별자가 로그와 D1 cache에 없음.
- concurrent quota 초과가 원자적으로 429.
- country migration 전후 기존 장소·친구놀이 ID·참조 수·좌표와 geofence/dedupe 결과 동일.
- Place ID·Google 주소·검색어·polyline이 기존 장소/event/memo/친구놀이 schema에 저장되지 않음.
- legacy `events.location`과 `[[loc:...]]` byte 보존, 사용자 별칭·직접 확정 pin만 기존 저장 경계로 전달됨.
- `current:*` synthetic row와 친구놀이 invite/session의 read/write 결과가 전환 전후 동일함.
- 역사 위치의 정확한 `recordedAt`, 최신 경로 origin 5분 freshness, raw 좌표 7자리·저quota·비보존.
- cron이 공통 resolver를 사용하고 국가 미확정에서도 안전 상태머신은 계속 진행.
- non-KR allowlist는 family-local 오전 8시·retention·quota·일정/도착 cron·quiet hours의 DST matrix가 통과하기
  전에는 열리지 않음.

### Android 회귀

- `@capacitor/google-maps` exact version과 Capacitor 8 호환.
- pinned `8.0.1` Android source contract: JS `apiKey`가 native create에서 사용되지 않고 Manifest metadata가 정본임.
- debug/test build는 빈 sentinel key로 assemble할 수 있지만 지도 생성 전에 `map_provider_unavailable`로 닫음.
- AndroidManifest key placeholder는 실제 release build에서 설정 누락 시 명시 실패시키고 키 값을 출력하지 않음.
- package/SHA 제한, Google Play services preflight, GMS 없는 emulator/device fixture의 명시 오류.
- map create/destroy, WebView root 투명화·복원, 화면 전환·스크롤·바텀시트·앱 background 후 native view 잔상·
  ghost click·비지도 화면 투명화 없음.
- 늦게 완료된 async mount/update abort, 중복 destroy, provider 전환, 부분 create 실패에서 generation guard와
  transparency lease ref-count가 native view/listener/배경을 모두 정리함.
- `ResizeObserver`·scroll·visual viewport·orientation 뒤 host rect 동기화, picker modal/scrim touch 차단.
- marker/circle/polyline/click listener parity와 DOM 접근성 목록·동일 액션.
- 10개 앱 locale×대표 기기 locale 조합에서 Android 지도 라벨 실제 동작을 기록하고 이해를 해치는 조합은 fail.
- 기존 위치 권한·FGS·백그라운드 수집·SOS·원격 기능 회귀 없음.
- `testDebugUnitTest`, `lintDebug`, `assembleDebug` 통과.

## 실제 QA와 출시 게이트

Google 자격 발급 뒤에만 실제 API QA를 수행한다.

1. web, android, worker 자격을 서로 분리하고 API·application restriction을 적용한다.
2. 허용하지 않은 origin, 잘못된 Android SHA, 허용하지 않은 API가 403인지 먼저 확인한다.
3. PWA 운영 키는 세 exact production origin만 허용하고, 임시 preview는 별도 staging key·exact origin만 쓰는지
   확인한다.
4. Chrome PWA, iPhone 홈 화면 PWA, Android debug와 Play App Signing 설치본에서 지도·검색·핀·역지오코딩·
   도보경로·SOS를 확인한다.
5. 초기 국가 matrix `KR`, `JP`, `TW`, `HK`, `SG`, `VN`, `TH`, `ID`, `MY`, `PH`를 검증한다. Android는 앱 locale과
   기기 locale이 다른 조합에서도 지도 라벨·검색 결과를 실제 확인한다.
6. `CN`, `ZZ`, allowlist 밖 국가와 GMS 없는 Android는 SDK/Worker upstream 호출이 0회이며 명시 UI가 나오는지 확인한다.
7. API별 quota cap, budget alert, 앱·Worker rate limit, 403/429/5xx 관측을 확인한다.
8. 이용약관·개인정보처리방침·정확한 Google attribution·도보 경고·billing entity 기준 EEA 약관을 검토한다.
9. 해당 국가의 지도 타일, Geocoding, Walking coverage, 시간대·DST와 실제 fixture가 모두 통과한 국가만 스토어에
   활성화한다.

실사용 A17·razr·S25의 역할·세션·페어링·가족 국가는 변경하지 않는다. 실제 국가 QA는 별도 테스트 가족과 fixture로
수행한다. 서명 비밀번호와 Google 자격은 사용자가 직접 입력·설정하며 에이전트가 읽거나 출력하지 않는다.

## 적용 순서

1. production read-only preflight로 기존 가족 수, 장소·친구놀이 ID/참조 수와 현재 schema를 기록한다.
2. D1에 `families.country_code`와 지도 요청 session/quota schema만 additive로 적용한다. 기존 가족은 `KR`로 보존하고
   Worker를 schema보다 먼저 배포하지 않는다.
3. country·지도 요청 제어 readiness를 통과한 뒤 공통 Worker map API, 권한, quota, OAuth 경계를 배포하되 non-KR
   allowlist는 계속 닫아 둔다.
4. `FamilyMap`과 Kakao adapter를 먼저 연결해 한국 회귀를 고정한다.
5. Google web/native adapter를 키 미설정 fail-closed 상태로 구현한다.
6. 모든 지도 소비 화면과 새 지도 i18n 문구를 공급자 중립 경계로 이관한다.
7. 앱·Worker·Android 전체 자동 검증을 통과한다.
8. 별도 글로벌 시간대/DST 계획의 완료 증거를 확인한다. 이 단계가 끝나지 않으면 non-KR 출시는 `HOLD`다.
9. 사용자가 Google Cloud 자격과 제한을 준비한다.
10. 별도 테스트 가족으로 실API 국가·locale matrix와 비용·정책 gate를 통과한다.
11. readiness 재확인 후 승인된 순서로 배포하고 통과한 국가만 allowlist와 스토어 국가에 활성화한다.

## 완료 정의

다음 조건을 모두 만족해야 지도·위치 글로벌 단계가 완료다.

- Kakao 직접 의존이 adapter와 한국 Worker 구현 밖에 남지 않는다.
- 모든 지도 소비 화면이 `FamilyMap`과 공통 map API를 사용한다.
- 한국 회귀와 기존 위치·SOS·지오펜스 불변식이 통과한다.
- 승인 해외 국가의 웹·Android 실지도·검색·역지오코딩·도보경로가 통과한다.
- `CN/ZZ/disabled`에서 외부 지도 호출이 없다.
- 기존 장소·이벤트·메모·친구놀이 schema/참조와 위치 기록이 보존되고 Google provider metadata가 추가되지 않는다.
- 별도 gate에서 non-KR 가족의 날짜·오전 8시 위치 이력·retention·quota·일정/도착 cron·quiet hours가 가족 시간대와
  DST로 검증된다. 이 문서는 해당 로직을 변경하지 않는다.
- API 키 제한, OAuth, quota, 비용 경보, 로그·캐시 최소수집, 법적 고지가 검증된다.
- 10개 locale 문구와 접근성, 지도 장애 폴백이 검증된다.
- Google 자격이 없거나 실API 국가 matrix가 하나라도 실패하면 글로벌 출시는 계속 HOLD다.

## 공식 참고 문서

- Google Maps Platform coverage: https://developers.google.com/maps/coverage
- Google Maps API security: https://developers.google.com/maps/api-security-best-practices
- Maps JavaScript 정책: https://developers.google.com/maps/documentation/javascript/policies
- Places 정책: https://developers.google.com/maps/documentation/places/web-service/policies
- Geocoding 정책: https://developers.google.com/maps/documentation/geocoding/policies
- Routes 정책: https://developers.google.com/maps/documentation/routes/policies
- Capacitor Google Maps: https://github.com/ionic-team/capacitor-google-maps
