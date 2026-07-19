# Task 5 보고서 — 웹 알림 조용한 시간 데이터 계층

## 결과

- 상태: `DONE`
- 앱 저장소: `C:\Users\TK\Desktop\hyeni-3`
- 브랜치: `codex/notification-quiet-hours`
- 기준 커밋: `a2533a3598655991897347db0ff089e0c6c8d29d`
- Worker 계약 확인 커밋: `7ca8c3219daf23d898420c8e767f4d02e794ddaa`
- 외부 작업: 배포·브라우저·ADB·실기기 작업 없음

## 문제 원인

- Worker에는 본인 조회의 `quiet_hours`, 가족 조회의 `family_id/recipients`, 부모 전용 부분 저장 API가 구현되어 있었지만 앱에는 이를 소비할 타입·방어적 변환·쿼리 키·hook이 없었습니다.
- 기존 `NotifSettings`와 `saveNotifSettings`는 일정/위치 알림 전체 객체만 다뤘고, 부모가 정한 quiet 값을 읽되 기존 POST가 덮어쓰지 않도록 분리할 경계가 필요했습니다.
- 기존 `notification_settings` realtime은 본인 설정과 아이 상태 키만 정밀 무효화했으므로 가족 quiet 캐시를 갱신할 수 없었습니다.
- 연속 저장은 같은 대상끼리 직렬화하면서도 다른 대상은 독립 실행해야 했고, 대기 중 계정·가족·role·session instance가 바뀌면 이전 요청을 중단해야 했습니다.

## 수정 방식

1. `src/transform/notificationQuietHours.ts`
   - 기본값을 비활성 `22:00~07:00`으로 고정했습니다.
   - 분↔`HH:MM` 변환, 범위·동일 시각 검증, Asia/Seoul 의미의 자연스러운 한국어 시간대 문구를 순수 함수로 구현했습니다.
2. `src/lib/api/endpoints/notifications.ts`
   - 본인 `quiet_hours`와 가족 recipient의 snake_case를 camelCase로 변환합니다.
   - family/target/role/boolean/0~1439분/updatedAt/configured를 런타임에 검증하고 잘못된 응답은 한국어 Error로 fail-closed합니다.
   - 가족 응답은 요청 family id, 호출 부모 본인 1명, target 중복 부재를 확인합니다.
   - PUT은 `family_id`, `target_user_id`, `expected_parent_user_id`, quiet draft만 전송하고 반환 target·role·configured를 다시 확인합니다.
   - 기존 `saveNotifSettings` POST body에는 quiet 필드를 추가하지 않았습니다.
3. `src/queries/keys.ts`, `src/queries/useNotifications.ts`
   - 가족별 `familyNotificationQuietHours` 키를 추가했습니다.
   - query는 authenticated parent이면서 캡처한 family/user/session instance가 실행 시점의 정본과 모두 같을 때만 호출합니다.
   - 저장은 TanStack MutationCache의 동적 scope `notif-quiet-hours:{familyId}:{targetUserId}`로 대상별 직렬화하고 실제 요청 직전에 부모·가족·세션을 다시 확인합니다.
   - 성공 응답 target 불일치는 throw하며, family cache에서는 정확한 target row만 불변 갱신합니다. self target일 때만 본인 `notifSettings` quiet cache도 갱신합니다.
4. `src/queries/useFamilyRealtime.ts`
   - 모든 `notification_settings` 이벤트에서 가족 quiet key를 무효화합니다.
   - row user id가 있는 경우 기존 self 설정·child-status 정밀 무효화도 그대로 유지합니다.

## 보존한 계약

- `children[0]`, 전역 active child setter, localStorage DND를 추가하지 않았습니다.
- 기존 일정/위치 알림 전체 저장 POST에 `quiet_hours_*`를 포함하지 않았습니다.
- 새 라이브러리·스키마·백엔드 변경을 추가하지 않았습니다.
- `tsconfig.app.tsbuildinfo`의 기존 검증 산출물은 폐기·stage하지 않았습니다.
- 상위 작업의 문서와 UI 파일을 수정·stage하지 않았습니다.

## TDD 증거

- RED: `node --test tests/notificationQuietHours.test.ts tests/notificationSettingsReliability.test.ts`
  - 결과: `15개 중 8 PASS / 7 FAIL`
  - 새 transform 모듈 부재와 endpoint/query/cache/realtime 계약 부재로 예상 실패를 확인했습니다.
- transform 중간 GREEN: `tests/notificationQuietHours.test.ts` `4/4 PASS`
- 최종 집중 GREEN: 지정 2개 파일 `18/18 PASS`, fail 0, exit 0

## 최종 코드

- `src/transform/notificationQuietHours.ts`
- `src/lib/api/endpoints/notifications.ts`
- `src/queries/keys.ts`
- `src/queries/useNotifications.ts`
- `src/queries/useFamilyRealtime.ts`
- `tests/notificationQuietHours.test.ts`
- `tests/notificationSettingsReliability.test.ts`

## 검증 포인트

- 집중 회귀:
  - `node --test tests/notificationQuietHours.test.ts tests/notificationSettingsReliability.test.ts`
  - 결과: `18/18 PASS`, fail 0, exit 0
- 앱 전체 Node 회귀:
  - `node --test tests/*.test.*`
  - 결과: `779/779 PASS`, fail 0, exit 0
- TypeScript:
  - `npm run typecheck`
  - 결과: exit 0
- diff:
  - `git diff --check`
  - 결과: exit 0

## 수행하지 않은 작업

- 웹/Worker 배포, 프로덕션 D1 변경, 브라우저 실행, Android 빌드·설치, ADB 접근은 수행하지 않았습니다.
- A17 부모 세션과 razr/S25 기기를 포함한 모든 실기기 상태를 건드리지 않았습니다.
- refresh token·시크릿·사용자 데이터를 읽거나 조작하지 않았습니다.
