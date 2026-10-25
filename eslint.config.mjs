import js from "@eslint/js";
import globals from "globals";
export default [
    { ignores: ["node_modules/**", ".worktrees/**", "reports/**", "tests/out/**"] },
    js.configs.recommended,
    { files: ["**/*.mjs", "bin/grokbot-voice-daemon"], languageOptions: { globals: globals.node }, rules: {
        "eqeqeq": "error", "no-var": "error", "prefer-const": ["error", { ignoreReadBeforeAssign: true }], "no-unused-vars": ["error", { caughtErrors: "none" }],
    } },
    { files: ["lib/page.mjs"], languageOptions: { globals: globals.browser } },
    { files: ["lib/call.js"], languageOptions: { sourceType: "script" }, rules: { "no-unused-vars": "off" } },
];
