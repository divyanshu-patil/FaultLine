import globals from "globals";
import { config } from "@faultline/eslint-config/base";

export default [
  ...config,
  { languageOptions: { globals: { ...globals.node } } },
  // vanilla browser scripts served to the client (not part of the TS build)
  { files: ["apps/buggybeans/public/**/*.js"], languageOptions: { globals: { ...globals.browser } } },
  { rules: { "no-useless-assignment": "off" } },
  // apps/web (Next.js/JSX) is gated by tsc (pnpm --filter web check-types) + next build, not eslint;
  // apps/api is Python (ruff/pytest). Neither is linted here.
  { ignores: ["apps/web/**", "apps/api/**", "docs/**", "scripts/*.mjs", "**/.venv/**", "**/dist/**"] },
];
