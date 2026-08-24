# 아이 모드 실시간 3D 혜니 설계

- 날짜: 2026-08-24
- 상태: 사용자 설계 승인, 구현 계획 작성 전 검토본
- 대상: Android 네이티브 아이 모드의 플로팅 `혜니`
- 사용자 기준 이미지: `C:\Users\TK\Downloads\A_cute_3d_cartoon_girl_with_dark_hair_styled.gif`

## 1. 목표

아이 모드에서 휴대폰 화면 위를 떠다니는 혜니를 고정 카메라 영상이나 연속 이미지가 아닌 실제 리깅된 3D 캐릭터로 렌더링한다. 아이가 친구를 기다리는 동안 심심해하는 모습, 부모 메시지를 알려 주는 모습, 궁금해하거나 생각하고 기뻐하고 걱정하는 모습을 자연스러운 몸동작과 얼굴 표정으로 연결한다.

성공 기준은 다음과 같다.

- 사용자가 제공한 참고 GIF와 현재 18장 혜니 이미지의 얼굴·머리·의상 정체성을 한 모델에서 유지한다.
- Android 아이 모드에서만 투명 WebGL 캔버스로 실제 3D 캐릭터를 렌더링한다.
- PWA·웹·움직임 줄이기·WebGL 실패 환경은 현재 18장 WebP를 그대로 사용한다.
- 기존 `AiBuddyFab`의 드래그, 가장자리 붙기, 배회, 말풍선, 탭, 550ms 길게 누르기, 화면 전환 계약을 보존한다.
- 부모 메시지를 알리는 동안 일반 탭은 AI 대화가 아니라 `#/child/memo`로 이동하며 자동 음성 재생은 하지 않는다.
- 모델이나 렌더러가 실패해도 아이가 AI 친구 진입점과 부모 메시지를 잃지 않는다.
- razr 아이 기기에서 목표 30fps로 자연스럽게 동작하고 세션·역할·페어링을 변경하지 않는다.

## 2. 현행 구조와 유지할 정본

현재 플로팅 친구는 다음 구조로 이미 실사용 중이다.

- `src/app/AiBuddyFab.tsx`: 아이 역할과 제외 경로 판정, 드래그, 배회, 주목 연출, 말풍선, 탭·길게 누르기
- `src/app/aiBuddyMood.tsx`: 라우트가 바뀌어도 유지되는 감정 상태
- `src/transform/aiBuddyEmotion.ts`: 8개 감정, 20개 의미 face, 18개 WebP pose 매핑
- `src/transform/aiBuddyWander.ts`: 9초 배회와 움직임 줄이기·화면 숨김·드래그 게이트
- `src/transform/aiBuddyNudge.ts`: 부모 메시지 → 일정 → 준비물 → 초대 순의 선제 안내
- `src/transform/aiBuddyFabPrompt.ts`: 좁은 DOM 말풍선과 AI 친구 진입 대상
- `public/assets/ai-buddy/poses/*.webp`: 320×320 투명 폴백 자산 18장

3D 전환은 이 상태 판정과 조작을 재작성하지 않는다. `AiBuddyFab`의 얼굴 표시 계층만 교체하고, 기존 순수 transform을 확장해 의미 상태를 3D 동작으로 해석한다. 18장 WebP는 삭제하거나 열화하지 않으며 웹·접근성·오류 폴백의 정본으로 계속 보존한다.

## 3. 선택한 제작 접근

### A. GPT Image 2 기준 시트 → Meshy 다중 시점 → Blender 정리 — 채택

1. 현재 18장과 참고 GIF에서 정체성이 안정적인 기준 프레임을 고른다.
2. GPT Image 2로 모델링용 다중 시점 전신 시트와 얼굴 표정 시트를 만든다.
3. Meshy의 multi-image/rest-pose 흐름에서 텍스처가 포함된 사람형 모델을 만든다.
4. Meshy Smart Rig 또는 Mixamo를 몸동작 초안에 사용한다.
5. Blender에서 큰 머리 캐릭터의 리깅, 머리카락·후드 가중치, 얼굴 morph, 동작 연결, 용량을 수동 정리한다.
6. 단일 최적화 GLB로 앱에 넣는다.

이 방식은 현재 이미지 정체성을 유지하면서도 완전 수작업 모델링보다 빠르고, AI 3D 원클릭 결과를 그대로 출시하는 것보다 얼굴·의상 변형을 통제하기 쉽다.

