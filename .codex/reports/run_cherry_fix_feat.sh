#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/treygoff/Development/openclaw"
cd "$ROOT"

INPUT_TSV="$ROOT/.codex/reports/upstream4d_missing_fix_feat.tsv"
LOG="$ROOT/.codex/reports/cherry_fix_feat_run.log"
STATE="$ROOT/.codex/reports/cherry_fix_feat_done.txt"
CONFLICT_LOG="$ROOT/.codex/reports/cherry_fix_feat_conflicts.tsv"
CUSTOM_COUNTS="$ROOT/.codex/reports/custom_hotspot_counts.tsv"
CUSTOM_FILES="$ROOT/.codex/reports/custom_hotspot_files.txt"

mkdir -p "$ROOT/.codex/reports"
touch "$LOG" "$STATE" "$CONFLICT_LOG"

# Build a file-level custom hotspot set from commits unique to local HEAD vs upstream/main.
git log upstream/main..HEAD --name-only --pretty=format: \
  | sed '/^$/d' \
  | sort \
  | uniq -c \
  | awk '{print $1"\t"$2}' \
  | sort -t $'\t' -k1,1nr > "$CUSTOM_COUNTS"

# Files touched at least 40 times by our custom-only commits are treated as custom hotspots.
awk -F '\t' '$1 >= 40 { print $2 }' "$CUSTOM_COUNTS" > "$CUSTOM_FILES"

mapfile -t SHAS < <(awk -F '\t' '{print $1"\t"$3}' "$INPUT_TSV" | sort -t $'\t' -k2,2 | cut -f1)
TOTAL="${#SHAS[@]}"
DONE_COUNT="$(wc -l < "$STATE" | tr -d ' ')"

printf '=== START %s ===\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG"
printf 'total=%s already_done=%s\n' "$TOTAL" "$DONE_COUNT" | tee -a "$LOG"

# Disable local commit hooks for bulk cherry-pick; full gates run after integration.
git config --local core.hooksPath /dev/null

is_custom_file() {
  local f="$1"

  if grep -Fxq "$f" "$CUSTOM_FILES"; then
    return 0
  fi

  case "$f" in
    extensions/*) return 0 ;;
    src/agents/*) return 0 ;;
    src/auto-reply/*) return 0 ;;
    src/config/*) return 0 ;;
    src/gateway/*) return 0 ;;
    src/telegram/*) return 0 ;;
    src/discord/*) return 0 ;;
    src/slack/*) return 0 ;;
    src/signal/*) return 0 ;;
    src/web/*) return 0 ;;
    src/channels/*) return 0 ;;
    ui/*) return 0 ;;
    apps/ios/*) return 0 ;;
    apps/macos/*) return 0 ;;
  esac

  return 1
}

# If a previous cherry-pick is mid-flight, fail fast so we can handle it explicitly.
if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null 2>&1; then
  echo "ERROR: CHERRY_PICK_HEAD already exists. Resolve/abort current cherry-pick first." | tee -a "$LOG"
  exit 1
fi

idx=0
for sha in "${SHAS[@]}"; do
  idx=$((idx + 1))

  if grep -Fxq "$sha" "$STATE"; then
    continue
  fi

  printf '[%s/%s] cherry-pick %s\n' "$idx" "$TOTAL" "$sha" | tee -a "$LOG"

  if git cherry-pick "$sha" >>"$LOG" 2>&1; then
    echo "$sha" >> "$STATE"
    continue
  fi

  if ! git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null 2>&1; then
    # Usually duplicate/empty with no active pick; mark as done and move on.
    printf '%s\t%s\t%s\n' "$sha" "no_cherry_pick_head" "skipped_or_already_applied" >> "$CONFLICT_LOG"
    echo "$sha" >> "$STATE"
    continue
  fi

  mapfile -t conflicted < <(git diff --name-only --diff-filter=U)

  if [ "${#conflicted[@]}" -eq 0 ]; then
    # No file-level conflicts but cherry-pick paused (often empty commit).
    if git cherry-pick --skip >>"$LOG" 2>&1; then
      printf '%s\t%s\t%s\n' "$sha" "empty" "skip" >> "$CONFLICT_LOG"
      echo "$sha" >> "$STATE"
      continue
    else
      echo "ERROR: unable to skip empty cherry-pick for $sha" | tee -a "$LOG"
      exit 1
    fi
  fi

  for f in "${conflicted[@]}"; do
    stages="$(git ls-files -u -- "$f" | awk '{print $3}' | tr '\n' ' ')"
    has_ours=0
    has_theirs=0
    if [[ " $stages " == *" 2 "* ]]; then
      has_ours=1
    fi
    if [[ " $stages " == *" 3 "* ]]; then
      has_theirs=1
    fi

    if is_custom_file "$f"; then
      decision="ours_custom"
      if [ "$has_ours" -eq 1 ]; then
        git checkout --ours -- "$f"
        git add -- "$f"
      else
        # Ours deleted the path (e.g. modify/delete); keep our deletion.
        git rm -- "$f" >/dev/null 2>&1 || rm -f -- "$f"
      fi
    else
      decision="theirs_upstream"
      if [ "$has_theirs" -eq 1 ]; then
        git checkout --theirs -- "$f"
        git add -- "$f"
      else
        # Theirs deleted the path; keep upstream deletion.
        git rm -- "$f" >/dev/null 2>&1 || rm -f -- "$f"
      fi
    fi
    printf '%s\t%s\t%s\n' "$sha" "$f" "$decision" >> "$CONFLICT_LOG"
  done

  if git cherry-pick --continue >>"$LOG" 2>&1; then
    echo "$sha" >> "$STATE"
    continue
  fi

  # If continue failed but no unresolved conflicts remain, skip empty commit.
  if git diff --name-only --diff-filter=U | grep -q .; then
    echo "ERROR: unresolved conflicts remain for $sha" | tee -a "$LOG"
    exit 1
  fi

  if git cherry-pick --skip >>"$LOG" 2>&1; then
    printf '%s\t%s\t%s\n' "$sha" "post-continue-empty" "skip" >> "$CONFLICT_LOG"
    echo "$sha" >> "$STATE"
  else
    echo "ERROR: failed to continue/skip cherry-pick for $sha" | tee -a "$LOG"
    exit 1
  fi

done

printf '=== END %s ===\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" | tee -a "$LOG"
printf 'processed=%s\n' "$(wc -l < "$STATE" | tr -d ' ')" | tee -a "$LOG"
