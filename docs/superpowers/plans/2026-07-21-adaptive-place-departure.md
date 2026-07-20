# 등록 장소 적응형 출발 판정 구현 계획

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for Worker, legacy JS, and Android parity changes; use `superpowers:verification-before-completion` before deployment.

**Goal:** 신뢰도 높은 위치가 등록 장소 이탈 반경을 충분히 벗어난 경우 출발 확정을 180초에서 60초로 줄이고, 경계·저정확도·정확도 미보고 상황의 기존 180초 오탐 방어를 유지한다.

**Architecture:** 상태 머신의 기존 `departureArmedAtMs`를 단일 시간 기준으로 보존한다. 매 평가 시점에 `accuracy <= 30m`이고 `distance >= resolved exit radius + 30m`인지 계산해 그 순간 필요한 타임아웃만 60초 또는 180초로 선택한다. Worker, 레거시 WebView JS, hyeni-3 Android의 설정 필드와 전이 로직을 동일하게 유지하며 DB 스키마·알림 병합·멱등키는 변경하지 않는다.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Vite/Vitest legacy client, Android Java/JUnit, Wrangler.

---

## 전역 제약

- `place_left` 등록 장소 상태 머신만 변경한다. `unregistered_stay_left` 5분 cron은 범위 밖이다.
- 빠른 출발 조건은 `accuracy <= 30`, `distance >= exitR + 30`, 누적 outside 60초를 모두 만족해야 한다.
- `accuracy`가 `null`이거나 30m를 초과하면 기존 180초를 사용한다.
- 이탈 반경 바로 밖에서는 정확도가 좋아도 기존 180초를 사용한다.
- 빠른 근거가 뒤늦게 들어와도 `departureArmedAtMs`를 재설정하지 않는다.
- 안으로 복귀하면 기존처럼 무장을 취소한다.
- `SILENT_RE_ENTER`의 재이탈은 빠른 조건에서도 `SILENT_LEAVE`로 끝난다.
- 같은 배치 출발+도착 병합, 최근 15분 stale leave 억제, idempotency key, quiet hours, D1 스키마는 변경하지 않는다.

### Task 1: Worker 상태 머신에 빠른 출발 계약 추가

**Files:**

- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\tests\registeredPlaceLatency.test.mjs`
- Modify: `C:\Users\TK\Desktop\hyeni-1\worker\shared\registeredPlaceGeofence.js`

**Step 1: 테스트 helper가 정확도를 받도록 확장**

```js
function fixAt(distanceM, tMs, accuracy = null) {
  return { lat: PLACE.lat + mLat(distanceM), lng: PLACE.lng, accuracy, tMs };
}
```

**Step 2: 실패하는 Worker 테스트 작성**

다음 다섯 시퀀스를 `registeredPlaceLatency.test.mjs`에 추가한다.

```js
test("정확도 30m 이하로 이탈 반경보다 30m 이상 멀어지면 60초에 출발한다", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(5, t0, 10),
    fixAt(5, t0 + 95_000, 10),
    fixAt(90, t0 + 200_000, 20),
    fixAt(90, t0 + 259_000, 20),
    fixAt(90, t0 + 261_000, 20),
  ]);
  assert.deepEqual(actions, [
    A.PENDING_DWELL,
    A.ENTER,
    A.OUTSIDE_ARMED,
    A.OUTSIDE_PENDING_TIMER,
    A.LEAVE,
  ]);
});

test("정확도가 좋아도 이탈 반경에서 30m 덜 벗어나면 180초를 유지한다", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(5, t0, 10),
    fixAt(5, t0 + 95_000, 10),
    fixAt(70, t0 + 200_000, 20),
    fixAt(70, t0 + 261_000, 20),
    fixAt(70, t0 + 381_000, 20),
  ]);
  assert.deepEqual(actions.slice(-3), [A.OUTSIDE_ARMED, A.OUTSIDE_PENDING_TIMER, A.LEAVE]);
});

