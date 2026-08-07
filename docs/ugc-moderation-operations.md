# AI·가족 메모 신고 운영 가이드

- 적용 데이터: `user_feedback.type IN ('ai_content_report','memo_content_report')`
- 운영 연락처·이의 제기: `mail@hyenicalendar.com`
- 기본 출시 판정: 실제 담당자·운영 큐·데모 E2E 증거가 없으면 **HOLD**

이 문서는 현재 앱과 Worker의 실제 신고·차단 계약만 사용한다. 신고 문서가 있다는 사실만으로 Google Play
AI·UGC 제출 게이트를 완료 처리하지 않는다. 운영 담당자 배정, 제한된 case 기록 시스템, 실제 아이·부모
데모 세션의 신고·차단·D1·표시 직전 재인가 E2E가 모두 확인돼야 한다.

## 1. 현재 코드 계약

신고는 `user_feedback`에 먼저 저장되며 초기 `status`는 `new`다. 신고 행의 `message` JSON에는
`kind`, `contentId`, `reportedUserId`, `reason`, `detail`만 들어간다. AI·메모 원문은 신고 행에 복제하지 않는다.
동일 신고자와 동일 콘텐츠의 중복 신고는 같은 결정적 ID로 멱등 처리된다.

| 유형 | 신고 가능 대상 | 허용 사유 |
|---|---|---|
| `ai_content_report` | 아이 본인의 저장된 `assistant` 답변 | `scary_or_uncomfortable`, `abusive_language`, `asks_personal_info`, `inaccurate`, `other` |
| `memo_content_report` | 정확한 가족·아이 스레드에서 상대가 보낸 저장 메시지 | `harassment`, `sexual_or_violent`, `personal_info`, `illegal_or_dangerous`, `other` |

AI 신고는 부모에게 자동 전달되지 않는다. 메모 차단은 두 사용자 사이의 메모 조회·전송·realtime·push에만
적용한다. 가족 연결, 위치, SOS, 도착·위험 알림은 계속 전달한다. 운영자가 신고자 대신 차단을 만들거나
안전 채널을 끊어서는 안 된다.

현재 Worker에는 운영자 전용 콘텐츠 삭제·계정 정지 API와 moderation action 감사 테이블이 없다. 따라서
운영자는 신고 큐의 제한된 상태 전이만 수행하고, 콘텐츠 제한·계정 제한·수사기관 협조처럼 사용자 권리에
영향을 주는 조치는 승인된 별도 case 기록과 코드 리뷰된 절차 없이 D1을 직접 수정해 실행하지 않는다.
이 조치 경로와 책임자가 준비되지 않은 상태는 `HOLD`다.

## 2. 역할과 내부 대응 목표

| 역할 | 책임 |
|---|---|
| 1차 검토자 | 메타데이터 큐 확인, 한 건 claim, 최소 원문 열람, 우선순위 분류 |
| 안전 책임자 | 아동 위해·성적·폭력·불법·개인정보 탈취 가능성 판단과 즉시 escalation |
| 기술 책임자 | 반복 AI 안전 실패, 차단 우회, 신고 저장 실패의 재현·수정·배포 판단 |
| 정책·법률 책임자 | 계정/콘텐츠 제한, 보존, 적법한 기관 요청, 이의 제기 최종 결정 |
| 대체 담당자 | 주 담당자 부재 시 같은 권한·절차로 큐 인수 |

내부 목표는 다음과 같다. 자동 신고 알림이 없거나 해당 시간대 담당자가 실제로 근무하지 않으면 목표를
충족한다고 표시하지 않는다.

- P0: 즉각적인 아동 위해, 성적 착취, 구체적 폭력·자해, 개인정보 탈취 정황은 staffed window에서 1시간 이내 triage하고 즉시 안전 책임자에게 escalation한다.
- P1: `sexual_or_violent`, `illegal_or_dangerous`, `personal_info`, `asks_personal_info`는 4시간 이내 triage한다.
- P2: `harassment`, `abusive_language`, `scary_or_uncomfortable`는 1영업일 이내 triage한다.
- P3: `inaccurate`, `other`는 3영업일 이내 triage한다.

앱 신고는 긴급 구조 채널이 아니다. 실제 위급 상황은 앱의 SOS와 112 등 공식 긴급 연락 수단을 사용해야
한다. 운영자가 신고 하나만 보고 위험이 없다고 단정하거나 자동으로 부모에게 원문을 전달하지 않는다.