Meshy 결과가 두 번의 제한된 보정 후에도 얼굴 또는 의상 구조 기준을 통과하지 못할 때만 Tripo를 한 차례 대안으로 비교한다. 두 서비스를 무기한 오가며 재생성하지 않는다.

### B. 전 과정 수작업 Blender 모델링 — 제외

정체성과 얼굴 표현 제어는 가장 좋지만, 전담 캐릭터 모델러 수준의 시간과 비용이 필요하다. 현재 목표인 빠른 Android 실사용 검증에 맞지 않는다.

### C. AI 3D 원클릭 결과를 무보정 사용 — 제외

가장 빠르지만 큰 머리·작은 몸 비율, 묶은 머리, 후드와 치마가 자동 리깅에서 쉽게 관통하거나 찌그러진다. 아이가 계속 보는 대표 캐릭터로는 품질 편차가 크다.

## 4. GPT Image 2 기준 시트

### 4.1 입력 기준

입력 수를 무작정 늘리지 않는다. 서로 다른 포즈가 너무 많으면 얼굴과 체형이 평균화되므로 다음 8개 안팎을 우선한다.

- `expecting.webp`: 심심하게 기다리는 감정
- `polite.webp`: 중립 얼굴과 후드 형태
- `welcome.webp`: 전신 비율과 인사 동작
- `thinking.webp`: 궁금한 얼굴
- `tablet.webp`: 생각하고 전달하는 손동작
- `worried.webp`: 걱정하는 얼굴
- `heart-hug.webp`: 다독이는 몸짓
- `jump.webp`: 기쁜 전신 동작
- 참고 GIF에서 추출한 대표 정지 프레임 1장

원본 GIF는 수정하지 않는다. 필요한 대표 프레임만 별도 파일로 추출한다. GPT Image 2 호출에는 API 키를 출력하거나 문서·로그에 남기지 않는다.

### 4.2 캐릭터 정체성 잠금

모든 생성 프롬프트는 다음 특징을 고정한다.

- 실제 인물이 아닌 독립적인 아동 친화형 캐릭터
- 큰 짙은 갈색 눈, 둥근 볼, 작고 부드러운 코와 입
- 짙은 갈색 머리, 위쪽 작은 번과 어깨까지 내려오는 옆머리
- 따뜻한 아이보리·크림색 후드
- 차분한 로즈핑크 치마와 신발
- 참고 이미지와 같은 큰 머리·작은 몸의 귀여운 비율
- 부드러운 머리카락·천 재질, 과한 광택 없는 고급 3D 애니메이션 영화풍 조명
- 과장된 성인 체형, 화장, 노출, 실존 인물 닮은꼴, 브랜드 로고 없음

특정 스튜디오나 살아 있는 작가의 이름으로 스타일을 지시하지 않고, 재질·비율·조명·표정 같은 시각 특성으로 묘사한다.

### 4.3 생성 순서

첫 호출은 1536×1024 가로형 전신 turnaround 후보 2장을 만든다.

- 정면, 앞 45도, 측면, 뒤 45도, 후면
- 같은 중립 A-pose와 같은 카메라 높이
- 머리·후드·치마·신발이 시점마다 동일
- 소품, 문자, 패널 라벨, 바닥 그림자 없음
- 머리카락과 옷 분리가 쉬운 단색 중간 명도의 청회색 배경

사용자가 한 후보를 승인한 뒤 그 시트를 정체성 기준으로 넣어 얼굴·상반신 표정 시트 1장을 만든다. 표정 순서는 문자가 없는 고정 7칸으로 관리한다.

1. 심심하게 기다림
2. 두리번거리며 떠다님
3. 궁금해서 고개를 갸웃함
4. 부모 메시지를 반갑게 알려 줌
5. 생각함
6. 기뻐하고 응원함
7. 걱정하며 다독임

GPT Image 2의 모델링 시트는 배경 제거 정확도를 위해 단색 배경으로 만든다. 이것은 최종 배경 요구를 포기하는 것이 아니다. 최종 앱은 `alpha:true` WebGL 캔버스로 렌더링하므로 캐릭터 주변은 완전히 투명하다.

### 4.4 시트 합격 기준

