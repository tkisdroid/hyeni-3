# 아이 모드 실시간 3D 혜니 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 18장 혜니 이미지와 참고 GIF의 정체성을 GPT Image 2 기준 시트와 리깅된 단일 GLB로 통합하고, Android 아이 모드의 플로팅 혜니를 투명 실시간 3D로 렌더링하되 웹·PWA·오류 환경은 기존 WebP로 안전하게 유지한다.

**Architecture:** 기존 `AiBuddyFab`의 역할 가드·드래그·배회·주목·말풍선·탭·길게 누르기를 정본으로 둔다. 순수 `aiBuddy3dState`가 현재 face/nudge를 7개 clip과 morph로 해석하고, `AiBuddyVisual`이 Android/WebGL2/motion 조건에서만 lazy `AiBuddyThreeCanvas`를 연다. Three.js는 한 canvas에서 직접 구동하고 모델·renderer·context 오류는 조용히 WebP로 강등한다. GPT Image 2 → Meshy → Blender 단계는 사용자 시각 승인 관문을 각각 통과한 산출물만 다음 단계에 사용한다.

**Tech Stack:** GPT Image 2 Images API, Sharp, Meshy multi-image/Smart Rig, Blender glTF 2.0, Three.js, React 19, TypeScript strict, Vite 7/Workbox, Capacitor 8 Android, Node 24 test runner, Playwright/CDP, Gradle/ADB.

**Spec:** [`docs/superpowers/specs/2026-08-24-ai-buddy-realtime-3d-design.md`](../specs/2026-08-24-ai-buddy-realtime-3d-design.md)

## Global Constraints

- 모든 응답·주석·문서·커밋 메시지는 한국어로 작성하고 아이 화면 문구는 반말을 유지한다.
- 참고 GIF `C:\Users\TK\Downloads\A_cute_3d_cartoon_girl_with_dark_hair_styled.gif`는 읽기만 하고 수정·이동·삭제하지 않는다.
- GPT Image 2 호출에는 `gpt-image-2`를 명시한다. 이 모델에는 `--background transparent`와 `--input-fidelity`를 전달하지 않는다. 모델링 시트는 불투명 단색 배경, 최종 앱 배경은 WebGL alpha로 투명하게 만든다.
- `OPENAI_API_KEY`, Meshy/Tripo/Mixamo 로그인, 결제 수단, 쿠키, 서명 비밀번호를 출력·커밋·문서화하지 않는다. 키가 없으면 값을 요구하지 않고 사용자가 환경 변수로 설정할 때까지 생성 단계에서 멈춘다.
- GPT turnaround 승인 전 표정 시트·유료 3D 변환을 시작하지 않고, 표정 시트 승인 전 Meshy를 시작하지 않으며, 3D turntable·7개 clip 승인 전 앱 renderer를 연결하지 않는다.
- Meshy는 최대 두 번만 구조 보정한다. 두 번 뒤에도 얼굴·의상 합격 기준을 못 맞추면 Tripo를 한 번만 비교하고 무기한 재생성하지 않는다.
- 최종 `hyeni.glb`는 6MiB 이하, 30,000~50,000 triangles, 1K texture, material/draw call 4개 이하, bone 70개 이하, `JOINTS_1` 없음으로 고정한다. GitHub 단일 파일 제한을 피하도록 편집 원본도 90MiB 미만으로 정리한다.
- 기존 `public/assets/ai-buddy/poses/*.webp` 18장은 삭제·교체·열화하지 않는다. 웹/PWA/iOS/reduced-motion/WebGL 실패의 정본 폴백이다.
- Worker, D1, 인증, 위치, 알림, AI 크레딧 계약은 건드리지 않고 새 endpoint·migration·secret·분석 이벤트를 만들지 않는다.
- 실기기 검증은 razr `ZY22H9VTQD`만 사용한다. `npm run android:install:debug -- ZY22H9VTQD`로 사용자 0에 덮어쓰고 로그아웃·역할 전환·재페어링·refresh token 조회/회전을 하지 않는다. A17·S25는 접근하지 않는다.
- Play Store 업로드·심사 제출·서명 AAB 생성·Pages/Worker 배포는 이번 범위 밖이다.
- 사용자 untracked `.hy-topbar`, `artifacts/**`와 기존 증거 파일은 stage·수정·삭제하지 않는다.

## 파일·책임 지도

| 경로 | 작업 | 단일 책임 |
|---|---|---|
| `assets/08-source-sheets/ai-buddy-3d/` | Create | 입력 사본, 프롬프트, GPT Image 2 후보·선택본·표정 시트 |
| `assets/03-hyeni-character/ai-buddy-3d-source/` | Create | Meshy export, Blender master, 검토용 turntable·clip preview |
| `public/assets/ai-buddy/3d/hyeni.glb` | Create | 앱에 실리는 유일한 3D runtime asset |
| `docs/assets/ai-buddy-3d-provenance.md` | Create | 입력·생성·라이선스·export·SHA-256 출처 기록 |
| `scripts/prepare-ai-buddy-3d-references.mjs` | Create | GIF frame 추출, 8개 anchor 복사, 결정적 manifest 생성 |
| `scripts/slice-ai-buddy-turnaround.mjs` | Create | 승인된 5-view sheet에서 Meshy용 정면·측면·후면 입력 생성 |
| `scripts/lib/aiBuddyGlbContract.mjs` | Create | GLB 구조·예산·clip·morph 계약 검사 |
| `scripts/verify-ai-buddy-glb.mjs` | Create | 실제 runtime GLB 검증 CLI |
| `scripts/verify-ai-buddy-3d-runtime.mjs` | Create | 외부망 차단 Android mock/Web fallback 브라우저 QA |
| `scripts/fixtures/ai-buddy-3d-runtime.html`, `scripts/fixtures/ai-buddy-3d-runtime.tsx` | Create | production component에 7개 상태를 주입하는 QA 전용 Vite page |
| `src/transform/aiBuddy3dState.ts` | Create | 표시 우선순위와 face/nudge → clip/morph 순수 매핑 |
| `src/transform/aiBuddy3dGate.ts` | Create | child/Android/WebGL2/motion/error 활성 조건 순수 판정 |
| `src/transform/aiBuddy3dRuntime.ts` | Create | 30fps·blink·one-shot fallback 등 renderer 독립 계산 |
| `src/app/AiBuddyWebpVisual.tsx` | Create | 현재 20개 의미 face의 18장 WebP stack 폴백 |
| `src/app/AiBuddyVisual.tsx` | Create | capability 확인, lazy 3D, ready/error 시 WebP 전환 |
| `src/app/AiBuddyThreeCanvas.tsx` | Create | canvas lifecycle와 controller 연결 |
| `src/app/aiBuddyThreeRuntime.ts` | Create | Three scene·GLB pool·mixer·morph·resize·pause·dispose |
| `src/app/AiBuddyFab.tsx` | Modify | 활성 cue 보존, 부모 메시지 탭 라우팅, 단일 visual 배치 |
| `src/app/AiBuddyFab.css` | Modify | 투명 canvas와 단일 full-attention visual 배치 |
| `vite.config.ts` | Modify | 안정적인 3D dynamic chunk와 PWA precache 제외 |
| `scripts/lib/pwaPrecacheManifest.mjs` | Modify | GLB·3D runtime precache 금지 검증 |
| `package.json`, `package-lock.json` | Modify | `three`, GLB/browser QA 명령 |
| `tests/aiBuddy3d*.test.*` | Create | reference, GLB, state, gate, runtime, PWA 회귀 |
| 기존 `tests/aiBuddyCharacterAssets.test.mjs`, `tests/aiBuddyCharacterBehavior.test.ts`, `tests/aiBuddyFab.test.ts` | Modify/Verify | 18장 폴백·기존 조작·새 부모 메시지 계약 보존 |
| `CLAUDE.md`, `AGENTS.md` | Modify last | 실제 검증이 끝난 결과만 정본 이력에 기록 |

---

### Task 1: 기준 입력·프롬프트를 재현 가능하게 고정

**Files:**

- Create: `tests/aiBuddy3dReferencePrep.test.mjs`
- Create: `scripts/prepare-ai-buddy-3d-references.mjs`
- Create: `assets/08-source-sheets/ai-buddy-3d/prompts/turnaround-gpt-image-2.txt`
- Create: `assets/08-source-sheets/ai-buddy-3d/prompts/expressions-gpt-image-2.txt`
- Create: `assets/08-source-sheets/ai-buddy-3d/README.md`

