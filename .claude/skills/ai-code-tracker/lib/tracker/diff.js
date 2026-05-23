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

export function parseRenamedFilesFromDiff(diffText) {
  const result = {};
  let renameFrom = null;
  let renameTo = null;

  for (const rawLine of String(diffText || "").split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      addRename(result, renameFrom, renameTo);
      renameFrom = null;
      renameTo = null;
      continue;
    }

    if (rawLine.startsWith("rename from ")) {
      renameFrom = rawLine.slice("rename from ".length).trim();
      continue;
    }

    if (rawLine.startsWith("rename to ")) {
      renameTo = rawLine.slice("rename to ".length).trim();
    }
  }

  addRename(result, renameFrom, renameTo);
  return result;
}

function normalizeDiffPath(file) {
  if (file === "/dev/null") return null;
  if (file.startsWith("b/")) return file.slice(2);
  return file;
}

function addRename(result, renameFrom, renameTo) {
  if (!renameFrom || !renameTo) return;
  result[renameFrom] = renameTo;
}