- 모든 시점의 눈 모양, 앞머리, 번 위치, 후드 끈, 치마 길이, 신발이 동일하다.
- 손가락·팔·다리 개수와 관절 방향이 정상이다.
- 후면도 앞면과 같은 헤어스타일과 의상 구조를 가진다.
- 표정만 달라지고 얼굴 나이·눈 크기·피부색이 바뀌지 않는다.
- 메시지 표정에 휴대폰·편지 같은 고정 소품을 넣지 않는다. 실제 말풍선은 앱 DOM이 담당한다.

이 관문은 자동 점수로 통과시키지 않고 사용자가 결과 시트를 직접 보고 승인한다. 승인 전에는 유료 3D 변환을 시작하지 않는다.

## 5. 3D 모델·리깅 계약

### 5.1 모델 생성과 정리

승인된 전신 시트의 정면·측면·후면을 Meshy multi-image 입력으로 사용하고 character rest pose를 선택한다. 생성일에 공식 상용 라이선스와 비공개 설정을 다시 확인하며, 무료 공개 자산 조건을 상용 앱의 기본값으로 가정하지 않는다.

초기 결과는 다음 순서로 정리한다.

1. 360도 회전에서 메시 구멍, 겹친 팔다리, 뒤집힌 노멀, 비대칭 얼굴을 확인한다.
2. 머리카락, 얼굴, 몸, 후드·치마를 합리적인 메시와 재질 단위로 정리한다.
3. 사람형 뼈대를 적용하고 glTF Y-up, meter 단위, 원점 기준으로 맞춘다.
4. 큰 머리와 짧은 팔다리에 맞게 어깨·팔꿈치·손목·골반·무릎 가중치를 보정한다.
5. 머리카락이 얼굴을 뚫거나 후드와 치마가 관절에서 관통하지 않게 가중치를 정리한다.
6. 모든 clip의 root motion을 제거하고 캐릭터가 원점으로 복귀하게 한다.

### 5.2 얼굴 morph 최소 세트

몸동작 7개와 별도로 다음 morph를 둔다.

- `blink`
- `smile`
- `mouthOpen`
- `pout`
- `browUp`
- `browConcern`
- `eyeWide`

좌우 비대칭 표정이 꼭 필요한 윙크는 초기 버전에서 `blink`와 고개 회전으로 표현하고, 품질이 부족할 때만 `blinkLeft`·`blinkRight`를 추가한다. 부모 메시지는 자동으로 읽지 않으므로 완전한 음소별 lip-sync는 초기 범위에 넣지 않는다. 실제 AI TTS 재생 중에는 `mouthOpen`을 낮은 강도로 주기 변화시켜 말하는 느낌만 준다.

### 5.3 몸동작 clip

캐릭터의 캔버스 안 상하 부유는 뼈대 clip이 아니라 모델 root 위의 별도 group transform으로 계속 적용한다. 각 몸동작은 root motion 없이 다음 이름과 의미를 사용한다.

| clip | 재생 방식 | 의미와 연출 |
|---|---|---|
| `idle_wait` | 약 6초 loop | 손에 턱을 기대거나 손을 모으고 심심하게 기다림 |
| `hover_explore` | 약 8초 loop | 천천히 좌우를 살피고 몸을 돌림 |
| `curious` | 약 2.4초 one-shot | 고개를 갸웃하고 조금 가까이 다가옴 |
| `message_delivery` | 약 3.2초 one-shot | 밝아진 얼굴로 DOM 말풍선을 손짓해 가리킴 |
| `thinking` | 약 2.8초 loop | 입가에 손을 대고 위쪽을 잠깐 바라봄 |
| `happy_cheer` | 약 2.5초 one-shot | 가볍게 회전하거나 두 손으로 기뻐함 |
| `caring` | 약 3.4초 hold/loop | 눈썹을 모으고 가까이 와서 다독이는 몸짓 |

one-shot은 끝난 뒤 현재 시간대의 `idle_wait` 또는 다음 우선 상태로 돌아간다. clip 사이에는 약 300ms cross-fade를 적용한다. 대기 중 눈 깜빡임은 3~6초 사이의 결정적 간격으로 morph를 재생해 기계적인 반복을 줄인다.

### 5.4 런타임 자산 예산

- 최종 파일: `public/assets/ai-buddy/3d/hyeni.glb`
- 단일 GLB에 메시, 스켈레톤, morph, 7개 clip 포함
- 목표 파일 크기: 6MiB 이하
- 목표 삼각형 수: 30,000~50,000
- 텍스처: 최대 1024px, 앱에 필요하지 않은 4K 원본 미포함
- 재질·draw call: 4개 이하 목표
- bone: 70개 이하 목표, vertex당 joint influence 4개 이하

