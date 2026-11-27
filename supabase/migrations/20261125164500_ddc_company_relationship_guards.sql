--
-- DDC CRM - Customer / parent relationship consistency guards
--
-- Ensures linked contacts, RFQs, deals, activities and RFQ items belong to
-- the same customer (or parent RFQ) as the record referencing them.
--

create or replace function public.ddc_check_company_links() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_row jsonb := to_jsonb(new);
    v_company_id bigint := nullif(v_row ->> 'company_id', '')::bigint;
    v_contact_id bigint := nullif(v_row ->> 'contact_id', '')::bigint;
    v_deal_id bigint := nullif(v_row ->> 'deal_id', '')::bigint;
    v_rfq_id bigint := nullif(v_row ->> 'rfq_id', '')::bigint;
    v_activity_id bigint := nullif(v_row ->> 'activity_id', '')::bigint;
    v_ref_company_id bigint;
begin
    if v_company_id is null then
        return new;
    end if;

    if v_contact_id is not null then
        select c.company_id into v_ref_company_id from public.contacts c where c.id = v_contact_id;
        if v_ref_company_id is distinct from v_company_id then
            raise exception 'Contact % does not belong to customer %', v_contact_id, v_company_id
                using errcode = '23514';
        end if;
    end if;

    if v_deal_id is not null then
        select d.company_id into v_ref_company_id from public.deals d where d.id = v_deal_id;
        if v_ref_company_id is distinct from v_company_id then
            raise exception 'Opportunity % does not belong to customer %', v_deal_id, v_company_id
                using errcode = '23514';
        end if;
    end if;

    if v_rfq_id is not null then
        select r.company_id into v_ref_company_id from public.rfqs r where r.id = v_rfq_id;
        if v_ref_company_id is distinct from v_company_id then
            raise exception 'RFQ % does not belong to customer %', v_rfq_id, v_company_id
                using errcode = '23514';
        end if;
    end if;

    if v_activity_id is not null then
        select a.company_id into v_ref_company_id from public.activities a where a.id = v_activity_id;
        if v_ref_company_id is not null and v_ref_company_id is distinct from v_company_id then
            raise exception 'Activity % does not belong to customer %', v_activity_id, v_company_id
                using errcode = '23514';
        end if;
    end if;

    return new;
end;
$$;

create trigger rfqs_check_company_links
    before insert or update on public.rfqs
    for each row execute function public.ddc_check_company_links();

create trigger quotations_check_company_links
    before insert or update on public.quotations
    for each row execute function public.ddc_check_company_links();

create trigger service_cases_check_company_links
    before insert or update on public.service_cases
    for each row execute function public.ddc_check_company_links();

create trigger dev_projects_check_company_links
    before insert or update on public.dev_projects
    for each row execute function public.ddc_check_company_links();

create trigger activities_check_company_links
    before insert or update on public.activities
    for each row execute function public.ddc_check_company_links();

create trigger action_items_check_company_links
    before insert or update on public.action_items
    for each row execute function public.ddc_check_company_links();

create or replace function public.ddc_check_activity_participant_contact() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_activity_company_id bigint;
    v_contact_company_id bigint;
begin
    if new.contact_id is null then
        return new;
    end if;
    select a.company_id into v_activity_company_id from public.activities a where a.id = new.activity_id;
    select c.company_id into v_contact_company_id from public.contacts c where c.id = new.contact_id;
    if v_activity_company_id is not null and v_contact_company_id is distinct from v_activity_company_id then
        raise exception 'Contact % does not belong to the customer of activity %', new.contact_id, new.activity_id
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger activity_participants_check_contact
    before insert or update on public.activity_participants
    for each row execute function public.ddc_check_activity_participant_contact();

create or replace function public.ddc_check_quotation_item_rfq() returns trigger
    language plpgsql
    set search_path to ''
    as $$
declare
    v_quotation_rfq_id bigint;
    v_item_rfq_id bigint;
begin
    if new.rfq_item_id is null then
        return new;
    end if;
    select q.rfq_id into v_quotation_rfq_id from public.quotations q where q.id = new.quotation_id;
    select ri.rfq_id into v_item_rfq_id from public.rfq_items ri where ri.id = new.rfq_item_id;
    if v_quotation_rfq_id is null or v_item_rfq_id is distinct from v_quotation_rfq_id then
        raise exception 'RFQ item % does not belong to the RFQ of quotation %', new.rfq_item_id, new.quotation_id
            using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger quotation_items_check_rfq
    before insert or update on public.quotation_items
    for each row execute function public.ddc_check_quotation_item_rfq();

revoke all on function public.ddc_check_company_links() from public, anon;
grant execute on function public.ddc_check_company_links() to authenticated, service_role;

revoke all on function public.ddc_check_activity_participant_contact() from public, anon;
grant execute on function public.ddc_check_activity_participant_contact() to authenticated, service_role;

revoke all on function public.ddc_check_quotation_item_rfq() from public, anon;
grant execute on function public.ddc_check_quotation_item_rfq() to authenticated, service_role;
