#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import console from "node:console";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const targetArg = process.argv[2];
if (!targetArg || targetArg.startsWith("-")) {
  console.error("Usage: npm run public:snapshot -- /absolute/path/to/DeskRelay-public");
  process.exit(2);
}

const target = path.resolve(targetArg);
if (target === root || target.startsWith(`${root}${path.sep}`)) {
  console.error("The public snapshot must be outside the source repository.");
  process.exit(2);
}
if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  console.error(`Target directory is not empty: ${target}`);
  process.exit(2);
}

execFileSync(process.execPath, [path.join(root, "scripts/check-public-safety.mjs")], {
  cwd: root,
  stdio: "inherit",
});

const listed = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
).split("\0").filter(Boolean);

fs.mkdirSync(target, { recursive: true });
let copied = 0;
for (const relativePath of listed) {
  const source = path.join(root, relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
  const destination = path.join(target, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
  copied += 1;
}

console.log(`Created privacy-reviewed snapshot with ${copied} files at ${target}`);
console.log("The snapshot contains no .git directory or ignored runtime data.");
console.log("Initialize a new Git repository there; do not copy the source repository's .git directory.");
