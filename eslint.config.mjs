import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/release/**",
      "scripts/**/*.ts",
      "apps/desktop/vite.config.ts",
      "**/*.test.ts",
      "vitest.config.ts",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        allowDefaultProject: ["scripts/**/*.ts", "vitest.config.ts"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    rules: { "no-console": "off" },
  },
];