test("정확도 30m 초과 또는 미보고 fix는 180초를 유지한다", () => {
  const t0 = 1_000_000;
  for (const accuracy of [31, null]) {
    const { actions } = run([
      fixAt(5, t0, 10),
      fixAt(5, t0 + 95_000, 10),
      fixAt(90, t0 + 200_000, accuracy),
      fixAt(90, t0 + 261_000, accuracy),
      fixAt(90, t0 + 381_000, accuracy),
    ]);
    assert.deepEqual(actions.slice(-3), [A.OUTSIDE_ARMED, A.OUTSIDE_PENDING_TIMER, A.LEAVE]);
  }
});

test("빠른 근거가 나중에 들어와도 최초 이탈 무장 시각부터 계산한다", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(5, t0, 10),
    fixAt(5, t0 + 95_000, 10),
    fixAt(60, t0 + 200_000, 20),
    fixAt(90, t0 + 265_000, 20),
  ]);
  assert.equal(actions.at(-1), A.LEAVE);
});

test("빠른 이탈 무장 중 장소 안으로 돌아오면 출발을 취소한다", () => {
  const t0 = 1_000_000;
  const { actions } = run([
    fixAt(5, t0, 10),
    fixAt(5, t0 + 95_000, 10),
    fixAt(90, t0 + 200_000, 20),
    fixAt(5, t0 + 240_000, 10),
  ]);
  assert.equal(actions.at(-1), A.DEPARTURE_CANCELLED);
});
```

학교처럼 `alertRadiusM=100`인 장소는 `exitR = 166.66…m`이므로 196.66m 이상에서만 빠른 조건이 열리는 별도 assertion도 추가한다.

**Step 3: Worker 테스트 실패 확인**

Run from `C:\Users\TK\Desktop\hyeni-1`:

`node --test worker/tests/registeredPlaceLatency.test.mjs worker/tests/registeredPlaceGeofence.test.mjs`

Expected: 60초 LEAVE와 새 config 필드 기대가 실패한다.

**Step 4: Worker config와 전이 최소 구현**

`SERVER_GEOFENCE_CONFIG`에 다음을 추가한다.

```js
fastDepartureTimeoutMs: 60_000,
fastDepartureMinBeyondExitM: 30,
fastDepartureMaxAccuracyM: 30,
```

`evaluateRegisteredPlaceTransition`에서 실제 해석된 `exitR`을 사용해 다음을 계산한다.

```js
const fastDepartureEvidence = !inside
    && Number.isFinite(fix.accuracy)
    && fix.accuracy <= config.fastDepartureMaxAccuracyM
    && dist >= exitR + config.fastDepartureMinBeyondExitM;
```

`transitionFromIn`에 boolean을 넘기고 기존 무장 시각을 유지한 채 필요한 타임아웃만 선택한다.

```js
const requiredDepartureMs = fastDepartureEvidence
    && Number.isFinite(config.fastDepartureTimeoutMs)
    ? config.fastDepartureTimeoutMs
    : config.departureTimeoutMs;
const departureSatisfied = (fix.tMs - prev.departureArmedAtMs) >= requiredDepartureMs;
```

config 필드가 없는 외부 호출은 기존 180초로 안전하게 폴백해야 한다.

**Step 5: Worker 테스트 통과 확인**

Run: `node --test worker/tests/registeredPlaceLatency.test.mjs worker/tests/registeredPlaceGeofence.test.mjs`

Expected: 전체 PASS.

**Step 6: 커밋**

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-1
git add worker/shared/registeredPlaceGeofence.js worker/tests/registeredPlaceLatency.test.mjs
git commit -m "fix: 신뢰 위치의 장소 출발 판정 단축"
```

### Task 2: 레거시 WebView JS parity 적용

**Files:**

- Modify: `C:\Users\TK\Desktop\hyeni-1\src\lib\locationConstants.js`
- Modify: `C:\Users\TK\Desktop\hyeni-1\src\lib\registeredPlaceGeofence.js`
- Modify: `C:\Users\TK\Desktop\hyeni-1\src\App.jsx`
- Modify: `C:\Users\TK\Desktop\hyeni-1\tests\registeredPlaceGeofence.test.js`
- Verify: `C:\Users\TK\Desktop\hyeni-1\tests\serverRegisteredPlaceGeofence.test.js`

