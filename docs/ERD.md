# DDC Agriculture CRM — Entity-Relationship Diagrams (ERD)

> Synchronized with `supabase/schemas/` + `supabase/migrations/*_ddc_*.sql` (including Phase 1 `20261127140000_ddc_enterprise_foundation.sql`).

## 1. Customer Master, Sales Pipeline & Field Operations

```mermaid
erDiagram
    companies ||--o{ company_addresses : "has"
    companies ||--o{ company_territories : "assigned_to"
    companies ||--o{ company_business_models : "operates_as"
    companies ||--o{ company_segments : "classified_in"
    companies ||--o{ contacts : "employs"
    companies ||--o{ customer_machines : "owns"
    companies ||--o{ customer_capacity_profiles : "seasonal_capacity"
    companies ||--o{ customer_part_usage : "part_demand"
    companies ||--o{ deals : "opportunities"
    companies ||--o{ activities : "visits_and_calls"
    companies ||--o{ rfqs : "requests"
    companies ||--o{ quotations : "quoted"
    companies ||--o{ sales_orders : "orders"
    companies ||--o{ service_cases : "complaints"
    companies }o--o| companies : "parent_company"

    customer_segments ||--o{ company_segments : "groups"
    territories ||--o{ company_territories : "covers"
    territories }o--o| territories : "parent"

    leads }o--o| companies : "converted_company"
    leads }o--o| contacts : "converted_contact"
    leads }o--o| deals : "converted_deal"

    pipelines ||--o{ pipeline_stages : "has_stages"
    pipelines ||--o{ deals : "governs"

    deals ||--o{ deal_products : "includes"
    deals ||--o{ deal_competitors : "competes_with"
    deals ||--o{ rfqs : "triggers"
    deals ||--o{ quotations : "priced_by"
    deals ||--o{ sales_orders : "closes_into"

    rfqs ||--o{ rfq_items : "lines"
    rfqs ||--o{ quotations : "answered_by"
    quotations ||--o{ quotation_items : "lines"
    quotations ||--o{ quotation_approvals : "approved_via"
    quotations }o--o| quotations : "previous_revision"
    quotations ||--o{ sales_orders : "confirmed_as"
    sales_orders ||--o{ sales_order_items : "lines"

    activities ||--o{ activity_participants : "attended_by"
    activities ||--o{ activity_products : "discussed"
    activities ||--o{ activity_photos : "captured"
    activities ||--o{ action_items : "follow_ups"
```

---

## 2. Agriculture Machinery, Products & Pricing

```mermaid
erDiagram
    manufacturers ||--o{ machine_models : "produces"
    machine_models ||--o{ machine_specifications : "spec_sheet"
    machine_models ||--o{ product_machine_applications : "compatible_parts"
    machine_models ||--o{ customer_machines : "customer_fleet"

    product_hierarchy_nodes }o--o| product_hierarchy_nodes : "parent_node"
    product_hierarchy_nodes ||--o{ products : "categorizes"
    brands ||--o{ products : "branded_as"

    products ||--o{ product_specifications : "specs"
    products ||--o{ product_customer_references : "customer_part_no"
    products ||--o{ product_revisions : "revisions"
    products ||--o{ product_relations : "related_parts"
    products ||--o{ product_machine_applications : "fits_machine"
    products ||--o{ price_list_items : "priced_in"

    customer_segments ||--o{ price_lists : "targeted_pricing"
    price_lists ||--o{ price_list_items : "entries"
```

---

## 3. Users, RBAC, Teams, Data Scopes & Security Audit

```mermaid
erDiagram
    ddc_roles ||--o{ role_permissions : "grants"
    permission_resources ||--o{ role_permissions : "protects"
    permission_resources ||--o{ table_permission_map : "maps_rls"
    ddc_roles ||--o{ role_field_permissions : "field_rules"
    ddc_roles ||--o{ sales : "assigned_role"
    ddc_roles ||--o{ service_accounts : "machine_role"

    teams }o--o| teams : "parent_team"
    teams ||--o{ team_members : "members"
    sales ||--o{ team_members : "belongs_to"
    data_scopes ||--o{ sales : "default_scope"
    territories ||--o{ sales : "primary_territory"
    territories ||--o{ teams : "covers"

    sales ||--o{ user_sessions : "active_sessions"
    sales ||--o{ login_history : "auth_events"
    sales ||--o{ api_keys : "user_keys"
    service_accounts ||--o{ api_keys : "service_keys"
    sales ||--o{ audit_log : "actor"
    sales ||--o{ sales_targets : "quota"
    sales ||--o{ sales_forecasts : "forecast"
    sales ||--o{ saved_views : "owns"
```

---

## 4. Enterprise Admin Control Plane (Config, Feature Flags, Releases & Jobs)

```mermaid
erDiagram
    sales ||--o{ ui_config_versions : "created_or_approved"
    ui_config_versions }o--o| ui_config_versions : "rolled_back_from"

    feature_flags ||--o{ feature_flag_history : "change_log"
    sales ||--o{ feature_flag_history : "changed_by"

    releases ||--o{ deployments : "deployed_by"
    deployments }o--o| deployments : "previous_deployment"
    sales ||--o{ releases : "created_or_approved"
    sales ||--o{ deployments : "triggered_or_approved"

    scheduled_jobs ||--o{ scheduled_job_logs : "execution_logs"
    sales ||--o{ scheduled_jobs : "created_by"
    sales ||--o{ backup_records : "initiated_by"
```
