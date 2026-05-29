import { PrismaClient } from "@prisma/client";
import { mulberry32 } from "../lib/forecast/rng";
import { SUPPLIER_SEED } from "../lib/forecast/rng-constants";
const prisma = new PrismaClient();

type SupplierSeed = {
  name: string;
  country: string;
  currency: string;
  leadTimeAvgDays: number;
  leadTimeStdDays: number;
  moq: number;
  notes: string;
  // Which vendor names / product types this supplier covers (used to auto-assign products).
  matchVendor?: string[];
  matchType?: string[];
  share?: number; // fallback share of unassigned products
};

const SUPPLIERS: SupplierSeed[] = [
  {
    name: "Guangzhou Beauty Imports",
    country: "China",
    currency: "USD",
    leadTimeAvgDays: 45,
    leadTimeStdDays: 12,
    moq: 100,
    notes: "Sea freight via Mombasa. Strong on K-beauty and budget skincare.",
    matchVendor: ["COSRX", "ANUA", "LANEIGE", "FRUDIA", "NINELESS", "JOANNA K"],
    matchType: [],
  },
  {
    name: "Dubai Cosmetics House",
    country: "UAE",
    currency: "AED",
    leadTimeAvgDays: 14,
    leadTimeStdDays: 4,
    moq: 50,
    notes: "Air freight from Dubai. Premium fragrance + mid-market makeup.",
    matchVendor: ["FENTY", "HUDA BEAUTY", "MAYBELLINE", "NYX"],
    matchType: ["FRAGRANCE"],
  },
  {
    name: "Nairobi Trade Centre",
    country: "Kenya",
    currency: "KES",
    leadTimeAvgDays: 5,
    leadTimeStdDays: 2,
    moq: 6,
    notes: "Local wholesale. Fast restock, slightly higher per-unit cost.",
    matchVendor: ["NIVEA", "DOVE", "EOS", "MANDEVU", "ADITA", "BIORE"],
    matchType: [],
  },
  {
    name: "Eastleigh Distributors",
    country: "Kenya",
    currency: "KES",
    leadTimeAvgDays: 7,
    leadTimeStdDays: 3,
    moq: 12,
    notes: "Eastleigh-based importers, mixed inventory, flexible MOQ.",
    matchVendor: ["BONDI SANDS", "GOOD MOLECULES", "THE ORDINARY"],
    matchType: ["LIP CARE", "BODY"],
  },
  {
    name: "EU Beauty Direct",
    country: "France",
    currency: "EUR",
    leadTimeAvgDays: 28,
    leadTimeStdDays: 7,
    moq: 30,
    notes: "European brands shipped via airfreight Paris-Nairobi.",
    matchVendor: ["LANEIGE"],
    matchType: [],
  },
  {
    name: "Mombasa Sea Freight",
    country: "China",
    currency: "USD",
    leadTimeAvgDays: 55,
    leadTimeStdDays: 15,
    moq: 200,
    notes: "Slowest but cheapest. Used for high-volume staples only.",
    matchVendor: [],
    matchType: ["HAIRCARE", "BODY"],
    share: 0.2,
  },
];

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) throw new Error("No tenant — seed catalog first");

  // Deterministic round-robin per SUPPLIER_SEED.
  const rng = mulberry32(SUPPLIER_SEED);

  console.log(`Seeding suppliers for tenant ${tenant.id}`);

  // Reset suppliers + clear product.supplierId so reseeding is idempotent
  await prisma.product.updateMany({ where: { tenantId: tenant.id }, data: { supplierId: null } });
  await prisma.supplier.deleteMany({ where: { tenantId: tenant.id } });

  const created: { id: string; seed: SupplierSeed }[] = [];
  for (const s of SUPPLIERS) {
    const supplier = await prisma.supplier.create({
      data: {
        tenantId: tenant.id,
        name: s.name,
        country: s.country,
        currency: s.currency,
        leadTimeAvgDays: s.leadTimeAvgDays,
        leadTimeStdDays: s.leadTimeStdDays,
        moq: s.moq,
        notes: s.notes,
      },
    });
    created.push({ id: supplier.id, seed: s });
    console.log(`  + ${s.name} (${s.country}, ${s.leadTimeAvgDays}d ± ${s.leadTimeStdDays}d)`);
  }

  // Assign suppliers to products based on vendor + product_type matching.
  const products = await prisma.product.findMany({ where: { tenantId: tenant.id } });
  let assigned = 0;

  for (const p of products) {
    const vendor = (p.vendor || "").toUpperCase();
    const type = (p.productType || "").toUpperCase();

    let match = created.find(s =>
      s.seed.matchVendor?.some(v => vendor.includes(v.toUpperCase()))
    );
    if (!match) {
      match = created.find(s =>
        s.seed.matchType?.some(t => type.includes(t.toUpperCase()))
      );
    }
    // Fallback: round-robin across suppliers with share-based weighting
    if (!match) {
      const fallbacks = created.filter(s => (s.seed.share ?? 0) > 0);
      const r = rng();
      let acc = 0;
      for (const f of fallbacks) {
        acc += f.seed.share ?? 0;
        if (r < acc) { match = f; break; }
      }
      if (!match) {
        // Default: cheapest local supplier (Nairobi Trade Centre)
        match = created.find(s => s.seed.name === "Nairobi Trade Centre");
      }
    }

    if (match) {
      await prisma.product.update({ where: { id: p.id }, data: { supplierId: match.id } });
      assigned++;
    }
  }

  console.log(`Assigned ${assigned} / ${products.length} products to suppliers.`);

  const breakdown = await prisma.product.groupBy({
    by: ["supplierId"],
    where: { tenantId: tenant.id },
    _count: true,
  });
  console.log("Breakdown by supplier:");
  for (const b of breakdown) {
    const sup = created.find(s => s.id === b.supplierId);
    console.log(`  ${sup?.seed.name ?? "unassigned"}: ${b._count}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
