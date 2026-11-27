# Microsoft Dynamics 365 Finance and Operations integration layer

**Status: disabled. Only the mock connector with synthetic data has ever run.** No request has been
sent to `ddcthailand.operations.dynamics.com` or any other DDC system during development.

## Components

| File | Role |
|---|---|
| `supabase/functions/_shared/erp/types.ts` | Contracts: `ErpConnector` port, `SyncStore` port, entity / mapping / run types |
| `.../mockConnector.ts` | Mock F&O: legal entities, server driven paging, incremental filter, throttling (429) and transient failures, on synthetic data |
| `.../d365Connector.ts` | OData adapter: Entra ID client credentials, `cross-company=true` + `dataAreaId` filter, `Prefer: odata.maxpagesize`, `@odata.nextLink` (same origin only), 429 `Retry-After`, 5xx transient, token refresh on 401, secrets never in errors |
| `.../mapping.ts` | Field mapping with transforms, composite keys, payload hash |
| `.../targets.ts` | Per entity target rules (linking order lines to orders, items to products, invoices to customers) |
| `.../syncEngine.ts` | Guards, paging, retries, idempotent upsert, conflict handling, cursor, retry queue, reconciliation |
| `.../tableStore.ts` | `SyncStore` over the `erp_*` tables (Supabase service client or in-memory) |
| `supabase/functions/erp_sync/index.ts` | Authenticated, authorized edge function: `health`, `register_legal_entities`, `sync`, `reconcile` |
| `src/ddc/features/ErpAdminPage.tsx` | Administration screen |

## Behaviour

- **Disabled by default**: `erp_connector_config.is_enabled = false`, `connector_type = 'mock'`.
  A `d365fo` connector can only be enabled once `approval_status = 'approved'` (database constraint),
  and the edge function also needs the Entra ID secrets.
- **Per contract decisions**: each entity has a direction, a system of record, permitted operations
  and a decision status. Synchronization is refused while the system of record is `undecided`.
- **Legal entities**: every query is scoped to one `dataAreaId`; `erp_external_ids` is unique per
  (entity, legal entity, ERP key). The same item number in two legal entities is **not** merged into
  one CRM product: it is reported as a conflict for DDC to decide.
- **CRM ids are independent**: CRM records keep their own ids; the link lives in `erp_external_ids`.
- **Incremental**: cursor per (entity, legal entity) in `erp_sync_cursors`, from the modified-date field
  (`D365_MODIFIED_FIELD`, unverified). The cursor only moves after a complete run.
- **Idempotent**: a record whose mapped payload hash is unchanged is skipped; reruns create nothing.
- **Conflicts**: when the CRM is the system of record, ERP changes are reported, not applied.
- **Failures**: a failing record is logged in `erp_sync_errors` with its payload and retried with
  exponential back-off (`mode: retry`) up to 5 attempts; then it waits for manual resolution.
- **Throttling**: 429 waits `Retry-After` (bounded retries); 5xx retries with back-off.
- **Reconciliation**: compares ERP keys and mapped keys, read-only.
- **Monitoring**: `erp_sync_runs` (counters, cursors, status, user), `erp_sync_errors`, audit log on
  configuration changes; the ERP page shows health, last sync, failures and approval state.

Implemented directions: **inbound** (ERP → CRM) for customers, contacts, products, released products,
inventory availability, price lists, sales orders, sales order lines, deliveries and invoices.
Outbound (e.g. pushing quotations or prospects to the ERP) is modelled in the contracts but **not
implemented**: it needs DDC decisions on ownership and numbering first.

## Candidate data entities (UNVERIFIED)

The seeded contracts name candidate public data entities (`CustomersV3`, `ReleasedProductsV2`,
`SalesOrderHeadersV2`, `SalesOrderLines`, `SalesInvoiceHeadersV2`, `SalesPackingSlipHeadersV2`,
`WarehousesOnHandV2`, `SalesPriceAgreements`, `ContactsV2`, `ProductsV2`, `SalesQuotationHeadersV2`) and
candidate field names. Entity availability, field names, keys and the modified-date field depend on the
F&O version, enabled configuration keys and customizations of the DDC environment. Each mapping has an
`is_verified` flag; all are false.

## Microsoft Entra ID application registration (to request from DDC IT)

1. Register a single-tenant application in the DDC Entra ID tenant (e.g. "DDC CRM integration – sandbox").
2. Create a client secret (or, preferably, a certificate) with a short expiry; store it only as a
   Supabase secret (`D365_CLIENT_SECRET`), never in the repository.
3. In F&O (**System administration > Setup > Microsoft Entra applications**), register the client id
   and map it to a dedicated integration user.
4. Give that user a **custom least-privilege security role** with read access to the confirmed data
   entities only (and write access only for confirmed outbound contracts), restricted to the confirmed
   legal entities.
5. Use a **sandbox** environment URL first. Production requires a separate registration and approval.

## Activation procedure (after authorization)

1. Record the decisions in **ERP integration → contract** (system of record, direction, operations,
   decision note with approver / date / reference), set the contract to `confirmed`.
2. Verify each mapping against the sandbox metadata (`$metadata`) and tick `is_verified`.
3. Set secrets: `npx supabase secrets set D365_TENANT_ID=... D365_CLIENT_ID=... D365_CLIENT_SECRET=... D365_MODIFIED_FIELD=...`
4. As a database administrator (SQL, not from the web app), record the approval and switch the connector:
   ```sql
   update public.erp_connector_config
   set approval_status = 'approved', approved_by_name = '<name>', approved_at = now(),
       approval_reference = '<document>', connector_type = 'd365fo',
       environment_type = 'sandbox', environment_url = 'https://<sandbox host>', is_enabled = true;
   ```
5. Run `health`, `register_legal_entities`, mark the confirmed legal entities `is_verified`, then one
   entity at a time: `full` sync, `reconcile`, review errors, then `incremental`.

## Test procedure

- Automated: `npx vitest run --config vitest.config.ts --project functions` and `npm run test:db`
  (sync on the real schema). These use the mock connector and a fake HTTP layer only.
- Sandbox acceptance (manual, after approval): row counts vs. F&O for each entity and legal entity,
  spot check of 20 records per entity, rerun idempotency (0 created), incremental after a change in
  the sandbox, throttling behaviour under load, error queue handling, reconciliation report.

## Rollback

- Immediate stop: `update erp_connector_config set is_enabled = false` (or untick in the ERP page for
  the mock). Per entity: untick the contract.
- Inbound data is isolated: ERP documents live in `erp_*` tables and links in `erp_external_ids`; they
  can be deleted per entity / legal entity without touching CRM-owned records. Records created in
  `companies` / `products` by a sync are listed in `erp_external_ids` (crm_table, crm_id) for removal.
- No outbound operation exists, so no ERP data can have been changed by the CRM.

## Deployment approval checklist

- [ ] F&O version, legal entities, enabled data entities confirmed by DDC IT
- [ ] Sandbox environment URL and integration user provided
- [ ] Entra ID app registration with least-privilege role
- [ ] System of record and direction confirmed per entity (signed decision)
- [ ] Field mappings verified against sandbox metadata
- [ ] Data protection review (customer data leaving / entering the ERP)
- [ ] Sandbox acceptance tests passed and signed off
- [ ] Production activation approved by management and IT