- [ ] **Step 1: reference 준비 계약의 실패 테스트 작성**

`tests/aiBuddy3dReferencePrep.test.mjs`는 임시 PNG를 입력으로 사용해 원본 SHA-256이 전후 동일하고, 재실행 결과가 byte-for-byte 같으며, 아래 9개 입력 이름과 hash가 정렬된 manifest에 있는지 검사한다.

```js
const EXPECTED_INPUTS = [
  "expecting.webp",
  "heart-hug.webp",
  "jump.webp",
  "polite.webp",
  "reference-gif-frame-000.png",
  "tablet.webp",
  "thinking.webp",
  "welcome.webp",
  "worried.webp",
];

test("기준 입력은 원본을 건드리지 않고 결정적 manifest로 준비된다", async () => {
  const before = await sha256(source);
  const first = await prepareAiBuddyReferences({ gifPath: source, frame: 0, outDir });
  const second = await prepareAiBuddyReferences({ gifPath: source, frame: 0, outDir });
  assert.equal(await sha256(source), before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.inputs.map(({ name }) => name), EXPECTED_INPUTS);
});
```

- [ ] **Step 2: RED 확인**

Run: `node --test tests/aiBuddy3dReferencePrep.test.mjs`

Expected: `prepare-ai-buddy-3d-references.mjs`가 없어 FAIL.

- [ ] **Step 3: 입력 준비 스크립트 최소 구현**

스크립트는 `sharp(gifPath, { page: frame }).png()`로 frame 0만 새 파일에 추출하고 아래 고정 anchor를 `public/assets/ai-buddy/poses/`에서 복사한다. 기존 출력과 hash가 같으면 성공, 다르면 overwrite하지 않고 실패한다. `reference-inputs.json`은 `schemaVersion`, `generatedAt` 없이 source path·frame·bytes·SHA-256만 정렬해 기록해 재실행이 결정적이어야 한다.

```js
export const AI_BUDDY_REFERENCE_POSES = [
  "expecting", "polite", "welcome", "thinking",
  "tablet", "worried", "heart-hug", "jump",
];
```

CLI:

```powershell
node scripts/prepare-ai-buddy-3d-references.mjs --gif "C:\Users\TK\Downloads\A_cute_3d_cartoon_girl_with_dark_hair_styled.gif" --frame 0 --out-dir "assets/08-source-sheets/ai-buddy-3d/inputs"
```

- [ ] **Step 4: 두 GPT Image 2 프롬프트를 원문으로 저장**

`turnaround-gpt-image-2.txt`에는 아래 요청을 그대로 넣는다.

```text
Create one production modeling turnaround sheet for the same single fictional child-friendly 3D cartoon girl shown in every reference image. Preserve her identity exactly: very large dark-brown eyes, round softly blushed cheeks, tiny soft nose and mouth, dark-brown hair with a small top bun and shoulder-length side hair, warm ivory cream hoodie with consistent hood and drawstrings, muted rose-pink skirt and matching shoes, large head and small body proportions. She is a fictional mascot, not a real person. Show exactly five full-body views in five equal-width vertical bays, in this order: front, front three-quarter, exact side, rear three-quarter, exact back. Use the same neutral A-pose, same scale, same camera height, same facial age, same body proportions, same hairstyle, same clothing construction and same material colors in all five views. Feet and top bun must be fully visible. Premium soft 3D animation-film materials and lighting without naming any studio or living artist. Flat medium blue-gray background in every bay, no floor plane and no cast shadow. No words, letters, numbers, panel labels, borders, props, phone, bag, jewelry or logos. Do not add or remove fingers, limbs, drawstrings or clothing parts. Avoid adult anatomy, makeup, revealing clothes, photorealism, glossy plastic skin, identity drift, perspective distortion, cropped feet, asymmetric eyes, inconsistent back hair, duplicated body parts and fused hands.
```

`expressions-gpt-image-2.txt`에는 아래 요청을 그대로 넣는다.

```text
Using the approved turnaround as the identity source, create one production facial-expression and upper-body reference sheet for exactly the same fictional child-friendly 3D cartoon girl. Keep the face age, eye size and shape, skin tone, bangs, top-bun position, side hair, ivory cream hoodie, rose-pink skirt and body proportions identical in all seven equal-width bays. Show these seven expressions and gestures from left to right with no written labels: 1) bored but gentle while waiting for a friend, cheek lightly supported by one hand; 2) softly hovering and looking around with curious eyes; 3) curious head tilt with raised brows; 4) warmly delivering a message from a parent while gesturing toward empty space beside her; 5) thinking with one hand near the mouth and gaze slightly upward; 6) happy encouragement with both hands lifted; 7) worried and comforting with concerned brows and open supportive hands. Keep every hand anatomically clean and every expression readable at mobile size. Use the same flat medium blue-gray background, soft premium 3D materials and neutral modeling light. No words, letters, numbers, borders, props, phone, envelope, speech bubble, tears, logos or extra characters. Avoid identity drift, different ages, eye-color changes, hairstyle changes, costume changes, adult anatomy, makeup, photorealism, fused fingers and duplicated limbs.
```

- [ ] **Step 5: GREEN 및 실제 reference 준비 확인**

Run: `node --test tests/aiBuddy3dReferencePrep.test.mjs`

Run: 위 CLI를 한 번 실행한 뒤 다시 실행한다.

Expected: 두 실행 모두 성공하고 원본 GIF hash가 동일하며 `inputs/reference-inputs.json`에 9개 입력만 있다.

- [ ] **Step 6: 커밋**

```powershell
git add tests/aiBuddy3dReferencePrep.test.mjs scripts/prepare-ai-buddy-3d-references.mjs assets/08-source-sheets/ai-buddy-3d
git commit -m "3D 혜니 기준 입력과 생성 프롬프트를 고정한다"
```

---

### Task 2: GPT Image 2 turnaround 후보 2장 생성과 사용자 승인

**Files:**

- Create: `assets/08-source-sheets/ai-buddy-3d/turnaround-candidate-1.png`
- Create: `assets/08-source-sheets/ai-buddy-3d/turnaround-candidate-2.png`
- Create after selection: `assets/08-source-sheets/ai-buddy-3d/turnaround-selected.png`
- Create: `docs/assets/ai-buddy-3d-provenance.md`

- [ ] **Step 1: secret·실행 환경 preflight**

키 값은 출력하지 않고 존재 여부만 확인한다.

```powershell
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw "OPENAI_API_KEY를 사용자 환경 변수에 설정한 뒤 다시 진행해야 합니다." }
docker version
```

현재 로컬 Python 3.11은 표준 라이브러리 `encodings`가 없어 imagegen CLI를 직접 실행할 수 없다. 시스템 Python을 임의로 수리·설치하지 않고 공식 `python:3.12-slim` 임시 container에서 skill의 `image_gen.py`를 실행한다. Docker daemon이 꺼져 있으면 설치나 설정을 바꾸지 말고 사용자에게 Docker Desktop 시작만 요청한다.

- [ ] **Step 2: dry-run으로 모델·입력·출력 계약 확인**

아래 command에서 마지막에 `--dry-run`을 붙여 실행한다. 출력 JSON에 `model: gpt-image-2`, `n: 2`, `size: 1536x1024`, `quality: high`, `background: opaque`, image 9개가 있고 secret 값이 없는지 확인한다.

```powershell
docker run --rm --env OPENAI_API_KEY --mount type=bind,source=C:\Users\TK\Desktop\hyeni-3,target=/workspace --mount type=bind,source=C:\Users\TK\.codex\skills\.system\imagegen,target=/imagegen,readonly python:3.12-slim sh -lc "pip install --disable-pip-version-check --no-cache-dir openai pillow && python /imagegen/scripts/image_gen.py edit --model gpt-image-2 --prompt-file /workspace/assets/08-source-sheets/ai-buddy-3d/prompts/turnaround-gpt-image-2.txt --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/expecting.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/polite.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/welcome.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/thinking.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/tablet.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/worried.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/heart-hug.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/jump.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/reference-gif-frame-000.png --n 2 --size 1536x1024 --quality high --background opaque --output-format png --out /workspace/assets/08-source-sheets/ai-buddy-3d/turnaround-candidate.png --no-augment --dry-run"
```

