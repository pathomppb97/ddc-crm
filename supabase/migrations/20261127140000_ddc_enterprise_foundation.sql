--
-- DDC Agriculture CRM - Phase 1 Enterprise Architecture, Database & Security Foundation
--
-- Backward-compatible, additive migration:
--   1. Security hardening (SEC-01, SEC-05, SEC-06, SEC-08, SEC-09):
--      - Fix is_admin() to reject disabled accounts and recognize super_admin
--      - Add is_active_user() guard and revoke excess anon grants
--      - Harden RLS on tags, favicons_excluded_domains, sales, configuration,
--        RBAC metadata tables, document_references (parent-owner check), and storage.objects
--      - Enhance audit_log with request correlation metadata, secret redaction,
--        and oversized base64 payload truncation
--   2. Enterprise roles & control-plane permission resources
--   3. Optimistic concurrency (version) & soft deletion (deleted_at) on core CRM tables
--   4. Normalized missing enterprise CRM & organization tables:
--      teams, team_members, data_scopes, role_field_permissions, user_sessions,
--      login_history, service_accounts, api_keys, customer_segments, company_segments,
--      customer_machines, machine_specifications, price_lists, price_list_items,
--      sales_orders, sales_order_items, sales_targets, sales_forecasts, saved_views
--   5. Admin Control Plane tables & atomic RPCs:
--      ui_config_versions, feature_flags, feature_flag_history, releases, deployments,
--      scheduled_jobs, scheduled_job_logs, api_idempotency_keys, backup_records
--

-- ============================================================================
-- 1. Security Helper Hardening (SEC-01)
-- ============================================================================

create or replace function public.is_active_user() returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
        select exists (
            select 1
            from public.sales s
            where s.user_id = auth.uid()
              and not s.disabled
        )
    $$;

create or replace function public.is_admin() returns boolean
    language plpgsql security definer
    set search_path to ''
    as $$
begin
    return exists (
        select 1
        from public.sales s
        where s.user_id = auth.uid()
          and not s.disabled
          and (s.administrator = true or s.role_key = 'super_admin')
    );
end;
$$;

create or replace function public.ddc_can(p_resource text, p_action text, p_owner bigint default null) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
        select coalesce((
            select (s.administrator or s.role_key = 'super_admin') or exists (
                select 1
                from public.role_permissions rp
                where rp.role_key = s.role_key
                  and rp.resource = p_resource
                  and rp.action = p_action
                  and (rp.scope = 'all' or (rp.scope = 'own' and p_owner is not null and p_owner = s.id))
            )
            from public.sales s
            where s.user_id = auth.uid() and not s.disabled
        ), false)
    $$;

create or replace function public.ddc_can_any_scope(p_resource text, p_action text) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
        select coalesce((
            select (s.administrator or s.role_key = 'super_admin') or exists (
                select 1
                from public.role_permissions rp
                where rp.role_key = s.role_key
                  and rp.resource = p_resource
                  and rp.action = p_action
            )
            from public.sales s
            where s.user_id = auth.uid() and not s.disabled
        ), false)
    $$;

-- Parent-record ownership guard for polymorphic document_references (SEC-08)
create or replace function public.ddc_can_document_reference(
    p_entity_type text,
    p_entity_id bigint,
    p_action text
) returns boolean
    language plpgsql stable security definer
    set search_path to ''
    as $$
declare
    v_resource text := public.ddc_entity_resource(p_entity_type);
    v_owner bigint;
    v_exists boolean := false;
begin
    if v_resource is null or p_entity_id is null then
        return false;
    end if;

    case p_entity_type
        when 'companies' then
            select true, c.sales_id into v_exists, v_owner from public.companies c where c.id = p_entity_id;
        when 'leads' then
            select true, l.sales_id into v_exists, v_owner from public.leads l where l.id = p_entity_id;
        when 'deals' then
            select true, d.sales_id into v_exists, v_owner from public.deals d where d.id = p_entity_id;
        when 'activities' then
            select true, a.sales_id into v_exists, v_owner from public.activities a where a.id = p_entity_id;
        when 'products' then
            select true, null::bigint into v_exists, v_owner from public.products p where p.id = p_entity_id;
        when 'rfqs' then
            select true, r.sales_id into v_exists, v_owner from public.rfqs r where r.id = p_entity_id;
        when 'quotations' then
            select true, q.sales_id into v_exists, v_owner from public.quotations q where q.id = p_entity_id;
        when 'dev_projects' then
            select true, dp.sales_id into v_exists, v_owner from public.dev_projects dp where dp.id = p_entity_id;
        when 'service_cases' then
            select true, sc.sales_id into v_exists, v_owner from public.service_cases sc where sc.id = p_entity_id;
        else
            return false;
    end case;

    if not coalesce(v_exists, false) then
        return false;
    end if;

    return public.ddc_can(v_resource, p_action, v_owner);
end;
$$;

-- ============================================================================
-- 2. Audit Log Correlation, Secret Redaction & Base64 Truncation (SEC-09)
-- ============================================================================

alter table public.audit_log
    add column request_id text,
    add column actor_ip text,
    add column actor_user_agent text,
    add column reason text;

create index audit_log_request_id_idx on public.audit_log using btree (request_id) where request_id is not null;

create or replace function public.ddc_sanitize_audit_jsonb(p_payload jsonb) returns jsonb
    language plpgsql immutable
    set search_path to ''
    as $$
declare
    v_result jsonb := '{}'::jsonb;
    v_key text;
    v_val jsonb;
    v_str text;
begin
    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        return p_payload;
    end if;

    for v_key, v_val in select * from jsonb_each(p_payload) loop
        if lower(v_key) ~ '(password|secret|token|api_key|key_hash|mfa_secret|recovery_code|credential|private_key)' then
            v_result := v_result || jsonb_build_object(v_key, '[REDACTED]');
        elsif jsonb_typeof(v_val) = 'string' then
            v_str := v_val #>> '{}';
            if v_str like 'data:%' and length(v_str) > 2048 then
                v_result := v_result || jsonb_build_object(
                    v_key,
                    jsonb_build_object('redacted_data_uri', true, 'bytes', length(v_str))
                );
            else
                v_result := v_result || jsonb_build_object(v_key, v_val);
            end if;
        else
            v_result := v_result || jsonb_build_object(v_key, v_val);
        end if;
    end loop;

    return v_result;
end;
$$;

create or replace function public.ddc_audit() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_old jsonb;
    v_new jsonb;
    v_changed text[];
begin
    if tg_op <> 'INSERT' then
        v_old := public.ddc_sanitize_audit_jsonb(to_jsonb(old) - 'fts');
    end if;
    if tg_op <> 'DELETE' then
        v_new := public.ddc_sanitize_audit_jsonb(to_jsonb(new) - 'fts');
    end if;
    if tg_op = 'UPDATE' then
        select array_agg(n.key order by n.key) into v_changed
        from jsonb_each(v_new) n
        where n.value is distinct from (v_old -> n.key)
          and n.key not in ('updated_at', 'index', 'version');
        if v_changed is null then
            return null;
        end if;
    end if;

    insert into public.audit_log (
        actor_user_id,
        actor_sales_id,
        table_name,
        record_id,
        action,
        changed_fields,
        old_data,
        new_data,
        request_id,
        actor_ip,
        actor_user_agent,
        reason
    )
    values (
        auth.uid(),
        (select s.id from public.sales s where s.user_id = auth.uid()),
        tg_table_name,
        coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key', v_new ->> 'flag_key', v_old ->> 'flag_key'),
        tg_op,
        v_changed,
        v_old,
        v_new,
        nullif(current_setting('app.request_id', true), ''),
        nullif(current_setting('app.actor_ip', true), ''),
        nullif(current_setting('app.actor_user_agent', true), ''),
        nullif(current_setting('app.audit_reason', true), '')
    );
    return null;
