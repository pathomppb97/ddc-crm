--
-- DDC CRM - 7/8 - Row level security, grants, audit and housekeeping triggers
--
-- Policies are generated from table_permission_map so that every business table
-- is protected by the same configurable permission matrix (ddc_can).
--

insert into public.permission_resources (key, name, name_en, sort_order) values
    ('customers', 'ลูกค้า', 'Customers', 10),
    ('contacts', 'ผู้ติดต่อ', 'Contacts', 20),
    ('leads', 'ลีด', 'Leads', 30),
    ('opportunities', 'โอกาสการขาย', 'Opportunities', 40),
    ('activities', 'กิจกรรมและการเข้าพบ', 'Activities and visits', 50),
    ('tasks', 'งาน', 'Tasks', 60),
    ('products', 'สินค้า', 'Products', 70),
    ('fitment', 'การใช้งานกับรุ่นรถ/เครื่องจักร', 'Fitment and applications', 80),
    ('rfqs', 'RFQ', 'RFQs', 90),
    ('quotations', 'ใบเสนอราคา', 'Quotations', 100),
    ('dev_projects', 'โครงการพัฒนา OEM/ODM', 'OEM/ODM development projects', 110),
    ('aftermarket', 'OBM และ Aftermarket', 'OBM and aftermarket', 120),
    ('service_cases', 'ข้อร้องเรียนและงานบริการ', 'Complaints and service cases', 130),
    ('master_data', 'ข้อมูลหลัก', 'Master data', 140),
    ('reports', 'แดชบอร์ดและรายงาน', 'Dashboards and reports', 150),
    ('erp_documents', 'เอกสารจาก ERP', 'ERP documents', 160),
    ('erp_integration', 'การเชื่อมต่อ ERP', 'ERP integration', 170),
    ('audit_log', 'บันทึกการตรวจสอบ', 'Audit log', 180),
    ('users', 'ผู้ใช้งาน', 'Users', 190);

insert into public.table_permission_map (table_name, resource, owner_column, parent_table, parent_fk, parent_owner_column) values
    -- Atomic CRM tables
    ('companies', 'customers', 'sales_id', null, null, null),
    ('contacts', 'contacts', 'sales_id', null, null, null),
    ('contact_notes', 'contacts', null, 'contacts', 'contact_id', 'sales_id'),
    ('deals', 'opportunities', 'sales_id', null, null, null),
    ('deal_notes', 'opportunities', null, 'deals', 'deal_id', 'sales_id'),
    ('tasks', 'tasks', 'sales_id', null, null, null),
    -- Customer master
    ('company_business_models', 'customers', null, 'companies', 'company_id', 'sales_id'),
    ('company_territories', 'customers', null, 'companies', 'company_id', 'sales_id'),
    ('company_addresses', 'customers', null, 'companies', 'company_id', 'sales_id'),
    ('company_product_interests', 'customers', null, 'companies', 'company_id', 'sales_id'),
    -- Leads, opportunities, activities
    ('leads', 'leads', 'sales_id', null, null, null),
    ('deal_competitors', 'opportunities', null, 'deals', 'deal_id', 'sales_id'),
    ('deal_products', 'opportunities', null, 'deals', 'deal_id', 'sales_id'),
    ('activities', 'activities', 'sales_id', null, null, null),
    ('activity_participants', 'activities', null, 'activities', 'activity_id', 'sales_id'),
    ('activity_products', 'activities', null, 'activities', 'activity_id', 'sales_id'),
    ('action_items', 'activities', 'sales_id', null, null, null),
    -- Master data
    ('divisions', 'master_data', null, null, null, null),
    ('business_models', 'master_data', null, null, null, null),
    ('territories', 'master_data', null, null, null, null),
    ('pipelines', 'master_data', null, null, null, null),
    ('pipeline_stages', 'master_data', null, null, null, null),
    ('master_options', 'master_data', null, null, null, null),
    ('custom_field_definitions', 'master_data', null, null, null, null),
    -- Products
    ('product_hierarchy_nodes', 'products', null, null, null, null),
    ('manufacturers', 'products', null, null, null, null),
    ('brands', 'products', null, null, null, null),
    ('products', 'products', null, null, null, null),
    ('product_specifications', 'products', null, 'products', 'product_id', null),
    ('product_customer_references', 'products', null, 'products', 'product_id', null),
    ('product_revisions', 'products', null, 'products', 'product_id', null),
    ('product_relations', 'products', null, 'products', 'product_id', null),
    ('vehicle_models', 'fitment', null, null, null, null),
    ('machine_models', 'fitment', null, null, null, null),
    ('product_vehicle_fitments', 'fitment', null, null, null, null),
    ('product_machine_applications', 'fitment', null, null, null, null),
    -- RFQ and quotations
    ('rfqs', 'rfqs', 'sales_id', null, null, null),
    ('rfq_items', 'rfqs', null, 'rfqs', 'rfq_id', 'sales_id'),
    ('quotations', 'quotations', 'sales_id', null, null, null),
    ('quotation_items', 'quotations', null, 'quotations', 'quotation_id', 'sales_id'),
    -- Development projects
    ('dev_projects', 'dev_projects', 'sales_id', null, null, null),
    ('dev_project_requirements', 'dev_projects', null, 'dev_projects', 'project_id', 'sales_id'),
    ('dev_project_milestones', 'dev_projects', null, 'dev_projects', 'project_id', 'sales_id'),
    ('dev_project_samples', 'dev_projects', null, 'dev_projects', 'project_id', 'sales_id'),
    ('dev_project_risks', 'dev_projects', null, 'dev_projects', 'project_id', 'sales_id'),
    -- Aftermarket
    ('dealer_networks', 'aftermarket', 'sales_id', null, null, null),
    ('dealer_product_coverage', 'aftermarket', null, 'dealer_networks', 'dealer_network_id', 'sales_id'),
    -- Complaints
    ('service_cases', 'service_cases', 'sales_id', null, null, null),
    ('service_case_products', 'service_cases', null, 'service_cases', 'case_id', 'sales_id'),
    ('service_case_communications', 'service_cases', null, 'service_cases', 'case_id', 'sales_id');

