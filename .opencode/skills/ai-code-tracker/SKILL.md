---
name: ai-code-tracker
description: Use when preparing to modify code in this opencode project, or when the user wants to install, enable, repair, or inspect AI code contribution tracking in this git repository.
---

# AI Code Tracker

Run this skill before modifying code in this repository.

## Preflight

Check whether tracking is installed and healthy:

```bash
node .opencode/skills/ai-code-tracker/scripts/install.js --check
```

If preflight reports missing or broken tracking, ask the user whether to install or repair it before modifying code.

If the user confirms, run:

```bash
node .opencode/skills/ai-code-tracker/scripts/install.js
```

For broken installs, run:

```bash
node .opencode/skills/ai-code-tracker/scripts/install.js --repair
```

After install or repair, rerun preflight. Continue with the original code task only after preflight passes.

If install or repair changed `.opencode/plugins/ai-code-tracker.js`, tell the user to restart the current opencode session before expecting edit tracking to work. opencode loads project plugins at startup, so a session that was already running before installation may not generate `.ai-tracking/pending-lines.json`.

If this skill directory has just been copied into a project, this is enough. The install script self-registers the project plugin, git hooks, `.ai-tracking/` files, and `AGENTS.md` rule from inside `.opencode/skills/ai-code-tracker/`.

## View Stats

```bash
node .opencode/skills/ai-code-tracker/scripts/ai-code-stats.js --last 10
```

## Recovery

If tracking fails because a temporary file or `.lock` file is blocked, read:

```bash
cat .ai-tracking/errors.log
```

Tell the user which file is blocking tracking. After the user releases the file lock or deletes a stale `.ai-tracking/*.lock` / `*.tmp` file that no tracker process is using, retry the same opencode edit, `git commit`, or `git push` action. The tracker regenerates the pending data, CSV record, or push archive on the next successful retry.

## AI-created Commits

If opencode creates a user-requested commit, mark that commit as AI-created:

```bash
AI_CODE_TRACKER_AI_COMMIT=1 git commit -m "message"
```

Do not set this variable for commits the user creates directly in their own terminal.

## Notes

- This is project-local only. Do not write to global opencode config or global command directories.
- To use in another project, copy this directory to `.opencode/skills/ai-code-tracker/`, then ask opencode to use `ai-code-tracker`.
- `is_ai_commit` means the commit command was executed by AI for the user, not that the code was AI-generated.
- CSV files are pruned on tracker runs so records for commits no longer reachable from `HEAD` after reset are removed.
- Before `git push`, pending tracking files are archived under `.ai-tracking/archive/` and removed from active tracking so old AI lines do not affect the next editing session.
- Temporary file and lock failures are logged to `.ai-tracking/errors.log`; the log is ignored by git and the failed operation can be retried after the lock is cleared.
- AI line tracking is an estimate based on line-content matching, not perfect authorship attribution.
- See `references/design.md` for details.
