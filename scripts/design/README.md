# 디자인 검증 도구 (어른 모드 유리 언어)

실제 화면 CSS 를 그대로 링크한 정적 하니스로 **렌더된 픽셀**을 재는 도구다.
토큰 계산이나 정적 스캔으로는 반투명 유리 위 대비를 알 수 없기 때문에 만들었다
(자세한 함정은 `docs/engineering/design.md`의 어른 모드 디자인 항목 참고).

```bash
node scripts/design/serve.mjs .                     # 저장소 루트를 5199 포트로 서빙
node scripts/design/contrast-audit.mjs              # 스크롤 위치별 전 텍스트 WCAG AA 실측
node scripts/design/screenshot.mjs <url> <out.png> <scrollTop> <height>
```

`contrast-audit.mjs` 는 각 텍스트 요소의 computed color 와 **그 요소 상자 안의 실제 배경 픽셀**을
비교한다. 요소 자신이 불투명 배경을 가지면(흰 글자/빨간 배지) 그 값을 우선한다.
