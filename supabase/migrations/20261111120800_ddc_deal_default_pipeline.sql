--
-- DDC CRM - opportunities always belong to a pipeline
--
-- Opportunities created without a pipeline (Atomic CRM forms, imports, API)
-- get the default pipeline, so they always appear on a Kanban board.
--

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
            (p.division_id is not distinct from new.division_id and p.business_model_id is not distinct from new.business_model_id) desc,
            p.is_default desc,
            p.sort_order
        limit 1;
    end if;
    return new;
end;
$$;

create trigger deals_default_pipeline
    before insert on public.deals
    for each row execute function public.ddc_deal_default_pipeline();

revoke all on function public.ddc_deal_default_pipeline() from public, anon;
grant execute on function public.ddc_deal_default_pipeline() to authenticated, service_role;

-- Deals created before the DDC migrations
update public.deals d
set pipeline_id = (select p.id from public.pipelines p where p.is_default limit 1)
where d.pipeline_id is null;
