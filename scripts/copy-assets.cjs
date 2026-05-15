// Copies the trainer system-prompt markdown next to the compiled JS so claude.ts
// can readFileSync it at runtime. Fails loudly so a silent build miss doesn't
// ship a bot with no system prompt.
const fs = require("fs");
const path = require("path");

const SUBDIRS = ["prompts"];

let total = 0;
for (const sub of SUBDIRS) {
  const srcDir = path.join("src", sub);
  const distDir = path.join("dist", sub);
  if (!fs.existsSync(srcDir)) {
    console.error(`[copy-assets] FAIL: missing source dir ${srcDir}`);
    process.exit(1);
  }
  fs.mkdirSync(distDir, { recursive: true });
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    console.error(`[copy-assets] FAIL: no .md files in ${srcDir}`);
    process.exit(1);
  }
  for (const f of files) {
    const from = path.join(srcDir, f);
    const to = path.join(distDir, f);
    fs.copyFileSync(from, to);
    console.log(`[copy-assets] ${from} -> ${to}`);
    total++;
  }
}

console.log(`[copy-assets] OK — copied ${total} file(s)`);
