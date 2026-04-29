#!/usr/bin/env bash
# Railway cron service entrypoint.
# Pings /api/cron/healthcheck on the web service every 5 minutes.
# Runs as a separate Railway service with cron schedule "*/5 * * * *".
# Independent of the web container — if web crashes mid-loop, this still fires.

set -u

URL="${HEALTHCHECK_URL:-https://web-production-6b396.up.railway.app/api/cron/healthcheck}"
SECRET="${CRON_SECRET:?CRON_SECRET must be set on this cron service}"

echo "[$(date -u +%FT%TZ)] cron tick → POST $URL"

# Curl with reasonable timeouts. The endpoint internally runs an 8-min agent turn
# but typical PONG latency is <10s. We give it 90s before giving up — anything
# longer means the synthetic check has its own internal failure logic.
HTTP_BODY=$(curl -sS \
  --max-time 90 \
  -H "x-cron-secret: ${SECRET}" \
  -X POST \
  -w "\nHTTP_STATUS:%{http_code}\n" \
  "${URL}" 2>&1)

STATUS=$(echo "${HTTP_BODY}" | sed -n 's/^HTTP_STATUS://p')
BODY=$(echo "${HTTP_BODY}" | sed '/^HTTP_STATUS:/d')

echo "[$(date -u +%FT%TZ)] status=${STATUS} body=${BODY}"

# Exit non-zero on hard transport failure so Railway flags the run as failed.
# Endpoint-level failures (ok:false) are handled by the endpoint itself
# (Postgres logging + Slack alerting), so we exit 0 there.
case "${STATUS}" in
  2*) exit 0 ;;
  *)  echo "[$(date -u +%FT%TZ)] hard transport failure"; exit 1 ;;
esac
