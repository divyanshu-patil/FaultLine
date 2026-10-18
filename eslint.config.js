import globals from "globals";
import { config } from "@faultline/eslint-config/base";

export default [
  ...config,
  { languageOptions: { globals: { ...globals.node } } },
  { ignores: ["apps/web/**", "docs/**"] },
];
