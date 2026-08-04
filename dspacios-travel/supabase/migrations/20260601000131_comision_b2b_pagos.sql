-- ───────────────────────────────────────────────────────────────────────────
-- 131 · Abonos/pagos parciales a comisiones B2B
--
-- `aliados_b2b.estado`/`fecha_pago` solo permitían marcar una comisión como
-- pagada de una sola vez (todo o nada) — reportado como bug real: hay
-- comisiones grandes que se pagan en varios abonos. Mismo patrón ya usado
-- por `retenciones_cxp` (125) y `cxp_pagos` (130): un log de movimientos sin
-- tope de cantidad, en vez de columnas fijas o un booleano.
--
-- `estado`/`fecha_pago` en `aliados_b2b` NO se borran (convención del
-- proyecto), pero la app deja de leerlas/escribirlas desde esta migración —
-- el estado (pendiente/parcial/pagada) se deriva en adelante de la suma de
-- pagos vs. el total a pagar calculado. Backfill: toda comisión que ya
-- estaba marcada 'pagada'/'pagado' se migra a un pago único por el total
-- calculado en la fecha que tenía registrada, para no perder ese estado.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.comision_b2b_pagos (
  id            bigserial primary key,
  aliado_b2b_id bigint not null references public.aliados_b2b(id) on delete cascade,
  fecha         date not null default current_date,
  valor         numeric(15,2) not null,
  tenant        text not null default 'mayorista',
  created_at    timestamptz not null default now()
);
create index if not exists idx_comision_b2b_pagos_aliado on public.comision_b2b_pagos(aliado_b2b_id);

alter table public.comision_b2b_pagos enable row level security;
drop policy if exists "comision_b2b_pagos: acceso contable" on public.comision_b2b_pagos;
create policy "comision_b2b_pagos: acceso contable" on public.comision_b2b_pagos for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  )
  with check (
    public.mi_rol() in ('superadmin','gerencia','administracion')
    and public.puede_ver_tenant(tenant)
  );

-- Backfill: una comisión ya marcada 'pagada'/'pagado' se migra a un pago
-- único por el total calculado (misma fórmula de calcComisionB2B), en la
-- fecha que ya tenía guardada. Idempotente vía `not exists`.
insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant)
select
  b.id,
  coalesce(b.fecha_pago, b.created_at::date, current_date),
  greatest(0, (b.base_comision * b.pct_comision + b.recobro_total * b.pct_recobro_aliado)
    * (1 - case when b.aplica_retencion then b.pct_retencion else 0 end)),
  b.tenant
from public.aliados_b2b b
where b.estado in ('pagada', 'pagado')
  and not exists (
    select 1 from public.comision_b2b_pagos p where p.aliado_b2b_id = b.id
  );
