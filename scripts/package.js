import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = pkg.version;
const name = pkg.name;

console.log(`[package] building...`);
execSync("node scripts/build.js", { cwd: repoRoot, stdio: "inherit" });

const outDir = path.join(repoRoot, "output");
mkdirSync(outDir, { recursive: true });
const zipName = `${name}-v${version}.zip`;
const artifact = path.join(outDir, zipName);

console.log(`[package] creating ${zipName}...`);
execSync(
  `zip -r "${artifact}" .opencode/skills .claude/skills .cac/skills --exclude "*/node_modules/*"`,
  { cwd: repoRoot, stdio: "inherit" }
);

const stats = execSync(`wc -c < "${artifact}"`, { cwd: repoRoot, encoding: "utf8" });
console.log(`[package] done: ${zipName} (${stats.trim()} bytes)`);
