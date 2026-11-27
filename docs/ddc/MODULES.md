# DDC CRM modules

Status legend: **Implemented** = working screens + persistence + tests. **Partial** = described limits apply.

| Module | Status | Where |
|---|---|---|
| Customer master | Implemented | Customers (`companies`), contacts (Atomic), addresses, territories, business relationships, product interests |
| Multi business model classification | Implemented | `company_business_models`: any number of (business model, sales channel) per customer; models / channels configurable |
| Duplicate detection | Implemented | Live warning in the customer form, conversion and import (tax id, normalized Thai / English name, domain, phone). Suggestion only, no automatic merge |
| Excel / CSV import & export | Implemented for customers, leads, products | Validation per row with spreadsheet row numbers, downloadable error report, template; Excel export of the filtered list; CSV export on every list. Contacts keep Atomic's CSV import |
| Custom fields | Partial | Definitions are configurable (`custom_field_definitions`), values stored in `custom_fields` jsonb; they are **not yet rendered** in the generic forms |
| Leads | Implemented | Qualification statuses, sources, follow-up, transactional conversion to customer + contact + opportunity |
| Opportunities | Implemented | Atomic Kanban + configurable pipelines per business model (selector on the board), probability, quantity, currency, products, competitors, loss reasons, RFQ / quotation links |
| Activities & visits | Implemented | Types configurable, participants, products discussed, action items with due dates, month calendar, overdue list, 90-day customer coverage |
| Product master | Implemented | Agriculture family > category > type > model hierarchy, part numbers, customer part numbers, specifications (entered, never derived), revisions, relations, brands |
| Agriculture applications | Implemented | Agricultural machine models (manufacturer, equipment type, series, years) ↔ products many-to-many, verification with evidence |
| RFQ | Implemented | Registration, items, requirements, target prices, delivery dates, engineering review (stamped), cost estimate reference |
| Quotations | Implemented | Lines with discounts, totals, revisions, configurable approval rules by amount / currency / role, segregation of duties, notifications, customer status |
| OEM / ODM development | Implemented | Projects, requirements, feasibility, process / material / tooling notes, milestones by department, samples, customer approval, risks, documents |
| OBM & aftermarket | Implemented | Brands, distributor / dealer network per territory, product coverage. Repeat-purchase analysis needs ERP orders (Partial) |
| Complaints & service cases | Implemented | Categories, priorities, departments, affected products / lots, communication log, 8D / NCR / CAPA references, closure |
| Dashboard | Implemented | KPIs with 10 filters (URL based), drill-down links, monthly trend, product interest chart, Excel export; estimated / quoted / ERP values separated |
| RBAC | Implemented | 9 roles, editable matrix, own-record scope, enforced by RLS |
| Audit log | Implemented | Database trigger, per-record history on every detail page, audit list |
| Notifications | Implemented | Approval requests / decisions in-app; overdue follow-ups. No e-mail notifications |
| Localization | Implemented | Thai default, English. Some Atomic CRM screens (contact details, notes, settings) fall back to English for untranslated texts |
| ERP integration layer | Implemented (mock only) | See ERP-INTEGRATION.md |
| Mobile | Partial | Desktop layout is responsive; Atomic's dedicated mobile layout (contacts / tasks) is unchanged and does not include DDC modules |