- [ ] **Step 3: 실제 GPT Image 2 호출**

같은 command에서 `--dry-run`만 제거해 정확히 한 번 호출한다. 기존 출력이 있으면 `--force`로 덮지 말고 새 revision 이름을 사용한다. Expected output은 `turnaround-candidate-1.png`, `turnaround-candidate-2.png`다.

- [ ] **Step 4: 자동·시각 품질 검사**

Sharp metadata로 두 파일이 PNG 1536×1024인지 확인하고, 각 후보를 원본 해상도로 열어 다음을 검사한다.

- 정확히 5개 전신 view, 발과 top bun이 잘리지 않음
- 눈·앞머리·번·hood 끈·치마 길이·신발이 모든 view에서 동일
- 손가락·팔·다리 개수와 관절 방향 정상
- 후면 머리·hood 구조가 앞면과 일치
- 문자·소품·바닥 그림자·브랜드 로고 없음
- 중간 명도 청회색 배경이 panel마다 끊기지 않음

- [ ] **Step 5: 사용자 시각 승인 관문**

두 후보를 사용자에게 나란히 보여 주고 1번 또는 2번을 명시적으로 선택받는다. 선택 전에는 표정 시트 생성, Meshy 접속, 결제를 하지 않는다. 선택에 따라 아래 둘 중 정확히 하나만 실행한다.

```powershell
Copy-Item -LiteralPath "assets/08-source-sheets/ai-buddy-3d/turnaround-candidate-1.png" -Destination "assets/08-source-sheets/ai-buddy-3d/turnaround-selected.png"
```

```powershell
Copy-Item -LiteralPath "assets/08-source-sheets/ai-buddy-3d/turnaround-candidate-2.png" -Destination "assets/08-source-sheets/ai-buddy-3d/turnaround-selected.png"
```

- [ ] **Step 6: provenance 최초 기록과 커밋**

`docs/assets/ai-buddy-3d-provenance.md`에 reference 9개의 실제 SHA-256, GIF frame 0, 모델 `gpt-image-2`, 생성일 KST, 프롬프트 파일 hash, 후보 2개 hash, 선택·탈락 사유를 기록한다. API key·계정·결제 정보는 쓰지 않는다.

```powershell
git add assets/08-source-sheets/ai-buddy-3d docs/assets/ai-buddy-3d-provenance.md
git commit -m "GPT Image 2 혜니 턴어라운드를 확정한다"
```

---

### Task 3: 7개 표정 시트 생성과 사용자 승인

**Files:**

- Create: `assets/08-source-sheets/ai-buddy-3d/expressions-candidate-1.png`
- Create after approval: `assets/08-source-sheets/ai-buddy-3d/expressions-approved.png`
- Modify: `docs/assets/ai-buddy-3d-provenance.md`

- [ ] **Step 1: GPT Image 2 expression dry-run**

turnaround 선택본과 얼굴 정체성이 선명한 4개 anchor만 입력해 과도한 평균화를 피한다.

```powershell
docker run --rm --env OPENAI_API_KEY --mount type=bind,source=C:\Users\TK\Desktop\hyeni-3,target=/workspace --mount type=bind,source=C:\Users\TK\.codex\skills\.system\imagegen,target=/imagegen,readonly python:3.12-slim sh -lc "pip install --disable-pip-version-check --no-cache-dir openai pillow && python /imagegen/scripts/image_gen.py edit --model gpt-image-2 --prompt-file /workspace/assets/08-source-sheets/ai-buddy-3d/prompts/expressions-gpt-image-2.txt --image /workspace/assets/08-source-sheets/ai-buddy-3d/turnaround-selected.png --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/expecting.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/thinking.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/worried.webp --image /workspace/assets/08-source-sheets/ai-buddy-3d/inputs/jump.webp --n 1 --size 1536x1024 --quality high --background opaque --output-format png --out /workspace/assets/08-source-sheets/ai-buddy-3d/expressions-candidate-1.png --no-augment --dry-run"
```

Expected: `gpt-image-2`, input 5개, output 1개이고 transparency/input-fidelity 옵션이 없다.

- [ ] **Step 2: 실제 호출과 자동 검사**

`--dry-run`을 제거해 한 번 호출한다. `expressions-candidate-1.png`가 PNG 1536×1024, 정확히 7개 bay, 문자·phone·편지·말풍선이 없는지 검사한다.

- [ ] **Step 3: 사용자 시각 승인 관문**

표정 시트를 원본 해상도로 보여 주고 다음 7개가 왼쪽부터 읽히는지 승인받는다: 기다림, 두리번거림, 궁금함, 부모 메시지 전달, 생각, 기쁨/응원, 걱정/다독임. 얼굴 나이·눈 크기·피부색·머리·의상 정체성이 한 칸이라도 바뀌면 구체적 결함만 고쳐 `expressions-candidate-2.png`를 만들고 기존 파일은 보존한다. 승인 전 Meshy를 시작하지 않는다. 승인된 candidate만 아래 canonical 이름으로 복사한다.

```powershell
Copy-Item -LiteralPath "assets/08-source-sheets/ai-buddy-3d/expressions-candidate-1.png" -Destination "assets/08-source-sheets/ai-buddy-3d/expressions-approved.png"
```

두 번째 candidate가 승인된 경우에는 source만 `expressions-candidate-2.png`로 바꾼 같은 command를 실행한다.

- [ ] **Step 4: provenance와 커밋**

실제 model/date/prompt hash/output hash와 사용자 승인 결과를 기록한다.

```powershell
git add assets/08-source-sheets/ai-buddy-3d/expressions-approved.png docs/assets/ai-buddy-3d-provenance.md
git commit -m "3D 혜니 일곱 표정 기준을 확정한다"
```

---

### Task 4: GLB 자동 계약을 먼저 만들기

**Files:**

- Create: `tests/aiBuddy3dGlbContract.test.mjs`
- Create: `scripts/lib/aiBuddyGlbContract.mjs`
- Create: `scripts/verify-ai-buddy-glb.mjs`
- Modify: `package.json`

- [ ] **Step 1: synthetic GLB 실패·성공 테스트 작성**

테스트 안의 작은 GLB builder로 JSON/BIN chunk를 만들고 다음을 고정한다.

```js
export const REQUIRED_AI_BUDDY_CLIPS = [
  "caring", "curious", "happy_cheer", "hover_explore",
  "idle_wait", "message_delivery", "thinking",
];
export const REQUIRED_AI_BUDDY_MORPHS = [
  "blink", "browConcern", "browUp", "eyeWide",
  "mouthOpen", "pout", "smile",
];
```

테스트 matrix는 정상 synthetic GLB 통과와 아래 각각의 거부를 포함한다: 잘못된 magic/version/length, 외부 image URI, clip 누락, morph 누락, 6MiB 초과, triangle 50,000 초과, material 또는 primitive 4개 초과, skin joint 70개 초과, `JOINTS_1`, 1024px 초과 embedded texture.

- [ ] **Step 2: RED 확인**

Run: `node --test tests/aiBuddy3dGlbContract.test.mjs`

Expected: contract module이 없어 FAIL.

- [ ] **Step 3: GLB parser와 예산 검사 구현**

Node built-in Buffer로 GLB header와 JSON/BIN chunk를 읽고, triangles는 mode 4 primitive의 index accessor count/3으로 합산한다. `meshes[].extras.targetNames`를 union하고 `animations[].name`, `skins[].joints`, primitive 수, materials, `JOINTS_1`을 검사한다. embedded image `bufferView` bytes는 Sharp metadata로 width/height를 확인한다. 오류에는 경로·user id·token이 아니라 계약 enum과 실제 숫자만 포함한다.

CLI는 기본 경로만 검사한다.

```js
const result = await inspectAiBuddyGlb(
  new URL("../../public/assets/ai-buddy/3d/hyeni.glb", import.meta.url),
);
console.log(`[3D 혜니 GLB] ${result.bytes}B · ${result.triangles} tris · ${result.animations.length} clips (통과)`);
```

`package.json`:

```json
"verify:ai-buddy-3d": "node scripts/verify-ai-buddy-glb.mjs"
```

- [ ] **Step 4: GREEN 확인과 커밋**

Run: `node --test tests/aiBuddy3dGlbContract.test.mjs`

Expected: synthetic contract 전부 PASS. 실제 `verify:ai-buddy-3d`는 아직 파일이 없어 실패하는 것이 정상이며 완료로 보고하지 않는다.

