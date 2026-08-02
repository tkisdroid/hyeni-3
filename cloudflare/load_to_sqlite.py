#!/usr/bin/env python3
"""sqlite_schema.sql + data.sql -> SQLite DB 적재 및 검증.

- public 스키마 INSERT 만 적재 (auth/storage 제외)
- multi-row INSERT 문 단위로 모아서 실행
- "public". 접두사 제거
- 적재 후 테이블별 행 수 + 알려진 수치 대조
"""
import sqlite3
import re
import sys
import os

schema_path, data_path, db_path = sys.argv[1], sys.argv[2], sys.argv[3]

if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
conn.execute("PRAGMA foreign_keys = OFF;")

# --- 스키마 ---
with open(schema_path, "r", encoding="utf-8") as f:
    conn.executescript(f.read())

schema_tables = {r[0] for r in conn.execute(
    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
print(f"생성된 테이블 수: {len(schema_tables)}")

# --- 데이터 적재 ---
insert_re = re.compile(r'^INSERT INTO "([a-z_]+)"\."([a-z_]+)"')
counts = {}
errors = []
skipped_schemas = {}

collecting = False
keep = False
table = None
buf = []

with open(data_path, "r", encoding="utf-8") as f:
    for line in f:
        if not collecting:
            m = insert_re.match(line)
            if not m:
                continue  # SET / 주석 / setval 등 스킵
            schema_name, tbl = m.group(1), m.group(2)
            collecting = True
            keep = (schema_name == "public")
            table = tbl
            if keep:
                # "public". 접두사 + PG 전용 OVERRIDING SYSTEM VALUE(IDENTITY 컬럼) 제거
                first = line.replace('"public".', "", 1)
                first = first.replace(" OVERRIDING SYSTEM VALUE", "")
                buf = [first]
            else:
                skipped_schemas[schema_name] = skipped_schemas.get(schema_name, 0) + 1
                buf = []
        else:
            if keep:
                buf.append(line)

        if collecting and line.rstrip().endswith(";"):
            if keep:
                stmt = "".join(buf)
                try:
                    cur = conn.execute(stmt)
                    counts[table] = counts.get(table, 0) + cur.rowcount
                except Exception as e:
                    errors.append((table, str(e)[:300]))
            collecting = False
            keep = False
            buf = []

conn.commit()

# --- 검증 ---
print(f"\n적재 INSERT 테이블 수: {len(counts)}")
print(f"제외된 비-public 스키마 INSERT: {skipped_schemas}")

if errors:
    print(f"\n!!! 적재 에러 {len(errors)}건:")
    for t, e in errors:
        print(f"  [{t}] {e}")
else:
    print("\n적재 에러: 0건")

# COUNT(*) 재검증 (rowcount 와 실제 일치 여부)
total_rows = 0
mismatch = []
for t in sorted(counts):
    actual = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
    total_rows += actual
    if actual != counts[t]:
        mismatch.append((t, counts[t], actual))

print(f"\n총 적재 행 수: {total_rows}")
print("상위 행 수 테이블:")
for t in sorted(counts, key=lambda x: -counts[x])[:12]:
    c = conn.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
    print("  %-32s %8d" % (t, c))

# MANIFEST 알려진 수치 대조
known = {"location_history": 95071, "parent_alerts": 281}
print("\nMANIFEST 대조:")
for t, expected in known.items():
    actual = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
    flag = "OK" if actual == expected else "DIFF"
    print(f"  {t}: SQLite {actual} / MANIFEST {expected}  [{flag}]")

# 데이터 정합성 샘플 (한글/jsonb/boolean)
print("\n정합성 샘플:")
row = conn.execute('SELECT title, location, is_family_event FROM "events" LIMIT 1').fetchone()
print(f"  events.title={row[0]!r}  location={str(row[1])[:50]}...  is_family_event={row[2]!r}")
row = conn.execute('SELECT ai_friend_name, ai_enabled, forbidden_topics FROM "ai_parent_settings" LIMIT 1').fetchone()
print(f"  ai_parent_settings.ai_friend_name={row[0]!r}  ai_enabled={row[1]!r}  forbidden_topics={row[2]!r}")
# boolean 변환 확인 (DISTINCT 값)
vals = conn.execute('SELECT DISTINCT is_family_event FROM "events"').fetchall()
print(f"  events.is_family_event DISTINCT 값: {sorted(v[0] for v in vals)}  (0/1 이어야 정상)")

conn.close()
print(f"\nDB 파일: {db_path}")
