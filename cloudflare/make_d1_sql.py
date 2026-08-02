#!/usr/bin/env python3
"""검증된 SQLite DB -> D1 import용 단일 .sql 생성.

- CREATE TABLE(검증된 sqlite_schema.sql) + 행당 INSERT
- D1 비호환 요소 제거: PRAGMA / BEGIN TRANSACTION / COMMIT 없음
- 행당 INSERT 라 단일 문장이 작아 D1 요청 크기 제한 회피
- LF 개행 고정
"""
import sqlite3
import sys

db_path, schema_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

conn = sqlite3.connect(db_path)

# 검증된 스키마에서 PRAGMA/주석 외 CREATE TABLE 본문만 사용
schema_sql = open(schema_path, "r", encoding="utf-8").read()
# PRAGMA 줄 제거 (D1 import 가 거부/무시)
schema_lines = [ln for ln in schema_sql.splitlines() if not ln.strip().upper().startswith("PRAGMA")]
schema_clean = "\n".join(schema_lines).strip()

insert_count = 0
with open(out_path, "w", encoding="utf-8", newline="\n") as out:
    out.write("-- 혜니캘린더 D1 import (schema + data, 행당 INSERT, 트랜잭션 문 없음)\n")
    out.write(schema_clean + "\n\n")
    for line in conn.iterdump():
        if line.startswith("INSERT INTO"):
            out.write(line + "\n")
            insert_count += 1

conn.close()
print(f"INSERT 문 수: {insert_count}")
print(f"출력: {out_path}")