```powershell
git add tests/aiBuddy3dGlbContract.test.mjs scripts/lib/aiBuddyGlbContract.mjs scripts/verify-ai-buddy-glb.mjs package.json package-lock.json
git commit -m "3D 혜니 GLB 품질 계약을 추가한다"
```

---

### Task 5: Meshy 입력 분리, 모델 생성, Blender 리깅·최적화

**Files:**

- Create: `tests/aiBuddy3dTurnaroundSlice.test.mjs`
- Create: `scripts/slice-ai-buddy-turnaround.mjs`
- Create: `assets/08-source-sheets/ai-buddy-3d/meshy-input/front.png`
- Create: `assets/08-source-sheets/ai-buddy-3d/meshy-input/side.png`
- Create: `assets/08-source-sheets/ai-buddy-3d/meshy-input/back.png`
- Create: `assets/03-hyeni-character/ai-buddy-3d-source/hyeni-meshy-source.glb`
- Create: `assets/03-hyeni-character/ai-buddy-3d-source/hyeni-master.blend`
- Create: `assets/03-hyeni-character/ai-buddy-3d-source/previews/hyeni-turntable.mp4`
- Create: `assets/03-hyeni-character/ai-buddy-3d-source/previews/hyeni-clips.mp4`
- Create: `public/assets/ai-buddy/3d/hyeni.glb`
- Create: `tests/aiBuddy3dAsset.test.mjs`
- Modify: `docs/assets/ai-buddy-3d-provenance.md`

- [ ] **Step 1: 5-panel 분리 RED 테스트**

1536×1024 synthetic sheet에 서로 다른 색의 5개 bay를 만들고, script가 `[307,307,308,307,307]` px 경계에서 1/3/5번째 panel을 골라 각각 1024×1024 PNG로 contain하는지 검사한다. 실제 sheet의 front/side/back은 육안으로 인물 잘림과 옆 panel 혼입이 없는지 별도 확인한다.

Run: `node --test tests/aiBuddy3dTurnaroundSlice.test.mjs`

Expected: script가 없어 FAIL.

- [ ] **Step 2: 분리 script 구현과 GREEN**

CLI:

```powershell
node scripts/slice-ai-buddy-turnaround.mjs --sheet "assets/08-source-sheets/ai-buddy-3d/turnaround-selected.png" --out-dir "assets/08-source-sheets/ai-buddy-3d/meshy-input"
```

출력 배경은 sheet 모서리 평균색으로 채우고 aspect ratio를 늘이지 않는다. source sheet가 1536×1024가 아니면 fail closed한다.

Run: `node --test tests/aiBuddy3dTurnaroundSlice.test.mjs`

Expected: PASS, 실제 front/side/back이 1024×1024.

- [ ] **Step 3: Meshy 라이선스·privacy 관문**

생성일에 공식 문서에서 현재 계정 tier의 commercial use와 private generation 가능 여부를 다시 확인한다. 확인한 tier 이름·날짜·공식 URL만 provenance에 기록한다. 로그인·결제는 사용자가 직접 하고, 허용 여부가 불명확하면 upload하지 않는다.

- [ ] **Step 4: Meshy multi-image 모델 생성**

정면·측면·후면 세 파일을 multi-image에 넣고 character rest pose/A-pose, texture, Smart Topology를 선택한다. 아래 순서로 최대 두 번만 보정한다.

1. 360도에서 얼굴 대칭, 뒤통수·번·옆머리, 손가락, 발, hood·치마 구조 확인
2. 메시 구멍, 겹친 팔다리, 뒤집힌 normal, 얼굴/머리/옷 융합 확인
3. 실패 이유를 한 문장으로 고정해 한 번 재생성
4. 두 번째에도 구조 기준 실패 시 Tripo를 동일 입력으로 한 번만 비교

합격 원본을 `hyeni-meshy-source.glb`로 export한다. export 당시 license와 SHA-256을 provenance에 기록한다.

- [ ] **Step 5: Blender master 정리**

현재 Blender LTS가 없으면 시스템에 임의 설치하지 말고 사용자가 공식 installer를 실행하도록 요청한다. Blender에서 다음을 순서대로 완료한다.

- scene unit metric 1.0, glTF Y-up, character feet가 원점, 모든 object scale 1·rotation 적용
- 숨은 내부면·중복 vertex·뒤집힌 normal 제거, 30k~50k triangles로 retopology
- face/hair/body/hood-skirt를 최대 4 material·4 primitive로 정리, 모든 texture 1024px 이하
- humanoid armature 70 bones 이하, vertex당 4 influence, root motion 제거
- 어깨·팔꿈치·손목·골반·무릎과 hair/hood/skirt weight를 A-pose·극단 pose에서 보정
- shape key 이름을 정확히 `blink`, `smile`, `mouthOpen`, `pout`, `browUp`, `browConcern`, `eyeWide`로 지정
- action 이름을 정확히 `idle_wait`, `hover_explore`, `curious`, `message_delivery`, `thinking`, `happy_cheer`, `caring`으로 지정
- 모든 action을 NLA strip으로 push하고 clip 시작·끝에서 root가 원점으로 복귀하도록 정리
- one-shot `curious`, `message_delivery`, `happy_cheer`는 끝 pose가 굳지 않게 neutral recovery key를 둔다

- [ ] **Step 6: GLB export와 자동 RED→GREEN**

`tests/aiBuddy3dAsset.test.mjs`를 먼저 추가해 실제 `public/assets/ai-buddy/3d/hyeni.glb`가 contract를 통과하고 SHA-256이 provenance와 일치해야 한다고 고정한다.

Run: `node --test tests/aiBuddy3dAsset.test.mjs`

Expected before export: runtime GLB 부재로 FAIL.

Blender glTF 2.0 export는 selected objects, apply modifiers, UVs/normals/tangents, materials, skins, shape keys, all NLA tracks를 포함하고 lights/camera는 제외한다. Draco는 Android 품질 확인 전 쓰지 않는다. export 뒤:

Run: `npm run verify:ai-buddy-3d`

Run: `node --test tests/aiBuddy3dAsset.test.mjs`

Expected: 두 command PASS, GLB 6MiB 이하·필수 clip/morph 7개씩·예산 전부 통과.

- [ ] **Step 7: 3D 사용자 승인 관문**

checkerboard와 rose/mint/lavender 배경을 포함한 360도 `hyeni-turntable.mp4`, 정면·45도에서 7개 clip을 연속 재생한 `hyeni-clips.mp4`를 보여 준다. 얼굴 정체성, hair/hood/skirt 관통, 발 미끄러짐, 손가락, clip 전환, 투명 edge를 사용자가 승인하기 전 renderer 코드를 시작하지 않는다.

- [ ] **Step 8: source/provenance 커밋**

master·preview 각각 실제 byte size를 확인하고 90MiB 이상 파일이 없게 정리한다. provenance에 Meshy/Tripo/Mixamo/Blender 사용 여부, export date, license URL, source/master/runtime SHA-256을 기록한다.

```powershell
git add tests/aiBuddy3dTurnaroundSlice.test.mjs tests/aiBuddy3dAsset.test.mjs scripts/slice-ai-buddy-turnaround.mjs assets/08-source-sheets/ai-buddy-3d/meshy-input assets/03-hyeni-character/ai-buddy-3d-source public/assets/ai-buddy/3d/hyeni.glb docs/assets/ai-buddy-3d-provenance.md
git commit -m "리깅된 3D 혜니 모델과 일곱 동작을 확정한다"
```

---

### Task 6: 표시 우선순위·clip/morph·활성 gate를 TDD로 추가

**Files:**

- Create: `tests/aiBuddy3dState.test.ts`
- Create: `tests/aiBuddy3dGate.test.ts`
- Create: `src/transform/aiBuddy3dState.ts`
- Create: `src/transform/aiBuddy3dGate.ts`

- [ ] **Step 1: 모든 의미 상태와 우선순위 실패 테스트 작성**

`tests/helpers/appModuleResolve.mjs`를 첫 줄에 정적 import하고 앱 module을 동적 import한다. 테스트는 20 face와 `AI_BUDDY_EMOTIONS` 8개가 모두 7개 clip 중 하나로 resolve되는지, 부모 메시지 > 실제 emotion > 일반 nudge > wander > idle인지, direct tap `quick`이 짧게 우선하는지 검사한다.

