---
description: Repair AI code tracker installation
---

Repair the AI code tracker installation:

!`node .opencode/skills/ai-code-tracker/scripts/install.js --repair`

Then run the preflight check:

!`node .opencode/skills/ai-code-tracker/scripts/install.js --check`

Report the results to the user. If the repair succeeded, remind them to restart the current opencode session so the project plugin loads.