**Step 1: 실패하는 Vitest 시퀀스 추가**

Worker와 동일한 다섯 계약을 기존 Vitest `CONFIG`에 다음 필드를 넣은 상태로 작성한다.

```js
fastDepartureTimeoutMs: 60_000,
fastDepartureMinBeyondExitM: 30,
fastDepartureMaxAccuracyM: 30,
```

추가로 `SILENT_RE_ENTER` 상태에서 신뢰도 높은 먼 fix가 60초 누적되면 `SILENT_LEAVE`이며 `LEAVE`가 아님을 검증한다.

**Step 2: Vitest 실패 확인**

Run from `C:\Users\TK\Desktop\hyeni-1`:

`npm test -- --run tests/registeredPlaceGeofence.test.js tests/serverRegisteredPlaceGeofence.test.js`

Expected: 빠른 타임아웃 계약이 없어 FAIL.

**Step 3: 상수와 JSDoc 추가**

`src/lib/locationConstants.js`에 다음 상수를 추가한다.

```js
export const REGISTERED_PLACE_FAST_DEPARTURE_TIMEOUT_MS = 60_000;
export const REGISTERED_PLACE_FAST_DEPARTURE_MIN_BEYOND_EXIT_M = 30;
export const REGISTERED_PLACE_FAST_DEPARTURE_MAX_ACCURACY_M = 30;
```

`registeredPlaceGeofence.js`의 `Config` JSDoc에 세 필드를 optional number로 추가하고 Worker와 동일한 `fastDepartureEvidence`와 timeout 선택 로직을 구현한다. 필드가 없으면 기존 `departureTimeoutMs`로 폴백한다.

**Step 4: App.jsx config 연결**

기존 `locationConstants.js` import에 세 상수를 추가하고 `geofenceConfig`에 다음 이름으로 전달한다.

```js
fastDepartureTimeoutMs: REGISTERED_PLACE_FAST_DEPARTURE_TIMEOUT_MS,
fastDepartureMinBeyondExitM: REGISTERED_PLACE_FAST_DEPARTURE_MIN_BEYOND_EXIT_M,
fastDepartureMaxAccuracyM: REGISTERED_PLACE_FAST_DEPARTURE_MAX_ACCURACY_M,
```

15초 fallback interval, 알림 payload, 상태 저장 방식은 변경하지 않는다.

**Step 5: parity 테스트 통과 확인**

Run: `npm test -- --run tests/registeredPlaceGeofence.test.js tests/serverRegisteredPlaceGeofence.test.js`

Expected: 클라이언트/서버 parity 포함 전체 PASS.

**Step 6: 커밋**

```powershell
git add src/lib/locationConstants.js src/lib/registeredPlaceGeofence.js src/App.jsx tests/registeredPlaceGeofence.test.js
git commit -m "fix: 웹 위치 판정에 빠른 출발 조건 반영"
```

### Task 3: hyeni-3 Android 상태 머신 parity 적용

**Files:**

- Modify: `android/app/src/main/java/com/hyeni/calendar/GeofenceStateMachine.java`
- Modify: `android/app/src/test/java/com/hyeni/calendar/GeofenceStateMachineTest.java`

**Step 1: 정확도와 거리를 명시하는 테스트 helper 추가**

```java
private TransitionResult stepAt(GeofenceState state, double distanceM, Double accuracy, long tMs) {
    double lat = PLACE_LAT + distanceM / 111_000.0;
    return GeofenceStateMachine.evaluateTransition(
            state, lat, PLACE_LNG, accuracy, tMs,
            PLACE_LAT, PLACE_LNG, 30.0, CFG);
}
```

**Step 2: 실패하는 JUnit 테스트 작성**

다음 계약을 각각 독립 테스트로 작성한다.

