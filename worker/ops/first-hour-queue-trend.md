# 출시 첫 60분 운영 큐 스냅샷·추세 판정

## 목적

출시 직전과 직후 운영자가 확인할 질문은 하나다.

> 실제 처리 가능한 긴급 알림·메모·Google Play RTDN·웹 결제/환불 대사 큐가 두 관측 구간 연속 커지는가?

`first-hour-queue-snapshot.sql`은 Worker 처리 코드와 같은 status·lease·retry 시각 조건으로 큐를 센다. 결과는
DB 시각과 고정된 11개 count만 반환한다. 사용자·가족·아이·메모·주문·결제 key/token·오류 원문은 조회 결과와
스냅샷에 포함하지 않는다. `hyeni-first-hour-queue-snapshot-v2`는 비민감 배포 출처인
`workerService=hyeni-calendar-api`, 현재 100% traffic Worker deployment ID·생성 시각, 정확한 version ID,
deployment API 확인 시각만 추가로 보존한다.

## 스냅샷 저장

실행 위치는 `C:\Users\TK\Desktop\hyeni-3\worker`이다. 로컬 증거 디렉터리 `..\artifacts/`는 Git에서 제외된다.
스냅샷과 판정 파일은 create-only로 저장하며 같은 경로의 증거는 덮어쓰지 않는다. 기존 파일이 있으면 새 출시 시각
디렉터리를 만든다. T-10 전에 새 Worker가 이미 100% traffic으로 배포되어 있어야 하며, Cloudflare 배포 결과와
`CF_VERSION_METADATA.id`가 일치하는 하이픈 UUID를 `HYENI_WORKER_VERSION_ID`에 둔다. `CLOUDFLARE_ACCOUNT_ID`와
`CLOUDFLARE_API_TOKEN`도 환경변수로만 주입한다. token에는 D1 read와 `Workers Scripts Read` 또는
`Workers Tail Read` 권한이 필요하다. 캡처기는 매번 Cloudflare List Deployments API의 첫 번째 active deployment를
조회해 단일 version이 100% traffic인지, env version과 같은지, deployment 생성 시각이 DB 측정 시각보다 늦지 않은지
확인한 뒤에만 파일을 만든다. T+60까지 Worker를 다시 배포하지 않는다.

```powershell
Set-Location -LiteralPath 'C:\Users\TK\Desktop\hyeni-3\worker'
$ErrorActionPreference = 'Stop'
if ($env:HYENI_WORKER_VERSION_ID -notmatch '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$') {
  throw 'HYENI_WORKER_VERSION_ID가 유효한 Worker version UUID가 아닙니다.'
}
$queueEvidenceDirectory = Join-Path -Path '..\artifacts' -ChildPath ("first-hour-queues-" + (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $queueEvidenceDirectory | Out-Null

$queueAggregate = npx wrangler d1 execute hyeni-calendar --remote --yes --json --file=ops/first-hour-queue-snapshot.sql
if ($LASTEXITCODE -ne 0) { throw 'T-10 운영 큐 집계가 실패했습니다.' }
$queueAggregate | node .\scripts\capture-first-hour-queue-snapshot.mjs --checkpoint=T-10 --out="$queueEvidenceDirectory\t-minus-10.json"
if ($LASTEXITCODE -ne 0) { throw 'T-10 운영 큐 스냅샷 저장이 실패했습니다.' }
```

T+30·T+45·T+60에도 같은 read-only 집계를 실행하고 checkpoint와 파일명만 각각 아래처럼 바꾼다.

```powershell
$queueAggregate = npx wrangler d1 execute hyeni-calendar --remote --yes --json --file=ops/first-hour-queue-snapshot.sql
if ($LASTEXITCODE -ne 0) { throw 'T+30 운영 큐 집계가 실패했습니다.' }
$queueAggregate | node .\scripts\capture-first-hour-queue-snapshot.mjs --checkpoint=T+30 --out="$queueEvidenceDirectory\t-plus-30.json"
if ($LASTEXITCODE -ne 0) { throw 'T+30 운영 큐 스냅샷 저장이 실패했습니다.' }

$queueAggregate = npx wrangler d1 execute hyeni-calendar --remote --yes --json --file=ops/first-hour-queue-snapshot.sql
if ($LASTEXITCODE -ne 0) { throw 'T+45 운영 큐 집계가 실패했습니다.' }
$queueAggregate | node .\scripts\capture-first-hour-queue-snapshot.mjs --checkpoint=T+45 --out="$queueEvidenceDirectory\t-plus-45.json"
if ($LASTEXITCODE -ne 0) { throw 'T+45 운영 큐 스냅샷 저장이 실패했습니다.' }

$queueAggregate = npx wrangler d1 execute hyeni-calendar --remote --yes --json --file=ops/first-hour-queue-snapshot.sql
if ($LASTEXITCODE -ne 0) { throw 'T+60 운영 큐 집계가 실패했습니다.' }
$queueAggregate | node .\scripts\capture-first-hour-queue-snapshot.mjs --checkpoint=T+60 --out="$queueEvidenceDirectory\t-plus-60.json"
if ($LASTEXITCODE -ne 0) { throw 'T+60 운영 큐 스냅샷 저장이 실패했습니다.' }
```

