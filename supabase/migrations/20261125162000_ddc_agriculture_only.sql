--
-- DDC CRM - Agriculture-only specialization
--
-- Removes all Automotive tables, code lists, product families, vehicle
-- manufacturer kinds, and multi-division structures so the CRM serves the
-- Agriculture business exclusively.
--

-- 1. Remove Automotive fitment tables, vehicle_type code list, and permission mappings
drop table if exists public.product_vehicle_fitments cascade;
drop table if exists public.vehicle_models cascade;

delete from public.table_permission_map
where table_name in ('vehicle_models', 'product_vehicle_fitments');

delete from public.master_options where category = 'vehicle_type';
delete from public.option_categories where key = 'vehicle_type';

-- 2. Rename 'fitment' permission resource to 'machine_applications'
--    (cascades to role_permissions and table_permission_map via ON UPDATE CASCADE)
update public.permission_resources
set key = 'machine_applications',
    name = 'การใช้งานกับเครื่องจักรการเกษตร',
    name_en = 'Agricultural machine applications'
where key = 'fitment';

update public.ddc_roles
set description = 'Products, machine applications, RFQ engineering review, development projects'
where key = 'engineering';

-- Recreate RLS policies on agricultural machine tables to reference 'machine_applications'
do $$
declare
    t text;
begin
    foreach t in array array['machine_models', 'product_machine_applications'] loop
        execute format('drop policy if exists ddc_select on public.%I', t);
        execute format('drop policy if exists ddc_insert on public.%I', t);
        execute format('drop policy if exists ddc_update on public.%I', t);
        execute format('drop policy if exists ddc_delete on public.%I', t);

        execute format(
            'create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(''machine_applications'', ''read'', null::bigint))',
            t
        );
        execute format(
            'create policy ddc_insert on public.%I for insert to authenticated with check (public.ddc_can(''machine_applications'', ''create'', null::bigint))',
            t
        );
        execute format(
            'create policy ddc_update on public.%I for update to authenticated using (public.ddc_can(''machine_applications'', ''update'', null::bigint)) with check (public.ddc_can(''machine_applications'', ''update'', null::bigint))',
            t
        );
        execute format(
            'create policy ddc_delete on public.%I for delete to authenticated using (public.ddc_can(''machine_applications'', ''delete'', null::bigint))',
            t
        );
    end loop;
end;
$$;

-- 3. Restrict manufacturers to agricultural machinery (remove vehicle/machinery/both kind column)
delete from public.manufacturers m
where m.kind = 'vehicle'
  and not exists (select 1 from public.machine_models mm where mm.manufacturer_id = m.id);

alter table public.manufacturers
    drop column if exists kind;

-- 4. Remove Automotive product hierarchy nodes before removing multi-division support
update public.products p
set node_id = null
from public.product_hierarchy_nodes n
join public.divisions d on d.id = n.division_id
where p.node_id = n.id and d.code = 'AUTO';

delete from public.deal_products dp
using public.product_hierarchy_nodes n
join public.divisions d on d.id = n.division_id
where dp.node_id = n.id and d.code = 'AUTO';

update public.product_hierarchy_nodes n
set parent_id = null
from public.divisions d
where n.division_id = d.id and d.code = 'AUTO';

delete from public.product_hierarchy_nodes n
using public.divisions d
where n.division_id = d.id and d.code = 'AUTO';

-- 5. Remove multi-division columns, constraints, triggers, and divisions table
drop view if exists public.companies_summary;

delete from public.company_business_models a
using public.company_business_models b
where a.id > b.id
  and a.company_id = b.company_id
  and a.business_model_id = b.business_model_id
  and a.sales_channel_id is not distinct from b.sales_channel_id;

alter table public.company_business_models
    drop constraint if exists company_business_models_unique;
drop index if exists public.company_business_models_division_id_idx;
alter table public.company_business_models
    drop column if exists division_id;
alter table public.company_business_models
    add constraint company_business_models_unique unique nulls not distinct (company_id, business_model_id, sales_channel_id);

-- Update product_hierarchy_nodes (single Agriculture hierarchy)
drop trigger if exists products_check_node on public.products;
drop function if exists public.ddc_check_product_node();