- 20m 정확도·90m 거리에서 최초 무장 후 59초는 `OUTSIDE_PENDING_TIMER`, 61초는 `LEAVE`.
- 20m 정확도·70m 거리는 61초 pending, 181초 `LEAVE`.
- 31m 정확도와 null 정확도는 90m 거리여도 181초 `LEAVE`.
- 60m에서 무장한 뒤 65초 시점 90m 신뢰 fix가 오면 최초 무장 시각 기준으로 즉시 `LEAVE`.
- 빠른 무장 중 inside 복귀는 `DEPARTURE_CANCELLED`.
- `lastDepartedAtMs != null`인 조용한 재진입 에피소드는 61초에 `SILENT_LEAVE`.

기존 `step()`의 null accuracy 시퀀스는 180초 계약을 그대로 검증하게 둔다.

**Step 3: JUnit 실패 확인**

Run from `C:\Users\TK\Desktop\hyeni-3\android`:

`.\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.GeofenceStateMachineTest`

Expected: 새 60초 조건 테스트 FAIL.

**Step 4: Java config와 전이 구현**

`GeofenceConfig`에 다음 필드를 추가한다.

```java
final long fastDepartureTimeoutMs;
final double fastDepartureMinBeyondExitM, fastDepartureMaxAccuracyM;
```

`DEFAULT`는 `60_000L, 30, 30`을 사용한다. 기존 테스트나 호출부가 쓰는 단축 생성자는 빠른 조건을 비활성화할 수 있도록 `fastDepartureTimeoutMs = departureTimeoutMs`와 보수적인 값으로 위임하거나, 모든 실제 생성 지점을 검색해 새 전체 생성자로 명시 갱신한다.

`evaluateTransition`에서 다음 boolean을 계산한다.

```java
boolean fastDepartureEvidence = !inside
        && accuracy != null
        && Double.isFinite(accuracy)
        && accuracy <= cfg.fastDepartureMaxAccuracyM
        && dist >= exitR + cfg.fastDepartureMinBeyondExitM;
```

`fromIn`에 전달해 기존 `departureArmedAtMs`는 유지하고 필요한 timeout만 선택한다. return action과 state 구조는 바꾸지 않는다.

**Step 5: JUnit 통과 확인**

Run: `.\gradlew.bat testDebugUnitTest --tests com.hyeni.calendar.GeofenceStateMachineTest`

Expected: 전체 PASS.

**Step 6: Android lint/build 확인**

Run: `.\gradlew.bat lintDebug assembleDebug`

Expected: lint error 0, assemble exit 0.

**Step 7: 커밋**

```powershell
Set-Location C:\Users\TK\Desktop\hyeni-3
git add android/app/src/main/java/com/hyeni/calendar/GeofenceStateMachine.java android/app/src/test/java/com/hyeni/calendar/GeofenceStateMachineTest.java
git commit -m "fix: 안드로이드 장소 출발 판정 단축"
```

### Task 4: 상태 머신 전체 회귀와 정본 문서 동기화

**Files:**

- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

**Step 1: Worker 전체 테스트**

Run from `C:\Users\TK\Desktop\hyeni-1`:

`node --test worker/tests/*.test.mjs`

Expected: 전체 PASS.

**Step 2: Worker TypeScript 검사**

Run from `C:\Users\TK\Desktop\hyeni-1\worker`:

`npx tsc --noEmit`

Expected: exit 0.

**Step 3: 레거시 클라이언트 회귀**

Run from `C:\Users\TK\Desktop\hyeni-1`:

`npm test -- --run tests/registeredPlaceGeofence.test.js tests/serverRegisteredPlaceGeofence.test.js`

Expected: 전체 PASS.

**Step 4: hyeni-3 앱 전체 회귀**

Run from `C:\Users\TK\Desktop\hyeni-3`:

`node --test tests/*.test.*`

Expected: 전체 PASS.

Run: `npm run typecheck`

Expected: exit 0.

Run: `npm run build`

Expected: exit 0.

**Step 5: 문서 정본 동기화**

`AGENTS.md`와 `CLAUDE.md`의 등록 장소 알림 항목에 다음을 같은 의미로 기록한다.

- 기본 이탈 타임아웃 180초 유지.
- `accuracy <= 30m`이고 `distance >= resolved exit radius + 30m`일 때만 60초.
- 최초 `departureArmedAtMs`부터 계산하며 inside 복귀 시 취소.
- null/저정확도/경계 fix는 180초.
- JS·Worker·Android parity와 `SILENT_LEAVE` 불변식 유지.