```ts
test("부모 메시지가 실제 감정과 일반 안내보다 먼저다", () => {
  const visual = resolveAiBuddyActiveVisual({
    tapped: false,
    dragging: false,
    blinking: false,
    emotion: "happy",
    attentionNudge: { kind: "parentMessage", line: "부모님 메시지 왔어!", fullLine: "같이 볼까?", face: "talking" },
    wanderNudge: null,
    wanderFace: "explore",
  });
  assert.equal(visual.face, "talking");
  assert.equal(visual.cueKind, "parentMessage");
  assert.equal(visual.three.clip, "message_delivery");
});
```

Gate matrix:

```ts
const cases = [
  ["child", "android", true, false, false, true, null],
  ["parent", "android", true, false, false, false, "not-child"],
  ["child", "web", true, false, false, false, "not-android"],
  ["child", "android", false, false, false, false, "webgl2-unavailable"],
  ["child", "android", true, true, false, false, "reduced-motion"],
  ["child", "android", true, false, true, false, "renderer-failed"],
] as const;
```

- [ ] **Step 2: RED 확인**

Run: `node --test tests/aiBuddy3dState.test.ts tests/aiBuddy3dGate.test.ts`

Expected: 두 module이 없어 FAIL.

- [ ] **Step 3: 순수 타입과 매핑 구현**

```ts
export const AI_BUDDY_3D_CLIPS = [
  "idle_wait", "hover_explore", "curious", "message_delivery",
  "thinking", "happy_cheer", "caring",
] as const;

export type AiBuddy3dClip = (typeof AI_BUDDY_3D_CLIPS)[number];
export type AiBuddy3dMorph = "blink" | "smile" | "mouthOpen" | "pout"
  | "browUp" | "browConcern" | "eyeWide";

export interface AiBuddy3dVisualState {
  clip: AiBuddy3dClip;
  loop: boolean;
  fallbackClip: "idle_wait" | null;
  playbackRate: number;
  morphs: Partial<Record<AiBuddy3dMorph, number>>;
}
```

20 face mapping은 다음을 정확히 사용한다.

```ts
const FACE_CLIP: Record<AiBuddyChatFace, AiBuddy3dClip> = {
  happy: "happy_cheer", wink: "hover_explore", joy: "happy_cheer",
  excited: "happy_cheer", love: "happy_cheer", curious: "curious",
  thinking: "thinking", idea: "thinking", talking: "idle_wait",
  sleepy: "idle_wait", sad: "caring", worried: "caring",
  shy: "hover_explore", celebrate: "happy_cheer", greeting: "hover_explore",
  music: "hover_explore", explore: "hover_explore", typing: "thinking",
  waiting: "idle_wait", quick: "happy_cheer",
};
```

얼굴 morph 기본값도 추정하지 않고 다음 표로 고정한다.

```ts
const FACE_MORPHS: Record<AiBuddyChatFace, Partial<Record<AiBuddy3dMorph, number>>> = {
  happy: { smile: 0.78 },
  wink: { blink: 0.70, smile: 0.45 },
  joy: { smile: 1, eyeWide: 0.30 },
  excited: { smile: 0.90, eyeWide: 0.25 },
  love: { smile: 0.85, browUp: 0.25 },
  curious: { browUp: 0.65, eyeWide: 0.22 },
  thinking: { browUp: 0.20 },
  idea: { smile: 0.25, browUp: 0.55, eyeWide: 0.35 },
  talking: { smile: 0.40 },
  sleepy: { blink: 0.45 },
  sad: { pout: 0.68, browConcern: 0.82 },
  worried: { pout: 0.18, browConcern: 0.78 },
  shy: { smile: 0.22, browUp: 0.18 },
  celebrate: { smile: 1, eyeWide: 0.38 },
  greeting: { smile: 0.70 },
  music: { smile: 0.55 },
  explore: { browUp: 0.38, eyeWide: 0.18 },
  typing: { browUp: 0.18 },
  waiting: { pout: 0.20, browUp: 0.12 },
  quick: { smile: 0.85, eyeWide: 0.55 },
};
```

`cueKind === "parentMessage"`는 clip `message_delivery`와 `{ smile: 0.75, browUp: 0.30, eyeWide: 0.25 }`, `cueKind === "supplies"`는 clip `curious`와 curious morph로 override한다. `sleepy`만 playback 0.75이고 나머지는 1.0이다. `idle_wait`, `hover_explore`, `thinking`, `caring`은 loop, 나머지는 one-shot이다. `speaking`은 최종 morph에 `mouthOpen: 0.18`을 합친다. 모든 morph 값은 0~1로 clamp한다.

표시 우선순위는 아래 분기 순서를 그대로 사용한다. `visibleNudge`는 동시에 둘이 생겨도 화면에 실제로 보이는 `attentionNudge ?? wanderNudge` 하나다.

```ts
const visibleNudge = input.attentionNudge ?? input.wanderNudge;
let face: AiBuddyChatFace;
let cueKind: AiBuddyNudgeKind | null = null;

if (input.tapped) {
  face = AI_BUDDY_TAP_FACE;
} else if (visibleNudge?.kind === "parentMessage") {
  face = visibleNudge.face;
  cueKind = visibleNudge.kind;
} else if (input.emotion !== "idle" && input.emotion !== "sleepy") {
  face = aiBuddyFaceFor(input.emotion);
} else if (visibleNudge) {
  face = visibleNudge.face;
  cueKind = visibleNudge.kind;
} else if (input.wanderFace) {
  face = input.wanderFace;
} else if (input.blinking && !input.dragging) {
  face = AI_BUDDY_BLINK_FACE;
} else {
  face = aiBuddyFaceFor(input.emotion);
}

return { face, cueKind, three: resolveAiBuddy3dState({ face, cueKind, speaking: input.speaking }) };
```

- [ ] **Step 4: gate 구현**

```ts
export function resolveAiBuddy3dGate(input: AiBuddy3dGateInput): AiBuddy3dGateResult {
  if (input.role !== "child") return { enabled: false, reason: "not-child" };
  if (input.platform !== "android") return { enabled: false, reason: "not-android" };
  if (input.reducedMotion) return { enabled: false, reason: "reduced-motion" };
  if (!input.webgl2) return { enabled: false, reason: "webgl2-unavailable" };
  if (input.rendererFailed) return { enabled: false, reason: "renderer-failed" };
  return { enabled: true, reason: null };
}
```

- [ ] **Step 5: GREEN과 커밋**

Run: `node --test tests/aiBuddy3dState.test.ts tests/aiBuddy3dGate.test.ts`

```powershell
git add tests/aiBuddy3dState.test.ts tests/aiBuddy3dGate.test.ts src/transform/aiBuddy3dState.ts src/transform/aiBuddy3dGate.ts
git commit -m "3D 혜니 상태와 활성 조건을 고정한다"
```

---

### Task 7: Three.js controller를 30fps·정리 계약으로 구현

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/aiBuddy3dRuntime.test.ts`
- Create: `src/transform/aiBuddy3dRuntime.ts`
- Create: `src/app/aiBuddyThreeRuntime.ts`
- Create: `src/app/AiBuddyThreeCanvas.tsx`

- [ ] **Step 1: dependency 설치**

Run: `npm install three`

Run: `npm install --save-dev @types/three`

Expected: `three`는 runtime dependency, `@types/three`는 devDependency에 들어가고 lockfile이 함께 바뀐다. React용 3D renderer나 physics/postprocess package는 추가하지 않는다.

- [ ] **Step 2: frame/blink/one-shot 순수 계산 RED 테스트**

```ts
test("renderer는 초당 30회를 넘기지 않는다", () => {
  assert.equal(shouldRenderAiBuddyFrame({ previousMs: 1000, nowMs: 1020, paused: false }), false);
  assert.equal(shouldRenderAiBuddyFrame({ previousMs: 1000, nowMs: 1034, paused: false }), true);
  assert.equal(shouldRenderAiBuddyFrame({ previousMs: 1000, nowMs: 1100, paused: true }), false);
});

