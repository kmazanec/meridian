#!/usr/bin/env bash
# Install/refresh the Meridian automation cron entries on the droplet.
#
# Idempotent: rewrites a dedicated crontab fragment owned by this script (marked by
# BEGIN/END sentinels) so re-running the deploy never duplicates entries. Run by the CI
# `deploy-automation` job on the runner host (same droplet), or by hand.
#
# Schedules (one-shot `docker run --rm` per tick, per the no-resident-scheduler design):
#   - morning    ~08:00 ET  → create the day's markets
#   - settlement ~16:05 ET  → settle the day's open contracts
# Cron runs in the host's local TZ; we set CRON_TZ=America/New_York so the ET wall-clock
# times above are correct across DST (the program also enforces timing on-chain).
#
# Env (with defaults):
#   IMAGE       container image to run            (default: meridian-automation:latest)
#   ENV_FILE    droplet env file for the jobs     (default: /etc/meridian/automation.env)
#   LOG_DIR     where job stdout/stderr is logged (default: /var/log/meridian)
set -euo pipefail

IMAGE="${IMAGE:-meridian-automation:latest}"
ENV_FILE="${ENV_FILE:-/etc/meridian/automation.env}"
LOG_DIR="${LOG_DIR:-/var/log/meridian}"

BEGIN="# >>> meridian-automation (managed by install-cron.sh) >>>"
END="# <<< meridian-automation (managed by install-cron.sh) <<<"

mkdir -p "$LOG_DIR"

run() {  # job-bin -> the docker run line
  echo "docker run --rm --env-file ${ENV_FILE} ${IMAGE} $1"
}

fragment="$(cat <<EOF
${BEGIN}
CRON_TZ=America/New_York
# morning job — create the day's markets (~08:00 ET, weekdays)
0 8 * * 1-5 $(run meridian-run-morning) >> ${LOG_DIR}/morning.log 2>&1
# settlement job — settle open contracts (~16:05 ET, weekdays)
5 16 * * 1-5 $(run meridian-run-settlement) >> ${LOG_DIR}/settlement.log 2>&1
${END}
EOF
)"

# Replace any existing managed fragment, preserving the user's other crontab lines.
current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current" | sed "/$(printf '%s' "$BEGIN" | sed 's/[][\\/.*^$]/\\&/g')/,/$(printf '%s' "$END" | sed 's/[][\\/.*^$]/\\&/g')/d")"

{ printf '%s\n' "$cleaned" | sed '/^$/d'; printf '%s\n' "$fragment"; } | crontab -

echo "Installed Meridian automation cron (image=${IMAGE}, env=${ENV_FILE}):"
crontab -l | sed -n "/${BEGIN}/,/${END}/p"