6MiB를 넘으면 먼저 숨은 메시, 중복 키프레임, 텍스처를 줄인다. 품질을 해칠 정도로 압축해야만 맞출 수 있을 때는 기본 모델과 동작 파일 분리를 검토하되, 초기 정본은 원자적으로 교체 가능한 단일 GLB다.

## 6. 앱 렌더링 구조

### 6.1 컴포넌트 경계

```text
AiBuddyFab
└─ AiBuddyVisual
   ├─ Android child + WebGL2 + motion 허용 → lazy AiBuddyThreeCanvas
   └─ 그 밖의 모든 환경                 → 기존 AiBuddyWebpVisual
```

예상 책임은 다음과 같다.

- `AiBuddyVisual`: 플랫폼·WebGL·움직임 줄이기·오류 폴백 판정
- `AiBuddyThreeCanvas`: Three.js renderer, camera, light, GLB load, mixer, morph, dispose
- `aiBuddy3dState`: 20개 의미 face·8개 감정·nudge를 7개 clip과 morph 값으로 바꾸는 순수 함수
- `AiBuddyFab`: 기존 드래그·배회·말풍선·탭·길게 누르기와 상태 우선순위 유지

React 전용 3D 렌더러는 추가하지 않고 `three`를 직접 사용한다. 한 캐릭터와 한 카메라만 필요하므로 React 렌더 트리와 WebGL 프레임 루프를 분리하고 기존 버튼 포인터 이벤트를 그대로 유지할 수 있다.

### 6.2 활성 조건

3D는 다음 조건을 모두 만족할 때만 연다.

- 이미 `AiBuddyFab`가 확인한 `role === "child"`
- `Capacitor.getPlatform() === "android"`
- WebGL2 context 생성 가능
- `prefers-reduced-motion`이 아님
- 모델 로드와 renderer 초기화가 성공함

iOS Capacitor가 나중에 생겨도 자동 활성화하지 않는다. 웹·PWA는 현재 18장 이미지를 사용하며 GLB를 요청하지 않는다.

### 6.3 Three.js 장면

- `WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true })`
- clear alpha 0으로 투명 배경 유지
- 캐릭터 비율이 화면 위치에 따라 변하지 않는 직교 카메라
- key/fill/rim의 가벼운 조명과 모델에 구운 AO 사용
- 실시간 shadow map과 무거운 post-processing 미사용
- canvas는 `pointer-events:none`; 바깥 `<button>`이 모든 탭·드래그를 처리
- CSS로 움직이는 화면 배회와 press scale은 wrapper가 담당하고, 캔버스 안 부유·표정은 Three.js가 담당
- 3D 활성 시 기존 이미지 stack의 숨쉬기·opacity 전환은 중복 재생하지 않음

플로팅 버튼과 전체 화면 주목 연출이 동시에 WebGL context를 두 개 만들지 않게 한다. 화면에 실제로 보이는 주 visual 한 곳만 3D를 렌더하고, 뒤에 가려진 위치는 WebP 또는 빈 자리로 유지한다. AI 대화 말풍선마다 별도 canvas를 만들지 않는다. 대화 메시지 아바타는 현재 WebP를 계속 사용하고, 플로팅→대화 진입의 주 얼굴만 필요할 때 같은 `AiBuddyVisual`을 재사용한다.

### 6.4 번들·PWA 경계

`AiBuddyThreeCanvas`와 Three.js는 Android 조건이 열린 뒤에만 동적 import한다. Vite의 3D runtime 청크는 안정적인 `ai-buddy-3d-runtime` 이름으로 분리하고 `injectManifest.globIgnores`에서 제외한다.

현재 Workbox glob은 `.glb`를 수집하지 않지만 이를 우연에 맡기지 않고 빌드 검증에서 다음을 고정한다.

- PWA precache manifest에 `hyeni.glb` 없음
- PWA precache manifest에 `ai-buddy-3d-runtime` 청크 없음
- 웹·PWA 아이 모드 네트워크 기록에 GLB 요청 없음
- Android 패키지 안에는 GLB와 runtime 청크가 존재함

## 7. 감정·상호작용 상태