test("one-shot은 정해진 fallback으로 돌아간다", () => {
  assert.equal(aiBuddyClipFallback("message_delivery"), "idle_wait");
  assert.equal(aiBuddyClipFallback("curious"), "idle_wait");
  assert.equal(aiBuddyClipFallback("happy_cheer"), "idle_wait");
  assert.equal(aiBuddyClipFallback("hover_explore"), null);
});
```

Run: `node --test tests/aiBuddy3dRuntime.test.ts`

Expected: module이 없어 FAIL.

- [ ] **Step 3: pure runtime 계산 구현과 GREEN**

`AI_BUDDY_FRAME_INTERVAL_MS = 1000 / 30`, blink 간격은 결정적 `[4200, 3500, 5600, 3900, 4800]`, cross-fade는 `300ms`로 export한다. `document`, Three.js, random을 읽지 않는다.

Run: `node --test tests/aiBuddy3dRuntime.test.ts`

- [ ] **Step 4: Three controller 구현**

`aiBuddyThreeRuntime.ts`는 `three`, `GLTFLoader`, `SkeletonUtils.clone`을 import한다. module-level source promise와 reference count를 사용하고 마지막 instance가 해제된 뒤 30초 idle timer에서 geometry/material/texture와 source promise를 정리한다. scene clone은 morph weight와 skeleton이 instance별로 독립이어야 한다.

Controller interface:

```ts
export interface AiBuddyThreeController {
  setVisualState(state: AiBuddy3dVisualState): void;
  setPaused(paused: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export async function createAiBuddyThreeController(input: {
  canvas: HTMLCanvasElement;
  modelUrl: string;
  initialState: AiBuddy3dVisualState;
  onFirstFrame: () => void;
  onFatal: (reason: AiBuddy3dRuntimeFailure) => void;
}): Promise<AiBuddyThreeController>;
```

필수 구현 계약:

- `WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true })`, `setClearColor(0x000000, 0)`, pixel ratio `Math.min(devicePixelRatio, 1.5)`
- orthographic camera와 Box3 정규화로 모델을 화면 중앙에 맞추고 발·top bun crop 방지
- ambient/key/fill/rim만 사용하고 shadow map·postprocess 비활성
- mixer clip 7개와 morph 7개를 load 직후 다시 검증; 누락은 `asset-contract` fatal
- state가 바뀌면 이전 action에서 300ms cross-fade, one-shot은 `LoopOnce`+`clampWhenFinished=false` 후 fallback
- state 전환 때 canvas의 `data-active-clip`만 갱신하고 one-shot 종료 뒤 fallback 이름으로 바꿔 QA가 production controller를 관측하게 함; frame마다 DOM을 갱신하지 않음
- 별도 root group에 작은 sine Y offset을 적용하고 skeleton action의 root motion은 사용하지 않음
- speaking은 `mouthOpen`에 낮은 sine만 더하고 parent message는 자동 speaking으로 두지 않음
- `webglcontextlost`에서 `preventDefault()` 후 한 번만 `context-lost` fatal
- RAF, mixer listener, context listener, action, clone, renderer를 dispose하고 shared pool reference를 release

- [ ] **Step 5: React canvas lifecycle 구현**

`AiBuddyThreeCanvas`는 canvas만 렌더하고 `aria-hidden="true"`, `tabIndex={-1}`를 둔다. `ResizeObserver`, `IntersectionObserver`, `document.visibilitychange`, Capacitor `App.addListener("appStateChange")`를 합쳐 하나라도 inactive면 pause한다. async controller가 unmount 뒤 도착하면 즉시 dispose한다.

```tsx
return <canvas ref={canvasRef} className="abv__canvas" aria-hidden="true" tabIndex={-1} />;
```

- [ ] **Step 6: typecheck·target tests와 커밋**

Run: `npm run typecheck`

Run: `node --test tests/aiBuddy3dRuntime.test.ts tests/aiBuddy3dAsset.test.mjs`

```powershell
git add package.json package-lock.json tests/aiBuddy3dRuntime.test.ts src/transform/aiBuddy3dRuntime.ts src/app/aiBuddyThreeRuntime.ts src/app/AiBuddyThreeCanvas.tsx
git commit -m "투명 30fps 3D 혜니 렌더러를 구현한다"
```

---

### Task 8: lazy capability gate와 WebP 무공백 폴백 구현

**Files:**

- Create: `tests/aiBuddy3dVisual.test.mjs`
- Create: `src/app/AiBuddyWebpVisual.tsx`
- Create: `src/app/AiBuddyVisual.tsx`
- Modify: `src/app/AiBuddyFab.css`

- [ ] **Step 1: static wiring RED 테스트**

테스트는 `AiBuddyVisual`이 module-scope `lazy(() => import("./AiBuddyThreeCanvas"))`를 사용하고, Android gate가 false이면 lazy component를 render하지 않으며, first-frame 전 WebP가 보이고 fatal/context loss 뒤 WebP만 남는지 source contract로 고정한다. canvas `pointer-events:none`, `aria-hidden`, reduced-motion WebP도 검사한다.

Run: `node --test tests/aiBuddy3dVisual.test.mjs`

Expected: 두 component가 없어 FAIL.

- [ ] **Step 2: 기존 image stack을 `AiBuddyWebpVisual`로 이동**

```tsx
export function AiBuddyWebpVisual({ face, size }: { face: AiBuddyChatFace; size: number }) {
  return (
    <span className="abf__stack" data-visual="webp">
      {AI_BUDDY_CHAT_FACES.map((name) => (
        <img key={name} src={asset(aiBuddyChatFaceAsset(name))} alt=""
          width={size} height={size} decoding="async"
          data-shown={face === name ? "true" : "false"} />
      ))}
    </span>
  );
}
```

- [ ] **Step 3: capability hook와 무공백 전환 구현**

`AiBuddyVisual`은 `getPlatform()`, `matchMedia`, temporary WebGL2 probe를 읽어 pure gate에 넘긴다. probe context는 `WEBGL_lose_context`로 즉시 해제한다. reduced-motion change를 구독한다. 3D가 허용돼도 WebP를 먼저 보이고 `onFirstFrame` 뒤에만 canvas opacity를 1로, WebP opacity를 0으로 바꾼다. fatal 뒤에는 해당 mount에서 재시도 loop 없이 WebP로 고정한다.

```tsx
const LazyAiBuddyThreeCanvas = lazy(() => import("./AiBuddyThreeCanvas"));

return (
  <span className="abv" data-three-ready={ready ? "true" : "false"}>
    <AiBuddyWebpVisual face={face} size={size} />
    {gate.enabled ? (
      <Suspense fallback={null}>
        <LazyAiBuddyThreeCanvas state={three} onFirstFrame={() => setReady(true)} onFatal={() => setFailed(true)} />
      </Suspense>
    ) : null}
  </span>
);
```

- [ ] **Step 4: CSS 계약**

`.abv`, `.abv__canvas`, `.abf__stack`은 같은 inset을 차지하고 canvas는 `width/height:100%`, `display:block`, `pointer-events:none`, 투명 background다. ready 전후 opacity만 160ms로 전환하고 reduced motion에서는 transition도 제거한다. 기존 18-image stack의 face opacity 규칙은 유지한다.

- [ ] **Step 5: GREEN과 커밋**

Run: `node --test tests/aiBuddy3dVisual.test.mjs tests/aiBuddyCharacterAssets.test.mjs`

Run: `npm run typecheck`

```powershell
git add tests/aiBuddy3dVisual.test.mjs src/app/AiBuddyWebpVisual.tsx src/app/AiBuddyVisual.tsx src/app/AiBuddyFab.css
git commit -m "Android 전용 3D 혜니와 WebP 폴백을 연결한다"
```

---

### Task 9: `AiBuddyFab` 활성 cue·부모 메시지 탭·단일 canvas 통합

**Files:**

- Modify: `tests/aiBuddyFab.test.ts`
- Modify: `tests/aiBuddyCharacterBehavior.test.ts`
- Modify: `src/transform/aiBuddyFabPrompt.ts`
- Modify: `src/app/AiBuddyFab.tsx`
- Modify: `src/app/AiBuddyFab.css`

- [ ] **Step 1: 부모 메시지와 단일 visual RED 테스트**

순수 target resolver를 먼저 고정한다.

```ts
test("부모 메시지 일반 탭만 메모로 가고 길게 누르기는 AI 음성으로 간다", () => {
  assert.equal(resolveAiBuddyFabTapTarget({ cueKind: "parentMessage", chatTarget: "/child/ai-friend" }), "/child/memo");
  assert.equal(resolveAiBuddyFabTapTarget({ cueKind: "supplies", chatTarget: "/child/ai-friend" }), "/child/ai-friend");
  assert.equal(resolveAiBuddyFabTapTarget({ cueKind: null, chatTarget: "/child/ai-friend-setup" }), "/child/ai-friend-setup");
});
```

Source contract는 다음을 검사한다.

- `wanderLine`만이 아니라 `AiBuddyNudge | null` 활성 cue를 저장
- parent cue의 일반 tap은 `navigate("/child/memo")`
- long press는 여전히 `openChat(true)`
- parent cue aria-label에 `부모님 메시지 확인하기`와 dynamic `friendName`
- `AiBuddyVisual` JSX가 정확히 한 곳에 있고 stage용 두 번째 canvas 없음
- 기존 drag/pointer capture/snap, 550ms long press, launch state 유지

Run: `node --test tests/aiBuddyFab.test.ts tests/aiBuddyCharacterBehavior.test.ts`

Expected: 새 target resolver와 visual 연결이 없어 FAIL.

- [ ] **Step 2: tap target과 접근성 문구 순수 함수 구현**

```ts
export function resolveAiBuddyFabTapTarget(input: {
  cueKind: AiBuddyNudgeKind | null;
  chatTarget: "/child/ai-friend" | "/child/ai-friend-setup" | null;
}) {
  return input.cueKind === "parentMessage" ? "/child/memo" : input.chatTarget;
}

