/**
 * ESLint config for the frontend (React + TypeScript + Tailwind via Vite).
 *
 * Notable choices:
 *   - jsx-a11y catches the kind of bugs the audit found (label without
 *     control, button without text, click-handler on a non-interactive el).
 *   - react-refresh keeps Fast Refresh boundaries clean (no mixed
 *     component/util exports in the same file).
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  settings: { react: { version: "detect" } },
  plugins: [
    "@typescript-eslint",
    "react",
    "react-hooks",
    "react-refresh",
    "jsx-a11y",
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
    "prettier",
  ],
  ignorePatterns: [
    "dist/",
    "node_modules/",
    "coverage/",
    "*.cjs",
    "playwright-report/",
    "test-results/",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "react/prop-types": "off",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],

    /* Accessibility — the audit found these the hard way */
    "jsx-a11y/label-has-associated-control": [
      "error",
      { assert: "either", depth: 3 },
    ],
    "jsx-a11y/no-autofocus": "warn",

    /* Real bugs */
    "no-empty": ["error", { allowEmptyCatch: true }],
    eqeqeq: ["error", "always", { null: "ignore" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
  overrides: [
    {
      files: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
        "no-console": "off",
      },
    },
  ],
};
