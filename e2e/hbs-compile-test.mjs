/**
 * e2e/hbs-compile-test.mjs — compile-checks every module template with the
 * mock's Handlebars + helper set. Catches template syntax errors the runtime
 * suites only hit on render.
 */
import "./foundry-mock.mjs";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..", "touch", "templates");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".hbs"));
let failed = 0;
for (const f of files) {
  try {
    Handlebars.compile(fs.readFileSync(path.join(dir, f), "utf8"))({});
    console.log(`  PASS  ${f}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${f}: ${err.message}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} templates compile`);
process.exit(failed ? 1 : 0);
