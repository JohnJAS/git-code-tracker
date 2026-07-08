import fs from "node:fs/promises";
import path from "node:path";

const targets = [
  ".opencode/skills/ai-code-tracker/lib",
  ".claude/skills/ai-code-tracker/lib",
  ".cac/skills/ai-code-tracker/lib",
];

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(repoRoot, "src");

for (const target of targets) {
  const dest = path.join(repoRoot, target);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(srcDir, dest, { recursive: true });
}
console.log(`src/ copied to ${targets.length} targets`);
