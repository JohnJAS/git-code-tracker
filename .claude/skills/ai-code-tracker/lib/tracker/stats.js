export function buildPendingCommit({ pendingLines, addedLines, countBlankLines = false }) {
  let totalLines = 0;
  let aiLines = 0;
  const matchedLines = {};

  for (const [filePath, lines] of Object.entries(addedLines ?? {})) {
    const unconsumed = (pendingLines?.[filePath] ?? [])
      .filter((e) => !e.consumed)
      .map((e) => e.content);
    const counted = countBlankLines ? lines : lines.filter((l) => l.trim() !== "");
    totalLines += counted.length;

    for (const line of counted) {
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
