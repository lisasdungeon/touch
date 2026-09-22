/** Build a public Foundry module ZIP from the explicit production file list. */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const output = process.argv[2] ? resolve(process.argv[2]) : null;
if (!output) throw new Error("Usage: node tools/package-release.mjs /absolute/path/to/touch.zip");
if (existsSync(output)) throw new Error(`Refusing to overwrite existing release artifact: ${output}`);

const root = resolve(import.meta.dirname, "..");
const moduleRoot = resolve(root, "touch");
const files = [
  "module.json", "CHANGELOG.md", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md",
  "lang", "scripts", "styles", "templates", "vendor",
];

for (const entry of files) {
  if (!existsSync(resolve(moduleRoot, entry))) throw new Error(`Missing release input: ${entry}`);
}

mkdirSync(dirname(output), { recursive: true });
execFileSync("zip", ["-X", "-q", "-r", output, ...files], { cwd: moduleRoot, stdio: "inherit" });
