export function buildPendingCommit({
  pendingLines,
  addedLines,
  countBlankLines = false,
  renamedFiles = {},
  missingPendingFiles = [],
}) {
  let totalLines = 0;
  let aiLines = 0;
  const matchedLines = {};
  const pendingPools = buildPendingPools(pendingLines);
  const renameSourcesByTarget = buildRenameSourcesByTarget(renamedFiles);
  const missingPending = new Set(missingPendingFiles);

  for (const [filePath, lines] of Object.entries(addedLines ?? {})) {
    const counted = countBlankLines ? lines : lines.filter((l) => l.trim() !== "");
    totalLines += counted.length;

    for (const line of counted) {
      const sourcePath = findMatchSource({
        pendingPools,
        filePath,
        line,
        renameSources: renameSourcesByTarget[filePath] ?? [],
        missingPending,
      });
      if (!sourcePath) continue;
      aiLines += 1;
      if (!matchedLines[sourcePath]) matchedLines[sourcePath] = [];
      matchedLines[sourcePath].push(line);
    }
  }

  return {
    ai_lines: aiLines,
    total_lines: totalLines,
    matched_lines: matchedLines,
  };
}

function buildPendingPools(pendingLines) {
  const pools = {};
  for (const [filePath, entries] of Object.entries(pendingLines ?? {})) {
    pools[filePath] = entries
      .filter((e) => !e.consumed)
      .map((e) => e.content);
  }
  return pools;
}

function buildRenameSourcesByTarget(renamedFiles) {
  const sourcesByTarget = {};
  for (const [source, target] of Object.entries(renamedFiles ?? {})) {
    if (!sourcesByTarget[target]) sourcesByTarget[target] = [];
    sourcesByTarget[target].push(source);
  }
  return sourcesByTarget;
}

function findMatchSource({ pendingPools, filePath, line, renameSources, missingPending }) {
  if (consumeFromPool(pendingPools[filePath], line)) return filePath;

  for (const source of renameSources) {
    if (consumeFromPool(pendingPools[source], line)) return source;
  }

  for (const source of missingPending) {
    if (source === filePath || renameSources.includes(source)) continue;
    if (consumeFromPool(pendingPools[source], line)) return source;
  }

  return null;
}

function consumeFromPool(pool, line) {
  if (!pool) return false;
  const index = pool.indexOf(line);
  if (index === -1) return false;
  pool.splice(index, 1);
  return true;
}
