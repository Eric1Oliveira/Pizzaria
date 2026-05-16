-- Automatic status progression for paid online orders
-- confirmado -> preparando (after 2 minutes), even if frontend is closed

create extension if not exists pg_cron;

alter table public.pedidos
  add column if not exists auto_prepare_at timestamptz;

create or replace function public.set_auto_prepare_at()
returns trigger
language plpgsql
as $fn$
begin
  if coalesce(new.forma_pagamento, '') = 'erede'
     and coalesce(new.status, '') = 'confirmado' then
    new.auto_prepare_at := now() + interval '2 minutes';
  else
    new.auto_prepare_at := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists trg_set_auto_prepare_at on public.pedidos;

create trigger trg_set_auto_prepare_at
before insert or update of status, forma_pagamento
on public.pedidos
for each row
execute function public.set_auto_prepare_at();

create or replace function public.promote_confirmed_orders_to_preparing()
returns void
language plpgsql
as $fn$
begin
  update public.pedidos
     set status = 'preparando'
   where status = 'confirmado'
     and auto_prepare_at is not null
     and now() >= auto_prepare_at;
end;
$fn$;

do $do$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'promote-confirmed-orders-to-preparing';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'promote-confirmed-orders-to-preparing',
    '* * * * *',
    'select public.promote_confirmed_orders_to_preparing();'
  );
end;
$do$;
