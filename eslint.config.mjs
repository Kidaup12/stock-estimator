import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tenantSafety from "./eslint-plugin-tenant-safety/index.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // TNT-06 / D-16: tenant-safety rule on real source. Allow-list the sanctioned
  // tenant-resolution layer (requireTenant + webhook resolver), the pre-membership
  // onboarding creation path (W2), and the user-scoped root redirect.
  {
    files: ["app/api/**/*.ts", "app/**/*.tsx", "lib/**/*.ts"],
    ignores: [
      "lib/auth/context.ts",
      "lib/auth/webhook-context.ts",
      "app/api/onboarding/route.ts",
      "app/api/cron/reconcile/route.ts", // cross-tenant system route: deliberately iterates all live connections
      "app/page.tsx",
    ],
    plugins: { "tenant-safety": tenantSafety },
    rules: { "tenant-safety/require-tenant-scope": "error" },
  },

  // Pre-existing UI patterns (load-in-effect + setState) predate any lint gate
  // and are out of scope for the tenant-auth phase. Keep them VISIBLE as warnings
  // (not errors) so the tenant-safety gate isn't blocked by unrelated UI debt.
  {
    files: ["app/**/*.tsx"],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Apply the rule to the deliberately-violating fixture so a targeted
  // `npx eslint eslint-plugin-tenant-safety/fixture-violation.ts` proves it fires.
  {
    files: ["eslint-plugin-tenant-safety/fixture-violation.ts"],
    plugins: { "tenant-safety": tenantSafety },
    rules: { "tenant-safety/require-tenant-scope": "error" },
  },
]);

export default eslintConfig;
