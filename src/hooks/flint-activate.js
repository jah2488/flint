// flint SessionStart hook. Emits one short activation note so the agent operates in flint mode
// from the first turn, without re-injecting the whole SKILL every session (that would be the
// opposite of the point). The full rules live in the `flint` skill, loaded on demand.
// Only console.log is used, so this runs as both CJS and ESM regardless of any ancestor
// package.json "type". Keep the note tiny: flint is token-conscious.
const note = [
  "flint mode is ON for this session.",
  "Operate per the flint skill: talk lean, build only what's needed (climb the ladder before writing code),",
  "build right (the nine engineering principles), and claim only what's proven (refute before you report any result).",
  "Guardrails and auto-clarity always hold. Say \"stop flint\" / \"normal mode\" to turn it off. Full rules: the flint skill.",
].join(" ");

// SessionStart stdout is added to the session context. JSON form is most portable across versions.
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: note } }),
);
