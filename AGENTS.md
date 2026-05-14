## AI Code Tracker

Before modifying code in this repository, load the opencode skill `ai-code-tracker` and run its preflight check. If tracking is not installed or is broken, ask the user whether to install or repair it. If the user confirms, run the project-level install or repair script automatically, rerun preflight, and continue with code changes only after preflight passes.

After installing or repairing ai-code-tracker, tell the user to restart the current opencode session because project plugins are loaded at opencode startup.

If you create a user-requested commit from opencode, you MUST mark it as AI-created by running `AI_CODE_TRACKER_AI_COMMIT=1 git commit ...`. Do not set this variable for commits the user creates directly in their own terminal.