Run: `rg -n "60초|30m|departureArmedAtMs|SILENT_LEAVE" AGENTS.md CLAUDE.md`

Expected: 두 파일에 새 계약이 모두 있다.

**Step 6: 문서 커밋**

```powershell
git add AGENTS.md CLAUDE.md
git commit -m "docs: 적응형 장소 출발 판정 정본 동기화"
```

### Task 5: Worker 배포, A17 설치, 운영 스모크 확인

**Files:**

- Verify only: `C:\Users\TK\Desktop\hyeni-1\worker\wrangler.toml`
- Verify only: `android/app/build/outputs/apk/debug/app-debug.apk`

**Step 1: 두 저장소 상태와 커밋 확인**

```powershell
git -C C:\Users\TK\Desktop\hyeni-1 status --short
git -C C:\Users\TK\Desktop\hyeni-3 status --short
git -C C:\Users\TK\Desktop\hyeni-1 log -3 --oneline
git -C C:\Users\TK\Desktop\hyeni-3 log -5 --oneline
```

Expected: 두 status가 비어 있고 새 커밋들이 보인다.

**Step 2: 두 저장소 push**

```powershell
git -C C:\Users\TK\Desktop\hyeni-1 push origin main
git -C C:\Users\TK\Desktop\hyeni-3 push origin main
```

Expected: 두 push 성공.

**Step 3: Worker 배포**

hyeni-3 `.env`의 Workers/D1 토큰을 출력하지 않고 현재 프로세스에만 주입한다.

```powershell
$hyeniTokenLine = Get-Content C:\Users\TK\Desktop\hyeni-3\.env | Where-Object { $_ -match '^CLOUDFLARE_API_TOKEN=' } | Select-Object -First 1
if (-not $hyeniTokenLine) { throw 'CLOUDFLARE_API_TOKEN이 없습니다.' }
$env:CLOUDFLARE_API_TOKEN = $hyeniTokenLine.Substring('CLOUDFLARE_API_TOKEN='.Length).Trim()
Set-Location C:\Users\TK\Desktop\hyeni-1\worker
npx wrangler deploy
Remove-Item Env:CLOUDFLARE_API_TOKEN
Set-Location C:\Users\TK\Desktop\hyeni-3
```

Expected: `hyeni-calendar-api.tkisdroid.workers.dev` 새 version 배포 성공. 토큰 값은 터미널에 출력하지 않는다.

**Step 4: A17에 세션 보존 설치**

```powershell
npm run build
npx cap sync android
Set-Location C:\Users\TK\Desktop\hyeni-3\android
.\gradlew.bat lintDebug assembleDebug
Set-Location C:\Users\TK\Desktop\hyeni-3
adb -s RFKL40DP73J install -r android\app\build\outputs\apk\debug\app-debug.apk
```

Expected: `Success`. A17 부모 계정·가족·페어링·세션이 유지된다. razr와 S25에는 설치·실행·로그·세션 조회를 포함한 adb 접근을 하지 않는다.

**Step 5: 운영 스모크 확인**

- A17은 부모 세션 그대로 앱 시작과 위치 화면 진입만 확인한다.
- 아이 역할은 단위·계측 테스트와 브라우저 역할 검증으로 확인하며 A17 역할을 바꾸지 않는다.
- 운영 D1은 read-only로 새 `place_left` 이후 `metadata_json.observedAt`과 `created_at`을 비교한다.
- 빠른 조건 증거가 실제로 생기기 전에는 억지로 이동 이벤트를 만들거나 테스트 알림을 발송하지 않는다.
- 운영 데이터 삭제, 설정 변경, refresh token 조회·출력·회전은 하지 않는다.

**Step 6: 최종 상태 확인**

```powershell
git -C C:\Users\TK\Desktop\hyeni-1 status --short
git -C C:\Users\TK\Desktop\hyeni-3 status --short
```

Expected: 두 저장소 모두 깨끗하다.
