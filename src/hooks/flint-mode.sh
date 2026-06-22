#!/bin/bash
# flint status-line support (OPTIONAL, opt-in). UserPromptSubmit hook that records the
# active flint level for THIS session, so a status-line segment can show it. flint's
# level lives in conversation context, not on disk; this captures it at the one place
# the user's intent is isolated — their submitted prompt — and writes a tiny per-session
# statefile that the segment script (src/statusline/flint-segment.sh) reads in O(1).
#
# This hook does nothing unless you wire it up (see README "Status line indicator").
# It is NOT declared in plugin.json on purpose: a per-prompt hook for a cosmetic segment
# would be an unrequested side effect for every flint user. Opt in by copying this into
# your own hooks dir and adding a UserPromptSubmit hook in settings.json.
#
# MUST always exit 0 with empty stdout:
#   - a non-zero UserPromptSubmit hook can block the prompt;
#   - any stdout from this event is injected into the model's context.
# Every path below is defensive and silent.

input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)
[ -z "$sid" ] && exit 0
state="${TMPDIR:-/tmp}/claude-flint-mode-$sid"

# A `/flint <level>` invocation reaches UserPromptSubmit already expanded into the flint
# skill body (unique marker: "Be flint") with a trailing "ARGUMENTS: <level>" line. Read
# the level from ARGUMENTS so we don't false-match the prose inside the skill body. The
# audit/verify subcommands don't change the standing mode, so the whitelist ignores them.
if printf '%s' "$prompt" | grep -q 'Be flint'; then
  lvl=$(printf '%s' "$prompt" \
    | grep -oiE 'ARGUMENTS:[[:space:]]*(ultra|full|lite|feral)' \
    | tail -1 | sed -E 's/.*[[:space:]]//' | tr '[:upper:]' '[:lower:]')
  [ -z "$lvl" ] && lvl=full          # bare `/flint` with no arg => full
  printf '%s' "$lvl" >"$state" 2>/dev/null
# Plain-prose disable. Anchored to the whole prompt so the skill body (which documents
# "stop flint" / "normal mode" as text) can't trip it — only a standalone phrase counts.
elif printf '%s' "$prompt" | grep -qiE '^[[:space:]]*(stop flint|normal mode)[[:space:].!]*$'; then
  printf 'off' >"$state" 2>/dev/null
fi

exit 0
