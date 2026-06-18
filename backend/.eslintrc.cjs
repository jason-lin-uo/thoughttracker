/**
 * ESLint config for the backend (Node + TypeScript).
 *
 * Goal: catch real bugs (unused vars, missing await, floating promises,
 * type-only imports, switch fallthrough). NOT used as a style enforcer
 * (prettier covers that).
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    project: ["./tsconfig.eslint.json"],
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "prettier",
  ],
  ignorePatterns: ["dist/", "node_modules/", "coverage/", "*.cjs"],
  rules: {
    /* Disabled — too noisy on a legit codebase */
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-misused-promises": [
      "error",
      { checksVoidReturn: false },
    ],

    /* Real bugs */
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-for-in-array": "error",
    "@typescript-eslint/require-await": "off",
    "no-fallthrough": "error",
    "no-constant-condition": ["error", { checkLoops: false }],
    "no-empty": ["error", { allowEmptyCatch: true }],

    /* Style nits we DO want */
    "no-console": ["warn", { allow: ["warn", "error"] }],
    eqeqeq: ["error", "always", { null: "ignore" }],
  },
  overrides: [
    {
      files: ["tests/**/*.ts", "scripts/**/*.ts", "prisma/**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
        "no-console": "off",
      },
    },
  ],
};