## 자동 판정

T+45에는 T-10·T+30·T+45의 세 파일을 시간순으로 넘긴다.

```powershell
node .\scripts\check-first-hour-queue-trend.mjs `
  "$queueEvidenceDirectory\t-minus-10.json" `
  "$queueEvidenceDirectory\t-plus-30.json" `
  "$queueEvidenceDirectory\t-plus-45.json" `
  --out="$queueEvidenceDirectory\trend-t-plus-45.json"
$queueTrendExitCode = $LASTEXITCODE
if ($queueTrendExitCode -eq 1) { throw '운영 큐가 두 구간 연속 증가했습니다. 신규 rollout을 중단합니다.' }
if ($queueTrendExitCode -eq 2) { throw '운영 큐 판정이 불충분합니다. 출시 확대를 HOLD합니다.' }
```

T+60에는 네 스냅샷을 모두 넘긴다. 앞 구간에서 이미 두 번 연속 증가한 큐도 놓치지 않는다.

```powershell
node .\scripts\check-first-hour-queue-trend.mjs `
  "$queueEvidenceDirectory\t-minus-10.json" `
  "$queueEvidenceDirectory\t-plus-30.json" `
  "$queueEvidenceDirectory\t-plus-45.json" `
  "$queueEvidenceDirectory\t-plus-60.json" `
  --out="$queueEvidenceDirectory\trend-t-plus-60.json"
$queueTrendExitCode = $LASTEXITCODE
if ($queueTrendExitCode -eq 1) { throw '운영 큐가 두 구간 연속 증가했습니다. 신규 rollout을 중단합니다.' }
if ($queueTrendExitCode -eq 2) { throw '운영 큐 판정이 불충분합니다. 출시 확대를 HOLD합니다.' }
```

판정은 다음 세 값만 사용한다.

- `ROLLBACK_REQUIRED`(exit 1): 고정된 11개 큐 중 하나 이상이 1→2, 2→3 두 구간 연속 엄격히 증가했다.
- `HEALTHY`(exit 0): 유효한 스냅샷이 3개 이상이고 두 구간 연속 증가한 큐가 없다.
- `INCONCLUSIVE`(exit 2): 파일 누락·형식 오류·순서/시계 오류·stale 증거·스냅샷 간 Worker version 또는
  deployment 불일치다.
  정상으로 간주하지 않는다.

T+45 판정은 정확히 `T-10,T+30,T+45`, T+60 판정은 정확히 네 checkpoint 전체가 있어야 한다. 중간 checkpoint가
빠지거나 순서가 다르면 `snapshot_checkpoint_sequence_invalid`로 닫는다. 스냅샷은 DB 측정 시각도 모두
오름차순이어야 한다. 마지막 스냅샷은 판정 시각 기준 20분 이내,
미래 허용 오차는 2분, 전체 관측 폭은 90분 이하여야 한다. 이 범위는 T-10부터 T+60까지의 70분 계획에
운영 여유를 더한 고정 계약이다. `hyeni-first-hour-queue-trend-v2` 결과도 동일한 `workerService`,
`workerDeploymentId`, `workerDeploymentCreatedAt`, `workerVersionId`를 보존한다. 중간 재배포로 version ID가
하나라도 다르면 `snapshot_version_mismatch`, 같은 version이라도 deployment가 다르면
`snapshot_deployment_mismatch`로 fail-closed한다. 기존 파일을 수정하지 말고 새 deployment용 create-only 증거
디렉터리에서 다시 시작한다.

`HEALTHY`는 큐 추세 한 항목만 통과했다는 뜻이다. 5xx·세션·가족 격리·권리·SOS/긴급 표시 ACK·crash/ANR과
사람의 최종 `GO`를 대체하지 않는다.
