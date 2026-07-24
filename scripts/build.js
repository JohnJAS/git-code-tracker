import fs from "node:fs/promises";
import path from "node:path";

const targets = [
  ".opencode/skills/ai-code-tracker/lib",
  ".claude/skills/ai-code-tracker/lib",
  ".cac/skills/ai-code-tracker/lib",
];

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(repoRoot, "src");
const packageVersion = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version;
const versionMarker = "__AI_CODE_TRACKER_VERSION__";

if (typeof packageVersion !== "string" || packageVersion.length === 0) {
  throw new Error("package.json must define a release version");
}

for (const target of targets) {
  const dest = path.join(repoRoot, target);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(srcDir, dest, { recursive: true });

  const installerPath = path.join(dest, "cli", "install.js");
  const installer = await fs.readFile(installerPath, "utf8");
  if (!installer.includes(versionMarker)) {
    throw new Error(`version marker missing from ${installerPath}`);
  }
  await fs.writeFile(installerPath, installer.replaceAll(versionMarker, packageVersion), "utf8");
}
console.log(`src/ copied to ${targets.length} targets`);
