export function buildPendingCommit({ pendingLines, addedLines }) {
  let totalLines = 0;
  let aiLines = 0;
  const matchedLines = {};

  for (const [filePath, lines] of Object.entries(addedLines ?? {})) {
    const unconsumed = (pendingLines?.[filePath] ?? [])
      .filter((e) => !e.consumed)
      .map((e) => e.content);
    totalLines += lines.length;

    for (const line of lines) {
      const index = unconsumed.indexOf(line);
      if (index === -1) continue;
      unconsumed.splice(index, 1);
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
