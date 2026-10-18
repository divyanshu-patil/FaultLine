#!/bin/sh
# Fails if the production PayPal API host appears outside the docs that prohibit it (AGENTS.md rule 1).
host="api-m""\.paypal\.com"
hits=$(git grep -n -I -E "$host" -- . ':!docs/' ':!AGENTS.md' ':!judging.md' ':!scripts/check-no-prod-host.sh' || true)
if [ -n "$hits" ]; then
  echo "Production PayPal host found:"; echo "$hits"; exit 1
fi
echo "check-no-prod-host: ok"
