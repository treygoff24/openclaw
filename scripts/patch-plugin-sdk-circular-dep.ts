/**
 * Post-build patch: fix circular dependency in dist/plugin-sdk/
 *
 * The bundler (tsdown/rolldown) generates a circular import between
 * dist/plugin-sdk/pi-model-discovery-*.js and dist/plugin-sdk/index.js:
 *
 *   index.js (line 1): import "./pi-model-discovery-*.js"
 *   pi-model-discovery-*.js: import { t as __exportAll } from "./index.js"
 *
 * This works in native ESM (live bindings) but breaks when jiti loads
 * plugins via CJS interop — the circular import causes `t` to be undefined.
 *
 * Fix: inline the __exportAll helper directly in pi-model-discovery-*.js
 * so it no longer needs to import from index.js.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginSdkDir = path.join(__dirname, "..", "dist", "plugin-sdk");

const EXPORT_ALL_INLINE = `
// Inlined __exportAll to break circular dependency with index.js (jiti CJS interop fix)
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
\tlet target = {};
\tfor (var name in all) {
\t\t__defProp(target, name, {
\t\t\tget: all[name],
\t\t\tenumerable: true
\t\t});
\t}
\tif (!no_symbols) {
\t\t__defProp(target, Symbol.toStringTag, { value: "Module" });
\t}
\treturn target;
};`.trim();

let patched = 0;

for (const file of fs.readdirSync(pluginSdkDir)) {
  if (!file.startsWith("pi-model-discovery-") || !file.endsWith(".js")) {
    continue;
  }

  const filePath = path.join(pluginSdkDir, file);
  let content = fs.readFileSync(filePath, "utf8");

  // Match: import { t as __exportAll } from "./index.js";
  const circularImport = /^import \{ t as __exportAll \} from "\.\/index\.js";\n/m;
  if (!circularImport.test(content)) {
    continue;
  }

  content = content.replace(circularImport, EXPORT_ALL_INLINE + "\n");
  fs.writeFileSync(filePath, content);
  console.log(`[patch-plugin-sdk] Patched circular dep in ${file}`);
  patched++;
}

if (patched === 0) {
  console.log("[patch-plugin-sdk] No files needed patching");
} else {
  console.log(`[patch-plugin-sdk] Done (${patched} file(s) patched)`);
}