export function aiBuddyFabAriaLabel(input: {
  cueKind: AiBuddyNudgeKind | null;
  friendName: string;
  emotionLabel: string;
}): string {
  return input.cueKind === "parentMessage"
    ? `부모님 메시지 확인하기 · 길게 누르면 ${input.friendName}와 바로 말하기`
    : `${input.friendName}와 이야기하기 · ${input.emotionLabel} · 길게 누르면 바로 말하기`;
}
```

- [ ] **Step 3: `wanderCue`와 우선순위 연결**

`wanderFace`는 이동·도착 피드백으로 유지하고 `wanderLine`을 `wanderCue: AiBuddyNudge | null`로 바꾼다. invite는 실제 `aiBuddyWanderLine(arrival)`과 arrival face를 복사한 cue로 보존한다. `activeCue = attention?.nudge ?? wanderCue`를 `resolveAiBuddyActiveVisual`에 넘긴다. 실제 emotion이 생길 때 일반 cue만 물러나고 `parentMessage` cue는 남긴다.

- [ ] **Step 4: 일반 tap과 long press 분리**

`openPrimaryTarget()`은 active cue를 snapshot해 parent message면 attention/말풍선을 닫고 `/child/memo`로 즉시 이동한다. 그 외에는 기존 `openChat(false)`를 부른다. `fireVoiceLongPress()`는 cue 종류와 무관하게 기존 `openChat(true)`를 유지하고 자동 TTS·효과음 코드를 추가하지 않는다.

- [ ] **Step 5: full attention을 기존 host button 한 개로 승격**

stage 내부의 별도 face `<button><img/></button>`를 제거하고 scrim·bubble만 둔다. 기존 `.abf` host가 `data-attention="full"`일 때 CSS로 중앙·handoff size에 승격되며 같은 `AiBuddyVisual`을 계속 쓴다. full 상태에서는 drag handler 대신 기존 `useLongPress` handler를 연결해 tap/long press 의미를 보존한다. 이로써 WebGL context는 언제나 최대 1개다.

- [ ] **Step 6: GREEN과 기존 회귀**

Run: `node --test tests/aiBuddyFab.test.ts tests/aiBuddyCharacterBehavior.test.ts tests/aiBuddy3dState.test.ts`

Run: `npm run typecheck`

Expected: 부모 메시지 일반 탭은 memo, long press는 AI voice, 기존 drag/attention/SOS z-index 테스트 전부 PASS.

- [ ] **Step 7: 커밋**

```powershell
git add tests/aiBuddyFab.test.ts tests/aiBuddyCharacterBehavior.test.ts src/transform/aiBuddyFabPrompt.ts src/app/AiBuddyFab.tsx src/app/AiBuddyFab.css
git commit -m "부모 메시지와 단일 3D 혜니 조작을 통합한다"
```

---

### Task 10: dynamic chunk·PWA 비다운로드·격리 브라우저 검증

**Files:**

- Create: `tests/aiBuddy3dBundle.test.mjs`
- Create: `tests/aiBuddy3dBrowserQaHarness.test.mjs`
- Create: `scripts/verify-ai-buddy-3d-runtime.mjs`
- Create: `scripts/fixtures/ai-buddy-3d-runtime.html`
- Create: `scripts/fixtures/ai-buddy-3d-runtime.tsx`
- Modify: `vite.config.ts`
- Modify: `scripts/lib/pwaPrecacheManifest.mjs`
- Modify: `scripts/verify-route-bundle.mjs`
- Modify: `package.json`

- [ ] **Step 1: build/PWA 계약 RED 테스트**

`tests/aiBuddy3dBundle.test.mjs`는 Vite config에 stable `ai-buddy-3d-runtime` manual chunk와 globIgnore가 있고, `inspectPwaPrecacheManifest`가 `hyeni.glb` 또는 `ai-buddy-3d-runtime` URL을 발견하면 실패하도록 요구한다. production `index.html`에는 3D chunk modulepreload가 없어야 한다.

Run: `node --test tests/aiBuddy3dBundle.test.mjs`

Expected: chunk/precache 금지 계약이 없어 FAIL.

- [ ] **Step 2: manual chunk와 precache 제외 구현**

기존 i18n object chunk를 그대로 보존하고 3D local module·Three entry를 같은 stable chunk에 추가한다.

```ts
manualChunks: {
  "i18n-runtime": [
    "react", "react-dom", "react-dom/client", "react-intl", "intl-messageformat",
  ],
  "ai-buddy-3d-runtime": [
    fileURLToPath(new URL("./src/app/AiBuddyThreeCanvas.tsx", import.meta.url)),
    fileURLToPath(new URL("./src/app/aiBuddyThreeRuntime.ts", import.meta.url)),
    "three",
    "three/addons/loaders/GLTFLoader.js",
    "three/addons/utils/SkeletonUtils.js",
  ],
},
```

`injectManifest.globIgnores`에 `"**/assets/ai-buddy-3d-runtime-*.js"`를 추가한다. `.glb`는 globPatterns에 없지만 검증 helper에서 `hyeni.glb`를 명시적으로 금지해 미래 glob 확장을 막는다.

- [ ] **Step 3: 외부망 차단 QA harness를 먼저 테스트로 고정**

Harness source test는 다음 안전 계약을 검사한다.

- production app/부모-message 시나리오는 exact `dist`만 localhost 임시 server로 제공
- 7-state component fixture는 repository Vite dev server에서 production component를 직접 import하되 배포 산출물 판정에는 사용하지 않음
- isolated user-data-dir, service worker block, DNS deny, deny proxy
- 운영 Worker/Pages/ADB/사용자 browser profile 접근 없음
- mock child session에는 가짜 access/refresh만 있고 실제 token을 읽지 않음
- Android context와 web context를 별도로 실행
- 종료 시 server/browser/profile을 항상 정리

Run: `node --test tests/aiBuddy3dBrowserQaHarness.test.mjs`

Expected: harness가 없어 FAIL.

- [ ] **Step 4: Android mock 시나리오 구현**

QA 전용 `scripts/fixtures/ai-buddy-3d-runtime.html`은 `<base href="/">`와 root element만 갖고 `ai-buddy-3d-runtime.tsx`를 불러온다. TSX fixture는 production `AiBuddyVisual`을 직접 import하고, select 값으로 아래 7개 prop 조합만 바꾼다. production route·debug query·global 상태 주입 코드는 추가하지 않는다.

```ts
const QA_STATES = {
  idle_wait: { face: "waiting", cueKind: null },
  hover_explore: { face: "explore", cueKind: null },
  curious: { face: "curious", cueKind: "supplies" },
  message_delivery: { face: "talking", cueKind: "parentMessage" },
  thinking: { face: "thinking", cueKind: null },
  happy_cheer: { face: "celebrate", cueKind: null },
  caring: { face: "worried", cueKind: null },
} as const;
```

`window.Capacitor.getPlatform()`이 `android`, `isNativePlatform()`이 true가 되도록 fixture module load 전 mock한다. 다음을 assert한다.

1. 첫 paint에 `[data-visual="webp"]`가 보임
2. 2초 안에 `canvas.abv__canvas` 첫 frame과 `data-three-ready="true"`
3. canvas alpha pixel의 네 모서리가 0이고 button pointer event가 유지됨
4. select로 7개 production state prop을 순서대로 적용해 active clip 이름·300ms cross-fade·one-shot fallback 확인
5. `webglcontextlost` 강제 후 canvas 제거·동일 face WebP 복귀·toast 없음
6. `document.hidden` mock 동안 draw count 증가 중지, visible 복귀 뒤 한 renderer만 재개

부모 메시지 DOM/탭은 같은 run의 production `index.html` child fixture로 별도 검증한다. page load 전 `Date.now()`만 100배로 진행시키되 timer 자체는 바꾸지 않아 첫 15초 attention tick에서 정상 gate를 통과시킨다. child session/family/events/memos/supplies/friend-public API는 localhost route fixture로만 응답하고 unread parent memo 1개를 제공한다. 말풍선 `부모님 메시지 왔어!`를 확인한 뒤 일반 click이 `#/child/memo`로 가고 자동 speech event가 0인지 assert한다.

