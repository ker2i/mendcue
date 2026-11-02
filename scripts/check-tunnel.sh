#!/usr/bin/env bash
# Called once a minute by the user systemd timer. Never logs credentials/bodies.
set -euo pipefail
deploy_dir=${MENDCUE_DEPLOY_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}
state_dir=${MENDCUE_TUNNEL_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/mendcue-tunnel}
mkdir -p "$state_dir"
chmod 700 "$state_dir"
exec 9>"$state_dir/lock"
flock -n 9 || exit 0
now=$(date +%s)
failures=0
last_restart=0
if [[ -f "$state_dir/state" ]]; then
  read -r failures last_restart < "$state_dir/state" || true
  [[ $failures =~ ^[0-9]+$ ]] || failures=0
  [[ $last_restart =~ ^[0-9]+$ ]] || last_restart=0
fi
save_state() { printf '%s %s\n' "$failures" "$last_restart" > "$state_dir/state"; }
# A broken app is not repaired by restarting its tunnel.
local_status=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 8 http://127.0.0.1:33000/healthz 2>/dev/null) || local_status=000
if [[ $local_status != 200 ]]; then
  failures=0; save_state
  echo "Origin unhealthy ($local_status); tunnel left running."
  exit 0
fi
public_status=$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 12 "https://intake.quickfixphx.com/healthz?tunnel_check=$now" 2>/dev/null) || public_status=000
if [[ $public_status == 200 ]]; then
  if (( failures > 0 )); then echo 'Public intake recovered.'; fi
  failures=0; save_state
  exit 0
fi
failures=$((failures + 1))
echo "Public intake unhealthy ($public_status), consecutive checks: $failures. Origin healthy."
save_state
if (( failures < 3 || now - last_restart < 600 )); then exit 0; fi
# Save cooldown before attempting recovery to prevent restart storms.
last_restart=$now
failures=0
save_state
cd "$deploy_dir"
echo 'Reconnecting cloudflared after three failed public checks.'
docker compose -f compose.yaml -f compose.private.yaml -f compose.tunnel.yaml restart --timeout 10 cloudflared
