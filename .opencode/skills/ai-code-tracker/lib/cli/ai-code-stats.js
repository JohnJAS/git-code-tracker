#!/usr/bin/env node
import { git, gitRepoRoot } from "../tracker/git.js";
import { pruneStaleRecords, readRecords } from "../tracker/csv.js";
import { logInfo, startTimer } from "../tracker/logger.js";

export async function runAiCodeStats(args = process.argv.slice(2), options = {}) {
  const timer = startTimer();
  const repoRoot = options.repoRoot ?? await gitRepoRoot(options.cwd ?? process.cwd());
  const gitImpl = options.git ?? git;

  await logInfo(repoRoot, "ai-code-stats", "enter");

  await pruneCsvRecordsIfPossible(repoRoot, gitImpl);
  const filters = parseArgs(args);
  let records = await readRecords(repoRoot);

  if (filters.author) records = records.filter((record) => record.author === filters.author);
  if (filters.since) records = records.filter((record) => record.date >= filters.since);

  const totalLines = sum(records, "total_lines");
  const aiLines = sum(records, "ai_lines");
  const ratio = totalLines === 0 ? 0 : (aiLines / totalLines) * 100;
  const aiCodeCommits = records.filter((record) => record.ai_lines > 0).length;
  const aiGeneratedCommits = records.filter((record) => record.is_ai_commit).length;

  const recent = [...records]
    .sort((a, b) => `${b.date}:${b.commit_id}`.localeCompare(`${a.date}:${a.commit_id}`))
    .slice(0, filters.last);

  const output = formatSummary({
    totalLines,
    aiLines,
    ratio,
    aiCodeCommits,
    aiGeneratedCommits,
    trackedCommits: records.length,
    recent,
  });

  await logInfo(repoRoot, "ai-code-stats", "complete", {
    trackedCommits: records.length,
    totalLines,
    aiLines,
    ratio: `${ratio.toFixed(1)}%`,
    durationMs: timer.elapsedMs(),
  });

  if (!options.silent) console.log(output);
  return { totalLines, aiLines, ratio, aiCodeCommits, aiGeneratedCommits, trackedCommits: records.length, recent, output };
}

function parseArgs(args) {
  const filters = { last: 10 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--author") filters.author = args[++i];
    else if (arg === "--since") filters.since = args[++i];
    else if (arg === "--last") filters.last = Number(args[++i] || 10);
  }
  return filters;
}

function formatSummary({ totalLines, aiLines, ratio, aiCodeCommits, aiGeneratedCommits, trackedCommits, recent }) {
  const lines = [
    "AI Code Stats",
    "",
    `Total added lines: ${totalLines}`,
    `AI added lines: ${aiLines}`,
    `AI ratio: ${ratio.toFixed(1)}%`,
    `AI-code commits: ${aiCodeCommits}`,
    `AI-generated commits: ${aiGeneratedCommits}`,
    `Tracked commits: ${trackedCommits}`,
  ];

  if (recent.length > 0) {
    lines.push("", "Recent tracked commits:");
    for (const record of recent) {
      lines.push(`${record.date}  ${record.author}  ${record.ai_lines}/${record.total_lines}  ${record.commit_id.slice(0, 7)}  ${record.message}`);
    }
  }

  return lines.join("\n");
}

function sum(records, key) {
  return records.reduce((total, record) => total + Number(record[key] || 0), 0);
}

async function pruneCsvRecordsIfPossible(repoRoot, gitImpl) {
  try {
    await gitImpl(["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
    await pruneStaleRecords(repoRoot, async (commitId) => {
      try {
        await gitImpl(["merge-base", "--is-ancestor", commitId, "HEAD"], { cwd: repoRoot });
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    // Stats should remain readable even if pruning cannot inspect git history.
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAiCodeStats().catch((error) => {
    console.error(`[ai-code-tracker] ${error.message}`);
    process.exitCode = 1;
  });
}