do $$
declare
    m record;
    p record;
    v_owner text;
begin
    -- Replace the permissive Atomic CRM policies by permission based ones
    for p in
        select policyname, tablename from pg_policies
        where schemaname = 'public'
            and tablename in ('companies', 'contacts', 'contact_notes', 'deals', 'deal_notes', 'tasks')
    loop
        execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    end loop;

    for m in select * from public.table_permission_map order by table_name loop
        execute format('alter table public.%I enable row level security', m.table_name);

        if m.parent_table is null then
            v_owner := case when m.owner_column is null then 'null::bigint' else format('%I', m.owner_column) end;
            execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(%L, ''read'', %s))',
                m.table_name, m.resource, v_owner);
            execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.ddc_can(%L, ''create'', %s))',
                m.table_name, m.resource, v_owner);
            execute format('create policy ddc_update on public.%I for update to authenticated using (public.ddc_can(%L, ''update'', %s)) with check (public.ddc_can(%L, ''update'', %s))',
                m.table_name, m.resource, v_owner, m.resource, v_owner);
            execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.ddc_can(%L, ''delete'', %s))',
                m.table_name, m.resource, v_owner);
        else
            -- Child rows: visible with their parent, writable by whoever may update the parent
            v_owner := case when m.parent_owner_column is null then 'null::bigint'
                else format('(select p.%I from public.%I p where p.id = %I.%I)', m.parent_owner_column, m.parent_table, m.table_name, m.parent_fk) end;
            execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can_any_scope(%L, ''read'') and exists (select 1 from public.%I p where p.id = %I.%I))',
                m.table_name, m.resource, m.parent_table, m.table_name, m.parent_fk);
            execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.ddc_can(%L, ''update'', %s))',
                m.table_name, m.resource, v_owner);
            execute format('create policy ddc_update on public.%I for update to authenticated using (public.ddc_can(%L, ''update'', %s)) with check (public.ddc_can(%L, ''update'', %s))',
                m.table_name, m.resource, v_owner, m.resource, v_owner);
            execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.ddc_can(%L, ''update'', %s))',
                m.table_name, m.resource, v_owner);
        end if;
    end loop;
end;
$$;

