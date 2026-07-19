# 부모 관리 알림 조용한 시간 설계

작성일: 2026-07-19

대상 저장소: `hyeni-3`, `hyeni-1/worker`

상태: 사용자 승인 완료, 구현 전 설계 정본

## 1. 목표

부모가 부모 본인 계정과 가족의 활성 아이별로 매일 반복되는 알림 조용한 시간을 설정한다. 조용한 시간에는 일정, 메시지, 일반 위치 도착·출발 같은 비긴급 알림을 만들거나 표시하지 않는다. SOS, 긴급 안전, 위험구역 알림과 부모가 직접 실행한 원격 안전 요청은 조용한 시간과 관계없이 동작한다.

이 기능의 직접 목적은 아이 GPS가 새벽에 집 주변에서 튀어 `집 도착`과 `집 출발`이 반복돼도 부모와 아이 기기가 깨지 않게 하는 것이다.

## 2. 확정된 제품 결정

- 매일 같은 조용한 시간 구간 1개를 반복한다.
- 부모 알림 시간은 설정한 부모 계정의 모든 기기에만 적용한다. 다른 공동부모의 설정은 바꾸지 않는다.
- 아이 알림 시간은 아이마다 따로 저장하며 해당 아이 계정의 모든 기기에 적용한다.
- 조용한 시간 기본값은 비활성이다. 신규 필드의 시간 초기값만 `22:00`부터 `07:00`까지로 둔다.
- 기준 시간대는 `Asia/Seoul`로 고정한다.
- 시작 시각은 포함하고 종료 시각은 제외하는 `[start, end)` 구간을 사용한다.
- `22:00 → 07:00`처럼 자정을 넘는 구간과 `13:00 → 15:00`처럼 같은 날 구간을 모두 지원한다.
- 시작과 종료가 같으면 유효한 24시간 구간으로 해석하지 않고 저장을 거부한다.
- 조용한 시간에 억제한 알림은 시간이 끝난 뒤 다시 보내지 않는다.
- 위치 추적, 지오펜스 평가, 위치 상태 영속은 계속 수행한다. 전달·표시만 억제한다.

## 3. 범위 밖

- 요일별 시간표, 평일·주말 분리, 하루 여러 구간
- 물리 기기별 서로 다른 시간 설정
- Android 시스템 방해금지 모드 자체 변경
- 위치 정확도·지오펜스 반경·체류 시간 변경
- 다른 공동부모의 개인 알림 설정 변경
- 아이가 조용한 시간을 직접 편집하는 기능

## 4. 현재 구조와 문제

- `notification_settings`는 `user_id`가 기본 키인 사용자 계정 단위 설정이다.
- `/api/notif-settings`는 호출자 본인 행만 조회·저장한다.
- 부모는 `/api/notif-settings/child-status`로 아이의 `child_enabled`를 읽을 수 있지만 아이 설정을 변경할 수 없다.
- 등록장소 도착·출발은 Android `LocationService`와 Worker cron이 같은 지오펜스 상태머신을 사용한다.
- `/api/parent-alerts`가 실패하면 Android와 Worker가 지오펜스 상태를 진행하지 않아 같은 전이를 다시 시도할 수 있다.
- 서버 pending을 만들고 단말 표시만 막으면 foreground 복구 때 과거 알림이 다시 표시될 수 있다.
- Android에는 FCM 외에도 아이 일정의 네이티브 알림 경로가 있어 서버만 수정하면 완전한 억제가 되지 않는다.

따라서 조용한 시간은 OS 설정이나 UI 로컬 상태가 아니라 사용자별 서버 정본과 Android 공통 표시 방어를 함께 사용해야 한다.

## 5. 데이터 모델

기존 `notification_settings`에 다음 additive 컬럼을 추가한다.

