# AGENTS.md — working with this repo

Rules for any AI agent producing commands for this project. Written from a real
session in which seven field-name bugs shipped because the agent wrote code
against field names it had *assumed* rather than *read*.

---

## The environment

- macOS, zsh, VS Code, repo already cloned.
- `gh` CLI installed and **already authenticated** — never emit `gh auth login`.
- `npm`, `node`, `python3` available. No internet inside any sandbox you use.
- The human runs every command by hand and pastes the output back. You cannot
  see the machine, the filesystem, the browser, or the running app.

Never claim to have "reviewed the repo" or "verified" anything you have not been
shown output for.

---

## Editor environment

The installed extensions change what commands are safe to emit. These are the
ones that matter; the rest (Go, Dart, C++, .NET, Vue) belong to other projects.

**Prettier + ESLint are installed.** If format-on-save is enabled, saved files
may be reformatted the moment they are touched — which silently invalidates the
exact-text anchors in a `sed` or `python3` patch written against an earlier read.
Two consequences:

- Anchor on the shortest unique string, not a multi-line block with its own
  indentation.
- If a patch asserts and fails on text you were just shown, suspect a reformat
  before suspecting the human.

**markdownlint is installed.** ADRs, `README.md`, and this file are linted.
Generated markdown should keep lines reasonable and use consistent heading
levels, or the human gets a wall of warnings on a file you wrote.

**Rainbow CSV and Excel Viewer are installed.** `data/exercises/*.csv` and any
generated `.xlsx` can be read in the editor directly. Prefer "open this file and
look at column N" over piping a 300-row CSV through the clipboard. Rainbow CSV
also has a query command, so a column tally can be done in-editor rather than
via a `node -e` one-liner.

**live-server is installed and is a trap.** It serves static files. This project
is a Vite PWA — `npm run dev` for development, `npx vite preview` after
`npm run build` for anything touching the service worker. Never suggest
live-server; it will not register the SW and offline behaviour cannot be tested
through it.

**GitHub Actions and YAML extensions are installed**, so `.github/workflows/*`
is editable in-editor with schema validation. Still verify a run with
`gh run list`, not by reading the YAML.

**Python + Pylance are installed** — relevant only to `tools/build_seed.py`,
which is the one Python file that ships.

**Claude Code and the ChatGPT extension are both installed.** These conventions
apply to whichever is producing commands.

---

## The one rule that matters

**Read the real shape before writing code against it.**

Never infer a field name, a JSON key, a function signature, or a file path from
context, from a similar project, or from what a name *should* be. Ask for a dump
first. It costs one round trip; guessing costs four.

```bash
# Right: read the emitted object, then write against it
node -e 'import("./js/engine/defs.js").then(async ({ defs }) => {
  const { generate } = await import("./js/engine/index.js");
  console.log(JSON.stringify(generate(req, defs).weeks[0].sessions[0], null, 2));
});'
```

If the human offers a zip of the relevant files, take it before proposing a
patch. A truncated file in your context is not a read file.

`js/engine/SPEC.md` is the authoritative shape contract for `Program`,
`Session`, `Block`, and `SetGroup`. Read it before touching the UI.

---

## Command format

**One chained block per turn.** Everything gated with `&&` so a failure stops the
chain. Never put a destructive or state-changing step on its own line after a
validation step — it will run even when validation fails.

```bash
# Wrong — closes the issue even if the gate fails
npm run check && npm run build
gh issue close 22

# Right
npm run check && npm run build && gh issue close 22 --comment "..."
```

**Always pipe diagnostic output through `tee` and `pbcopy`.** The human pastes
clipboard contents back; a long unpiped dump is unusable.

```bash
cd "$(git rev-parse --show-toplevel)" &&
{
  echo "=== SECTION ==="
  some-command
  echo "=== NEXT ==="
  other-command
} 2>&1 | tee /tmp/descriptive-name.txt | pbcopy
```

**Filter noisy commands.** `npm test` emits hundreds of TAP lines. Ask for the
summary, or the failure, never both in full.

```bash
npm run check 2>&1 | grep -E 'PASS|FAIL|validators,|# (tests|pass|fail) |not ok'
```

**Anchor paths to the repo root.** The human may be in any subdirectory.

```bash
repo="$(git rev-parse --show-toplevel)" || exit 1
cd "$repo"
```

---

## Editing files

### Small, surgical edits — `sed` with a line number