end;
$$;

-- Optimistic concurrency helper
create or replace function public.ddc_bump_version() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
    if new.version is null or new.version <= old.version then
        new.version := old.version + 1;
    end if;
    return new;
end;
$$;

-- Keep quotation guard compatible with optimistic concurrency version bumps
create or replace function public.ddc_quotation_guard() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_free text[] := array['follow_up_date', 'updated_at', 'total_amount', 'version'];
begin
    if public.ddc_workflow_active() then
        return new;
    end if;
    if tg_op = 'INSERT' then
        if new.status <> 'draft' then
            raise exception 'A quotation must be created as a draft' using errcode = '42501';
        end if;
        return new;
    end if;
    if new.status is distinct from old.status then
        raise exception 'The quotation status can only be changed through the approval workflow' using errcode = '42501';
    end if;
    if old.status not in ('draft', 'rejected')
        and (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
        raise exception 'Quotation % is locked in status %: create a revision to change it', old.quotation_no, old.status
            using errcode = '42501';
    end if;
    return new;
end;
$$;

-- ============================================================================
-- 3. Harden Upstream Atomic CRM Policies, Storage & Anon Grants (SEC-05, SEC-06, SEC-08)
-- ============================================================================

do $$
declare
    t text;
begin
    -- Tighten RBAC & config metadata SELECT policies to active users only
    foreach t in array array[
        'ddc_roles', 'permission_resources', 'role_permissions', 'table_permission_map',
        'option_categories', 'app_settings', 'approval_rules'
    ] loop
        execute format('drop policy if exists ddc_select on public.%I', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.is_active_user())', t);
    end loop;
end;
$$;

drop policy if exists "Enable read for authenticated" on public.configuration;
drop policy if exists ddc_select on public.configuration;
create policy ddc_select on public.configuration for select to authenticated
    using (public.is_active_user());

drop policy if exists "Enable read access for authenticated users" on public.sales;
drop policy if exists ddc_select on public.sales;
create policy ddc_select on public.sales for select to authenticated
    using (public.is_active_user());

drop policy if exists "Enable read access for authenticated users" on public.tags;
drop policy if exists "Enable insert for authenticated users only" on public.tags;
drop policy if exists "Enable update for authenticated users only" on public.tags;
drop policy if exists "Enable delete for authenticated users only" on public.tags;
create policy ddc_select on public.tags for select to authenticated
    using (public.is_active_user());
create policy ddc_insert on public.tags for insert to authenticated
    with check (public.is_active_user() and (public.is_admin() or public.ddc_can_any_scope('contacts', 'update') or public.ddc_can_any_scope('master_data', 'create')));
create policy ddc_update on public.tags for update to authenticated
    using (public.is_active_user() and (public.is_admin() or public.ddc_can_any_scope('contacts', 'update') or public.ddc_can_any_scope('master_data', 'update')))
    with check (public.is_active_user() and (public.is_admin() or public.ddc_can_any_scope('contacts', 'update') or public.ddc_can_any_scope('master_data', 'update')));
create policy ddc_delete on public.tags for delete to authenticated
    using (public.is_active_user() and (public.is_admin() or public.ddc_can_any_scope('master_data', 'delete')));

drop policy if exists "Enable access for authenticated users only" on public.favicons_excluded_domains;
create policy ddc_select on public.favicons_excluded_domains for select to authenticated
    using (public.is_active_user());
create policy ddc_insert on public.favicons_excluded_domains for insert to authenticated
    with check (public.is_admin());
create policy ddc_update on public.favicons_excluded_domains for update to authenticated
    using (public.is_admin()) with check (public.is_admin());
create policy ddc_delete on public.favicons_excluded_domains for delete to authenticated
    using (public.is_admin());

-- Tighten document_references to parent-record ownership (SEC-08)
drop policy if exists ddc_select on public.document_references;
drop policy if exists ddc_insert on public.document_references;
drop policy if exists ddc_update on public.document_references;
drop policy if exists ddc_delete on public.document_references;
create policy ddc_select on public.document_references for select to authenticated
    using (public.ddc_can_document_reference(entity_type, entity_id, 'read'));
create policy ddc_insert on public.document_references for insert to authenticated
    with check (public.ddc_can_document_reference(entity_type, entity_id, 'update'));
create policy ddc_update on public.document_references for update to authenticated
    using (public.ddc_can_document_reference(entity_type, entity_id, 'update'))
    with check (public.ddc_can_document_reference(entity_type, entity_id, 'update'));
create policy ddc_delete on public.document_references for delete to authenticated
    using (public.ddc_can_document_reference(entity_type, entity_id, 'update'));

-- Harden storage.objects attachment policies (SEC-06)
drop policy if exists "Attachments 1mt4rzk_0" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_1" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_3" on storage.objects;
create policy ddc_attachments_select on storage.objects for select to authenticated
    using (bucket_id = 'attachments' and public.is_active_user());
create policy ddc_attachments_insert on storage.objects for insert to authenticated
    with check (
        bucket_id = 'attachments'
        and public.is_active_user()
        and (
            public.is_admin()
            or public.ddc_can_any_scope('customers', 'create')
            or public.ddc_can_any_scope('customers', 'update')
            or public.ddc_can_any_scope('contacts', 'create')
            or public.ddc_can_any_scope('contacts', 'update')
            or public.ddc_can_any_scope('activities', 'create')
            or public.ddc_can_any_scope('products', 'update')
            or public.ddc_can_any_scope('service_cases', 'create')
        )
    );
create policy ddc_attachments_delete on storage.objects for delete to authenticated
    using (
        bucket_id = 'attachments'
        and public.is_active_user()
        and (
            public.is_admin()
            or public.ddc_can_any_scope('customers', 'delete')
            or public.ddc_can_any_scope('contacts', 'delete')
            or public.ddc_can_any_scope('activities', 'delete')
            or public.ddc_can_any_scope('products', 'delete')
        )
    );

-- Revoke excessive anon grants from upstream Atomic CRM (SEC-05)
revoke all on table public.activity_log, public.favicons_excluded_domains from anon;
revoke all on table public.init_state from anon, authenticated;
grant select on table public.init_state to anon, authenticated, service_role;

revoke all on function public.get_avatar_for_email(text) from public, anon;
grant execute on function public.get_avatar_for_email(text) to authenticated, service_role;
revoke all on function public.get_domain_favicon(text) from public, anon;
grant execute on function public.get_domain_favicon(text) to authenticated, service_role;
revoke all on function public.merge_contacts(bigint, bigint) from public, anon;
grant execute on function public.merge_contacts(bigint, bigint) to authenticated, service_role;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
revoke all on function public.is_active_user() from public, anon;
grant execute on function public.is_active_user() to authenticated, service_role;
revoke all on function public.ddc_can_document_reference(text, bigint, text) from public, anon;
grant execute on function public.ddc_can_document_reference(text, bigint, text) to authenticated, service_role;
revoke all on function public.ddc_sanitize_audit_jsonb(jsonb) from public, anon;
grant execute on function public.ddc_sanitize_audit_jsonb(jsonb) to authenticated, service_role;
revoke all on function public.set_sales_id_default() from public, anon;
grant execute on function public.set_sales_id_default() to authenticated, service_role;

revoke all on sequence public.companies_id_seq, public."contactNotes_id_seq", public.contacts_id_seq,
    public."dealNotes_id_seq", public.deals_id_seq, public.favicons_excluded_domains_id_seq,
    public.sales_id_seq, public.tags_id_seq, public.tasks_id_seq from anon;

-- ============================================================================
-- 4. Enterprise Roles & Control-Plane Permission Resources
-- ============================================================================

insert into public.ddc_roles (key, name, name_en, description, is_system, sort_order) values
    ('super_admin', 'ผู้ดูแลระบบสูงสุด', 'Super Admin', 'Unrestricted enterprise platform governance and security control', true, 5),
    ('release_manager', 'ผู้จัดการการปล่อยระบบ', 'Release Manager', 'Manages immutable releases, staging/production deployments, feature flags, and UI publish approvals', true, 15),
    ('data_admin', 'ผู้ดูแลข้อมูล', 'Data Admin', 'Manages master data governance, bulk imports/exports, query builder, and backup verification', true, 18),
    ('executive_viewer', 'ผู้บริหารดูรายงาน', 'Executive Viewer', 'Read-only executive visibility into dashboards, KPIs, forecasts, targets, and audit summaries', true, 25)
on conflict (key) do nothing;

insert into public.permission_resources (key, name, name_en, sort_order) values
    ('sales_orders', 'ใบสั่งขาย (CRM)', 'Sales orders (CRM)', 105),
    ('admin_console', 'ศูนย์ควบคุมผู้ดูแลระบบ', 'Admin control center', 200),
    ('roles', 'บทบาทและสิทธิ์การใช้งาน', 'Roles and permissions', 210),
    ('data_management', 'การจัดการข้อมูลและคิวรี', 'Data management and queries', 220),
    ('api_management', 'การจัดการ API และคีย์', 'API and key management', 230),
    ('ui_config', 'การตั้งค่าหน้าเว็บและธีม', 'Configuration-driven UI', 240),
    ('feature_flags', 'การจัดการ Feature Flags', 'Feature flag management', 250),
    ('releases', 'การจัดการเวอร์ชัน (Release)', 'Release management', 260),
    ('deployments', 'การจัดการการ Deploy', 'Deployment management', 270),
    ('jobs', 'งานเบื้องหลังและตัวตั้งเวลา', 'Background jobs and scheduler', 280),
    ('backups', 'การสำรองและกู้คืนข้อมูล', 'Backup and recovery', 290),
    ('system_settings', 'การตั้งค่าระบบองค์กร', 'System settings', 300)
on conflict (key) do nothing;

-- Seed least-privilege permissions for new roles & resources
create function pg_temp.grant_perm_p1(p_role text, p_resources text[], p_actions text[], p_scope text default 'all') returns void
    language sql as $$
        insert into public.role_permissions (role_key, resource, action, scope)
        select p_role, r, a, p_scope from unnest(p_resources) r cross join unnest(p_actions) a
        on conflict (role_key, resource, action) do update set scope = excluded.scope
    $$;

-- Super Admin: all actions across all resources
select pg_temp.grant_perm_p1('super_admin',
    array['customers','contacts','leads','opportunities','activities','tasks','products','machine_applications',
          'rfqs','quotations','sales_orders','dev_projects','aftermarket','service_cases','master_data','reports',
          'erp_documents','erp_integration','audit_log','users','admin_console','roles','data_management',
          'api_management','ui_config','feature_flags','releases','deployments','jobs','backups','system_settings'],
    array['read','create','update','delete','approve','export','import']);

-- System Admin: extend existing role with new control-plane & sales_orders permissions
select pg_temp.grant_perm_p1('system_admin',
    array['sales_orders','admin_console','data_management','api_management','ui_config','feature_flags','jobs','backups','system_settings'],
    array['read','create','update','delete','approve','export','import']);
select pg_temp.grant_perm_p1('system_admin', array['roles'], array['read','create','update']);
select pg_temp.grant_perm_p1('system_admin', array['releases','deployments'], array['read']);

-- Release Manager
select pg_temp.grant_perm_p1('release_manager', array['admin_console','audit_log'], array['read']);
select pg_temp.grant_perm_p1('release_manager', array['releases','deployments','feature_flags'], array['read','create','update','approve']);
select pg_temp.grant_perm_p1('release_manager', array['ui_config'], array['read','approve']);
select pg_temp.grant_perm_p1('release_manager', array['jobs'], array['read','create']);

-- Data Admin
select pg_temp.grant_perm_p1('data_admin',
    array['admin_console','users','audit_log','erp_documents'], array['read']);
select pg_temp.grant_perm_p1('data_admin', array['audit_log'], array['export']);
select pg_temp.grant_perm_p1('data_admin',
    array['customers','contacts','leads','opportunities','products','machine_applications','master_data','data_management'],
    array['read','create','update','import','export']);
select pg_temp.grant_perm_p1('data_admin',
    array['activities','tasks','rfqs','quotations','sales_orders','dev_projects','aftermarket','service_cases','reports'],
    array['read','export']);
select pg_temp.grant_perm_p1('data_admin', array['jobs'], array['read','create','update']);
select pg_temp.grant_perm_p1('data_admin', array['backups'], array['read','create']);

-- Executive Viewer
select pg_temp.grant_perm_p1('executive_viewer',
    array['customers','contacts','leads','opportunities','activities','products','machine_applications',
          'rfqs','quotations','sales_orders','dev_projects','aftermarket','service_cases','master_data',
          'reports','erp_documents','audit_log'],
    array['read']);
select pg_temp.grant_perm_p1('executive_viewer',
    array['customers','opportunities','quotations','sales_orders','reports'],
    array['export']);

-- Operational roles: add sales_orders parity
select pg_temp.grant_perm_p1('management', array['sales_orders'], array['read','export']);
select pg_temp.grant_perm_p1('sales_manager', array['sales_orders'], array['read','create','update','export']);
select pg_temp.grant_perm_p1('sales_rep', array['sales_orders'], array['read','create']);
select pg_temp.grant_perm_p1('sales_rep', array['sales_orders'], array['update'], 'own');
select pg_temp.grant_perm_p1('engineering', array['sales_orders'], array['read']);
select pg_temp.grant_perm_p1('finance', array['sales_orders'], array['read','export']);
select pg_temp.grant_perm_p1('read_only', array['sales_orders'], array['read']);

-- ============================================================================
-- 5. Backward-Compatible Concurrency (version) & Soft Delete (deleted_at)
-- ============================================================================

alter table public.companies
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.contacts
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.leads
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.deals
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.products
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.rfqs
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

alter table public.quotations
    add column version integer not null default 1 check (version >= 1),
    add column deleted_at timestamp with time zone;

create index companies_not_deleted_idx on public.companies using btree (id) where deleted_at is null;
create index contacts_not_deleted_idx on public.contacts using btree (id) where deleted_at is null;
create index leads_not_deleted_idx on public.leads using btree (id) where deleted_at is null;
create index deals_not_deleted_idx on public.deals using btree (id) where deleted_at is null;
create index products_not_deleted_idx on public.products using btree (id) where deleted_at is null;
create index rfqs_not_deleted_idx on public.rfqs using btree (id) where deleted_at is null;
create index quotations_not_deleted_idx on public.quotations using btree (id) where deleted_at is null;

-- ============================================================================
-- 6. Organization, Identity, Data Scope & Security Tables
-- ============================================================================

create table public.data_scopes (
    id bigint generated by default as identity primary key,
    code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
    name text not null,
    name_en text,
    scope_type text not null default 'own' check (scope_type in ('own', 'team', 'territory', 'all')),
    territory_ids bigint[] not null default '{}'::bigint[],
    team_ids bigint[] not null default '{}'::bigint[],
    custom_filter jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_filter) = 'object'),
    is_active boolean not null default true,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create table public.teams (
    id bigint generated by default as identity primary key,
    code text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
    name text not null,
    name_en text,
    parent_team_id bigint references public.teams(id) on delete set null,
    territory_id bigint references public.territories(id) on delete set null,
    manager_sales_id bigint references public.sales(id) on delete set null,
    is_active boolean not null default true,
    version integer not null default 1 check (version >= 1),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint teams_not_own_parent check (parent_team_id is null or parent_team_id <> id)
);