| 컬럼 | 타입 | 기본값 | 의미 |
| --- | --- | --- | --- |
| `quiet_hours_enabled` | `INTEGER NOT NULL` | `0` | `0` 비활성, `1` 활성 |
| `quiet_hours_start_minute` | `INTEGER NOT NULL` | `1320` | 자정 이후 시작 분, 22:00 |
| `quiet_hours_end_minute` | `INTEGER NOT NULL` | `420` | 자정 이후 종료 분, 07:00 |
| `quiet_hours_updated_by` | `TEXT` | `NULL` | 마지막으로 변경한 활성 부모 user id |
| `quiet_hours_updated_at` | `TEXT` | `NULL` | 마지막 변경 서버 시각 |

분 값은 API에서 정수 `0..1439`만 허용한다. bootstrap 정본 `cloudflare/schema_d1.sql`에도 같은 기본값과 `CHECK` 제약을 반영한다.

신규 migration은 `worker/db/notification-quiet-hours.sql` 한 파일로 관리한다. 기존 행은 `quiet_hours_enabled=0`이므로 배포 즉시 알림이 사라지는 변화가 없다.

`quiet_hours_updated_by`는 감사용 user id이므로 계정 삭제 시 삭제 대상 부모를 참조하는 다른 사용자의 이 컬럼을 `NULL`로 정리한다. 아이 설정 행과 시간 값 자체는 유지해 다른 가족 구성원의 설정을 삭제하지 않는다.

## 6. 시간 판정

Worker와 Android가 같은 순수 규칙을 사용한다.

- 비활성: 조용한 시간이 아님
- `start < end`: `start <= nowMinute && nowMinute < end`
- `start > end`: `nowMinute >= start || nowMinute < end`
- `start === end`: 잘못된 설정으로 저장 단계에서 거부

서버 판정 시각은 `Asia/Seoul`의 현재 시·분이다. Android는 서버에서 받은 분 값을 단말의 `Asia/Seoul` 기준으로 판정한다. 기기 시간대가 바뀌어도 혜니캘린더 가족의 설정 의미는 바뀌지 않는다.

## 7. API와 권한

### 7.1 가족 조용한 시간 조회

`GET /api/notif-settings/family?family_id=<familyId>`

인증한 사용자가 해당 가족의 활성 부모일 때만 다음 대상을 반환한다.

- 호출한 부모 본인 1명
- `family_members.is_active=1`, `role='child'`, `user_id IS NOT NULL`인 활성 아이들

다른 공동부모는 응답에 포함하지 않는다. 응답 대상은 `target_user_id`, `role`, `enabled`, `start_minute`, `end_minute`, `updated_at`, `configured`만 포함한다. 화면의 아이 이름은 기존 가족 정본과 `target_user_id`로 결합한다.

### 7.2 조용한 시간 부분 수정

`PUT /api/notif-settings/quiet-hours`

요청 필드:

- `family_id`
- `target_user_id`
- `expected_parent_user_id`
- `enabled`
- `start_minute`
- `end_minute`

서버는 다음 순서로 검증한다.

1. `expected_parent_user_id`와 인증 토큰 `sub` 일치
2. 현재 가족 정본에서 호출자가 활성 부모인지 확인
3. 대상이 호출자 본인이거나 같은 가족의 활성 아이인지 확인
4. 다른 공동부모, 다른 가족, 비활성 아이, `user_id`가 없는 미연결 아이 행 거부
5. 분 값 범위와 시작·종료 불일치 확인
6. 부모·가족·대상 아이 account mutation lease 획득
7. lease 획득 뒤 활성 membership 재확인
8. quiet 컬럼만 부분 update 또는 기본 설정 행 insert

기존 `/api/notif-settings` 전체 저장은 quiet 컬럼을 변경하지 않는다. 따라서 아이의 일정 알림 토글 저장이나 오래된 앱의 전체 설정 저장이 부모가 정한 시간을 덮을 수 없다.

성공 응답은 저장된 대상 quiet row를 반환하고 `notification_settings` realtime 이벤트를 정확한 `target_user_id`로 발행한다.

## 8. 알림 분류

### 8.1 항상 전달·실행

- `sos`, `emergency`, `sos_followup`
- `not_arrived`, `missed_arrival`
- 위험구역 진입·이탈 계열: `danger_zone`, `danger_enter`, `danger_entry`, `danger_exit`
- 부모가 직접 실행한 `force_ring`, `force_ring_stop`, `force_ring_reminder`
- 부모가 직접 실행한 `remote_listen`, `remote_listen_stop`
- 표시 없는 `request_location`, `request_device_status`
- 위치 서비스 생존에 필요한 Android foreground service 상시 알림

