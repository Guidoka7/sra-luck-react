#!/usr/bin/env bash
# Inicia o app do QA local com variáveis SOMENTE locais.
set -euo pipefail
SP=${QA_PRIVADO:-/tmp/sra-luck-qa}
set -a; . "$SP/qa-credentials.env"; set +a
cd /home/user/qa-supabase
KEYS=$(npx supabase status -o json 2>/dev/null)
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=$(echo "$KEYS" | python3 -c "import json,sys;print(json.load(sys.stdin)['SERVICE_ROLE_KEY'])")
export CLIENTE_SESSION_SECRET=$QA_SESSION_SECRET
export LOG_PSEUDONYM_KEY=$QA_SESSION_SECRET
export DEV_CONSOLE_SERVICE_TOKEN=$QA_DEV_CONSOLE_TOKEN
export CRON_SECRET=$QA_CRON_SECRET NOTIFICACOES_CRON_SECRET=$QA_CRON_SECRET
# Nenhuma credencial de integração real: RD, Conta Azul, Mercado Pago, bancos, Gemini, VAPID ficam vazios.
unset VERCEL_PROJECT_PRODUCTION_URL PUBLIC_APP_URL NOTIFICACOES_APP_URL
exec node tools/qa-serve.mjs