create index teams_parent_idx on public.teams using btree (parent_team_id);
create index teams_territory_idx on public.teams using btree (territory_id);

create table public.team_members (
    id bigint generated by default as identity primary key,
    team_id bigint not null references public.teams(id) on delete cascade,
    sales_id bigint not null references public.sales(id) on delete cascade,
    team_role text not null default 'member' check (team_role in ('member', 'lead', 'manager')),
    created_at timestamp with time zone not null default now(),
    constraint team_members_unique unique (team_id, sales_id)
);

create index team_members_sales_idx on public.team_members using btree (sales_id);

alter table public.sales
    add column mfa_enabled boolean not null default false,
    add column mfa_enforced boolean not null default false,
    add column last_login_at timestamp with time zone,
    add column primary_territory_id bigint references public.territories(id) on delete set null,
    add column default_data_scope_id bigint references public.data_scopes(id) on delete set null;

create table public.role_field_permissions (
    id bigint generated by default as identity primary key,
    role_key text not null references public.ddc_roles(key) on update cascade on delete cascade,
    resource text not null references public.permission_resources(key) on update cascade on delete cascade,
    field_name text not null check (field_name ~ '^[a-z][a-z0-9_]*$'),
    access_level text not null default 'read' check (access_level in ('hidden', 'masked', 'read', 'write')),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint role_field_permissions_unique unique (role_key, resource, field_name)
);

