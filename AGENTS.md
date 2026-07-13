## AI Code Tracker

Before modifying code in this repository, load the matching local agent skill `ai-code-tracker` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current agent session so project integrations are reloaded.

When cherry-picking commits, always use `git cherry-pick -x` to preserve the source commit reference. This allows ai-code-tracker to copy the original AI line statistics into the cherry-picked commit's tracking record.
