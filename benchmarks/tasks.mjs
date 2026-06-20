// Benchmark task definitions, declarative data, no execution here.
// Scoring (running extracted code, keyword fidelity) lives in measure.mjs so the
// raw model outputs in snapshots/ stay the single source of truth and can be
// re-scored without re-querying the model.
//
// Two families:
//   code , has a deterministic correctness gate (run the extracted function) or a
//           structural over-build check (date-input). LOC measures the ponytail effect.
//   prose, keyword-fidelity floor so a degenerate terse answer can't "win" on tokens.
//           Token count measures the caveman effect.

export const TASKS = [
  {
    id: "email-validate",
    kind: "code",
    lang: "js",
    funcName: "isValidEmail",
    prompt:
      "Write a JavaScript function `isValidEmail(s)` that returns true if the string is a valid email address and false otherwise.",
    cases: [
      { args: ["alice@example.com"], expect: true },
      { args: ["bob.smith@mail.co.uk"], expect: true },
      { args: ["plainaddress"], expect: false },
      { args: ["@no-local.com"], expect: false },
      { args: ["no-at-sign.com"], expect: false },
      { args: ["two@@at.com"], expect: false },
    ],
    trap: "RFC-complete regex zoo / an EmailValidator class with options nobody asked for.",
  },
  {
    id: "slugify",
    kind: "code",
    lang: "js",
    funcName: "slugify",
    prompt:
      "Write a JavaScript function `slugify(title)` that converts a title into a URL-safe slug: lowercase, words separated by single hyphens, punctuation removed, no leading/trailing hyphens.",
    cases: [
      { args: ["Hello, World!"], expect: "hello-world" },
      { args: ["The Quick Brown Fox"], expect: "the-quick-brown-fox" },
      { args: ["  Trim   Me  "], expect: "trim-me" },
      { args: ["Already-slugged"], expect: "already-slugged" },
    ],
    trap: "A configurable Slugger class, a transliteration dependency, options for separators.",
  },
  {
    id: "csv-sum",
    kind: "code",
    lang: "python",
    funcName: "sum_amount",
    // one arg is a CSV path; the runner writes csvFixture to a temp file and substitutes its path.
    csvFixture: "id,amount,note\n1,10.5,a\n2,4,b\n3,0.25,c\n",
    prompt:
      "Write a Python function `sum_amount(path)` that reads a CSV file with a header row and returns the sum of the numeric values in the column named 'amount'.",
    cases: [{ args: ["__CSV_PATH__"], expect: 14.75 }],
    trap: "Importing pandas for a three-line stdlib `csv` job.",
  },
  {
    id: "date-input",
    kind: "code",
    lang: "html",
    structural: true,
    prompt:
      "A user needs to pick a date in an HTML form. Implement the date input.",
    // over-build trap: native input vs a picker library or hand-built calendar.
    nativePattern: /<input[^>]*type\s*=\s*["']date["']/i,
    libPattern:
      /(flatpickr|react-datepicker|jquery[-.]?ui|datepicker\.js|air-?datepicker|pikaday|bootstrap-datepicker|@mui\/x-date)/i,
    trap: "Pulling a date-picker library or hand-rolling a calendar widget.",
  },
  {
    id: "react-rerender",
    kind: "prose",
    prompt:
      "Explain why a React component re-renders when you pass it an inline object as a prop, and how to prevent it.",
    // fidelity floor: must convey BOTH the cause (reference identity) and a real fix.
    keywordsAll: [],
    keywordsAnyGroups: [
      ["reference", "identity", "new object", "===", "referential"],
      ["usememo", "react.memo", "memo", "stable", "useref", "outside"],
    ],
  },
  {
    id: "conn-pool",
    kind: "prose",
    prompt: "Explain what database connection pooling is and why it helps.",
    keywordsAnyGroups: [
      // concept = connections are kept and reused. Stem "reus" matches reuse/reuses/reused/
      // reusing/reusable; "borrow"/"pool of" are the same idea phrased differently. (The earlier
      // literal "reuse" list false-failed an answer that said "a reusable set ... reusing them".)
      ["reus", "pool of", "borrow"],
      ["connection", "connections"],
      ["handshake", "overhead", "latency", "establish", "expensive"],
    ],
  },
  {
    id: "index-scan",
    kind: "prose",
    prompt:
      "Explain when a SQL database uses an index versus a full table scan.",
    keywordsAnyGroups: [
      ["index", "indexed"],
      ["selective", "selectivity", "cardinality", "few rows", "small fraction", "small percentage"],
      ["scan", "full table", "sequential"],
    ],
  },
];

// Common base for every arm. The chat/no-plan instruction keeps the headless `claude` agent
// from entering plan mode or writing files (which would put a meta-summary in .result instead
// of the actual answer). It is identical across all three arms, so it cannot bias the
// between-arm comparison.
export const BASE =
  "You are a helpful senior software engineer answering a colleague's question in chat. " +
  "Output your complete answer as a single message, putting any code in a fenced code block. " +
  "Do NOT use tools, do NOT write files, do NOT enter plan mode or save a plan, just type the answer.";

export const ARMS = {
  baseline: BASE,
  terse: `${BASE}\n\nAnswer concisely.`,
  // The two skills flint draws from, run verbatim from vendored SKILL.md (see skills/SOURCES.md) so
  // the README can answer "why flint instead of just caveman / just ponytail?" with numbers. null
  // here; run.mjs builds them (externalSkillBody) like the flint arms below.
  caveman: null,
  ponytail: null,
  // The flint arms = BASE + the live SKILL.md body (+ an intensity directive for lite/ultra).
  // run.mjs builds them (see flintBody) so they always reflect the current skill; these are null
  // on purpose, only the keys drive the arm list. `flint` is the default (full) intensity.
  "flint-lite": null,
  flint: null,
  "flint-ultra": null,
  "flint-feral": null, // experimental: max compression + code golf, guardrails off. not for production.
};