create or replace function public.ddc_check_hierarchy_node() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_parent public.product_hierarchy_nodes%rowtype;
begin
    if new.parent_id is null then
        return new;
    end if;
    select * into v_parent from public.product_hierarchy_nodes where id = new.parent_id;
    if public.ddc_hierarchy_level_rank(v_parent.level) >= public.ddc_hierarchy_level_rank(new.level) then
        raise exception 'A % node cannot be placed under a % node', new.level, v_parent.level using errcode = '23514';
    end if;
    return new;
end;
$$;

alter table public.product_hierarchy_nodes
    drop constraint if exists product_hierarchy_nodes_unique;
drop index if exists public.product_hierarchy_nodes_division_idx;
alter table public.product_hierarchy_nodes
    drop column if exists division_id;
alter table public.product_hierarchy_nodes
    add constraint product_hierarchy_nodes_unique unique (level, code);
create index if not exists product_hierarchy_nodes_level_idx on public.product_hierarchy_nodes using btree (level);

-- Update company_product_interests constraint before dropping division_id
delete from public.company_product_interests
where node_id is null and product_id is null;

alter table public.company_product_interests
    drop constraint if exists company_product_interests_has_target;
alter table public.company_product_interests
    drop column if exists division_id;
alter table public.company_product_interests
    add constraint company_product_interests_has_target check (num_nonnulls(node_id, product_id) >= 1);

-- Drop remaining division_id columns and indexes
drop index if exists public.deals_division_id_idx;
drop index if exists public.products_division_id_idx;

alter table public.pipelines drop column if exists division_id;
alter table public.leads drop column if exists division_id;
alter table public.deals drop column if exists division_id;
alter table public.brands drop column if exists division_id;
alter table public.products drop column if exists division_id;
alter table public.rfqs drop column if exists division_id;
alter table public.quotations drop column if exists division_id;
alter table public.approval_rules drop column if exists division_id;
alter table public.dev_projects drop column if exists division_id;

-- Recreate companies_summary without division_ids
create view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    c.customer_code,
    c.legal_name,
    c.parent_company_id,
    c.org_type,
    c.branch_code,
    c.lifecycle_status_id,
    c.category_id,
    c.territory_id,
    c.province,
    c.email,
    c.custom_fields,
    c.updated_at,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts,
    (select coalesce(array_agg(distinct cbm.business_model_id), '{}'::bigint[])
        from public.company_business_models cbm where cbm.company_id = c.id) as business_model_ids,
    (select max(a.start_at) from public.activities a
        where a.company_id = c.id and a.status = 'completed') as last_activity_at
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;

revoke all on table public.companies_summary from anon;
grant select on table public.companies_summary to authenticated, service_role;

-- Update workflow functions to remove division_id references
create or replace function public.convert_lead(
    p_lead_id bigint,
    p_create_opportunity boolean default true,
    p_existing_company_id bigint default null
) returns jsonb
    language plpgsql
    set search_path to ''
    as $$
declare
    v_lead public.leads%rowtype;
    v_company_id bigint;
    v_contact_id bigint;
    v_deal_id bigint;
    v_pipeline_id bigint;
    v_stage text;
    v_first_name text;
    v_last_name text;