### 7.1 의미 상태 매핑

| 3D 동작 | 기존 의미 face·emotion |
|---|---|
| `idle_wait` | `idle`, `waiting`, `sleepy` |
| `hover_explore` | `explore`, `greeting`, `shy`, `music`, `wink` |
| `curious` | `curious`, `listening`, 준비물 질문 |
| `message_delivery` | 읽지 않은 부모 메시지, `talking` 중 메시지 전달 맥락 |
| `thinking` | `thinking`, `typing`, `idea` |
| `happy_cheer` | `happy`, `excited`, `joy`, `celebrate`, `love`, `quick` |
| `caring` | `worried`, `sad`, `caring` |

몸동작과 얼굴은 분리한다. 예를 들어 `sleepy`는 `idle_wait`를 느리게 재생하면서 눈꺼풀 morph를 높이고, `sad`는 `caring` 몸동작에 `pout`을 더한다. AI 음성의 `speaking`은 현재 감정의 몸동작을 유지하면서 `mouthOpen`만 낮게 움직인다.

### 7.2 표시 우선순위

사용자가 지금 직접 하는 탭·드래그의 짧은 피드백을 제외하면 다음 순서를 사용한다.

1. 읽지 않은 부모 메시지를 알리는 활성 nudge
2. AI 대화에서 이어진 실제 감정
3. 일정·준비물·초대 attention nudge
4. 배회 도착 동작
5. 시간대별 평상시 대기

부모 메시지는 매 프레임 계속 강제하는 영구 상태가 아니라 기존 배회·주목 타이밍에서 가장 먼저 선택되는 nudge다. 메시지를 읽은 뒤 같은 cue가 다시 나오지 않도록 현재 unread query 정본을 따른다.

### 7.3 부모 메시지 계약

- 좁은 말풍선: `부모님 메시지 왔어!`
- 전체 주목 말풍선: 현재처럼 최대 24자 미리보기, 미리보기가 없으면 내용을 지어내지 않음
- 자동 TTS·효과음 없음
- 일반 탭: `#/child/memo`
- 길게 누르기: 기존처럼 `#/child/ai-friend`로 이동해 음성 대화 시작
- 메시지 cue 중 접근성 이름: `부모님 메시지 확인하기 · 길게 누르면 ${friendName}와 바로 말하기`처럼 저장된 친구 이름을 반영
- 말풍선은 계속 DOM으로 렌더하고 canvas 텍스처에 한글을 굽지 않음

현재 `wanderLine`만 저장하는 구조로는 탭 대상을 알 수 없으므로 활성 cue를 `{ kind, line, face }` 형태로 보존한다. `kind === "parentMessage"`일 때만 일반 탭 대상을 메모로 바꾸고, 일정·준비물·초대는 기존 AI 친구 진입을 유지한다.

## 8. 성능·오류·접근성

### 8.1 렌더링 예산

- 최대 30fps로 프레임 루프 제한
- renderer pixel ratio 최대 1.5
- `document.hidden`, 앱 background, 컴포넌트 비가시 상태에서 mixer와 렌더 즉시 정지
- resize는 `ResizeObserver`로 실제 visual 크기가 바뀔 때만 반영
- unmount에서 animation frame, mixer action, geometry, material, texture, renderer를 해제
- 반복 진입 시 모델 fetch·parse를 무한 반복하지 않도록 module 단위 load promise를 재사용하되, scene instance는 안전하게 clone

초기 목표는 razr에서 앱 셸 준비 후 2초 안에 첫 3D 프레임을 보이는 것이다. 그 전에는 동일 face의 WebP가 보여 빈 공간이 생기지 않는다.

### 8.2 정직한 폴백

다음 상황에서는 오류 화면이나 반복 toast를 띄우지 않고 같은 의미 face의 기존 WebP로 강등한다.

- WebGL2 미지원
- GLB fetch·parse 실패
- 필요한 animation clip 또는 핵심 morph 누락
- `webglcontextlost`
- 움직임 줄이기 활성
- 런타임 예외

오류 때문에 버튼·말풍선·부모 메시지 탭 경로를 제거하지 않는다. 개발 환경에서는 민감 정보가 없는 짧은 오류 enum만 기록하고, 새 분석 endpoint나 사용자·가족 식별자를 추가하지 않는다.

### 8.3 접근성

