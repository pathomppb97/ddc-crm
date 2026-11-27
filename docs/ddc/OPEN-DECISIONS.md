# Open decisions and unverified dependencies

Nothing below was invented as a fact. Each item is either a configurable placeholder or a decision
that belongs to DDC.

## Requires DDC business decision

| Item | Current state | Where to change |
|---|---|---|
| Permission matrix per role | Proposed default | Administration → Role permissions |
| Quotation approval thresholds and approvers | **No rule seeded**: every quotation needs one approval by a user holding *approve* (Sales Manager, Management, Finance by default) | Administration → Quotation approval rules |
| Self-approval of quotations | Refused (`quotation_allow_self_approval = false`) | `app_settings` |
| Pipeline stages and probabilities | Proposed: Standard and OEM/ODM pipelines | Administration → Sales pipelines |
| Code lists (lifecycle, lead source, loss reasons, activity / complaint types, departments, document types, equipment types) | Proposed defaults | Administration → Code lists |
| Product categories, types, models | Only the families named in the requirements are seeded | Products → Product hierarchy |
| Document number formats | `CUS-`, `LD-`, `RFQ-`, `QT-`, `DEV-`, `CASE-` | Migration trigger arguments |
| Customer code scheme / ERP account alignment | CRM generates `CUS-000001`; ERP accounts are linked, not copied | `ddc_assign_customer_code` |
| ERP system of record per entity, direction, operations | All `proposed` / `undecided` for customers and contacts | ERP integration → contracts |
| Owned brand names (OBM) | None seeded | Products → Brands |

## Unverified external facts

| Fact | Status |
|---|---|
| Dynamics 365 F&O version, modules, configuration keys | Unknown |
| Enabled public data entities and field names | Candidates only, all mappings `is_verified = false` |
| Legal entities (dataAreaId) | Unknown; the mock uses `syn1`, `syn2` |
| Modified-date field for incremental sync | Unknown (`D365_MODIFIED_FIELD`) |
| Sandbox environment | Not provided |
| Throttling limits of the DDC environment | Unknown; the adapter honours `Retry-After` |
| `ddcthailand.operations.dynamics.com` | Recorded as informational note only; never contacted |
| Official DDC logo and colours | Not available: neutral "DDC CRM" mark, replace in `src/ddc/config.ts` |
| Supabase hosting (region, plan, backups) | To be chosen by DDC IT |

## Known technical limitations

- Dashboard KPIs are computed client side from up to 10,000 rows per entity.
- Custom field values are stored but not yet displayed in forms.
- Outbound ERP synchronization is not implemented.
- E-mail notifications are not implemented (in-app only); Atomic's inbound e-mail (Postmark) is unchanged.
- Evaluation mode does not enforce row level security (interface and operation checks only).
- The database tests run on PGlite with a stand-in for Supabase auth; a run on a real Supabase stack
  (`npx supabase db reset --local`) was not possible in this environment (no Docker).
- In this development environment, 14 of Atomic CRM's own browser tests fail (`ContactShow`,
  `getContactAvatar`, `TaskCreateSheet`, `DealInputs` "creates a contact…", `DataImportButton` "hides a
  resource…"). The **unmodified upstream commit fails the same 14 tests here**: they depend on external
  network access (Gravatar / favicon) and on test ordering. They are not caused by DDC changes, but they
  should be checked on a machine with normal internet access / in CI.
