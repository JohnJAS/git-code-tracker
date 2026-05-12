export function parseAddedLinesFromDiff(diffText) {
  const result = {};
  let currentFile = null;

  for (const rawLine of String(diffText || "").split(/\r?\n/)) {
    if (rawLine.startsWith("+++ ")) {
      const file = rawLine.slice(4).trim();
      currentFile = normalizeDiffPath(file);
      continue;
    }

    if (rawLine.startsWith("diff --git ")) {
      currentFile = null;
      continue;
    }

    if (!currentFile) continue;
    if (!rawLine.startsWith("+")) continue;
    if (rawLine.startsWith("+++")) continue;

    const line = rawLine.slice(1);
    if (!result[currentFile]) result[currentFile] = [];
    result[currentFile].push(line);
  }

  return result;
}

function normalizeDiffPath(file) {
  if (file === "/dev/null") return null;
  if (file.startsWith("b/")) return file.slice(2);
  return file;
}