begin
    select * into v_lead from public.leads where id = p_lead_id for update;
    if not found then
        raise exception 'Lead % not found', p_lead_id using errcode = 'P0002';
    end if;
    if not public.ddc_can('leads', 'update', v_lead.sales_id) then
        raise exception 'Not allowed to convert this lead' using errcode = '42501';
    end if;
    if v_lead.status = 'converted' then
        raise exception 'Lead % is already converted', p_lead_id using errcode = '22023';
    end if;
    if v_lead.status = 'disqualified' then
        raise exception 'A disqualified lead cannot be converted' using errcode = '22023';
    end if;

    if p_existing_company_id is not null then
        select id into v_company_id from public.companies where id = p_existing_company_id;
        if v_company_id is null then
            raise exception 'Customer % not found', p_existing_company_id using errcode = 'P0002';
        end if;
    else
        insert into public.companies (name, website, phone_number, country, province, territory_id, sales_id, email)
        values (v_lead.company_name, v_lead.website, v_lead.phone, v_lead.country, v_lead.province, v_lead.territory_id, v_lead.sales_id, v_lead.email::text)
        returning id into v_company_id;

        if v_lead.business_model_id is not null then
            insert into public.company_business_models (company_id, business_model_id, is_primary)
            values (v_company_id, v_lead.business_model_id, true);
        end if;
    end if;

    if v_lead.contact_name is not null and btrim(v_lead.contact_name) <> '' then
        v_first_name := split_part(btrim(v_lead.contact_name), ' ', 1);
        v_last_name := nullif(btrim(substr(btrim(v_lead.contact_name), length(v_first_name) + 1)), '');
        insert into public.contacts (first_name, last_name, title, company_id, sales_id, first_seen, last_seen, email_jsonb, phone_jsonb)
        values (
            v_first_name,
            coalesce(v_last_name, ''),
            v_lead.contact_title,
            v_company_id,
            v_lead.sales_id,
            now(),
            now(),
            case when v_lead.email is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('email', v_lead.email::text, 'type', 'Work')) end,
            case when v_lead.phone is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('number', v_lead.phone, 'type', 'Work')) end
        )
        returning id into v_contact_id;
    end if;

    if p_create_opportunity then
        select p.id into v_pipeline_id
        from public.pipelines p
        where p.is_active
        order by
            (p.business_model_id is not null and p.business_model_id = v_lead.business_model_id) desc,
            p.is_default desc,
            p.sort_order
        limit 1;

        select ps.code into v_stage
        from public.pipeline_stages ps
        where ps.pipeline_id = v_pipeline_id and ps.stage_type = 'open'
        order by ps.sort_order
        limit 1;

        if v_stage is null then
            raise exception 'No active pipeline with an open stage is configured' using errcode = '22023';
        end if;

        insert into public.deals (name, company_id, contact_ids, stage, pipeline_id, description, amount, currency, business_model_id, lead_id, sales_id, index)
        values (
            v_lead.company_name || ' - ' || coalesce(nullif(btrim(v_lead.product_interest), ''), v_lead.lead_no),
            v_company_id,
            case when v_contact_id is null then '{}'::bigint[] else array[v_contact_id] end,
            v_stage,
            v_pipeline_id,
            v_lead.qualification_notes,
            v_lead.estimated_value::bigint,
            v_lead.currency,
            v_lead.business_model_id,
            v_lead.id,
            v_lead.sales_id,
            0
        )
        returning id into v_deal_id;
    end if;

    update public.leads
    set status = 'converted',
        converted_company_id = v_company_id,
        converted_contact_id = v_contact_id,
        converted_deal_id = v_deal_id,
        converted_at = now()
    where id = p_lead_id;

    return jsonb_build_object('lead_id', p_lead_id, 'company_id', v_company_id, 'contact_id', v_contact_id, 'deal_id', v_deal_id);
end;
$$;

create or replace function public.ddc_deal_default_pipeline() returns trigger
    language plpgsql
    set search_path to ''
    as $$
begin
    if new.pipeline_id is null then
        select p.id into new.pipeline_id
        from public.pipelines p
        where p.is_active
        order by
            (p.business_model_id is not null and p.business_model_id = new.business_model_id) desc,
            p.is_default desc,
            p.sort_order
        limit 1;
    end if;
    return new;
end;
$$;

create or replace function public.submit_quotation(p_quotation_id bigint) returns public.quotations
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_q public.quotations%rowtype;
    v_rules integer;