- WebGL canvas는 장식이므로 `aria-hidden="true"`
- 의미와 조작 이름은 기존 바깥 button의 `aria-label`이 담당
- canvas가 포커스나 pointer event를 받지 않음
- 움직임 줄이기에서는 단순히 fps를 낮추는 대신 기존 정적 WebP 사용
- 자동 음성·진동·효과음을 새로 추가하지 않음
- 기존 44px 이상 조작 영역과 `hy-press` 피드백 유지

## 9. 자산 보관과 출처

자산은 앱에 실리는 결과와 편집 원본을 분리한다.

- GPT Image 2 기준 시트와 추출 프레임: `assets/08-source-sheets/ai-buddy-3d/`
- Blender·FBX·고해상도 texture 원본: `assets/03-hyeni-character/ai-buddy-3d-source/`
- 앱용 최종 GLB: `public/assets/ai-buddy/3d/hyeni.glb`
- 출처 기록: `docs/assets/ai-buddy-3d-provenance.md`

provenance에는 다음만 기록한다.

- 사용한 기존 자산 경로와 SHA-256
- 참고 GIF의 경로·SHA-256과 추출한 frame 번호
- GPT Image 모델명, 생성일, 프롬프트, 선택·탈락 결과
- Meshy/Tripo/Mixamo/Blender 사용 여부와 export 날짜
- export 당시 확인한 상용 라이선스 종류와 공식 문서 링크
- 최종 BLEND·FBX·GLB SHA-256

API 키, 외부 서비스 로그인 정보, 결제 수단, 세션 쿠키는 기록하지 않는다. 외부 서비스 약관은 바뀔 수 있으므로 export 날짜에 공식 페이지를 다시 확인한다.

## 10. 검증

### 10.1 기준 시트와 모델 검증

1. turnaround 후보 2장을 나란히 보여 사용자가 한 장을 승인한다.
2. 선택본에서 만든 표정 시트를 사용자가 승인한다.
3. Meshy 초안을 360도 turntable과 정면 close-up으로 확인한다.
4. Blender 정리 뒤 7개 clip을 각각 정면과 45도에서 재생해 관통·튀는 전환을 확인한다.
5. 투명 checkerboard와 밝은 로즈·민트·라벤더 화면 위에서 검은 사각형·색 번짐이 없는지 확인한다.

### 10.2 자동 회귀

- 20개 의미 face와 8개 emotion이 빠짐없이 7개 clip으로 매핑되는 순수 함수 테스트
- 부모 메시지 > 감정 > 일반 nudge > 배회 > 대기 우선순위 테스트
- 부모 메시지 일반 탭=`/child/memo`, 길게 누르기=AI 음성 대화 테스트
- Android/PWA/WebGL/reduced-motion/error 조합별 3D gate 테스트
- context loss와 GLB load 실패 시 WebP 폴백 테스트
- PWA precache에서 GLB·3D runtime 청크 제외 테스트
- GLB 존재, 크기 예산, 필수 clip·morph 이름을 검사하는 자산 테스트
- 기존 `aiBuddyCharacterAssets`, `aiBuddyCharacterBehavior`, `aiBuddyFab` 회귀 유지
- `npm run typecheck`
- `npm run build`
- `npm test` 후 종료 코드가 아니라 `ℹ fail 0` 요약 확인
- `npx cap sync android`
- Android unit test, `lintDebug`, `assembleDebug`

### 10.3 브라우저·PWA 검증

격리 Chromium에서 Android 조건을 mock해 다음을 확인한다.

- 모델 로드 전 WebP → 로드 후 투명 3D 전환
- 7개 상태와 cross-fade
- 부모 메시지 말풍선·메모 이동
- drag 중 frame 리렌더가 React drag 상태를 방해하지 않음
- `document.hidden`과 reduced motion 정지
- context loss 강제 후 WebP 복귀
- canvas pointer event 없음과 button 접근성 이름

일반 PWA 조건에서는 Network·Service Worker precache를 확인해 GLB와 Three.js 전용 runtime을 내려받지 않는지 검증한다.

### 10.4 razr 실기기 검증

아이 역할이 유지된 razr `ZY22H9VTQD`에만 다음 명령으로 기본 사용자 보존 설치한다.

```bash
npm run android:install:debug -- ZY22H9VTQD
```

로그아웃·역할 전환·재페어링·refresh token 조회나 회전을 하지 않는다. A17과 S25는 이번 아이 전용 3D 검증에 사용하지 않는다.