`remote_listen`은 기존 계약을 그대로 유지한다. 일반 알림으로 요청을 표시하고 아이가 해당 세션을 직접 1회 허용하기 전에는 마이크를 시작하지 않는다.

표시 없는 명령은 실행 성공과 알림 표시 ACK를 구분한다. quiet hours를 이유로 명령 실행이나 서버 ACK 규칙을 바꾸지 않는다.

### 8.2 조용한 시간 적용

- 일반 도착·출발: `arrived`, `late_arrived`, `place_arrived`, `place_left`, `unregistered_stay_left`
- 일정 사전 알림과 일정 변경
- 새 메모와 일반 메시지
- 스티커·`kkuk`
- 친구·놀이 알림
- AI proactive 알림
- 저배터리·위치 복구 같은 비긴급 상태 알림
- 선생님 알림장 등 일반 알림

예외 여부는 `urgent=true`나 자유 문자열 severity 하나로 결정하지 않는다. 위의 서버 관리 명시 allowlist만 우회할 수 있다.

## 9. 서버 전달 흐름

모든 일반 알림 경로는 다음 공통 순서를 따른다.

1. 활성 membership에서 정확한 수신자 user id 계산
2. 수신자 quiet 설정을 batch 조회
3. 명시적 안전 예외인지 분류
4. 일반 알림이면서 현재 quiet인 수신자를 제외
5. 남은 수신자만 pending 생성
6. 남은 수신자만 FCM·Web Push 전송
7. quiet 수신자는 `suppressed_quiet_hours` 성공으로 계수

quiet 수신자에 대해서는 pending을 만들지 않는다. 이미 생성된 일반 pending을 quiet 설정 변경 뒤 조회할 때도 현재 설정과 생성 시각을 확인해 표시 대상에서 제외하고 `suppressed_quiet_hours`로 완료한다. 이 방어는 설정 직전 생성·설정 직후 조회 레이스를 닫는다.

### 9.1 부모 알림과 지오펜스

- `parent_alerts` 이력 행은 저장한다. 부모는 나중에 알림 목록에서 사실 기록을 볼 수 있다.
- 부모별 quiet 설정을 적용해 공동부모 중 quiet가 아닌 부모에게만 push한다.
- 아이용 `child_safety`도 해당 아이 quiet 설정을 독립 적용한다.
- 모든 실제 수신자가 quiet여도 전달 함수는 `suppressed_quiet_hours` 성공을 반환한다.
- Android와 Worker 지오펜스 상태는 정상적으로 다음 상태로 영속한다.
- quiet 종료 뒤 같은 episode를 다시 push하지 않는다.

### 9.2 일반 알림 경로

일정 cron, 메모 outbox, 스티커, 놀이, AI proactive, 선생님 알림을 포함해 pending 또는 FCM을 직접 만드는 경로를 전수 조사한다. 각 경로가 공통 quiet policy를 거치지 않으면 회귀 테스트에서 실패시킨다.

설정 판정이 실패한 수신자에게는 일반 알림을 보내지 않는다. 해당 시도는 운영 로그와 메트릭에 `settings_unavailable`로 남기고 지연 재생 대상으로 만들지 않는다. 명시적 안전 예외는 quiet 설정 조회와 무관하게 전달한다.

## 10. Android 방어

Android에 다음 두 단위를 둔다.

- `NotificationQuietHoursStore`: 현재 세션 user id, enabled, start/end minute, updatedAt을 원자 저장
- `NotificationQuietHoursPolicy`: 알림 type·alertType·현재 KST 시각을 받아 `ALLOW`, `SUPPRESS`, `COMMAND`를 반환

정책은 현재 `SessionTokenStore`의 user id와 저장된 설정 user id가 일치할 때만 사용한다. 로그아웃 generation이 바뀌거나 다른 계정 설정이면 폐기한다.

