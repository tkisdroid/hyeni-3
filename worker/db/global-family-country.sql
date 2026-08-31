-- 정확히 1회 적용한다. 실행 전 worker/lib/region.ts의 preflight로
-- families.country_code 부재를 확인해야 한다.
ALTER TABLE families ADD COLUMN country_code TEXT NOT NULL DEFAULT 'KR';
