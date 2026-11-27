--
-- DDC CRM - Field Sales Mobile & Desktop Extensions
--
-- Supports all 8 field sales visit requirements while preserving existing
-- customers, products, machine models, Excel evidence and RBAC policies:
--   1. Customer group (5 Agriculture groups)
--   2. GPS location & Google Maps links on customers and visit check-ins
--   3. Contact LINE ID, nickname, and optional last_name
--   4. Activity product quantities, UOM, custom part name, urgency
--   5. Immutable logged_at timestamp for chronological timeline logs
--   6. Editable customer usage capacity (fleet & harvest tonnage)
--   7. Editable part replacement frequency & estimated seasonal demand
--   8. Field visit & customer photos (camera capture / upload)
--

-- 1. Five standard Agriculture customer groups + field activity types
insert into public.option_categories (key, name, name_en, description) values
    ('customer_group', 'กลุ่มลูกค้า', 'Customer group', '5 DDC Agriculture field sales customer groups')
on conflict (key) do nothing;

insert into public.master_options (category, code, name, name_en, sort_order) values
    ('customer_group', 'sugar_mill', 'โรงงานน้ำตาล', 'Sugar mill', 10),
    ('customer_group', 'dealer', 'ดีลเลอร์', 'Dealer', 20),
    ('customer_group', 'repair_shop', 'อู่ซ่อม', 'Repair workshop', 30),
    ('customer_group', 'parts_shop', 'ร้านอะไหล่', 'Spare parts shop', 40),
    ('customer_group', 'farm_owner', 'เจ้าของไร่', 'Farm owner', 50),
    ('activity_type', 'line_chat', 'แชท LINE', 'LINE chat', 45),
    ('activity_type', 'sample_delivery', 'ส่งตัวอย่างทดสอบ', 'Sample delivery', 55)
on conflict (category, code) do nothing;

-- 2. Extend companies with customer_group_id and GPS location
alter table public.companies
    add column customer_group_id bigint references public.master_options(id),
    add column latitude double precision check (latitude is null or latitude between -90 and 90),
    add column longitude double precision check (longitude is null or longitude between -180 and 180),
    add column google_maps_url text,
    add column location_note text;

create index companies_customer_group_id_idx on public.companies using btree (customer_group_id);

drop trigger if exists companies_check_options on public.companies;
create trigger companies_check_options
    before insert or update on public.companies
    for each row execute function public.ddc_check_option_category(
        'lifecycle_status_id', 'customer_lifecycle_status',
        'category_id', 'customer_category',
        'customer_group_id', 'customer_group'
    );

-- 3. Extend contacts with LINE ID and nickname; allow Thai single-name contacts
alter table public.contacts
    add column line_id text,
    add column nickname text;

alter table public.contacts
    alter column last_name set default '';

-- 4. Recreate summary views to expose new columns
drop view if exists public.companies_summary;

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
    c.customer_group_id,
    c.territory_id,
    c.province,
    c.email,
    c.latitude,
    c.longitude,
    c.google_maps_url,
    c.location_note,
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

drop view if exists public.contacts_summary;

