# 영단어 카탈로그 출처와 이용 조건

이 자료는 영어 단어의 한국어 뜻을 새로 생성한 사전이 아니다. 한국어 위키낱말사전의 뜻과 CEFR-J의 품사·수준 정보를 정제하여 연결한 파생 어휘 데이터이다.

## 한국어 뜻

- 원저작자: 한국어 위키낱말사전 기여자
- 추출·배포: Kaikki.org / Wiktextract, Tatu Ylonen
- 원문: 각 단어의 `sourceUrl`에 연결된 한국어 위키낱말사전 영어 항목
- 덤프: 2026-09-01, 추출: 2026-09-09
- 데이터: https://kaikki.org/kowiktionary/raw-wiktextract-data.jsonl.gz
- 출처 안내: https://kaikki.org/kowiktionary/rawdata.html
- 저작권 안내: https://ko.wiktionary.org/wiki/위키낱말사전:저작권
- 라이선스: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
- 라이선스 본문: https://creativecommons.org/licenses/by-sa/4.0/legalcode

이 카탈로그의 해당 파생 어휘 데이터는 CC BY-SA 4.0으로 제공한다. 복사·수정·배포할 때 원저작자와 출처 링크, 라이선스 링크 및 수정 사실을 유지하고, 해당 파생 데이터에 동일조건을 적용한다. 원저작자나 기관이 혜니캘린더를 보증하거나 감수했다는 의미로 사용하지 않는다.

변경 내용: 소문자 단일 표제어와 일치 품사를 선정했다. 원문에 붙은 부록 참조, 영문 괄호 설명, 품사 표기를 제거하고 중복 뜻을 통합했다. 설명문·불완전한 뜻·형태변형·노골적 표현 및 명시한 표본 검수 오류를 제외했다. 하나의 단어에 한 품사와 대표 뜻 하나를 표시한다. 별도로 검수한 항목은 원문 안의 한국어 부분 문자열만 발췌했다. 조동사를 일반 동사로 자동 변환하여 같은 철자의 다른 의미에 연결하지 않는다. 원문 예문·인용문·음원·이미지는 반입하지 않았다.

## 수준·품사 정보

The CEFR-J Wordlist Version 1.6. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from https://www.cefr-j.org/data/CEFRJ_wordlist_ver1.6.zip on 12/09/2026.

- 공식 설명 및 이용 조건: https://www.cefr-j.org/download.html
- 저작권: Tokyo University of Foreign Studies, Tono Laboratory
- 공식 안내는 출처를 적절히 밝히는 연구·교육·상업 이용과 목록 변경을 허용한다. 이 자료에 별도의 CC 라이선스가 붙어 있다고 추정하지 않는다. 감수·보증은 받지 않았다.

단계 변경: A1은 같은 수준 안에서 단어 길이→알파벳 순으로 반씩 나누어 1·2단계로 구성했다. A2는 3단계, B1은 4단계, B2는 5단계이다. 짧은 단어 순서는 사용 빈도나 독립 검증된 난이도가 아니다. 이 5단계는 앱의 자체 학습 순서이며 한국의 초·중등 공식 필수 어휘 범위를 뜻하지 않는다.

## 재현

`pwsh.exe -File ./build-vocabulary-catalog.ps1`

Node.js와 PowerShell/.NET 기본 기능만 사용한다. 같은 폴더의 원본 두 파일이 없으면 공개 다운로드 주소에서 내려받지만, SHA-256이 아래 값과 다르면 진행하지 않는다. 최신 Kaikki 다운로드는 갱신되므로 이후 재현에는 보관한 원본을 사용해야 할 수 있다.

- `kowiktionary-20260901.jsonl.gz`: `779e7a3d4d20ab5c8f4bbd02646fad7ff191361543dc07a499b5eee7c5c0274d`
- `CEFRJ_wordlist_ver1.6.zip`: `c837d2c00ab8954ed8db48e79afd8ef37099570295fec36950dbf9322303a37a`

수동 제외는 `manual-exclusions.json`에 사유와 함께 남기며, 검수한 원문 발췌는 `manual-selections.json`에 보관한다. 두 파일은 재현에 필요하다. 생성 결과 `vocabulary-catalog.json`은 출처 메타데이터와 `words` 배열을 함께 담으며, `vocabulary-exclusions.json`은 원문·정규화 결과·제외 사유를 보관한다. `node ./validate-vocabulary-catalog.mjs`는 데이터 계약과 읽기 검수 범위를 검사하고 `vocabulary-quality-review.json`을 작성한다. 배포 시 이 출처 안내와 각 항목의 원문 링크를 함께 제공한다.

검수 한계: 기계적 전수 검증과 에이전트의 기본 단계·표본 읽기 검수 결과이다. 사람이 모든 뜻을 감수한 자료나 초중등 교육과정 적합성 인증 자료로 표시하지 않는다. 원문 사전에는 설명·오탈자·동음이의 혼동이 있을 수 있으므로 앱의 기존 수작업 기본 어휘가 있으면 이를 우선하는 것이 적절하다.

앱 배치 추가 변경: 같은 A1 안에서 생활 어휘 시작 목록을 우선하고 나머지를 단어 길이와 알파벳 순으로 이어 두 단계로 나눈다. 시작 단어 93개는 원문 안에서 짧은 대표 뜻을 발췌했다. 생성 정본은 scripts/prepare-vocabulary-catalog.mjs, 발췌 정본은 content/vocabulary/starter-meaning-excerpts.json이다.
