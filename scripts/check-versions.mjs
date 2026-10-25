import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (file) => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const expected = JSON.parse(read("manifest.json")).version;
assert.equal(vm.runInNewContext(read("lib/call.js") + "\nversion()"), expected, "QML version differs from manifest");
assert.equal(JSON.parse(read("package.json")).version, expected, "Package version differs from manifest");
const lock = JSON.parse(read("package-lock.json"));
assert.equal(lock.version, expected, "Lock version differs from manifest");
assert.equal(lock.packages[""].version, expected, "Locked package version differs from manifest");
