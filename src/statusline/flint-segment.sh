#!/bin/bash
# flint status-line segment (OPTIONAL, opt-in). Reads the statusLine JSON on stdin and
# prints a single segment: a spark glyph + the active flint level, e.g. "✦ flint:ultra".
# Glyph color carries the intensity (feral red, ultra amber, full/lite green, off dim).
#
# Level comes from the per-session statefile that src/hooks/flint-mode.sh writes; an
# absent file means "full", since flint is on-by-default each session (its SessionStart
# hook). Prints NOTHING when flint isn't installed, so leaving this wired after an
# uninstall degrades cleanly to no segment.
#
# Two ways to use it (see README "Status line indicator"):
#   1. No status line yet  -> point settings.json statusLine.command at this script.
#   2. Existing status line -> copy the body into your script, or tee stdin to both.
#
# Requires: jq (same as most status lines).

input=$(cat)

# Show nothing unless flint is actually installed.
compgen -G "$HOME/.claude/plugins/cache/flint/flint/*/skills/flint" >/dev/null 2>&1 || exit 0

sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
mode=full
sf="${TMPDIR:-/tmp}/claude-flint-mode-${sid}"
[ -n "$sid" ] && [ -r "$sf" ] && mode=$(cat "$sf" 2>/dev/null)

DIM=$'\033[2m'; RST=$'\033[0m'
GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'

case "$mode" in
  off)   printf '%s✦ flint off%s'        "$DIM" "$RST" ;;
  feral) printf '%s✦%s %sflint:%s%s'     "$RED" "$RST" "$DIM" "$RST" feral ;;
  ultra) printf '%s✦%s %sflint:%s%s'     "$YEL" "$RST" "$DIM" "$RST" ultra ;;
  *)     printf '%s✦%s %sflint:%s%s'     "$GRN" "$RST" "$DIM" "$RST" "$mode" ;;
esac