## 3. 메타데이터 우선 큐 확인

Worker 디렉터리에서 실행한다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-1\worker'
```

먼저 원문·사용자·가족 식별자를 열지 않고 유형·상태·사유·나이만 집계한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT type, status, json_extract(message,'$.reason') AS reason, COUNT(*) AS report_count, MIN(created_at) AS oldest_at, MAX(created_at) AS newest_at FROM user_feedback WHERE type IN ('ai_content_report','memo_content_report') GROUP BY type,status,reason ORDER BY CASE WHEN reason IN ('sexual_or_violent','illegal_or_dangerous','personal_info','asks_personal_info') THEN 0 WHEN reason IN ('harassment','abusive_language','scary_or_uncomfortable') THEN 1 ELSE 2 END,oldest_at;"
```

미처리 노화도 집계한다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT type, COUNT(*) AS new_count, SUM(CASE WHEN datetime(substr(created_at,1,19))<=datetime('now','-1 hour') THEN 1 ELSE 0 END) AS older_than_1h, SUM(CASE WHEN datetime(substr(created_at,1,19))<=datetime('now','-4 hours') THEN 1 ELSE 0 END) AS older_than_4h, MIN(created_at) AS oldest_new_at FROM user_feedback WHERE type IN ('ai_content_report','memo_content_report') AND status='new' GROUP BY type ORDER BY type;"
```

한정된 case 목록은 내부 `rowid`만 반환한다. 신고 ID에는 사용자 식별자가 포함될 수 있으므로 일상 큐
목록에 노출하지 않는다. `detail`도 내용 대신 존재 여부와 길이만 본다.

```powershell
npx wrangler d1 execute hyeni-calendar --remote --json --command "SELECT rowid AS case_rowid, type, status, created_at, current_screen, json_extract(message,'$.reason') AS reason, CASE WHEN NULLIF(TRIM(COALESCE(json_extract(message,'$.detail'),'')),'') IS NULL THEN 0 ELSE 1 END AS has_detail, LENGTH(COALESCE(json_extract(message,'$.detail'),'')) AS detail_length FROM user_feedback WHERE type IN ('ai_content_report','memo_content_report') AND status='new' ORDER BY CASE WHEN json_extract(message,'$.reason') IN ('sexual_or_violent','illegal_or_dangerous','personal_info','asks_personal_info') THEN 0 WHEN json_extract(message,'$.reason') IN ('harassment','abusive_language','scary_or_uncomfortable') THEN 1 ELSE 2 END,created_at,rowid LIMIT 100;"
```

모든 컬럼을 한꺼번에 가져오는 조회나 전체 `message`, 전체 AI·memo 테이블 조회를 사용하지 않는다. 큐 목록을 채팅·이메일·일반
issue tracker에 붙이지 않는다.

## 4. 한 건 claim과 최소 원문 확인

case를 맡을 운영자는 외부 제한 case 기록에 담당자·claim 시각·`case_rowid`를 먼저 기록한다. 그 뒤
`new → reviewing` 조건부 전이를 실행한다. `changed_rows=1`일 때만 자신이 claim한 것이다.

```powershell
$caseRowIdText = Read-Host 'claim할 case_rowid'
$caseRowId = 0L
if (-not [long]::TryParse($caseRowIdText, [ref]$caseRowId) -or $caseRowId -le 0) { throw '올바른 case_rowid가 아닙니다.' }
$claimSql = "UPDATE user_feedback SET status='reviewing' WHERE rowid=$caseRowId AND type IN ('ai_content_report','memo_content_report') AND status='new'; SELECT changes() AS changed_rows;"
npx wrangler d1 execute hyeni-calendar --remote --json --command $claimSql
```

원문 열람은 메타데이터만으로 판정할 수 없을 때, 해당 한 건에만 수행한다. 출력에는 아동 대화·가족 메모·
주소·사진 R2 key가 포함될 수 있으므로 화면 녹화, screenshot, 클립보드 공유를 끄고 승인된 담당자만 본다.

```powershell
$reviewConfirmation = Read-Host '민감한 원문 한 건을 열람하려면 REVIEW를 입력'
if ($reviewConfirmation -cne 'REVIEW') { throw '원문 열람이 취소됐습니다.' }
$reviewSql = "WITH report AS (SELECT rowid,type,status,message,created_at FROM user_feedback WHERE rowid=$caseRowId AND type IN ('ai_content_report','memo_content_report') AND status='reviewing' LIMIT 1) SELECT rowid AS case_rowid,type,status,created_at,json_extract(message,'$.reason') AS reason,json_extract(message,'$.detail') AS detail,CASE WHEN type='ai_content_report' THEN (SELECT content FROM ai_chat_messages WHERE id=json_extract(report.message,'$.contentId') AND role='assistant' LIMIT 1) ELSE (SELECT content FROM memo_replies WHERE id=json_extract(report.message,'$.contentId') LIMIT 1) END AS reported_content FROM report;"
npx wrangler d1 execute hyeni-calendar --remote --json --command $reviewSql
```

원문 행이 없다고 신고가 허위라는 뜻은 아니다. 계정 삭제·가족 삭제·보존 정책에 따라 source가 이미 없어질
수 있다. 메모 원문이 `[[img:R2key]]` 또는 `[[loc:lat,lng|주소]]` 마커라면 R2 객체나 좌표를 일반 URL로
열거나 case 기록에 복사하지 않는다. 별도 권한 검토 없이 access token을 query string에 넣지 않는다.

## 5. 판정과 상태 전이

현재 D1 `status`는 큐 위치만 나타내고 누가 무엇을 했는지 보존하지 않는다. 다음 정본은 별도의 제한 case
기록에 남긴다.

- `case_rowid`, report type, 접수·claim·판정 시각
- 검토자와 2차 승인자
- 사유, 우선순위, 원문 열람 여부
- 위반 여부와 적용한 조치의 승인 근거
- 사용자 통지 여부와 이의 제기 결과
- 관련 코드 배포가 있으면 앱·Worker SHA와 deployment ID

허용하는 queue status는 다음 다섯 개다.

- `new`: 미claim
- `reviewing`: 담당자 claim 완료
- `escalated`: 안전·정책·법률 책임자의 결정 대기
- `closed_no_action`: 위반 근거 부족 또는 조치 불필요
- `closed_actioned`: 승인된 조치와 검증 완료

최종 상태는 `reviewing` 또는 `escalated`에서만 조건부로 바꾼다. 운영 조치와 case 감사 기록이 끝나기
전에 `closed_actioned`로 표시하지 않는다.

```powershell
$nextStatus = Read-Host 'escalated, closed_no_action, closed_actioned 중 하나'
if ($nextStatus -notin @('escalated','closed_no_action','closed_actioned')) { throw '허용되지 않은 상태입니다.' }
$expectedStatus = Read-Host '현재 상태 reviewing 또는 escalated'
if ($expectedStatus -notin @('reviewing','escalated')) { throw '허용되지 않은 현재 상태입니다.' }
$statusSql = "UPDATE user_feedback SET status='$nextStatus' WHERE rowid=$caseRowId AND type IN ('ai_content_report','memo_content_report') AND status='$expectedStatus'; SELECT changes() AS changed_rows;"
npx wrangler d1 execute hyeni-calendar --remote --json --command $statusSql
```

`changed_rows=0`이면 다른 담당자 처리나 상태 변경을 의심하고 다시 조회한다. 값을 강제로 덮어쓰지 않는다.

## 6. 허용 조치와 금지 조치

### 즉시 허용되는 제품 내 보호

- 신고자는 앱에서 상대 메모 사용자를 직접 차단할 수 있다.
- 차단은 memo만 숨기며 SOS·위치·도착·위험 알림과 가족 연결은 유지한다.
- 중복 신고는 기존 행으로 성공 처리하므로 새 case로 중복 집계하지 않는다.

### 운영 승인 뒤 가능한 조치

- 반복되는 AI 안전 실패는 재현 가능한 fixture로 만들고, 안전 규칙보다 앞서지 않는 운영자 프롬프트 또는
  Worker 수정으로 해결한 뒤 전체 AI 안전 회귀를 실행한다.
- 확정 위반에 대한 콘텐츠 제한·계정 제한·기관 협조는 정책·법률 책임자의 승인, 최소 범위, 복구 계획,
  별도 감사 기록이 있는 절차로만 수행한다.
- 위법성이나 아동 위해가 의심되면 원문을 넓게 공유하지 않고 안전·법률 책임자에게 즉시 escalation한다.

### 금지

- 일반 D1 콘솔에서 `memo_replies`, `ai_chat_messages`, `users`, `family_members`를 임의 `DELETE`·`UPDATE`하지 않는다.
- 신고자의 요청 없이 운영자가 `user_interaction_blocks`를 만들거나 해제하지 않는다.
- 차단을 가족 연결 해제, 위치 중단, SOS·안전 알림 중단으로 확대하지 않는다.
- AI 신고를 자동으로 부모에게 전달했다고 사용자에게 말하지 않는다.
- 신고 원문, 아동 이름, 가족 ID, 좌표, R2 key, 이메일·전화번호를 Slack·메일·일반 issue에 복사하지 않는다.
- access·refresh·purchase/order token, billing key, payment key를 조회하거나 기록하지 않는다.
- 처리 상태만 바꾸고 실제 조치·검증·감사 기록 없이 `closed_actioned`로 닫지 않는다.

운영자 전용 제한 도구와 감사 저장소가 준비되지 않았는데 실제 제한이 필요한 case가 발생하면 임시 SQL을
만들어 실행하지 않고 `escalated`로 유지한다. 이 상태에서 Play rollout 확대는 `HOLD`다.

## 7. 사용자 통지와 이의 제기

이의 제기는 `mail@hyenicalendar.com`에서 받는다. 사용자가 신고 원문·사진·좌표·token을 다시 보내도록
요구하지 않는다. 계정 소유권을 최소 정보로 확인하고 제한 case 시스템 안에서 원 신고와 연결한다.

- 신고 접수 성공 문구는 운영 검토 큐에 저장됐다는 뜻이며 즉시 조치·부모 통지·위반 확정을 뜻하지 않는다.
- 연락 가능한 보호자 계정이 없는 아이 신고에는 앱이 제공하지 않는 이메일 회신을 약속하지 않는다.
- 계정·콘텐츠 제한 통지는 근거 범주, 적용 범위, 기간, 이의 제기 방법을 제공하되 다른 사용자의 신원을 노출하지 않는다.
- 이의 제기는 원 검토자와 다른 승인자가 재검토하고 결과를 제한 case 기록에 남긴다.
- 적법한 기관 요청은 정책·법률 책임자가 진위와 범위를 확인한 뒤 최소 정보만 처리한다.

## 8. 개인정보·삭제·보존

현재 공개 개인정보처리방침은 콘텐츠 안전 정보의 대상 ID·사유·설명·처리 상태와 차단 관계를 고지한다.
신고 전용 자동 TTL은 코드에 없으므로 운영자가 임의 보존기간을 약속하거나 광범위하게 삭제하지 않는다.
법률·정책 책임자가 목적 달성, 계정 삭제, 법정 보존 예외를 판단한 승인 절차를 따른다.

계정 삭제 계약은 본인이 만든 신고를 삭제하고, 타인의 `memo_content_report`에 남은 피신고자 ID는 `null`로
익명화한다. source 행이 사라져도 타인의 신고 사유를 재식별하려고 다른 데이터와 결합하지 않는다.

## 9. 출시 증거와 HOLD 해제

다음 증거가 모두 같은 release record에 연결돼야 한다.

1. 부모·아이 데모 계정과 재사용 가능한 심사 접근 절차
2. 아이 AI 답변 신고 → `status='new'` D1 반영 → claim → 판정 상태 전이
3. 부모와 아이 양방향 memo 신고·차단·해제
4. 차단 뒤 memo 조회·realtime·FCM·pending 미표시와 SOS·위치·안전 알림 유지
5. 늦게 도착한 Web Push·FCM의 `memoDisplayPermit` 표시 직전 재인가 fail-closed
6. 중복 신고 멱등, 본인/타 가족/타 스레드 신고 거부
7. 담당자 roster, 내부 대응 목표, 대체 담당자, 제한 case 기록, 이의 제기 메일 송수신
8. 테스트로 만든 데이터의 승인된 정리 결과와 정리 전후 불변식

운영 production에 안전한 테스트 정리 절차가 아직 없다면 실제 사용자 가족으로 E2E를 만들지 않는다.
격리 환경에서 먼저 검증하고 production E2E 항목은 `HOLD`로 남긴다. 증거 없는 체크박스 변경이나 문서상
완료 선언은 허용하지 않는다.