`NotificationHelper`의 공통 표시 경계는 결과를 `posted`, `shouldAcknowledge`, `reason`으로 반환한다.

- 허용: `posted=true`, 표시 확인 뒤 ACK
- quiet 억제: `posted=false`, `shouldAcknowledge=true`, `reason=quiet_hours`
- 표시 없는 명령: 기존 명령별 ACK 계약 유지, 표시 ACK로 취급하지 않음

이 경계는 FCM, pending 복구, 아이 로컬 일정, Capacitor notification plugin, legacy scheduled receiver에 공통 적용한다.

### 10.1 설정 동기화

부모가 quiet 설정을 저장하면 Worker는 대상 user id의 활성 FCM endpoint에 표시 없는 `notification_quiet_hours_updated` 명령을 보낸다. payload에는 원문 세션 토큰 없이 target user id, enabled, start/end minute, updatedAt만 넣는다.

Android는 target user id가 현재 세션과 일치하고 updatedAt이 기존 값보다 새로울 때만 저장한다. 명령을 놓친 경우 앱 시작·foreground, `get_today_events` 동기화, 위치 서비스의 인증된 설정 갱신에서 같은 서버 정본을 회복한다.

아이 로컬 일정 알림은 저장된 quiet policy를 적용한다. quiet 직전 발송돼 늦게 도착한 일반 FCM도 표시 시각에 다시 판정한다.

## 11. 부모 UI

기존 `/notification-settings` 상단에 `알림을 받는 시간` 영역을 추가한다.

- 대상 칩: `내 알림`, 활성 아이 이름별 칩
- 조용한 시간 사용 스위치
- 시작·종료 `type="time"` 입력
- 현재 설정 한 줄 요약
- 변경한 대상만 저장하는 `적용` 버튼
- 저장 중 중복 실행 차단과 접근성 상태 안내

대상 칩은 알림 설정 안에서만 사용하는 명시적 수신자 선택이며 전역 활성 아이를 변경하지 않는다. 첫 아이 폴백을 추가하지 않는다. `user_id`가 없는 아이는 선택·저장을 닫고 `아이 기기 연결이 필요해요`를 표시한다.

문구:

> 조용한 시간에는 일정·메시지·일반 도착·출발 알림을 보내지 않아요.
>
> SOS·긴급·위험구역 알림은 이 시간에도 항상 전달돼요.

기존 OS 안내는 다음처럼 축소한다.

> 알림 소리와 진동은 휴대폰 또는 브라우저 설정에서 관리해 주세요.

시간 입력은 390px에서 2열, 360px 이하에서 필요하면 1열로 배치한다. 모든 칩·스위치·입력·버튼은 명시적 accessible name과 최소 44px 조작 영역을 가진다.

## 12. 아이 UI

아이 설정에는 부모가 정한 quiet 상태를 읽기 전용으로 표시한다.

- 활성: `밤 10시부터 아침 7시까지 알림을 쉬어`
- 비활성: `알림 쉬는 시간이 설정되지 않았어`
- 조회 실패: 값을 지어내지 않고 재시도 안내

아이의 기존 일정 알림 토글은 유지한다. 아이가 이 화면에서 quiet 시간을 변경하거나 부모 설정을 전체 객체 저장으로 덮지 못하게 한다.

## 13. 오류·경합 처리

- 부모 화면의 가족 quiet 조회가 실패하면 기본값으로 seed하지 않고 편집·저장을 닫는다.
- 대상 변경 중 이전 대상의 응답이 늦게 와도 현재 초안을 덮지 않는다.
- 저장 중 세션 instance 또는 로그인 user가 바뀌면 요청을 중단한다.
- 같은 target의 저장은 TanStack Query mutation scope로 직렬화한다.
- 서버는 account deletion·unpair mutation lease와 충돌하면 `409` 또는 `503`으로 fail-closed한다.
- 계정 삭제는 다른 사용자의 `quiet_hours_updated_by`에 남은 삭제 대상 부모 id만 `NULL`로 정리한다.
- realtime은 정확한 target user id의 본인/아이 query만 무효화한다.
- quiet 설정값과 user id는 로그에 남길 수 있으나 토큰, endpoint 원문, 세션 nonce는 남기지 않는다.

