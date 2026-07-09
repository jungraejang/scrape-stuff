/**
 * Master runner for cron/Task Scheduler: prunes outdated rows, then runs
 * every scraper in sequence. A failing step logs its error and the run
 * continues, so one blocked source doesn't stop the others. Exits non-zero
 * if any step failed (visible in Task Scheduler history).
 *
 * Run: npm run scrape:all
 */
import { spawn } from "node:child_process";

const STEPS: [name: string, script: string][] = [
  ["prune", "scripts/prune-stale.ts"],
  ["heykorean", "scripts/scrape.ts"],
  ["zillow", "scripts/scrape-zillow.ts"],
  ["streeteasy", "scripts/scrape-streeteasy.ts"],
  ["craigslist", "scripts/scrape-craigslist.ts"],
  ["facebook", "scripts/scrape-facebook.ts"],
  ["reddit", "scripts/scrape-reddit.ts"],
];

function runStep(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--use-system-ca", "--import", "tsx", script],
      { stdio: "inherit" },
    );
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const results: { name: string; ok: boolean; seconds: number }[] = [];

  for (const [name, script] of STEPS) {
    console.log(`\n===== ${name} =====`);
    const started = Date.now();
    const code = await runStep(script);
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({ name, ok: code === 0, seconds });
    if (code !== 0) console.error(`${name} exited with code ${code}`);
  }

  console.log(`\n===== summary (${new Date().toISOString()}) =====`);
  for (const r of results) {
    console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name} (${r.seconds}s)`);
  }

  const failures = results.filter((r) => !r.ok).length;
  process.exit(failures > 0 ? 1 : 0);
}

main();
