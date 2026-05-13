import fs from "node:fs/promises";
import { configPath } from "./paths.js";

export function addedLines(before, after) {
  const remaining = new Map();
  for (const line of String(before).split(/\r?\n/)) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  const added = [];
  for (const line of String(after).split(/\r?\n/)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
    } else {
      added.push(line);
    }
  }
  return added;
}

export async function loadConfig(repoRoot) {
  try {
    return JSON.parse(await fs.readFile(configPath(repoRoot), "utf8"));
  } catch {
    return { enabled: false };
  }
}

export function shouldIgnore(filePath, patterns) {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return filePath.startsWith(pattern.slice(0, -3));
    return filePath === pattern;
  });
}

export async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
