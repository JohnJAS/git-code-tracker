Repair a broken AI code tracker installation. Run the repair script, then verify with a preflight check.

Steps:
1. Run `node .cac/skills/ai-code-tracker/scripts/install.js --repair`
2. Run `node .cac/skills/ai-code-tracker/scripts/install.js --check`
3. Report the results to the user

If the repair succeeded, remind the user to restart the current session so the project plugin loads.
