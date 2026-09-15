#!/usr/bin/env bash
set -euo pipefail
npm ci --ignore-scripts --omit=peer
npm run db:generate
npm run lint
npm run typecheck
npm test
npm run build
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  npm run test:integration
fi
npm audit --omit=dev --audit-level=high