- [ ] **Step 5: web/PWA fallback 시나리오 구현**

같은 QA fixture에서 platform을 `web`으로 두고 request log를 검사한다. `hyeni.glb`, `ai-buddy-3d-runtime`, `three`가 포함된 request가 0건이고 WebP face가 정상이어야 한다. production child fixture의 일반 tap도 기존 AI 친구 route를 유지해야 한다.

`package.json`:

```json
"qa:ai-buddy-3d": "node scripts/verify-ai-buddy-3d-runtime.mjs"
```

- [ ] **Step 6: build와 QA GREEN**

Run: `npm run build`

Expected: route bundle 예산 통과, PWA precache에 GLB/3D chunk 없음, dist에는 둘 다 존재.

Run: `node --test tests/aiBuddy3dBundle.test.mjs tests/aiBuddy3dBrowserQaHarness.test.mjs`

Run: `npm run qa:ai-buddy-3d`

Expected: Android mock 3D/parent-message/context-loss 전부 PASS, web request 0건.

- [ ] **Step 7: 커밋**

```powershell
git add tests/aiBuddy3dBundle.test.mjs tests/aiBuddy3dBrowserQaHarness.test.mjs scripts/verify-ai-buddy-3d-runtime.mjs scripts/fixtures/ai-buddy-3d-runtime.html scripts/fixtures/ai-buddy-3d-runtime.tsx vite.config.ts scripts/lib/pwaPrecacheManifest.mjs scripts/verify-route-bundle.mjs package.json package-lock.json
git commit -m "3D 혜니 번들과 PWA 경계를 검증한다"
```

---

### Task 11: 전체 회귀·Android 패키징·razr 보존 검증

**Files:**

- Modify after evidence: `CLAUDE.md`
- Modify after evidence: `AGENTS.md`
- Create: `docs/qa/2026-08-25-ai-buddy-realtime-3d.md`

- [ ] **Step 1: 작업 범위와 binary hash 최종 확인**

Run: `git status --short`

Run: `git diff --check`

Run: `npm run verify:ai-buddy-3d`

Expected: 사용자 untracked artifact는 그대로이고 GLB/provenance hash 일치.

- [ ] **Step 2: 앱 전체 자동 회귀**

Run: `npm run typecheck`

Run: `npm test`

Expected: 명령 exit code뿐 아니라 마지막 요약 `ℹ fail 0`.

Run: `npm run build`

Run: `npm run qa:ai-buddy-3d`

Run: `npm run qa:browser`

Run: `npm run qa:pwa-runtime`

Expected: 모든 command 성공, 일반 PWA의 GLB/3D runtime request 0.

- [ ] **Step 3: Android sync·unit·lint·debug APK**

Run: `npx cap sync android`

```powershell
Push-Location android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
Pop-Location
```

Expected: 모두 `BUILD SUCCESSFUL`. 아래가 Android packaged web assets에 존재해야 한다.

- `android/app/src/main/assets/public/assets/ai-buddy/3d/hyeni.glb`
- `android/app/src/main/assets/public/assets/ai-buddy-3d-runtime-*.js`

- [ ] **Step 4: razr 연결·설치 전 무손실 기준 기록**

```powershell
adb -s ZY22H9VTQD get-state
adb -s ZY22H9VTQD shell dumpsys package com.hyeni.calendar | Select-String "firstInstallTime|lastUpdateTime|versionName|versionCode"
```

CDP를 serial-scoped forward로 열고 token 원문 없이 `role=child`, family/user가 존재함, `hasAccess=true`, `hasRefresh=true`만 기록한다. role/family가 예상과 다르면 설치하지 않고 중단한다.

- [ ] **Step 5: 사용자 0 보존 설치**

Run: `npm run android:install:debug -- ZY22H9VTQD`

Expected: `Success`, `firstInstallTime` 불변, role `child`와 같은 family scope 유지. A17·S25에는 adb command를 보내지 않는다.

- [ ] **Step 6: 5분 성능·상호작용 검증**

razr에서 아이 홈을 열고 다음을 확인한다.

- local packaged asset에서 첫 3D frame 목표 2초 이내, 검은 사각형 없음
- 5분 대기·배회에서 `dumpsys gfxinfo com.hyeni.calendar framestats` 중앙값 28fps 이상, 500ms 이상 stall 없음
- 60초마다 진행 상태를 알리고 한 번에 60초 넘게 응답 없이 기다리지 않음
- drag, edge snap, tap, 550ms long press, grow/full attention 정상
- 현재 실사용 unread message가 있을 때만 부모 메시지 cue tap→`#/child/memo`; 새 메시지·AI 크레딧을 만들지 않음
- background→foreground 뒤 renderer 하나만 재개
- 홈↔`#/child/memo` 10회 왕복 전후 `dumpsys meminfo`가 단조 증가하지 않고 context loss/crash/ANR 없음
- frame buffer screenshot에서 canvas 배경 투명, crop·말풍선 겹침 없음

- [ ] **Step 7: QA 문서와 정본 이력 갱신**

`docs/qa/2026-08-25-ai-buddy-realtime-3d.md`에 commit, GLB/APK SHA-256, 자동 test counts, precache 부재 증거, razr firstInstallTime 전후, role boolean, first-frame time, fps/stall/memory, 조작 결과를 기록한다. 실제 하지 않은 부모 메시지·AI 왕복은 `미실행(실사용 데이터 보호)`로 쓴다.

`CLAUDE.md`와 `AGENTS.md`에는 통과한 결과만 요약하고 Play 출시·Pages 배포를 완료로 표시하지 않는다.

- [ ] **Step 8: 최종 검증·커밋·push**

Run: `git diff --check`

Run: `git status --short`

```powershell
git add CLAUDE.md AGENTS.md docs/qa/2026-08-25-ai-buddy-realtime-3d.md
git commit -m "실시간 3D 혜니 검증 결과를 기록한다"
git push origin main
```

Expected: `origin/main`이 현재 HEAD와 같고 사용자 untracked 파일은 남아 있다. Play Store·Pages·Worker에는 변화가 없다.

---

## 최종 수용 체크리스트

- [ ] GPT Image 2 turnaround와 7-expression sheet를 사용자가 각각 승인했다.
- [ ] 360도와 7개 clip preview를 사용자가 승인했다.
- [ ] `hyeni.glb`가 6MiB·50k tris·4 material/draw call·70 bones·1K texture 계약을 통과했다.
- [ ] Android child에서만 3D가 열리고 웹/PWA/reduced-motion/error는 기존 18장 WebP다.
- [ ] parent message cue 일반 tap은 `/child/memo`, long press는 AI voice이고 자동 음성은 없다.
- [ ] 한 화면의 WebGL context가 최대 1개이고 background/hidden에서 멈추며 unmount에서 해제된다.
- [ ] PWA precache와 web network에 GLB·3D runtime request가 없다.
- [ ] `npm run typecheck`, `npm test`의 `ℹ fail 0`, `npm run build`, 3D/browser/PWA QA가 통과했다.
- [ ] Android unit/lint/assemble와 razr 보존 설치·성능·상호작용 검증이 통과했다.
- [ ] A17·S25·refresh token·역할·페어링·운영 데이터·Play/Pages/Worker를 건드리지 않았다.
