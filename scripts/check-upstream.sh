#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

git fetch upstream --quiet

LOCAL=$(git rev-parse main)
REMOTE=$(git rev-parse upstream/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "UP_TO_DATE"
    exit 0
fi

COUNT=$(git log main..upstream/main --oneline | wc -l | tr -d ' ')
echo "BEHIND by $COUNT commits"
echo ""
echo "New commits:"
git log main..upstream/main --oneline --no-merges | head -20

# Show files changed for quick relevance scan
echo ""
echo "Files changed:"
git diff main..upstream/main --stat | tail -5