## 14. TDD와 회귀 검증

### 14.1 Worker

- disabled, 같은 날, 자정 횡단, 시작/종료 경계, 잘못된 분 값
- 명시적 안전 allowlist만 bypass하고 `urgent=true` 단독 우회 금지
- 호출한 부모 본인과 활성 아이만 수정 가능
- 다른 공동부모·타 가족·비활성 아이·아이 caller 거부
- 기존 전체 설정 POST가 quiet 컬럼을 보존
- 부모 계정 삭제 시 아이 설정을 유지하고 `quiet_hours_updated_by` 참조만 제거
- 공동부모 중 quiet 부모만 수신자에서 제외
- 부모 quiet·아이 허용과 부모 허용·아이 quiet 독립 판정
- quiet 중 `parent_alerts` 이력 저장, pending·FCM·Web Push 0건
- 모든 수신자 suppressed여도 지오펜스 상태 진행
- quiet 종료 뒤 과거 episode 재전송 없음
- 일정·메모·스티커·놀이·AI·선생님 직접 전달 경로의 공통 policy 배선
- bootstrap 정본과 migration 컬럼·기본값 일치

### 14.2 웹앱

- 서버 row와 분↔`HH:MM` 정규화
- 내 알림과 아이별 초안·저장 scope 격리
- 대상 변경 시 늦은 응답 무시
- 미연결 아이와 조회 오류에서 저장 닫힘
- 첫 아이 자동 폴백 없음
- session instance 변경 시 저장 중단
- realtime target별 cache 무효화
- OS 방해금지 localStorage를 만들지 않음
- 360px·390px overflow 0, accessible name, 44px 조작 영역

### 14.3 Android

- KST 같은 날·자정 횡단·경계 판정
- 세션 user 불일치·오래된 updatedAt 거부
- 일반 FCM, pending, 로컬 일정의 quiet 억제
- quiet 억제 결과 `posted=false`, `shouldAcknowledge=true`
- SOS·긴급·위험구역·force ring·remote listen 예외
- 표시 없는 native command가 표시 ACK로 바뀌지 않음
- quiet와 무관하게 지오펜스 전이·상태 영속 유지

모든 새 동작은 실패하는 테스트를 먼저 확인한 뒤 최소 구현으로 통과시킨다.

## 15. 배포 순서

1. 앱·Worker 테스트를 RED로 추가
2. Worker 순수 정책·API·전달 경로 구현
3. 앱 API·화면·Android 방어 구현
4. `cloudflare/schema_d1.sql` bootstrap 검증
5. 프로덕션 D1 `PRAGMA table_info(notification_settings)` 사전 확인
6. additive migration 1회 적용
7. 신규 컬럼·기본값 readback
8. Worker 타입 검사·전체 테스트 후 배포
9. 웹앱 전체 회귀·typecheck·build 후 Pages 배포
10. Capacitor sync, Android unit test·lint·assemble
11. A17 부모모드와 razr 아이모드에 `adb install -r`
12. 부모·아이 서로 다른 quiet 시간, 일반 알림 억제, 안전 예외, 지연 재생 없음 교차 검증
13. 테스트 데이터와 임시 설정 원복
14. 두 저장소의 의도한 파일만 커밋·머지·푸시

refresh 토큰은 읽거나 회전하지 않는다. S25는 조작하지 않는다.

## 16. 완료 기준

- 부모가 본인과 각 활성 아이의 조용한 시간을 독립적으로 저장·조회할 수 있다.
- 다른 공동부모의 개인 설정은 변하지 않는다.
- 새벽 GPS 지터로 만들어진 일반 집 도착·출발이 부모와 아이 기기에 표시되지 않는다.
- 억제된 일반 알림이 아침에 재생되지 않는다.
- 위치 이력·지오펜스 상태·알림 이력은 정합성을 유지한다.
- SOS·긴급·위험구역 및 승인된 원격 안전 요청은 조용한 시간에도 정상 동작한다.
- 웹·Worker·Android 자동 회귀와 A17·razr 실기기 검증이 모두 통과한다.
