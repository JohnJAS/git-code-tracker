export function buildPendingCommit({ pendingLines, addedLines }) {
  let totalLines = 0;
  let aiLines = 0;
  const matchedLines = {};

  for (const [filePath, lines] of Object.entries(addedLines ?? {})) {
    const pendingForFile = [...(pendingLines?.[filePath] ?? [])];
    totalLines += lines.length;

    for (const line of lines) {
      const index = pendingForFile.indexOf(line);
      if (index === -1) continue;
      pendingForFile.splice(index, 1);
      aiLines += 1;
      if (!matchedLines[filePath]) matchedLines[filePath] = [];
      matchedLines[filePath].push(line);
    }
  }

  return {
    ai_lines: aiLines,
    total_lines: totalLines,
    matched_lines: matchedLines,
  };
}