--
-- Tables with dedicated policies
--

-- Security configuration: readable by every signed-in user, writable by administrators only
do $$
declare
    t text;
begin
    foreach t in array array[
        'ddc_roles', 'permission_resources', 'role_permissions', 'table_permission_map',
        'option_categories', 'app_settings', 'approval_rules'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (true)', t);
        execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.is_admin())', t);
        execute format('create policy ddc_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
        execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.is_admin())', t);
    end loop;

    -- ERP configuration: administrators write, the erp_integration permission reads
    foreach t in array array[
        'erp_connector_config', 'erp_legal_entities', 'erp_entity_configs', 'erp_field_mappings'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(''erp_integration'', ''read''))', t);
        execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.is_admin())', t);
        execute format('create policy ddc_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
        execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.is_admin())', t);
    end loop;

    -- ERP bookkeeping: written by the synchronization service (service role) only
    foreach t in array array['erp_external_ids', 'erp_sync_cursors', 'erp_sync_runs', 'erp_sync_errors'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(''erp_integration'', ''read''))', t);
    end loop;

    -- ERP owned documents: read-only in the CRM
    foreach t in array array[
        'erp_sales_orders', 'erp_sales_order_lines', 'erp_deliveries', 'erp_invoices',
        'erp_inventory_availability', 'erp_price_list_entries'
    ] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(''erp_documents'', ''read''))', t);
    end loop;
end;
$$;

alter table public.audit_log enable row level security;
create policy ddc_select on public.audit_log for select to authenticated
    using (public.ddc_can('audit_log', 'read'));

alter table public.notifications enable row level security;
create policy ddc_select on public.notifications for select to authenticated
    using (recipient_sales_id = public.current_sales_id());
create policy ddc_update on public.notifications for update to authenticated
    using (recipient_sales_id = public.current_sales_id())
    with check (recipient_sales_id = public.current_sales_id());
create policy ddc_delete on public.notifications for delete to authenticated
    using (recipient_sales_id = public.current_sales_id());

alter table public.quotation_approvals enable row level security;
create policy ddc_select on public.quotation_approvals for select to authenticated
    using (exists (select 1 from public.quotations q where q.id = quotation_approvals.quotation_id));

alter table public.document_references enable row level security;
create policy ddc_select on public.document_references for select to authenticated
    using (public.ddc_can_any_scope(public.ddc_entity_resource(entity_type), 'read'));
create policy ddc_insert on public.document_references for insert to authenticated
    with check (public.ddc_can_any_scope(public.ddc_entity_resource(entity_type), 'update'));
create policy ddc_update on public.document_references for update to authenticated
    using (public.ddc_can_any_scope(public.ddc_entity_resource(entity_type), 'update'))
    with check (public.ddc_can_any_scope(public.ddc_entity_resource(entity_type), 'update'));
create policy ddc_delete on public.document_references for delete to authenticated
    using (public.ddc_can_any_scope(public.ddc_entity_resource(entity_type), 'update'));

create trigger document_references_set_sales_id
    before insert on public.document_references
    for each row execute function public.set_sales_id_default();

--
-- Audit and updated_at triggers
--

do $$
declare
    t text;
begin
    for t in
        select table_name from public.table_permission_map
        union
        select unnest(array[
            'sales', 'configuration', 'ddc_roles', 'role_permissions', 'app_settings', 'approval_rules',
            'option_categories', 'quotation_approvals', 'document_references',
            'erp_connector_config', 'erp_legal_entities', 'erp_entity_configs', 'erp_field_mappings'
        ])
    loop
        execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.ddc_audit()', t);
    end loop;

    for t in
        select c.table_name
        from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'updated_at' and tb.table_type = 'BASE TABLE'
            and c.table_name <> 'deals'
    loop
        execute format('create trigger aa_touch_updated_at before update on public.%I for each row execute function public.ddc_touch_updated_at()', t);
    end loop;
end;
$$;

--
-- Search across DDC entities (security invoker: results follow the RLS policies)
--