begin
    select * into v_q from public.quotations where id = p_quotation_id for update;
    if not found then
        raise exception 'Quotation % not found', p_quotation_id using errcode = 'P0002';
    end if;
    if not public.ddc_can('quotations', 'update', v_q.sales_id) then
        raise exception 'Not allowed to submit this quotation' using errcode = '42501';
    end if;
    if v_q.status not in ('draft', 'rejected') then
        raise exception 'Only a draft or rejected quotation can be submitted (current status: %)', v_q.status using errcode = '22023';
    end if;
    if not exists (select 1 from public.quotation_items i where i.quotation_id = p_quotation_id) then
        raise exception 'A quotation needs at least one line before submission' using errcode = '22023';
    end if;

    perform set_config('ddc.workflow', '1', true);

    update public.quotation_approvals set status = 'cancelled'
    where quotation_id = p_quotation_id and status = 'pending';

    insert into public.quotation_approvals (quotation_id, rule_id, required_role_key)
    select p_quotation_id, r.id, r.approver_role_key
    from public.approval_rules r
    where r.is_active
        and (r.currency is null or r.currency = v_q.currency)
        and v_q.total_amount >= r.min_amount
        and (r.max_amount is null or v_q.total_amount <= r.max_amount)
    order by r.sort_order, r.id;
    get diagnostics v_rules = row_count;

    -- No rule matched: the quotation still needs one decision from a user holding the approve permission
    if v_rules = 0 then
        insert into public.quotation_approvals (quotation_id, rule_id, required_role_key)
        values (p_quotation_id, null, null);
    end if;

    update public.quotations
    set status = 'pending_approval', submitted_at = now(), submitted_by = public.current_sales_id(), approved_at = null
    where id = p_quotation_id
    returning * into v_q;

    perform public.ddc_notify(s.id, 'quotation.approval_requested', 'Quotation approval requested',
        v_q.quotation_no || ' rev. ' || v_q.revision, 'quotations', v_q.id)
    from public.sales s
    where not s.disabled
        and s.id is distinct from v_q.submitted_by
        and exists (
            select 1 from public.quotation_approvals a
            where a.quotation_id = p_quotation_id and a.status = 'pending'
                and (a.required_role_key = s.role_key
                    or (a.required_role_key is null and exists (
                        select 1 from public.role_permissions rp
                        where rp.role_key = s.role_key and rp.resource = 'quotations' and rp.action = 'approve')))
        );

    perform set_config('ddc.workflow', '', true);
    return v_q;
end;
$$;

create or replace function public.create_quotation_revision(p_quotation_id bigint) returns public.quotations
    language plpgsql security definer
    set search_path to ''
    as $$
declare
    v_q public.quotations%rowtype;
    v_new public.quotations%rowtype;
begin
    select * into v_q from public.quotations where id = p_quotation_id for update;
    if not found then
        raise exception 'Quotation % not found', p_quotation_id using errcode = 'P0002';
    end if;
    if not public.ddc_can('quotations', 'create') or not public.ddc_can('quotations', 'update', v_q.sales_id) then
        raise exception 'Not allowed to revise this quotation' using errcode = '42501';
    end if;
    if v_q.status not in ('approved', 'sent', 'rejected', 'declined', 'expired') then
        raise exception 'A quotation in status % cannot be revised', v_q.status using errcode = '22023';
    end if;
    if exists (select 1 from public.quotations where quotation_no = v_q.quotation_no and revision > v_q.revision) then
        raise exception 'A newer revision of % already exists', v_q.quotation_no using errcode = '22023';
    end if;

    perform set_config('ddc.workflow', '1', true);

    insert into public.quotations (
        quotation_no, revision, previous_revision_id, rfq_id, deal_id, company_id, contact_id,
        subject, currency, status, valid_until, payment_terms, delivery_terms, notes, follow_up_date, sales_id
    )
    values (
        v_q.quotation_no, v_q.revision + 1, v_q.id, v_q.rfq_id, v_q.deal_id, v_q.company_id, v_q.contact_id,
        v_q.subject, v_q.currency, 'draft', v_q.valid_until, v_q.payment_terms, v_q.delivery_terms, v_q.notes, v_q.follow_up_date, v_q.sales_id
    )
    returning * into v_new;

    insert into public.quotation_items (quotation_id, line_no, product_id, rfq_item_id, description, quantity, uom, unit_price, discount_percent, lead_time_days, notes)
    select v_new.id, i.line_no, i.product_id, i.rfq_item_id, i.description, i.quantity, i.uom, i.unit_price, i.discount_percent, i.lead_time_days, i.notes
    from public.quotation_items i
    where i.quotation_id = v_q.id;

    update public.quotation_approvals set status = 'cancelled' where quotation_id = v_q.id and status = 'pending';
    update public.quotations set status = 'superseded' where id = v_q.id;

    perform set_config('ddc.workflow', '', true);
    select * into v_new from public.quotations where id = v_new.id;
    return v_new;
end;
$$;

-- Drop divisions table and its permission mapping
delete from public.table_permission_map where table_name = 'divisions';
drop table if exists public.divisions cascade;