create index role_field_permissions_role_idx on public.role_field_permissions using btree (role_key, resource);

create table public.user_sessions (
    id bigint generated by default as identity primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    sales_id bigint not null references public.sales(id) on delete cascade,
    session_token_hash text not null unique,
    ip_address text,
    user_agent text,
    mfa_verified boolean not null default false,
    created_at timestamp with time zone not null default now(),
    last_seen_at timestamp with time zone not null default now(),
    expires_at timestamp with time zone not null,
    revoked_at timestamp with time zone,
    revoked_by_sales_id bigint references public.sales(id) on delete set null,
    revoke_reason text
);

create index user_sessions_sales_active_idx on public.user_sessions using btree (sales_id, expires_at) where revoked_at is null;

create table public.login_history (
    id bigint generated by default as identity primary key,
    user_id uuid,
    sales_id bigint references public.sales(id) on delete set null,
    email text,
    event_type text not null check (event_type in (
        'login_success', 'login_failed', 'logout', 'force_logout',
        'mfa_challenge', 'mfa_verified', 'password_reset'
    )),
    ip_address text,
    user_agent text,
    request_id text,
    failure_reason text,
    occurred_at timestamp with time zone not null default now()
);

create index login_history_sales_idx on public.login_history using btree (sales_id, occurred_at desc);
create index login_history_occurred_idx on public.login_history using btree (occurred_at desc);