```bash
sed -i '' '352s/group\.needsWarmup/group.warmupRequired/' js/ui/app.js
```

Note the empty `''` after `-i` — BSD sed on macOS requires it.

### Multi-edit patches — `python3` heredoc **with asserts**

Every replacement must assert it applied. A patch that silently does nothing is
worse than one that fails, because the human will report a confusing symptom
three turns later.

```bash
python3 - <<'PY'
p = 'js/ui/app.js'
s = open(p).read(); before = s
s = s.replace("old exact text", "new text")
assert s != before, "APP: target not found — inspect lines 340-360"
open(p, 'w').write(s)
print("patched")          # absence of this line means it did not run
PY
```

Tell the human: **if the patch prints nothing, treat it as unapplied.**

When one heredoc edits several files, assert and write each file before moving
to the next. A tripped assert halfway through otherwise leaves the later files
untouched while the earlier ones are already saved.

### Never do

- Rewrite a whole file when a targeted patch would do. A 600-line diff is
  unreviewable and hides regressions inside "formatting churn."
- Emit a file to Downloads and describe it as installed. Give the `mv` command.
- Claim a file was created without actually producing it.

---

## Verifying your own work

After any patch, verify three things in one block: **residual**, **gate**,
**behaviour**.

```bash
cd "$(git rev-parse --show-toplevel)" &&
{
  echo "=== RESIDUAL (expect none) ==="
  grep -n 'oldFieldName' js/ui/app.js || echo "none"

  echo "=== GATE ==="
  npm run check 2>&1 | grep -E 'validators,|# (pass|fail) '

  echo "=== BEHAVIOUR ==="
  node -e '/* generate something and print it */'
} 2>&1 | tee /tmp/verify.txt | pbcopy
```

A green gate proves internal consistency, **not** that the change did what it
claimed. Always include a behavioural check that prints real output.

---

## GitHub via `gh`

Authenticated already. Prefer the API over title-matching — `--milestone "Some
Title"` resolves by string and fails on em-dashes and renames.

```bash
# Robust: numeric milestone id through the API
gh api --method PATCH "repos/{owner}/{repo}/issues/37" -F milestone=7

# Idempotent issue creation: reuse if the exact title exists
number="$(gh api --paginate "repos/$repo/issues?state=all&per_page=100" \
  --jq ".[] | select(.pull_request == null and .title == \"$title\") | .number" | head -n1)"
```

Scripts that create or edit issues must be **safe to re-run**. Assume the human
will run them twice.

Beware: `gh issue list --milestone` can lag a just-created issue. Verify with
`gh issue view N --json milestone` rather than assuming the write failed.

---

## Commit messages

Explain **why**, and name what broke. The repo's history is a record of
decisions, not a changelog.

```
fix(ui): read prescription fields the engine actually emits

The rewrite invented `group.prescription` and `needsWarmup`. The engine emits
neither — prescription fields sit flat on the setGroup, and the flag is
`warmupRequired`. Every read resolved to undefined, so the badge rendered on
nothing and sets/reps edits wrote into a phantom object.

82 tests passed throughout, because nothing crossed the engine/UI boundary.
```

State known limitations in the message rather than omitting them.

---

## Project-specific invariants

- **Data holds values, code holds shapes** (ADR-012). Never put control flow,
  gates, or validators into JSON.
- **ADRs are immutable once ACCEPTED.** To change a decision, write a new ADR
  that supersedes or refines it. Add it to *both* tables in `docs/adr/README.md`.
- **`js/data/exercises.seed.json` is generated.** Edit `data/exercises/*.csv`
  and run `npm run build:seed`.
- **Gate before committing:** `npm run check && npm run build`.
- **Determinism (ADR-002):** the same seed must produce byte-identical output.
  Any change to selection needs a before/after comparison across styles and
  profiles proving unrelated output is unchanged.
- **Fail closed.** An unknown safety gate throws; it never permits.
- **Offline is a hard requirement (ADR-001)** and cannot be tested with
  `npm run dev` or live-server. Only a real build — `vite preview` or the
  deployed Pages site — registers the service worker.

---

## Reporting findings

When a check reveals a problem:

1. State what is broken, in one line, before any explanation.
2. Separate *your* bugs from pre-existing ones, explicitly.
3. Correct your own earlier numbers when they turn out wrong — say so plainly
   rather than quietly restating.
4. Recommend one option and give the tradeoff in a sentence. Do not present a
   menu of five.

Do not pad. The human is reading this between other work.
