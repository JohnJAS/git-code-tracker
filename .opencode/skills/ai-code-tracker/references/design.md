# AI Code Tracker Design Reference

## Purpose

Track AI-added lines and whether commits were created by AI in an opencode project by combining:

- A project-local opencode plugin that records AI edit additions.
- Git hooks that summarize staged additions at commit time.
- CSV records committed back to the repository in a separate `[ai-tracking]` commit.

## Project-Local Layout

```text
.opencode/
├── skills/
│   └── ai-code-tracker/
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
└── plugins/
    └── ai-code-tracker.js

.ai-tracking/
├── config.json
├── pending-lines.json
├── pending-commit.json
├── tracking-message.txt
├── errors.log
├── archive/
└── <author>.csv
```

## Runtime Flow

Before code changes, `AGENTS.md` requires opencode to load this skill and run preflight. If tracking is missing or broken, the agent asks the user whether to install or repair it. After confirmation, the installer runs, preflight is repeated, and the original task continues only if checks pass.

For a new repository, the user can copy only this skill directory into:

```text
.opencode/skills/ai-code-tracker/
```

Then the user can ask opencode to use `ai-code-tracker`. The skill preflight will detect that `.opencode/plugins/`, `.ai-tracking/`, and git hooks are missing, ask for permission, and self-install from the copied skill directory.

After first install or plugin repair, the agent must tell the user to restart the current opencode session. The git hooks are active immediately, but the project plugin is loaded only when opencode starts.

During opencode edits, `.opencode/plugins/ai-code-tracker.js` records added nonblank text lines into `.ai-tracking/pending-lines.json`.

During `git commit`, pre-commit parses staged additions and matches them against pending AI lines. It writes `.ai-tracking/pending-commit.json` without staging CSV files. Commits created from an opencode process tree are marked `is_ai_commit=true`; opencode should also set `AI_CODE_TRACKER_AI_COMMIT=1` when it creates a user-requested commit as an explicit fallback.

After the user commit succeeds, post-commit appends a CSV record and creates a separate tracking commit. The tracking commit reuses the original full commit message and appends `[ai-tracking]` to the first line. CSV records are pruned on tracker runs so entries for commits no longer reachable from `HEAD` after reset are removed.

Before `git push`, pre-push archives active pending files into `.ai-tracking/archive/<timestamp>/` and removes the active pending files. This prevents stale pending AI lines from affecting the next editing session after a push.

If a lock file or temporary file blocks tracking, the failed operation writes `.ai-tracking/errors.log` with the operation name, path, error, and recovery instruction. After the user releases the lock or removes a stale `.ai-tracking/*.lock` / `*.tmp` file that no tracker process is using, retrying the same opencode edit, `git commit`, or `git push` regenerates the corresponding pending lines, CSV update, or archive.

## Safety Rules

- Never install globally.
- Never amend user commits.
- Mark AI-created user commits with `AI_CODE_TRACKER_AI_COMMIT=1 git commit ...`; process-tree detection is also used as a fallback.
- Set `AI_CODE_TRACKER_SKIP=1` and `AI_CODE_TRACKER_DEPTH=1` for automatic tracking commits.
- Before creating the tracking commit, verify the staged area contains only `.ai-tracking/` changes.
- Archive pending files before push; `.ai-tracking/archive/` is ignored by git.
- Use lock files and atomic writes for pending JSON files; write actionable diagnostics to `.ai-tracking/errors.log` when lock or temp-file operations fail.

## Limitations

This is an estimate. Formatting, manual edits, duplicated lines, or generated code that matches existing lines can affect attribution.
