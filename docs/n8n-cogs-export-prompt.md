# n8n build-prompt — QuickBooks → Cost of Goods export

Paste this into the n8n AI workflow builder (or build by hand) on the same n8n
instance that runs the Beauty Square reconciliation workflows. It reuses the
**existing QuickBooks credential** already wired into "Get QB Items" — no new auth.

Output: a `cogs.csv` (`Name, Sku, Cost`) emailed to the team, ready to upload in
Wezesha → Settings → **Cost of goods**. Wezesha matches each row to a product by
SKU when present, else by normalized name (QB SKUs are frequently blank, so Name
is always included).

---

## Prompt

> Build an n8n workflow named **"Beauty Square — QuickBooks → Cost of Goods export"**.
>
> 1. **Trigger:** Manual Trigger (also fine to add a monthly Schedule Trigger later).
> 2. **QuickBooks node** (`n8n-nodes-base.quickbooks`), reusing the existing QuickBooks
>    credential already used by the Beauty Square reconciliation workflows:
>    - `resource: item`
>    - `operation: getAll`
>    - `returnAll: true`
> 3. **Code node — "Map COGS"** (JavaScript), maps each QuickBooks item to a flat row,
>    dropping items with no purchase cost:
>    ```js
>    return $input.all()
>      .map(({ json: it }) => ({
>        json: {
>          Name: (it.Name || it.FullyQualifiedName || "").toString().trim(),
>          Sku:  (it.Sku || "").toString().trim(),
>          Cost: Number(it.PurchaseCost ?? 0),
>        },
>      }))
>      .filter(r => r.json.Cost > 0 && (r.json.Sku || r.json.Name));
>    ```
> 4. **Convert to File** (`n8n-nodes-base.convertToFile`): CSV, columns in order
>    `Name, Sku, Cost`, file name `cogs.csv`.
> 5. **Email** the file using the SAME Brevo HTTP pattern as the recon workflows
>    (`POST https://api.brevo.com/v3/smtp/email`, generic header auth), to
>    `teamsimplydone@gmail.com`, subject "Beauty Square — Cost of Goods export",
>    with `cogs.csv` attached.
>
> Notes:
> - QuickBooks `Sku` is often blank — that's expected; the `Name` column is the
>   fallback match key downstream, so never drop it.
> - Cost MUST come from `PurchaseCost` (cost of goods) ONLY. Never use `UnitPrice` —
>   that's the sell price; items with no `PurchaseCost` are dropped, not guessed.

---

## Then, in Wezesha

Settings → **Cost of goods** → upload `cogs.csv`. The result banner reports
`Updated N of M rows · K unmatched` (with sample unmatched names/SKUs). Re-run any
time costs change in QuickBooks; lead times can ride the same upload flow later.
