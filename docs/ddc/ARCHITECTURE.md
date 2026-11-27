# DDC CRM architecture

## Starting point

DDC CRM extends [Atomic CRM](https://github.com/marmelab/atomic-crm) (MIT). Atomic CRM provided the
React + react-admin application shell, Supabase authentication, contacts, notes, tasks, the deal Kanban,
CSV import, global search and the user management edge function. DDC CRM keeps those and adds the
manufacturing modules. The original README is kept as `README.atomic-crm.md`.

## Layers

```
Presentation      src/ddc/ui, src/ddc/features, src/ddc/layout, src/components/atomic-crm
                   generic screens generated from resource definitions + workflow screens
Resource model    src/ddc/resources        one definition per entity: fields, labels (th/en),
                                           relations, filters, search, documents
Domain logic      src/ddc/domain           pure TypeScript, no React, no I/O:
                                           permissions, quotation state machine, KPIs,
                                           duplicate detection, import validation
Application svc   src/ddc/providers        DdcDataMethods: lead conversion, quotation workflow,
                                           ERP actions, search, dashboard data
                     supabaseDdc.ts         -> PostgreSQL functions (RPC) + edge functions
                     fakerestDdc.ts         -> in-browser evaluation implementation
Persistence       supabase/migrations/*_ddc_*.sql   tables, constraints, triggers,
                                           workflow functions, RLS policies, grants
Integration       supabase/functions/_shared/erp    connector port, mock and D365 adapters,
                                           sync engine, mapping, persistence port
                     supabase/functions/erp_sync    server side entry point
```

The **database is the enforcement point**. Every rule that protects data (permissions, quotation
locking, approval segregation, document numbering, verification evidence, audit) is implemented in
PostgreSQL. The interface mirrors those rules to hide actions a user cannot take, but a client that
bypasses the interface is still blocked.

## Resource definitions

`src/ddc/resources/*Resources.ts` declare ~55 entities. From one definition the app generates the list
(with search, filters, sorting, pagination, CSV export), create / edit forms with validation, the
detail page with related records, document references and change history, and the Thai / English
labels. Two unit tests keep the definitions honest: every referenced column must exist in the SQL
schema and every label must exist in both languages.

Entities with a workflow add extensions: quotation approval panel, lead conversion panel, duplicate
warning on customers, Excel / CSV import-export on customers, leads and products.

## Security model

- **Authentication**: Supabase Auth (email / password, invitations, optional SAML SSO).
- **Authorization**: `ddc_roles` + `role_permissions` (resource x action x scope `all` / `own`).
  `ddc_can(resource, action, owner)` is called by every RLS policy. Policies are generated from
  `table_permission_map`, so new tables get the same protection by adding one row. Child rows inherit
  the permission of their parent row. Administrators (`sales.administrator`) bypass the matrix.
- **Configuration tables** (roles, permissions, settings, approval rules, ERP configuration) are
  writable by administrators only.
- **Workflow functions** are `security definer` and perform their own permission checks; quotation
  status columns and approval rows can only change inside them (`ddc.workflow` transaction flag).
- **Anonymous** access to DDC tables is revoked.
- **Audit**: `ddc_audit()` trigger on all business and configuration tables writes actor, changed
  fields, before / after images. `audit_log` is append-only for API users.
- **Secrets**: no ERP credential exists in the database, the repository or the browser bundle. The
  D365 adapter reads them from edge function secrets.

Required production HTTP headers (configure on the static host / CDN):
`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a Content-Security-Policy restricting
`connect-src` to the Supabase project URL.

## Value categories (reporting integrity)

| Category | Source | Shown as |
|---|---|---|
| Estimated opportunity value | `deals.amount` (optional, empty when unknown) | Pipeline (estimated), weighted |
| Quoted value | `quotations.total_amount` of sent quotations | Quoted value |
| Confirmed orders | `erp_sales_orders` (ERP only) | Confirmed orders |
| Invoiced revenue | `erp_invoices.invoice_amount` (ERP only) | Invoiced revenue |
| Actual (collected) revenue | `erp_invoices.paid_amount` (ERP only) | Collected revenue |

Categories are never summed together and money is always grouped by currency. ERP figures read
"not available" until data has been synchronized; they are never estimated.

## Evaluation mode

`npm run dev:demo` swaps the Supabase providers for FakeRest (in-memory). DDC operations run through
`fakerestDdc.ts`, which reuses the domain modules and the same ERP sync engine with the mock connector.
Reference data comes from the migrations through `src/ddc/demo/referenceData.json`. Business data is
synthetic (`src/ddc/demo/generateDemoData.ts`). Row level security does not exist in this mode.

## Tests

| Project | Runs | Covers |
|---|---|---|
| `db` | Node + PGlite | The real Atomic schema + DDC migrations: constraints, triggers, RLS per role, quotation workflow, lead conversion, ERP sync on the real tables, reference data freshness; domain logic; resource definitions vs. schema; translations |
| `functions` | Node | ERP mapping, sync engine (idempotency, incremental cursor per legal entity, throttling, retry, conflicts, reconciliation), D365 adapter against a fake HTTP layer; Atomic edge function tests |
| `app` | Headless Chromium | Atomic CRM component tests |

PGlite is PostgreSQL compiled to WebAssembly. It runs the SQL unmodified, on top of a minimal stand-in
for `auth.users`, `auth.uid()` and the API roles. It does not replace a run against a real Supabase
stack before going live.
