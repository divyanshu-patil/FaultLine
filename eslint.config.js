import globals from "globals";
import { config } from "@faultline/eslint-config/base";

export default [
  ...config,
  { languageOptions: { globals: { ...globals.node } } },
  // vanilla browser scripts served to the client (not part of the TS build)
  { files: ["apps/buggybeans/public/**/*.js"], languageOptions: { globals: { ...globals.browser } } },
  { rules: { "no-useless-assignment": "off" } },
  { ignores: ["apps/web/**", "apps/api/**", "docs/**", "scripts/*.mjs", "**/.venv/**"] },
];