실기기 합격 기준은 다음과 같다.

- 설치 전후 `firstInstallTime`, child role, family scope가 유지됨
- 앱 진입 후 로컬 자산에서 2초 안에 3D 첫 프레임 목표
- 5분 연속 대기·배회에서 목표 30fps, 중앙값 28fps 이상
- 초기 로드를 제외하고 500ms 이상 멈춤 없음
- 드래그, 가장자리 붙기, 탭, 길게 누르기, 화면 중앙 주목 연출 정상
- 부모 메시지 cue 탭 후 `#/child/memo` 이동
- 앱 background→foreground 뒤 한 renderer만 재개
- 홈↔다른 아이 화면 10회 왕복에서 메모리의 단조 증가, context loss, crash, ANR 없음
- 프레임버퍼 캡처에서 배경 투명·인물 크롭·말풍선 비겹침 확인

실제 읽지 않은 메시지를 만들거나 운영 AI 대화·크레딧을 사용해야 하는 시나리오는 자동 발사하지 않는다. 메시지 상태와 AI 응답은 격리 브라우저에서 mock하고, 실기기에서는 현재 존재하는 실사용 상태를 읽기만 한다.

## 11. 단계별 진행과 중단 관문

1. 이 설계 문서를 사용자에게 검토받는다.
2. 구현 계획을 작성하고 테스트·자산·외부 도구 작업 순서를 고정한다.
3. GPT Image 2 turnaround 후보를 생성한다.
4. **사용자 시각 승인 관문**: 한 후보를 선택하기 전에는 표정 시트와 3D 변환을 진행하지 않는다.
5. 표정 시트를 생성하고 다시 사용자 승인을 받는다.
6. Meshy 계정의 라이선스·비공개 설정을 확인하고 모델을 생성한다. 로그인·결제는 사용자가 직접 수행한다.
7. Blender에서 리깅·morph·7개 clip·최적화를 완료한다.
8. **3D 모델 승인 관문**: 360도와 7개 clip 미리보기를 승인받는다.
9. TDD로 Android 전용 renderer와 폴백을 구현한다.
10. 자동 테스트·격리 브라우저·razr 보존 설치를 순서대로 검증한다.

GPT Image 2가 기준 시트 생성에는 직접 쓰이지만, 래스터 이미지 모델만으로 리깅된 GLB를 만들 수 있다고 가장하지 않는다. Meshy·Blender 단계가 끝나기 전에는 실제 3D 완료로 보고하지 않는다.

## 12. 배포 경계

- Worker, D1 schema, 인증, 위치, 알림 전달 계약은 변경하지 않는다.
- 웹 Pages는 기존 18장 폴백을 계속 사용한다. 구현 코드가 Pages에 포함되더라도 PWA가 3D runtime과 GLB를 내려받지 않아야 한다.
- Android debug 검증까지는 Play Store 업로드나 심사 제출을 하지 않는다.
- 앱 코드와 GLB가 현재 Play 제출 AAB보다 새로우므로, 이후 출시할 때는 versionCode를 올리고 최신 커밋에서 AAB를 다시 서명·검증해야 한다. 기존 AAB를 재사용하지 않는다.
- 서명 비밀번호와 외부 서비스 자격은 사용자가 직접 입력하며 에이전트가 읽거나 저장하지 않는다.

## 13. 범위 밖

- 고정 카메라 alpha 영상이나 GIF를 실시간 3D로 가장하기
- PWA·iOS에서 초기 3D 활성화
- 대화 메시지마다 별도 WebGL canvas 렌더링
- 음소별 자동 lip-sync와 부모 메시지 자동 읽기
- 의상·헤어스타일 선택 UI와 여러 캐릭터 모델
- 원격 CDN에서 실행 중 모델을 교체하는 기능
- 새 서버 endpoint, DB migration, 분석 이벤트
- A17·S25 역할 변경 또는 실사용 계정 재로그인
- Google Play 업로드·출시

## 14. 외부 도구 참고

- Meshy multi-image to 3D: https://help.meshy.ai/en/articles/9996860-how-to-use-meshy-image-to-3d
- Meshy character/animation: https://www.meshy.ai/3d-tools/ai-character-generator
- Mixamo custom character rigging: https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html
- Three.js GLTF·animation API: https://threejs.org/docs/
- Blender glTF export: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html
