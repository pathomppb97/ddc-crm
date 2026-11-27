# DDC CRM database

Atomic CRM's declarative schema (`supabase/schemas/`) plus the DDC migrations:

| Migration | Content |
|---|---|
| `20261111120000_ddc_rbac_audit` | roles, permission matrix, `ddc_can`, audit log, code lists (`master_options`), settings, custom fields, notifications, document references, numbering helper |
| `20261111120100_ddc_customers_sales` | business models, territories, customer master extensions, pipelines, leads, opportunity extensions, activities, action items, `convert_lead` |
| `20261111120200_ddc_products` | product hierarchy, products, specifications, customer part numbers, revisions, relations, machine models + applications, interests |
| `20261111120300_ddc_rfq_quotations` | RFQs, quotations, lines, approval rules, approvals, workflow functions and guards |
| `20261111120400_ddc_projects_aftermarket_cases` | OEM/ODM development projects, dealer network, complaints / service cases |
| `20261111120500_ddc_erp` | connector config, legal entities, contracts, field mappings, external ids, cursors, runs, errors, ERP document copies |
| `20261111120600_ddc_policies_grants` | RLS generated from `table_permission_map`, dedicated policies, audit triggers, search, grants |
| `20261111120700_ddc_reference_data` | roles, proposed permission matrix, business models, code lists, product families, pipelines, ERP contracts (no business data) |
| `20261111120800_ddc_deal_default_pipeline` | default pipeline assignment trigger on opportunities |
| `20261125085937_ddc_customer_list_relationships` | read-only workbook evidence tables for Customer List imports |
| `20261125162000_ddc_agriculture_only` | Agriculture-only specialization: drops Automotive tables/options (`vehicle_models`, `product_vehicle_fitments`, `vehicle_type`), multi-division `divisions`/`division_id`, and `manufacturers.kind`, renames `fitment` permission to `machine_applications` |
| `20261125164500_ddc_company_relationship_guards` | Enforces customer/parent consistency for linked contacts, RFQs, opportunities, activities, and RFQ items |

## Main relationships

```
companies ─┬─< company_business_models >── business_models, master_options(sales_channel)
           ├─< company_addresses, company_territories >── territories
           ├─< contacts (Atomic) ─< contact_notes
           ├─< company_product_interests >── product_hierarchy_nodes | products
           ├─ parent_company_id → companies          (HQ / subsidiary / branch)
           ├─< deals (opportunities) ─┬─< deal_products, deal_competitors
           │        pipeline_id → pipelines ─< pipeline_stages
           │        lead_id → leads ── converted_company_id / converted_deal_id
           ├─< activities ─┬─< activity_participants, activity_products
           │               └─< action_items
           ├─< rfqs ─< rfq_items
           │      └─< quotations (quotation_no, revision) ─┬─< quotation_items
           │               previous_revision_id ↺          └─< quotation_approvals >── approval_rules
           ├─< dev_projects ─< requirements, milestones, samples, risks
           ├─< dealer_networks >── brands ─< dealer_product_coverage
           ├─< service_cases ─< service_case_products, service_case_communications
           └─< erp_sales_orders ─< erp_sales_order_lines, erp_invoices, erp_deliveries

product_hierarchy_nodes (family > category > type > model) ─< products
products ─< product_machine_applications >── machine_models >── manufacturers  (Agriculture)

document_references (entity_type, entity_id)      polymorphic, protected by the entity permission
audit_log (table_name, record_id)                 written by trigger only
erp_external_ids (entity, data_area_id, erp_key) ↔ (crm_table, crm_id)
```

## Integrity rules enforced by PostgreSQL

- Code list foreign keys must point to the right category (`ddc_check_option_category`).
- Hierarchy nodes stay below a higher level (`family > category > type > model`).
- A machine application can only be `verified` with a verification source; who and when are stamped.
- A converted lead must reference its customer; conversion is one transaction (`convert_lead`).
- Quotations are created as drafts; status changes only via `submit_quotation`,
  `decide_quotation_approval`, `set_quotation_status`, `create_quotation_revision`; a quotation and its
  lines are locked outside draft / rejected; the submitter cannot approve (setting
  `quotation_allow_self_approval`); a rejection needs a comment; totals are computed from lines.
- A service case can only be closed with a closure summary; closure is stamped.
- A real ERP connector cannot be enabled without `approval_status = 'approved'`.
- ERP keys are unique per (entity, legal entity), not globally.
- Document numbers: `CUS-000001`, `LD-YYYY-00001`, `RFQ-…`, `QT-…`, `DEV-…`, `CASE-…` (prefixes are
  proposals; change them in the trigger arguments if DDC uses another scheme).

## Adding a table

1. Create it in a new migration with foreign keys and indexes.
2. Add a row to `table_permission_map` and (re)create its policies, or copy the loop of
   `20261111120600_ddc_policies_grants.sql`.
3. Add the audit trigger and grants.
4. Add a resource definition in `src/ddc/resources`; the column test will check it.
5. `npm run ddc:export-reference-data` if it carries reference data.
