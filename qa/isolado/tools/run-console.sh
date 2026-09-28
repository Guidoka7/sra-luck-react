#!/usr/bin/env bash
# Dev Console do QA local: banco próprio (55321) e Sra Luck do QA (localhost:3100). Sem tokens reais.
set -euo pipefail
SP=${QA_PRIVADO:-/tmp/sra-luck-qa}
set -a; . "$SP/qa-credentials.env"; set +a
KEYS=$(cd /home/user/qa-supabase-console && /home/user/qa-supabase/node_modules/.bin/supabase status -o json 2>/dev/null)
export DEV_SUPABASE_URL=http://127.0.0.1:55321
export DEV_SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
export DEV_SUPABASE_ANON_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['ANON_KEY'])")
export DEV_SESSION_SECRET=$QA_SESSION_SECRET-console
export SRA_LUCK_BASE_URL=http://localhost:3100
export SRA_LUCK_SERVICE_TOKEN=$QA_DEV_CONSOLE_TOKEN
unset VERCEL_TOKEN GITHUB_TOKEN SRA_VERCEL_TEAM_ID DEV_VERCEL_TEAM_ID
exec node /home/user/qa-supabase/tools/console-serve.cjs