create view public.contacts_summary with (security_invoker = on) as
select
    co.id,
    co.first_name,
    co.last_name,
    co.nickname,
    co.gender,
    co.title,
    co.background,
    co.avatar,
    co.first_seen,
    co.last_seen,
    co.has_newsletter,
    co.status,
    co.tags,
    co.company_id,
    co.sales_id,
    co.linkedin_url,
    co.line_id,
    co.email_jsonb,
    co.phone_jsonb,
    co.department,
    co.is_primary,
    co.custom_fields,
    (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'))::text as email_fts,
    (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'))::text as phone_fts,
    c.name as company_name,
    count(distinct t.id) filter (where t.done_date is null) as nb_tasks
from public.contacts co
    left join public.tasks t on co.id = t.contact_id
    left join public.companies c on co.company_id = c.id
group by co.id, c.name;

revoke all on table public.contacts_summary from anon;
grant select on table public.contacts_summary to authenticated, service_role;

-- 5. Extend activities for chronological logging & GPS check-in
alter table public.activities
    add column logged_at timestamp with time zone not null default now(),
    add column checkin_lat double precision check (checkin_lat is null or checkin_lat between -90 and 90),
    add column checkin_lng double precision check (checkin_lng is null or checkin_lng between -180 and 180),
    add column checkin_accuracy_m integer check (checkin_accuracy_m is null or checkin_accuracy_m >= 0);

create index activities_logged_at_idx on public.activities using btree (logged_at desc);

-- 6. Extend activity_products for part demand quantity, UOM, urgency and custom parts
alter table public.activity_products add column custom_part_name text;
alter table public.activity_products add column uom text default 'pcs';
alter table public.activity_products add column urgency text default 'inquiry' check (urgency is null or urgency in ('immediate', 'this_season', 'inquiry'));
alter table public.activity_products add column quantity numeric(18, 3) check (quantity is null or quantity >= 0);

alter table public.activity_products
    drop constraint if exists activity_products_has_target;
alter table public.activity_products
    add constraint activity_products_has_target check (num_nonnulls(product_id, node_id, custom_part_name) >= 1);

-- 7. Editable Customer Usage Capacity (fleet vehicles & seasonal tonnage)
create table public.customer_capacity_profiles (
    id bigint generated by default as identity primary key,
    company_id bigint not null references public.companies(id) on delete cascade,
    season_label text not null default '2569/70',
    capacity_role text not null default 'owner' check (capacity_role in ('owner', 'service_shop', 'dealer_network')),
    total_vehicles integer check (total_vehicles is null or total_vehicles >= 0),
    tons_per_vehicle numeric(18, 2) check (tons_per_vehicle is null or tons_per_vehicle >= 0),
    total_tons_per_season numeric(18, 2) check (total_tons_per_season is null or total_tons_per_season >= 0),
    fleet_breakdown jsonb not null default '[]'::jsonb,
    notes text,
    sales_id bigint references public.sales(id),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint customer_capacity_fleet_is_array check (jsonb_typeof(fleet_breakdown) = 'array')
);

create index customer_capacity_profiles_company_idx on public.customer_capacity_profiles using btree (company_id, updated_at desc);

create trigger customer_capacity_profiles_set_sales_id
    before insert on public.customer_capacity_profiles
    for each row execute function public.set_sales_id_default();

create trigger aa_touch_updated_at
    before update on public.customer_capacity_profiles
    for each row execute function public.ddc_touch_updated_at();

-- 8. Editable Part Replacement Frequency & Estimated Demand per Customer
create table public.customer_part_usage (
    id bigint generated by default as identity primary key,
    company_id bigint not null references public.companies(id) on delete cascade,
    product_id bigint references public.products(id) on delete set null,
    part_label text not null,
    qty_per_change numeric(18, 2) check (qty_per_change is null or qty_per_change > 0),
    change_interval_value numeric(18, 2) check (change_interval_value is null or change_interval_value > 0),
    change_interval_unit text not null default 'tons' check (change_interval_unit in ('tons', 'days', 'hours', 'rai', 'season')),
    estimated_season_qty numeric(18, 2) check (estimated_season_qty is null or estimated_season_qty >= 0),
    current_brand text,
    notes text,
    recorded_activity_id bigint references public.activities(id) on delete set null,
    sales_id bigint references public.sales(id),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

create index customer_part_usage_company_idx on public.customer_part_usage using btree (company_id, updated_at desc);
create index customer_part_usage_product_idx on public.customer_part_usage using btree (product_id);

create trigger customer_part_usage_set_sales_id
    before insert on public.customer_part_usage
    for each row execute function public.set_sales_id_default();

create trigger aa_touch_updated_at
    before update on public.customer_part_usage
    for each row execute function public.ddc_touch_updated_at();

-- 9. Field Visit & Customer Photos
create table public.activity_photos (
    id bigint generated by default as identity primary key,
    company_id bigint not null references public.companies(id) on delete cascade,
    activity_id bigint references public.activities(id) on delete cascade,
    photo_tag text not null default 'part_sample' check (photo_tag in ('part_sample', 'machine', 'shop', 'business_card', 'other')),
    caption text,
    file_name text,
    image_src text not null,
    latitude double precision check (latitude is null or latitude between -90 and 90),
    longitude double precision check (longitude is null or longitude between -180 and 180),
    taken_at timestamp with time zone not null default now(),
    sales_id bigint references public.sales(id),
    created_at timestamp with time zone not null default now()
);

create index activity_photos_company_idx on public.activity_photos using btree (company_id, taken_at desc);
create index activity_photos_activity_idx on public.activity_photos using btree (activity_id);

create trigger activity_photos_set_sales_id
    before insert on public.activity_photos
    for each row execute function public.set_sales_id_default();

create trigger activity_photos_check_company_links
    before insert or update on public.activity_photos
    for each row execute function public.ddc_check_company_links();

-- 10. RBAC mapping, RLS policies, Audit triggers, and Grants for new tables
insert into public.table_permission_map (table_name, resource, owner_column, parent_table, parent_fk, parent_owner_column) values
    ('customer_capacity_profiles', 'customers', 'sales_id', null, null, null),
    ('customer_part_usage', 'customers', 'sales_id', null, null, null),
    ('activity_photos', 'activities', 'sales_id', null, null, null);

do $$
declare
    m record;
begin
    for m in
        select * from public.table_permission_map
        where table_name in ('customer_capacity_profiles', 'customer_part_usage', 'activity_photos')
        order by table_name
    loop
        execute format('alter table public.%I enable row level security', m.table_name);
        execute format('create policy ddc_select on public.%I for select to authenticated using (public.ddc_can(%L, ''read'', sales_id))',
            m.table_name, m.resource);
        execute format('create policy ddc_insert on public.%I for insert to authenticated with check (public.ddc_can(%L, ''create'', sales_id))',
            m.table_name, m.resource);
        execute format('create policy ddc_update on public.%I for update to authenticated using (public.ddc_can(%L, ''update'', sales_id)) with check (public.ddc_can(%L, ''update'', sales_id))',
            m.table_name, m.resource, m.resource);
        execute format('create policy ddc_delete on public.%I for delete to authenticated using (public.ddc_can(%L, ''delete'', sales_id))',
            m.table_name, m.resource);
        execute format('create trigger zz_audit after insert or update or delete on public.%I for each row execute function public.ddc_audit()',
            m.table_name);
        execute format('revoke all on table public.%I from anon', m.table_name);
        execute format('grant select, insert, update, delete on table public.%I to authenticated', m.table_name);
        execute format('grant all on table public.%I to service_role', m.table_name);
        execute format('revoke all on sequence public.%I from anon', m.table_name || '_id_seq');
        execute format('grant usage, select on sequence public.%I to authenticated', m.table_name || '_id_seq');
        execute format('grant all on sequence public.%I to service_role', m.table_name || '_id_seq');
    end loop;
end;
$$;

-- 11. Include customers in ddc_global_search so mobile header search finds customers immediately
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
        (select 'companies', c.id, c.name, coalesce(c.customer_code, '') || case when c.province is not null then ' · ' || c.province else '' end
            from public.companies c, params
            where c.name ilike params.pattern
               or c.customer_code ilike params.pattern
               or c.province ilike params.pattern
               or c.city ilike params.pattern
               or c.phone_number ilike params.pattern
            order by c.name limit (select lim from params))
        union all
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
