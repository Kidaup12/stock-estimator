/**
 * Classify every product's importCategory (LOCAL | KOREAN | WESTERN) from its
 * vendor, using a researched brand map. Mary's policy needs only the bucket:
 *   LOCAL   → quick restock (lead ~7d default, order cover 17d)
 *   KOREAN / WESTERN imports → ETA ~28d, order cover 21d+
 *
 * Heuristics:
 *  - K-beauty brands → KOREAN.
 *  - Import-only Western/prestige brands → WESTERN.
 *  - Mass-market brands with established Kenyan distribution (Nivea, Vaseline,
 *    Garnier…) → LOCAL (they restock from Nairobi distributors, not abroad).
 *  - Unknown vendors → left NULL (treated as LOCAL cover-wise legacy 30d) and
 *    printed for review; Mary fixes via the Products page inline editor.
 *
 * Idempotent: only fills NULL importCategory unless --force.
 * RUN: npx tsx scripts/classify-import-category.ts [--force] [--dry]
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

const KOREAN = [
  "COSRX", "ANUA", "LANEIGE", "FRUDIA", "NINELESS", "SOME BY MI", "BEAUTY OF JOSEON",
  "SKIN1004", "SKIN 1004", "MIXSOON", "ISNTREE", "ROUND LAB", "ROUNDLAB", "MEDICUBE",
  "TIRTIR", "BIODANCE", "MISSHA", "ETUDE", "INNISFREE", "KLAIRS", "DEAR KLAIRS", "IUNIK",
  "PYUNKANG YUL", "HEIMISH", "BENTON", "PURITO", "GOODAL", "MARY&MAY", "MARY & MAY",
  "TOCOBO", "SNP", "JM SOLUTION", "JMSOLUTION", "HOLIKA", "SECRET KEY", "ELIZAVECCA",
  "ESFOLIO", "FARMSTAY", "FARM STAY", "3W CLINIC", "NATURE REPUBLIC", "TONYMOLY",
  "TONY MOLY", "THE FACE SHOP", "AXIS-Y", "AXIS Y", "ABIB", "TORRIDEN", "CELIMAX",
  "DR.G", "DR G ", "NUMBUZIN", "DR JART", "DR.JART", "BANILA", "AHC", "MEDIHEAL",
  "PAPA RECIPE", "BY WISHTREND", "WISHTREND", "KOELF", "PETITFEE", "PETITFÉE",
  "ESTHETIC HOUSE", "EYENLIP", "LEBELAGE", "ENOUGH", "EKEL", "MIZON", "SCINIC",
  "A'PIEU", "APIEU", "PERIPERA", "ROM&ND", "ROMAND", "CLIO", "ETUDE HOUSE",
  "SULWHASOO", "KAHI", "CENTELLIAN", "COSNORI", "SOON JUNG", "JOANNA K",
  // Round 2 — from the live Beauty Square vendor list (Asia-import supply route,
  // incl. Japanese/Thai brands shipped on the same lane):
  "JUMISO", "TIAM", "MARY AND MAY", "HARUHARU", "ILLIYOON", "DR. CEURACLE",
  "DR CEURACLE", "DR.PLINUS", "EQQUALBERRY", "S. NATURE", "SEOUL", "KOREAN",
  "VT COSMETICS", "APLB", "YOUTH O'CLOCK", "PEACH & LILY", "DR. ALTHEA",
  "DR.ALTHEA", "MAY ISLAND", "HADA LABO", "HADALABO", "HADA", "I'M FROM",
  "I’M FROM", "BLITHE", "B.LAB", "MANYO", "MEDIPEEL", "MEDI PEEL", "MEDITHERPAY",
  "FACESHOP", "NEOGEN", "HOUSE OF HUR", "CATHY DOLL", "KOSE SUNCUT", "MELANO",
];

const WESTERN = [
  "THE ORDINARY", "ORDINARY", "MIZANI", "FENTY", "HUDA", "NYX", "MAYBELLINE",
  "CERAVE", "CETAPHIL", "NEUTROGENA", "AVEENO", "OLAPLEX", "CANTU", "SHEA MOISTURE",
  "SHEAMOISTURE", "MIELLE", "AUNT JACKIE", "ORS", "CREME OF NATURE", "AFRICAN PRIDE",
  "TGIN", "CAMILLE ROSE", "AS I AM", "KERACARE", "MOTIONS", "BONDI SANDS",
  "GOOD MOLECULES", "MILANI", "L.A. GIRL", "LA GIRL", "BLACK OPAL", "E.L.F", "ELF",
  "REVOLUTION", "MAKEUP REVOLUTION", "WET N WILD", "MAC ", "KIKO", "NARS",
  "ESTEE LAUDER", "CLINIQUE", "PAULA'S CHOICE", "INKEY", "GLOW RECIPE", "DRUNK ELEPHANT",
  "BYOMA", "BUBBLE", "TREE HUT", "SOL DE JANEIRO", "BATH & BODY", "VICTORIA'S SECRET",
  "LA ROCHE", "VICHY", "BIODERMA", "EUCERIN", "DIFFERIN", "PANTENE", "TRESEMM",
  "BATISTE", "MARC JACOBS", "VERSACE", "DIOR", "CHANEL", "ARMANI", "LATTAFA",
  // Round 2 — from the live Beauty Square vendor list:
  "NATURIUM", "SALTAIR", "FINERY", "MIXBAR", "TOPICALS", "YVES ROCHE", "YVES ROCHER",
  "BEING FRENSHE", "BODY BY TPH", "BLACK GIRL", "GEEK & GORGEOUS", "HELIOCARE",
  "PANOXYL", "SUMMER FRIDAYS", "AMLACTIN", "BIRETIX", "PHLUR", "CARMEX", "PFB",
  "TIMELESS", "THE HONEY POT", "JO MALONE", "FLAMINGO", "SULFUR8", "FORVR",
  "DERMALOGICA", "VANICREAM", "VIKTOR ROLF", "KIEHL", "FIRST AID", "AQUAPHOR",
  "SKINSCRIPT", "SKIN SCRIPT", "EPIMAX", "CÉCRED", "CECRED", "NEST", "FACETHEORY",
  "BIAEFFECT", "KOSASPORT", "GOOD GIRL", "ZAPZYT", "THAYERS", "NECESSAIRE",
  "SUNKISSED", "LAYALI", "TOM FORD", "PAULA'S", "BURBERRY", "SKINOREN",
];

// Mass-market with Kenyan distribution OR local manufacture → quick local restock.
const LOCAL = [
  "NIVEA", "DOVE", "VASELINE", "GARNIER", "L'OREAL PARIS", "LOREAL PARIS",
  "DARK AND LOVELY", "DARK & LOVELY", "EOS", "MANDEVU", "ADITA", "BIORE",
  "NICE & LOVELY", "NICE AND LOVELY", "ARIMIS", "TROPIKAL", "MOVIT", "AMARA",
  "SUZIE BEAUTY", "FLORI ROBERTS", "BLACK LIKE ME", "PALMER", "ST. IVES", "ST.IVES",
  "JERGENS", "SIMPLE", "PEARS", "JOHNSON", "COLGATE", "GILLETTE", "VENUS",
  "BEAUTY SQUARE", // house brand / unbranded sundries
  // Round 2 — Kenyan brands / pharmacy lines with local distribution:
  "UNCOVER", "IZEZE", "EPIMOL", "LOREAL", "NIZORAL", "BEPANTHEN",
];

type Cat = "LOCAL" | "KOREAN" | "WESTERN";

function classify(vendorRaw: string): Cat | null {
  const v = vendorRaw.toUpperCase().trim();
  const hit = (list: string[]) => list.some((b) => v === b || v.includes(b));
  // Order matters: KOREAN/WESTERN are more specific signals than the LOCAL
  // mass-market list; check LOCAL last so e.g. "L'OREAL PARIS" wins over "MAC".
  if (hit(KOREAN)) return "KOREAN";
  if (hit(WESTERN)) return "WESTERN";
  if (hit(LOCAL)) return "LOCAL";
  return null;
}

async function main() {
  const force = process.argv.includes("--force");
  const dry = process.argv.includes("--dry");

  const tenant = await prisma.tenant.findFirst({ select: { id: true } });
  if (!tenant) throw new Error("No tenant");

  const vendors: { vendor: string; n: number }[] = await prisma.$queryRawUnsafe(
    `select vendor, count(*)::int n from "Product"
     where "tenantId" = '${tenant.id}' and vendor is not null
     group by 1 order by 2 desc`
  );

  let updated = 0;
  const rows: { vendor: string; n: number; cat: Cat | "—" }[] = [];
  const unknown: { vendor: string; n: number }[] = [];

  for (const { vendor, n } of vendors) {
    const cat = classify(vendor);
    rows.push({ vendor, n, cat: cat ?? "—" });
    if (!cat) { unknown.push({ vendor, n }); continue; }
    if (dry) continue;
    const res = await prisma.product.updateMany({
      where: {
        tenantId: tenant.id,
        vendor,
        ...(force ? {} : { importCategory: null }),
      },
      data: { importCategory: cat },
    });
    updated += res.count;
  }

  console.log("vendor".padEnd(34) + "products".padStart(9) + "  category");
  for (const r of rows.sort((a, b) => b.n - a.n)) {
    console.log(r.vendor.slice(0, 33).padEnd(34) + String(r.n).padStart(9) + "  " + r.cat);
  }
  const counts = rows.reduce((m, r) => ((m[r.cat] = (m[r.cat] ?? 0) + r.n), m), {} as Record<string, number>);
  console.log(`\nTotals by category (products): ${JSON.stringify(counts)}`);
  console.log(`${dry ? "[dry-run] would update" : "Updated"} ${dry ? "?" : updated} products.`);
  if (unknown.length) {
    console.log(`\n${unknown.length} vendors unclassified (left NULL → treated LOCAL; fix on Products page):`);
    for (const u of unknown.slice(0, 40)) console.log(`  ${u.vendor} (${u.n})`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
