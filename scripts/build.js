import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const targets = [
  ".opencode/skills/ai-code-tracker/scripts/bundle.js",
  ".claude/skills/ai-code-tracker/scripts/bundle.js",
];

const repoRoot = path.resolve(import.meta.dirname, "..");

const result = await esbuild.build({
  entryPoints: [path.join(repoRoot, "src/index.js")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  write: false,
  minify: false,
});

const code = result.outputFiles[0].text;
for (const target of targets) {
  const dest = path.join(repoRoot, target);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, code, "utf8");
}
console.log(`bundle written to ${targets.length} targets`);
