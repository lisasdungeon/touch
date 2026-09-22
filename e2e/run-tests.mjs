/** Run each standalone E2E file in its own process for clean Foundry state. */
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const directory = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(directory))
  .filter((file) => file.endsWith("-test.mjs"))
  .sort();

let failures = 0;
for (const file of files) {
  const status = await new Promise((resolve) => {
    const child = spawn(process.execPath, [join(directory, file)], { stdio: "inherit" });
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (status !== 0) failures++;
}

if (failures) {
  console.error(`${failures} test file${failures === 1 ? "" : "s"} failed.`);
  process.exitCode = 1;
} else {
  console.log(`${files.length} test files passed.`);
}
