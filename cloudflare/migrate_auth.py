#!/usr/bin/env python3
"""백업 data.sql의 auth.users / auth.identities → D1 users/auth_identities 이행 SQL 생성.

- 전체 컬럼을 임시 인메모리 테이블에 적재 후 필요 컬럼만 추출(uuid/bcrypt 보존)
- 출력: auth_import.sql (auth-schema DDL + users/auth_identities INSERT, 행당)
- 이전 변환 도구(load_to_sqlite/make_d1_sql)와 동일한 INSERT 파싱 패턴 재사용
"""
import sqlite3
import sys

data_path, schema_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

USERS_COLS = [
    "instance_id", "id", "aud", "role", "email", "encrypted_password",
    "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at",
    "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change",
    "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data",
    "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at",
    "phone_change", "phone_change_token", "phone_change_sent_at",
    "email_change_token_current", "email_change_confirm_status", "banned_until",
    "reauthentication_token", "reauthentication_sent_at", "is_sso_user",
    "deleted_at", "is_anonymous",
]
IDENT_COLS = [
    "provider_id", "user_id", "identity_data", "provider",
    "last_sign_in_at", "created_at", "updated_at", "id",
]


def extract_insert(data_file, schema_name, table, temp_name):
    """data.sql에서 INSERT INTO "schema"."table" 한 문장을 모아 temp_name 대상으로 반환."""
    target = f'INSERT INTO "{schema_name}"."{table}"'
    buf, collecting = [], False
    with open(data_file, "r", encoding="utf-8") as f:
        for line in f:
            if not collecting:
                if line.startswith(target):
                    collecting = True
                    first = line.replace(f'"{schema_name}"."{table}"', f'"{temp_name}"', 1)
                    first = first.replace(" OVERRIDING SYSTEM VALUE", "")
                    buf = [first]
            else:
                buf.append(line)
            if collecting and line.rstrip().endswith(";"):
                return "".join(buf)
    return None


conn = sqlite3.connect(":memory:")

# 1) 전체 컬럼 임시 테이블 + 원본 INSERT 적재
conn.execute("CREATE TABLE au (" + ",".join(f'"{c}" TEXT' for c in USERS_COLS) + ")")
conn.execute("CREATE TABLE ai (" + ",".join(f'"{c}" TEXT' for c in IDENT_COLS) + ")")
u_stmt = extract_insert(data_path, "auth", "users", "au")
i_stmt = extract_insert(data_path, "auth", "identities", "ai")
if not u_stmt:
    print("!! auth.users INSERT 없음"); sys.exit(1)
conn.execute(u_stmt)
if i_stmt:
    conn.execute(i_stmt)

raw_users = conn.execute("SELECT COUNT(*) FROM au").fetchone()[0]
raw_idents = conn.execute("SELECT COUNT(*) FROM ai").fetchone()[0] if i_stmt else 0

# 2) 타깃 스키마 생성 + 필요 컬럼만 INSERT SELECT
conn.executescript(open(schema_path, "r", encoding="utf-8").read())
conn.execute("""
  INSERT INTO users(id, phone, email, encrypted_password, is_anonymous, raw_user_meta_data, created_at)
  SELECT id, NULLIF(phone,''), NULLIF(email,''), encrypted_password,
         CASE WHEN is_anonymous IN ('1',1,'true','t') THEN 1 ELSE 0 END,
         raw_user_meta_data, created_at
  FROM au
""")
if i_stmt:
    conn.execute("""
      INSERT INTO auth_identities(id, user_id, provider, provider_id, identity_data, created_at)
      SELECT id, user_id, provider, provider_id, identity_data, created_at FROM ai
    """)

mig_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
mig_idents = conn.execute("SELECT COUNT(*) FROM auth_identities").fetchone()[0]

# 3) 출력 SQL (DDL + users/auth_identities INSERT, 행당)
with open(out_path, "w", encoding="utf-8", newline="\n") as out:
    out.write("-- auth.users/identities → D1 이행 (uuid/bcrypt 보존)\n")
    out.write(open(schema_path, "r", encoding="utf-8").read() + "\n")
    for line in conn.iterdump():
        if line.startswith('INSERT INTO users') or line.startswith('INSERT INTO auth_identities') \
           or line.startswith('INSERT INTO "users"') or line.startswith('INSERT INTO "auth_identities"'):
            out.write(line + "\n")

# 4) 진단
pw_users = conn.execute("SELECT COUNT(*) FROM users WHERE encrypted_password IS NOT NULL AND encrypted_password != ''").fetchone()[0]
phone_users = conn.execute("SELECT COUNT(*) FROM users WHERE phone IS NOT NULL").fetchone()[0]
anon_users = conn.execute("SELECT COUNT(*) FROM users WHERE is_anonymous=1").fetchone()[0]
print(f"원본 auth.users={raw_users} auth.identities={raw_idents}")
print(f"이행 users={mig_users} auth_identities={mig_idents}")
print(f"비밀번호 보유 users={pw_users} / 전화번호 보유={phone_users} / 익명={anon_users}")
sample = conn.execute("SELECT phone, substr(encrypted_password,1,7) FROM users WHERE encrypted_password!='' AND phone IS NOT NULL LIMIT 3").fetchall()
print("전화+비번 샘플(phone, 해시prefix):", sample)
print(f"출력: {out_path}")