create or replace function public.ddc_global_search(p_query text, p_max_results integer default 10)
    returns table(resource text, record_id bigint, title text, subtitle text)
    language sql stable
    set search_path to ''
    as $$
        with params as (
            select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pattern,
                least(greatest(coalesce(p_max_results, 10), 1), 50) as lim
            where length(btrim(coalesce(p_query, ''))) >= 2
        )
        (select 'products', p.id, p.part_number, p.name
            from public.products p, params
            where p.part_number ilike params.pattern or p.name ilike params.pattern or p.name_en ilike params.pattern
            order by p.part_number limit (select lim from params))
        union all
        (select 'leads', l.id, l.company_name, l.lead_no
            from public.leads l, params
            where l.company_name ilike params.pattern or l.lead_no ilike params.pattern or l.contact_name ilike params.pattern
            order by l.created_at desc limit (select lim from params))
        union all
        (select 'rfqs', r.id, r.rfq_no, r.subject
            from public.rfqs r, params
            where r.rfq_no ilike params.pattern or r.subject ilike params.pattern or r.customer_rfq_ref ilike params.pattern
            order by r.created_at desc limit (select lim from params))
        union all
        (select 'quotations', q.id, q.quotation_no || ' rev. ' || q.revision, q.subject
            from public.quotations q, params
            where q.quotation_no ilike params.pattern or q.subject ilike params.pattern
            order by q.created_at desc limit (select lim from params))
        union all
        (select 'dev_projects', d.id, d.project_no, d.name
            from public.dev_projects d, params
            where d.project_no ilike params.pattern or d.name ilike params.pattern
            order by d.created_at desc limit (select lim from params))
        union all
        (select 'service_cases', s.id, s.case_no, s.subject
            from public.service_cases s, params
            where s.case_no ilike params.pattern or s.subject ilike params.pattern
            order by s.created_at desc limit (select lim from params))
    $$;

--
-- Grants. RLS decides which rows; anon gets nothing on DDC objects.
--

do $$
declare
    t text;
    f text;
begin
    for t in
        select tablename from pg_tables
        where schemaname = 'public'
            and tablename not in (
                'companies', 'contacts', 'contact_notes', 'deals', 'deal_notes', 'sales', 'tags', 'tasks',
                'configuration', 'favicons_excluded_domains', 'user_invitations'
            )
    loop
        execute format('revoke all on table public.%I from anon', t);
        execute format('grant all on table public.%I to service_role', t);
        if t in ('audit_log', 'erp_external_ids', 'erp_sync_cursors', 'erp_sync_runs', 'erp_sync_errors', 'erp_sales_orders',
                'erp_sales_order_lines', 'erp_deliveries', 'erp_invoices', 'erp_inventory_availability',
                'erp_price_list_entries', 'quotation_approvals', 'table_permission_map') then
            execute format('revoke all on table public.%I from authenticated', t);
            execute format('grant select on table public.%I to authenticated', t);
        else
            execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
        end if;
    end loop;

    for t in
        select sequencename from pg_sequences
        where schemaname = 'public'
            and sequencename not in (
                'companies_id_seq', 'contactNotes_id_seq', 'contacts_id_seq', 'dealNotes_id_seq', 'deals_id_seq',
                'favicons_excluded_domains_id_seq', 'sales_id_seq', 'tags_id_seq', 'tasks_id_seq'
            )
    loop
        execute format('revoke all on sequence public.%I from anon', t);
        execute format('grant usage, select on sequence public.%I to authenticated', t);
        execute format('grant all on sequence public.%I to service_role', t);
    end loop;

    for f in
        select p.oid::regprocedure::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
            and (p.proname like 'ddc\_%' or p.proname in (
                'current_sales_id', 'current_role_key', 'convert_lead', 'submit_quotation',
                'decide_quotation_approval', 'set_quotation_status', 'create_quotation_revision'
            ))
    loop
        execute format('revoke all on function %s from public, anon', f);
        execute format('grant execute on function %s to authenticated, service_role', f);
    end loop;
end;
$$;

-- Anonymous visitors must not read or write business data through the Atomic CRM grants either
revoke all on table public.companies, public.contacts, public.contact_notes, public.deals, public.deal_notes,
    public.tasks, public.tags, public.sales, public.configuration from anon;

grant select on table public.companies_summary to authenticated, service_role;
grant select on table public.contacts_summary to authenticated, service_role;
