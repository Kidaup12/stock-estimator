// Flat-config local plugin (TNT-06 / D-16). Registered in eslint.config.mjs.
// Bans bare prisma.tenant.findFirst/findUnique outright, and prisma.<model>
// .findMany/findFirst/findUnique whose inline `where` literal lacks a `tenantId`
// key. Known limit (Pitfall 5): it cannot follow variables — the two-tenant
// integration test is the real net. This is a fast CI tripwire, not a proof.
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Prisma calls must be tenant-scoped (TNT-06)" },
    schema: [],
  },
  create(context) {
    return {
      "CallExpression[callee.type='MemberExpression']"(node) {
        const prop = node.callee.property?.name;
        if (!["findMany", "findFirst", "findUnique"].includes(prop)) return;

        // is it prisma.<model>.<method>?
        const obj = node.callee.object;
        if (obj?.type !== "MemberExpression") return;
        const root = obj.object;
        if (root?.type !== "Identifier" || root.name !== "prisma") return;
        const model = obj.property?.name;

        // Ban any prisma.tenant.findFirst/findUnique outright (the landmine).
        if (model === "tenant" && (prop === "findFirst" || prop === "findUnique")) {
          context.report({
            node,
            message:
              "Resolve tenants via requireTenant() — bare prisma.tenant lookup is banned (TNT-06).",
          });
          return;
        }

        // For other models: require an inline where with tenantId.
        const arg = node.arguments[0];
        const where = arg?.properties?.find((p) => p.key?.name === "where");
        const hasTenantId = where?.value?.properties?.some(
          (p) => p.key?.name === "tenantId"
        );
        if (!hasTenantId) {
          context.report({
            node,
            message: `prisma.${model}.${prop}() must filter by tenantId (TNT-06).`,
          });
        }
      },
    };
  },
};

export default { rules: { "require-tenant-scope": rule } };
