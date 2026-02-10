import fs from "fs";
import path from "path";

const docPath = path.resolve(process.cwd(), "TEST_AGENT_RUNBOOK.md");
const now = new Date();
const stamp = now.toISOString();

const entry = `\n### ${stamp}\n- Changes:\n- Findings:\n- Next actions:\n- Open questions:\n`;

let content = "";
if (fs.existsSync(docPath)) {
  content = fs.readFileSync(docPath, "utf8");
} else {
  content = "# Test Agent Runbook (Treasury Withdrawal)\n\n## Refinement Log Entries\n";
}

if (!content.includes("## Refinement Log Entries")) {
  content += "\n## Refinement Log Entries\n";
}

content += entry;

fs.writeFileSync(docPath, content, "utf8");
console.log(`Appended refinement entry to ${docPath}`);