create table public.service_accounts (
    id bigint generated by default as identity primary key,
    code text not null unique check (code ~ '^[a-z][a-z0-9_-]*$'),
    name text not null,
    description text,
    role_key text not null references public.ddc_roles(key) on update cascade,
    is_active boolean not null default true,
    created_by_sales_id bigint references public.sales(id) on delete set null,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create table public.api_keys (
    id bigint generated by default as identity primary key,
    name text not null,
    key_prefix text not null check (length(key_prefix) between 6 and 20),
    key_hash text not null unique,
    owner_sales_id bigint references public.sales(id) on delete cascade,
    service_account_id bigint references public.service_accounts(id) on delete cascade,
    scopes text[] not null default '{}'::text[],
    rate_limit_per_min integer not null default 120 check (rate_limit_per_min between 1 and 10000),
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by_sales_id bigint references public.sales(id) on delete set null,
    created_at timestamp with time zone not null default now(),
    constraint api_keys_single_principal check (num_nonnulls(owner_sales_id, service_account_id) = 1)
);

create index api_keys_active_idx on public.api_keys using btree (key_prefix) where revoked_at is null;

-- ============================================================================
-- 7. Normalized Enterprise Agriculture CRM Domain Tables
-- ============================================================================

create table public.customer_segments (
    id bigint generated by default as identity primary key,
    code text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
    name text not null,
    name_en text,
    description text,
    criteria jsonb not null default '{}'::jsonb check (jsonb_typeof(criteria) = 'object'),
    is_active boolean not null default true,
    sort_order integer not null default 0,
    version integer not null default 1 check (version >= 1),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create table public.company_segments (
    id bigint generated by default as identity primary key,
    company_id bigint not null references public.companies(id) on delete cascade,
    segment_id bigint not null references public.customer_segments(id) on delete cascade,
    assigned_at timestamp with time zone not null default now(),
    constraint company_segments_unique unique (company_id, segment_id)
);

create index company_segments_segment_idx on public.company_segments using btree (segment_id);

create table public.machine_specifications (
    id bigint generated by default as identity primary key,
    machine_model_id bigint not null references public.machine_models(id) on delete cascade,
    spec_group text not null default 'specification' check (spec_group in ('specification', 'dimension', 'powertrain', 'hydraulic', 'harvesting')),
    name text not null,
    value text not null,
    unit text,
    source text,
    sort_order integer not null default 0,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index machine_specifications_model_idx on public.machine_specifications using btree (machine_model_id, spec_group, sort_order);

create table public.customer_machines (
    id bigint generated by default as identity primary key,
    company_id bigint not null references public.companies(id) on delete cascade,
    machine_model_id bigint not null references public.machine_models(id) on delete restrict,
    serial_number text,
    unit_count integer not null default 1 check (unit_count > 0),
    model_year integer check (model_year is null or model_year between 1950 and 2200),
    operating_hours numeric(12, 1) check (operating_hours is null or operating_hours >= 0),
    status text not null default 'active' check (status in ('active', 'seasonal_idle', 'under_repair', 'retired')),
    location_note text,
    notes text,
    sales_id bigint references public.sales(id),
    version integer not null default 1 check (version >= 1),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index customer_machines_company_idx on public.customer_machines using btree (company_id) where deleted_at is null;
create index customer_machines_model_idx on public.customer_machines using btree (machine_model_id);

create trigger customer_machines_set_sales_id
    before insert on public.customer_machines
    for each row execute function public.set_sales_id_default();

create table public.price_lists (
    id bigint generated by default as identity primary key,
    code text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
    name text not null,
    name_en text,
    currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
    customer_segment_id bigint references public.customer_segments(id) on delete set null,
    valid_from date,
    valid_to date,
    is_default boolean not null default false,
    is_active boolean not null default true,
    notes text,
    version integer not null default 1 check (version >= 1),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint price_lists_dates_ordered check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create table public.price_list_items (
    id bigint generated by default as identity primary key,
    price_list_id bigint not null references public.price_lists(id) on delete cascade,
    product_id bigint not null references public.products(id) on delete restrict,
    min_qty numeric(18, 3) not null default 1 check (min_qty > 0),
    unit_price numeric(18, 4) not null check (unit_price >= 0),
    discount_max_percent numeric(5, 2) not null default 0 check (discount_max_percent between 0 and 100),
    uom text,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint price_list_items_unique unique (price_list_id, product_id, min_qty)
);

create index price_list_items_product_idx on public.price_list_items using btree (product_id);

create sequence public.sales_order_no_seq;

create table public.sales_orders (
    id bigint generated by default as identity primary key,
    order_no text unique,
    company_id bigint not null references public.companies(id) on delete restrict,
    contact_id bigint references public.contacts(id) on delete set null,
    deal_id bigint references public.deals(id) on delete set null,
    quotation_id bigint references public.quotations(id) on delete set null,
    erp_sales_order_id bigint references public.erp_sales_orders(id) on delete set null,
    currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
    status text not null default 'draft' check (status in ('draft', 'confirmed', 'in_fulfillment', 'partially_delivered', 'delivered', 'cancelled')),
    order_date date not null default current_date,
    requested_delivery_date date,
    total_amount numeric(18, 4) not null default 0 check (total_amount >= 0),
    notes text,
    sales_id bigint references public.sales(id),
    version integer not null default 1 check (version >= 1),
    deleted_at timestamp with time zone,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index sales_orders_company_idx on public.sales_orders using btree (company_id, order_date desc);
create index sales_orders_status_idx on public.sales_orders using btree (status);
create index sales_orders_sales_idx on public.sales_orders using btree (sales_id);

create trigger sales_orders_assign_no
    before insert on public.sales_orders
    for each row execute function public.ddc_assign_doc_no('order_no', 'SO', 'sales_order_no_seq');

create trigger sales_orders_set_sales_id
    before insert on public.sales_orders
    for each row execute function public.set_sales_id_default();

create trigger sales_orders_check_company_links
    before insert or update on public.sales_orders
    for each row execute function public.ddc_check_company_links();

create table public.sales_order_items (
    id bigint generated by default as identity primary key,
    sales_order_id bigint not null references public.sales_orders(id) on delete cascade,
    line_no integer not null,
    product_id bigint references public.products(id) on delete restrict,
    description text,
    quantity numeric(18, 3) not null check (quantity > 0),
    uom text,
    unit_price numeric(18, 4) not null check (unit_price >= 0),
    discount_percent numeric(5, 2) not null default 0 check (discount_percent between 0 and 100),
    line_total numeric(18, 4) generated always as (round(quantity * unit_price * (1 - discount_percent / 100), 4)) stored,
    notes text,
    constraint sales_order_items_unique unique (sales_order_id, line_no),
    constraint sales_order_items_identified check (num_nonnulls(product_id, description) >= 1)
);

create index sales_order_items_product_idx on public.sales_order_items using btree (product_id);

create table public.sales_targets (
    id bigint generated by default as identity primary key,
    period_type text not null default 'quarterly' check (period_type in ('monthly', 'quarterly', 'seasonal', 'annual')),
    period_start date not null,
    period_end date not null,
    sales_id bigint references public.sales(id) on delete set null,
    team_id bigint references public.teams(id) on delete set null,
    territory_id bigint references public.territories(id) on delete set null,
    product_family_id bigint references public.product_hierarchy_nodes(id) on delete set null,
    currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
    target_amount numeric(18, 2) not null default 0 check (target_amount >= 0),
    target_units numeric(18, 2) check (target_units is null or target_units >= 0),
    notes text,
    version integer not null default 1 check (version >= 1),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint sales_targets_period_ordered check (period_end >= period_start)
);

create index sales_targets_period_idx on public.sales_targets using btree (period_start, period_end);
create index sales_targets_sales_idx on public.sales_targets using btree (sales_id);

create table public.sales_forecasts (
    id bigint generated by default as identity primary key,
    period_start date not null,
    period_end date not null,
    sales_id bigint references public.sales(id) on delete set null,
    team_id bigint references public.teams(id) on delete set null,
    territory_id bigint references public.territories(id) on delete set null,
    currency text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
    committed_amount numeric(18, 2) not null default 0 check (committed_amount >= 0),
    best_case_amount numeric(18, 2) not null default 0 check (best_case_amount >= 0),
    pipeline_amount numeric(18, 2) not null default 0 check (pipeline_amount >= 0),
    closed_amount numeric(18, 2) not null default 0 check (closed_amount >= 0),
    status text not null default 'draft' check (status in ('draft', 'submitted', 'locked')),
    submitted_at timestamp with time zone,
    notes text,
    version integer not null default 1 check (version >= 1),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint sales_forecasts_period_ordered check (period_end >= period_start)
);

create index sales_forecasts_period_idx on public.sales_forecasts using btree (period_start, period_end);

create table public.saved_views (
    id bigint generated by default as identity primary key,
    resource text not null check (resource ~ '^[a-z][a-z0-9_]*$'),
    name text not null,
    description text,
    view_type text not null default 'table' check (view_type in ('table', 'kanban', 'query')),
    query_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(query_definition) = 'object'),
    columns_config jsonb not null default '[]'::jsonb check (jsonb_typeof(columns_config) = 'array'),
    is_shared boolean not null default false,
    owner_sales_id bigint not null references public.sales(id) on delete cascade,
    version integer not null default 1 check (version >= 1),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index saved_views_resource_idx on public.saved_views using btree (resource, owner_sales_id);

-- ============================================================================
-- 8. Admin Control Plane: UI Config Versions, Feature Flags, Releases, Jobs, Backups
-- ============================================================================

create table public.ui_config_versions (
    id bigint generated by default as identity primary key,
    environment text not null default 'production' check (environment in ('development', 'staging', 'production')),
    version_number integer not null check (version_number >= 1),
    status text not null default 'draft' check (status in ('draft', 'validated', 'approved', 'scheduled', 'published', 'superseded', 'rolled_back')),
    config_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(config_payload) = 'object'),
    change_summary text,
    validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
    checksum text,
    created_by_sales_id bigint references public.sales(id) on delete set null,
    approved_by_sales_id bigint references public.sales(id) on delete set null,
    approved_at timestamp with time zone,
    scheduled_publish_at timestamp with time zone,
    published_at timestamp with time zone,
    rolled_back_from_id bigint references public.ui_config_versions(id) on delete set null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint ui_config_versions_env_num_unique unique (environment, version_number)
);

-- Atomic single active published UI configuration per environment
create unique index ui_config_versions_one_published_per_env
    on public.ui_config_versions using btree (environment)
    where status = 'published';

create index ui_config_versions_env_status_idx
    on public.ui_config_versions using btree (environment, status, created_at desc);

create table public.feature_flags (
    id bigint generated by default as identity primary key,
    flag_key text not null unique check (flag_key ~ '^[a-z][a-z0-9_.-]*$'),
    name text not null,
    description text,
    is_enabled boolean not null default false,
    kill_switch boolean not null default false,
    rollout_percentage smallint not null default 0 check (rollout_percentage between 0 and 100),
    target_user_ids bigint[] not null default '{}'::bigint[],
    target_role_keys text[] not null default '{}'::text[],
    target_team_ids bigint[] not null default '{}'::bigint[],
    scheduled_enable_at timestamp with time zone,
    scheduled_disable_at timestamp with time zone,
    version integer not null default 1 check (version >= 1),
    created_by_sales_id bigint references public.sales(id) on delete set null,
    updated_by_sales_id bigint references public.sales(id) on delete set null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint feature_flags_schedule_ordered check (
        scheduled_disable_at is null or scheduled_enable_at is null or scheduled_disable_at > scheduled_enable_at
    )
);

create table public.feature_flag_history (
    id bigint generated by default as identity primary key,
    flag_id bigint not null references public.feature_flags(id) on delete cascade,
    flag_key text not null,
    change_type text not null check (change_type in ('created', 'updated', 'toggled', 'kill_switch', 'scheduled', 'deleted')),
    previous_state jsonb,
    new_state jsonb,
    changed_by_sales_id bigint references public.sales(id) on delete set null,
    reason text,
    occurred_at timestamp with time zone not null default now()
);

create index feature_flag_history_flag_idx on public.feature_flag_history using btree (flag_id, occurred_at desc);

create table public.releases (
    id bigint generated by default as identity primary key,
    release_tag text not null unique check (release_tag ~ '^[A-Za-z0-9._+-]+$'),
    environment text not null default 'staging' check (environment in ('development', 'staging', 'production')),
    app_target text not null default 'fullstack' check (app_target in ('crm', 'admin', 'api', 'worker', 'fullstack')),
    git_sha text not null check (git_sha ~ '^[0-9a-fA-F]{7,40}$'),
    artifact_uri text not null,
    artifact_checksum text not null,
    build_status text not null default 'pending' check (build_status in ('pending', 'building', 'succeeded', 'failed')),
    approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
    approved_by_sales_id bigint references public.sales(id) on delete set null,
    approved_at timestamp with time zone,
    notes text,
    created_by_sales_id bigint references public.sales(id) on delete set null,
    created_at timestamp with time zone not null default now()
);

create index releases_env_created_idx on public.releases using btree (environment, created_at desc);

create table public.deployments (
    id bigint generated by default as identity primary key,
    release_id bigint not null references public.releases(id) on delete restrict,
    environment text not null check (environment in ('development', 'staging', 'production')),
    strategy text not null default 'blue_green' check (strategy in ('blue_green', 'atomic_switch', 'rolling')),
    status text not null default 'pending' check (status in (
        'pending', 'approved', 'scheduled', 'running', 'verifying',
        'succeeded', 'failed', 'rolled_back', 'cancelled'
    )),
    scheduled_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    previous_deployment_id bigint references public.deployments(id) on delete set null,
    health_check_status text not null default 'pending' check (health_check_status in ('pending', 'passed', 'failed')),
    smoke_test_status text not null default 'pending' check (smoke_test_status in ('pending', 'passed', 'failed')),
    logs_excerpt text,
    triggered_by_sales_id bigint references public.sales(id) on delete set null,
    approved_by_sales_id bigint references public.sales(id) on delete set null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index deployments_env_created_idx on public.deployments using btree (environment, created_at desc);
create index deployments_scheduled_idx on public.deployments using btree (scheduled_at) where status = 'scheduled';

-- Production deployments MUST reference an approved, build-succeeded release artifact
create or replace function public.ddc_guard_production_deployment() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_release public.releases%rowtype;
begin
    if new.environment = 'production' and new.status in ('approved', 'scheduled', 'running', 'verifying', 'succeeded') then
        select * into v_release from public.releases where id = new.release_id;
        if not found then
            raise exception 'Release % not found', new.release_id using errcode = 'P0002';
        end if;
        if v_release.build_status <> 'succeeded' then
            raise exception 'Production deployment requires a release with build_status = succeeded' using errcode = '23514';
        end if;
        if v_release.approval_status <> 'approved' then
            raise exception 'Production deployment requires an approved release artifact' using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

create trigger deployments_guard_production
    before insert or update on public.deployments
    for each row execute function public.ddc_guard_production_deployment();

create table public.scheduled_jobs (
    id bigint generated by default as identity primary key,
    job_type text not null check (job_type in (
        'scheduled_deployment', 'scheduled_config_publish', 'scheduled_feature_flag',
        'data_import', 'data_export', 'report_generation',
        'notification_dispatch', 'erp_sync', 'database_backup', 'data_retention_cleanup'
    )),
    queue_name text not null default 'default' check (queue_name ~ '^[a-z][a-z0-9_-]*$'),
    idempotency_key text,
    status text not null default 'pending' check (status in (
        'pending', 'scheduled', 'running', 'completed', 'failed', 'cancelled', 'retrying'
    )),
    payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
    result jsonb,
    error_message text,
    scheduled_at timestamp with time zone not null default now(),
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    max_attempts integer not null default 3 check (max_attempts between 1 and 20),
    attempt_count integer not null default 0 check (attempt_count >= 0),
    next_retry_at timestamp with time zone,
    locked_by text,
    locked_until timestamp with time zone,
    created_by_sales_id bigint references public.sales(id) on delete set null,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index scheduled_jobs_claim_idx
    on public.scheduled_jobs using btree (queue_name, scheduled_at, next_retry_at)
    where status in ('pending', 'scheduled', 'retrying');
create index scheduled_jobs_status_idx on public.scheduled_jobs using btree (status, created_at desc);
create unique index scheduled_jobs_active_idempotency_idx
    on public.scheduled_jobs using btree (job_type, idempotency_key)
    where idempotency_key is not null and status in ('pending', 'scheduled', 'running', 'retrying');

create table public.scheduled_job_logs (
    id bigint generated by default as identity primary key,
    job_id bigint not null references public.scheduled_jobs(id) on delete cascade,
    attempt_no integer not null default 1 check (attempt_no >= 1),
    level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
    message text not null,
    details jsonb not null default '{}'::jsonb,
    logged_at timestamp with time zone not null default now()
);

create index scheduled_job_logs_job_idx on public.scheduled_job_logs using btree (job_id, logged_at desc);

create table public.api_idempotency_keys (
    id bigint generated by default as identity primary key,
    idempotency_key text not null check (length(idempotency_key) between 1 and 128),
    actor_user_id uuid not null,
    endpoint text not null,
    request_hash text not null,
    response_status integer not null,
    response_body jsonb not null default '{}'::jsonb,
    created_at timestamp with time zone not null default now(),
    expires_at timestamp with time zone not null default (now() + interval '24 hours'),
    constraint api_idempotency_keys_unique unique (actor_user_id, endpoint, idempotency_key)
);

create index api_idempotency_keys_expires_idx on public.api_idempotency_keys using btree (expires_at);

create table public.backup_records (
    id bigint generated by default as identity primary key,
    backup_type text not null check (backup_type in ('full', 'incremental', 'pre_migration', 'manual')),
    environment text not null default 'production' check (environment in ('development', 'staging', 'production')),
    status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'verified', 'failed')),
    storage_uri text,
    checksum text,
    size_bytes bigint check (size_bytes is null or size_bytes >= 0),
    retention_until timestamp with time zone,
    verified_at timestamp with time zone,
    initiated_by_sales_id bigint references public.sales(id) on delete set null,
    notes text,
    created_at timestamp with time zone not null default now()
);

create index backup_records_env_created_idx on public.backup_records using btree (environment, created_at desc);

-- ============================================================================
-- 9. Atomic Control-Plane RPCs (UI Config Publish/Rollback & Job Lease Claim)
-- ============================================================================

create or replace function public.publish_ui_config_version(p_version_id bigint)
    returns public.ui_config_versions
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_target public.ui_config_versions%rowtype;
begin
    if not public.ddc_can('ui_config', 'approve') then
        raise exception 'Not allowed to publish UI configuration' using errcode = '42501';
    end if;

    select * into v_target from public.ui_config_versions where id = p_version_id for update;
    if not found then
        raise exception 'UI configuration version % not found', p_version_id using errcode = 'P0002';
    end if;
    if v_target.status not in ('approved', 'scheduled') then
        raise exception 'UI configuration version % must be approved or scheduled before publishing (current: %)',
            p_version_id, v_target.status using errcode = '22023';
    end if;
    if jsonb_array_length(v_target.validation_errors) > 0 then
        raise exception 'UI configuration version % has validation errors and cannot be published',
            p_version_id using errcode = '22023';
    end if;

    -- Atomically supersede active version for the same environment
    update public.ui_config_versions
    set status = 'superseded'
    where environment = v_target.environment
      and status = 'published'
      and id <> v_target.id;

    update public.ui_config_versions
    set status = 'published',
        published_at = now(),
        approved_by_sales_id = coalesce(approved_by_sales_id, public.current_sales_id()),
        approved_at = coalesce(approved_at, now())
    where id = v_target.id
    returning * into v_target;

    return v_target;
end;
$$;

create or replace function public.rollback_ui_config_version(
    p_target_version_id bigint,
    p_reason text default null
) returns public.ui_config_versions
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_source public.ui_config_versions%rowtype;
    v_active public.ui_config_versions%rowtype;
    v_next_num integer;
    v_created public.ui_config_versions%rowtype;
begin
    if not public.ddc_can('ui_config', 'approve') then
        raise exception 'Not allowed to roll back UI configuration' using errcode = '42501';
    end if;

    select * into v_source from public.ui_config_versions where id = p_target_version_id;
    if not found then
        raise exception 'Target UI configuration version % not found', p_target_version_id using errcode = 'P0002';
    end if;
    if v_source.status not in ('superseded', 'published', 'approved') then
        raise exception 'Cannot roll back to version in status %', v_source.status using errcode = '22023';
    end if;

    select * into v_active
    from public.ui_config_versions
    where environment = v_source.environment and status = 'published'
    for update;

    if v_active.id is not null then
        update public.ui_config_versions set status = 'rolled_back' where id = v_active.id;
    end if;

    select coalesce(max(version_number), 0) + 1 into v_next_num
    from public.ui_config_versions
    where environment = v_source.environment;

    insert into public.ui_config_versions (
        environment, version_number, status, config_payload, change_summary,
        validation_errors, checksum, created_by_sales_id, approved_by_sales_id,
        approved_at, published_at, rolled_back_from_id
    )
    values (
        v_source.environment,
        v_next_num,
        'published',
        v_source.config_payload,
        coalesce(nullif(btrim(p_reason), ''), 'Rollback to version ' || v_source.version_number),
        '[]'::jsonb,
        v_source.checksum,
        public.current_sales_id(),
        public.current_sales_id(),
        now(),
        now(),
        coalesce(v_active.id, v_source.id)
    )
    returning * into v_created;

    return v_created;
end;
$$;

-- Distributed worker lease claim using FOR UPDATE SKIP LOCKED
create or replace function public.claim_scheduled_job(
    p_worker_id text,
    p_queue_name text default 'default',
    p_lease_seconds integer default 300
) returns public.scheduled_jobs
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_job public.scheduled_jobs%rowtype;
begin
    if coalesce(btrim(p_worker_id), '') = '' then
        raise exception 'p_worker_id is required' using errcode = '22023';
    end if;

    select * into v_job
    from public.scheduled_jobs j
    where j.queue_name = p_queue_name
      and (
          (j.status in ('pending', 'scheduled') and j.scheduled_at <= now())
          or (j.status = 'retrying' and coalesce(j.next_retry_at, j.scheduled_at) <= now())
          or (j.status = 'running' and j.locked_until is not null and j.locked_until < now())
      )
      and j.attempt_count < j.max_attempts
    order by j.scheduled_at asc, j.id asc
    for update skip locked
    limit 1;

    if not found then
        return null;
    end if;

    update public.scheduled_jobs
    set status = 'running',
        started_at = coalesce(started_at, now()),
        attempt_count = attempt_count + 1,
        locked_by = p_worker_id,
        locked_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 300), 30))
    where id = v_job.id
    returning * into v_job;

    return v_job;
end;
$$;

-- ============================================================================
-- 10. RLS Policies, Audit Triggers, Version/Updated Triggers & Grants for Phase 1 Tables
-- ============================================================================

insert into public.table_permission_map (table_name, resource, owner_column, parent_table, parent_fk, parent_owner_column) values
    ('customer_segments', 'master_data', null, null, null, null),
    ('company_segments', 'customers', null, 'companies', 'company_id', 'sales_id'),
    ('machine_specifications', 'machine_applications', null, 'machine_models', 'machine_model_id', null),
    ('customer_machines', 'customers', 'sales_id', null, null, null),
    ('price_lists', 'products', null, null, null, null),
    ('price_list_items', 'products', null, 'price_lists', 'price_list_id', null),
    ('sales_orders', 'sales_orders', 'sales_id', null, null, null),
    ('sales_order_items', 'sales_orders', null, 'sales_orders', 'sales_order_id', 'sales_id'),
    ('sales_targets', 'reports', 'sales_id', null, null, null),
    ('sales_forecasts', 'reports', 'sales_id', null, null, null)
on conflict (table_name) do nothing;

do $$
declare
    m record;
    v_owner text;
    t text;
begin
    -- Generate standard business RLS policies for newly mapped tables
    for m in
        select * from public.table_permission_map
        where table_name in (
            'customer_segments', 'company_segments', 'machine_specifications', 'customer_machines',
            'price_lists', 'price_list_items', 'sales_orders', 'sales_order_items',
            'sales_targets', 'sales_forecasts'
        )
        order by table_name
    loop
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

    -- Organization & RBAC tables: active users read, admins/users-managers write
    foreach t in array array['teams', 'team_members', 'data_scopes', 'role_field_permissions'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.is_active_user())', t);
        execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.is_admin() or public.ddc_can(''roles'', ''update''))', t);
        execute format('create policy ddc_update on public.%I for update to authenticated using (public.is_admin() or public.ddc_can(''roles'', ''update'')) with check (public.is_admin() or public.ddc_can(''roles'', ''update''))', t);
        execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.is_admin() or public.ddc_can(''roles'', ''delete''))', t);
    end loop;

    -- Control-plane tables mapped to explicit resources
    -- ui_config_versions: active users can read published config; ui_config holders manage drafts
    alter table public.ui_config_versions enable row level security;
    create policy ddc_select on public.ui_config_versions for select to authenticated
        using (public.is_active_user() and (status = 'published' or public.ddc_can('ui_config', 'read')));
    create policy ddc_insert on public.ui_config_versions for insert to authenticated
        with check (public.ddc_can('ui_config', 'create'));
    create policy ddc_update on public.ui_config_versions for update to authenticated
        using (public.ddc_can('ui_config', 'update'))
        with check (public.ddc_can('ui_config', 'update'));
    create policy ddc_delete on public.ui_config_versions for delete to authenticated
        using (public.ddc_can('ui_config', 'delete') and status = 'draft');

    -- feature_flags: active users can evaluate flags; feature_flags holders manage
    alter table public.feature_flags enable row level security;
    create policy ddc_select on public.feature_flags for select to authenticated
        using (public.is_active_user());
    create policy ddc_insert on public.feature_flags for insert to authenticated
        with check (public.ddc_can('feature_flags', 'create'));
    create policy ddc_update on public.feature_flags for update to authenticated
        using (public.ddc_can('feature_flags', 'update'))
        with check (public.ddc_can('feature_flags', 'update'));
    create policy ddc_delete on public.feature_flags for delete to authenticated
        using (public.ddc_can('feature_flags', 'delete'));

    alter table public.feature_flag_history enable row level security;
    create policy ddc_select on public.feature_flag_history for select to authenticated
        using (public.ddc_can('feature_flags', 'read') or public.ddc_can('audit_log', 'read'));

    -- releases & deployments
    alter table public.releases enable row level security;
    create policy ddc_select on public.releases for select to authenticated using (public.ddc_can('releases', 'read'));
    create policy ddc_insert on public.releases for insert to authenticated with check (public.ddc_can('releases', 'create'));
    create policy ddc_update on public.releases for update to authenticated
        using (public.ddc_can('releases', 'update')) with check (public.ddc_can('releases', 'update'));

    alter table public.deployments enable row level security;
    create policy ddc_select on public.deployments for select to authenticated using (public.ddc_can('deployments', 'read'));
    create policy ddc_insert on public.deployments for insert to authenticated with check (public.ddc_can('deployments', 'create'));
    create policy ddc_update on public.deployments for update to authenticated
        using (public.ddc_can('deployments', 'update')) with check (public.ddc_can('deployments', 'update'));

    -- scheduled_jobs & logs
    alter table public.scheduled_jobs enable row level security;
    create policy ddc_select on public.scheduled_jobs for select to authenticated
        using (public.ddc_can('jobs', 'read') or created_by_sales_id = public.current_sales_id());
    create policy ddc_insert on public.scheduled_jobs for insert to authenticated
        with check (public.ddc_can('jobs', 'create'));
    create policy ddc_update on public.scheduled_jobs for update to authenticated
        using (public.ddc_can('jobs', 'update')) with check (public.ddc_can('jobs', 'update'));

    alter table public.scheduled_job_logs enable row level security;
    create policy ddc_select on public.scheduled_job_logs for select to authenticated
        using (public.ddc_can('jobs', 'read'));

    -- user_sessions & login_history
    alter table public.user_sessions enable row level security;
    create policy ddc_select on public.user_sessions for select to authenticated
        using (public.is_active_user() and (sales_id = public.current_sales_id() or public.ddc_can('users', 'read')));
    create policy ddc_update on public.user_sessions for update to authenticated
        using (public.is_active_user() and (sales_id = public.current_sales_id() or public.ddc_can('users', 'update')))
        with check (public.is_active_user() and (sales_id = public.current_sales_id() or public.ddc_can('users', 'update')));

    alter table public.login_history enable row level security;
    create policy ddc_select on public.login_history for select to authenticated
        using (public.is_active_user() and (sales_id = public.current_sales_id() or public.ddc_can('audit_log', 'read')));

    -- service_accounts & api_keys
    foreach t in array array['service_accounts', 'api_keys'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(''api_management'', ''read''))', t);
        execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.ddc_can(''api_management'', ''create''))', t);
        execute format('create policy ddc_update on public.%I for update to authenticated using (public.ddc_can(''api_management'', ''update'')) with check (public.ddc_can(''api_management'', ''update''))', t);
        execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.ddc_can(''api_management'', ''delete''))', t);
    end loop;

    -- saved_views (owner or shared)
    alter table public.saved_views enable row level security;
    create policy ddc_select on public.saved_views for select to authenticated
        using (public.is_active_user() and (is_shared or owner_sales_id = public.current_sales_id() or public.is_admin()));
    create policy ddc_insert on public.saved_views for insert to authenticated
        with check (public.is_active_user() and owner_sales_id = public.current_sales_id());
    create policy ddc_update on public.saved_views for update to authenticated
        using (public.is_active_user() and (owner_sales_id = public.current_sales_id() or public.is_admin()))
        with check (public.is_active_user() and (owner_sales_id = public.current_sales_id() or public.is_admin()));
    create policy ddc_delete on public.saved_views for delete to authenticated
        using (public.is_active_user() and (owner_sales_id = public.current_sales_id() or public.is_admin()));

    -- api_idempotency_keys (actor sees own; service_role manages writes)
    alter table public.api_idempotency_keys enable row level security;
    create policy ddc_select on public.api_idempotency_keys for select to authenticated
        using (public.is_active_user() and actor_user_id = auth.uid());

    -- backup_records
    alter table public.backup_records enable row level security;
    create policy ddc_select on public.backup_records for select to authenticated
        using (public.ddc_can('backups', 'read'));
    create policy ddc_insert on public.backup_records for insert to authenticated
        with check (public.ddc_can('backups', 'create'));

    -- Attach updated_at, version bump, and audit triggers to new Phase 1 tables
    foreach t in array array[
        'data_scopes', 'teams', 'team_members', 'role_field_permissions', 'service_accounts', 'api_keys',
        'customer_segments', 'company_segments', 'machine_specifications', 'customer_machines',
        'price_lists', 'price_list_items', 'sales_orders', 'sales_order_items',
        'sales_targets', 'sales_forecasts', 'saved_views',
        'ui_config_versions', 'feature_flags', 'releases', 'deployments', 'scheduled_jobs', 'backup_records'
    ] loop
        execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.ddc_audit()', t);
    end loop;

    foreach t in array array[
        'data_scopes', 'teams', 'role_field_permissions', 'service_accounts',
        'customer_segments', 'machine_specifications', 'customer_machines',
        'price_lists', 'price_list_items', 'sales_orders', 'sales_targets', 'sales_forecasts',
        'saved_views', 'ui_config_versions', 'feature_flags', 'deployments', 'scheduled_jobs'
    ] loop
        execute format('create trigger aa_touch_updated_at before update on public.%I for each row execute function public.ddc_touch_updated_at()', t);
    end loop;

    foreach t in array array[
        'companies', 'contacts', 'leads', 'deals', 'products', 'rfqs', 'quotations',
        'teams', 'customer_segments', 'customer_machines', 'price_lists',
        'sales_orders', 'sales_targets', 'sales_forecasts', 'saved_views', 'feature_flags'
    ] loop
        execute format('create trigger aa_bump_version before update on public.%I for each row execute function public.ddc_bump_version()', t);
    end loop;

    -- Table & sequence grants (anon gets nothing)
    foreach t in array array[
        'data_scopes', 'teams', 'team_members', 'role_field_permissions',
        'user_sessions', 'login_history', 'service_accounts', 'api_keys',
        'customer_segments', 'company_segments', 'machine_specifications', 'customer_machines',
        'price_lists', 'price_list_items', 'sales_orders', 'sales_order_items',
        'sales_targets', 'sales_forecasts', 'saved_views',
        'ui_config_versions', 'feature_flags', 'feature_flag_history',
        'releases', 'deployments', 'scheduled_jobs', 'scheduled_job_logs',
        'api_idempotency_keys', 'backup_records'
    ] loop
        execute format('revoke all on table public.%I from anon', t);
        execute format('grant all on table public.%I to service_role', t);
        if t in ('login_history', 'feature_flag_history', 'scheduled_job_logs', 'api_idempotency_keys') then
            execute format('revoke all on table public.%I from authenticated', t);
            execute format('grant select on table public.%I to authenticated', t);
        else
            execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
        end if;
        execute format('revoke all on sequence public.%I from anon', t || '_id_seq');
        execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
        execute format('grant all on sequence public.%I to service_role', t || '_id_seq');
    end loop;
end;
$$;

revoke all on sequence public.sales_order_no_seq from anon;
grant usage, select on sequence public.sales_order_no_seq to authenticated;
grant all on sequence public.sales_order_no_seq to service_role;

revoke all on function public.publish_ui_config_version(bigint) from public, anon;
grant execute on function public.publish_ui_config_version(bigint) to authenticated, service_role;

revoke all on function public.rollback_ui_config_version(bigint, text) from public, anon;
grant execute on function public.rollback_ui_config_version(bigint, text) to authenticated, service_role;

revoke all on function public.claim_scheduled_job(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_scheduled_job(text, text, integer) to service_role;

revoke all on function public.ddc_bump_version() from public, anon;
grant execute on function public.ddc_bump_version() to authenticated, service_role;

revoke all on function public.ddc_guard_production_deployment() from public, anon;
grant execute on function public.ddc_guard_production_deployment() to authenticated, service_role;
