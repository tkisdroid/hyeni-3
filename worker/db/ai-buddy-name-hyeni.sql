-- 단일 AI 친구의 제품 이름을 통통이·꼬미에서 혜니로 변경한다. 2026-08-24.
-- 사용자가 직접 지은 다른 이름은 보존하고, 과거 앱·DB가 자동 저장한 기본값만 바꾼다.
-- WHERE 조건 덕분에 재실행해도 추가 변경이 없는 멱등 migration이다.
UPDATE ai_parent_settings
SET ai_friend_name = '혜니',
    updated_at = CURRENT_TIMESTAMP
WHERE TRIM(ai_friend_name) IN ('통통이', '꼬미', 'AI 친구');
