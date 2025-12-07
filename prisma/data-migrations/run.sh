#!/bin/bash
# backend/prisma/data-migrations/run.sh
#
# Data migrations executor script.
# Runs TypeScript data migrations after Prisma schema migrations.
# Called automatically during ./run.sh update.

set -e

MIGRATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="$MIGRATION_DIR/registry.json"

# Initialize registry if it doesn't exist
if [ ! -f "$REGISTRY" ]; then
  echo '{"migrations":[]}' > "$REGISTRY"
fi

# Find all migration files (excluding template.ts)
# First check if any .ts files exist (other than template.ts)
MIGRATIONS=""
for f in "$MIGRATION_DIR"/*.ts; do
  # Check if glob matched any files (glob returns literal pattern if no match)
  [ -e "$f" ] || continue
  # Exclude template.ts
  [ "$(basename "$f")" = "template.ts" ] && continue
  MIGRATIONS="$MIGRATIONS $f"
done

# Trim leading space and sort
MIGRATIONS=$(echo "$MIGRATIONS" | xargs -n1 2>/dev/null | sort)

if [ -z "$MIGRATIONS" ]; then
  echo "No data migrations found"
  exit 0
fi

for migration_file in $MIGRATIONS; do
  MIGRATION_ID=$(basename "$migration_file" .ts)

  # Check if already applied
  if jq -e ".migrations[] | select(.id == \"$MIGRATION_ID\")" "$REGISTRY" > /dev/null 2>&1; then
    echo "✓ $MIGRATION_ID already applied, skipping"
    continue
  fi

  echo "Running data migration: $MIGRATION_ID"

  # Execute migration using ts-node
  START_TIME=$(date +%s%3N)

  cd /opt/infinibay/backend
  npx ts-node -r tsconfig-paths/register "$migration_file"

  END_TIME=$(date +%s%3N)
  DURATION=$((END_TIME - START_TIME))

  # Record in registry
  TIMESTAMP=$(date -Iseconds)
  jq ".migrations += [{\"id\": \"$MIGRATION_ID\", \"appliedAt\": \"$TIMESTAMP\", \"executionTimeMs\": $DURATION, \"status\": \"success\"}]" \
    "$REGISTRY" > "$REGISTRY.tmp"
  mv "$REGISTRY.tmp" "$REGISTRY"

  echo "✓ $MIGRATION_ID completed in ${DURATION}ms"
done

echo "All data migrations completed"
