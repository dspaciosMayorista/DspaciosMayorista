-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK 217 · retirar el cierre de la frontera (B) de #39.
--
-- ⚠️ SOLO por incidente comprobado, con aprobación humana, ventana y postcheck
-- (decisión 2 del dueño). Esta retirada REABRE el DML directo de la API sobre
-- servicios, pagos previos, condiciones y columnas económicas de las manuales
-- (el estado anterior a la 217). La edición de servicios se apaga sola: sin la
-- frontera, `edicion_cotizaciones_habilitada()` es falsa. Contención previa
-- recomendada: el interruptor (`p39_priv.suspension_edicion`), no esta retirada.
--
-- Qué hace: deshabilita los tres disparadores de frontera y restaura la LISTA
-- FIJA de permisos que la 217 retiró (los de Supabase por defecto). No toca
-- datos: compara los conteos antes y después y aborta si algo cambió.
-- ═════════════════════════════════════════════════════════════════════════
begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regprocedure('p39_priv.frontera_activa()') is null then
    raise exception 'ROLLBACK 217 ABORTADO: la 216 no está aplicada.';
  end if;
  if not exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgenabled <> 'D'
                  and t.tgname in ('trg_cot_frontera_39', 'trg_cot_pagos_frontera_39', 'trg_cot_condiciones_frontera_39'))
     and has_table_privilege('authenticated', 'public.cotizacion_servicios', 'INSERT') then
    raise exception 'ROLLBACK 217 ABORTADO: la 217 no está aplicada (nada que retirar).';
  end if;
end $$;

create temp table rb217_conteos on commit drop as
  select 'cotizaciones' as t, count(*) as n from public.cotizaciones
  union all select 'cotizacion_servicios', count(*) from public.cotizacion_servicios
  union all select 'cotizacion_pagos_previos', count(*) from public.cotizacion_pagos_previos
  union all select 'cotizacion_condiciones', count(*) from public.cotizacion_condiciones
  union all select 'cotizacion_ediciones', count(*) from public.cotizacion_ediciones
  union all select 'autorizacion_emitida', count(*) from p39_priv.autorizacion_emitida
  union all select 'autorizacion_cerrada', count(*) from p39_priv.autorizacion_cerrada
  union all select 'ventas', count(*) from public.ventas
  union all select 'abonos', count(*) from public.abonos;

alter table public.cotizaciones disable trigger trg_cot_frontera_39;
alter table public.cotizacion_pagos_previos disable trigger trg_cot_pagos_frontera_39;
alter table public.cotizacion_condiciones disable trigger trg_cot_condiciones_frontera_39;

-- Lista fija (exactamente lo que la 217 revocó a los roles de la API).
grant insert, update, delete, truncate on public.cotizacion_servicios to anon, authenticated, service_role;
grant insert, update, delete, truncate on public.cotizacion_pagos_previos to anon, authenticated;
grant delete, truncate on public.cotizacion_pagos_previos to service_role;
grant insert, update, delete, truncate on public.cotizacion_condiciones to anon, authenticated;
grant truncate on public.cotizacion_condiciones to service_role;

do $$
declare v_dif text;
begin
  select string_agg(a.t || ' ' || a.n || '→' || b.n, ', ') into v_dif
    from rb217_conteos a
    join (select 'cotizaciones' as t, count(*) as n from public.cotizaciones
          union all select 'cotizacion_servicios', count(*) from public.cotizacion_servicios
          union all select 'cotizacion_pagos_previos', count(*) from public.cotizacion_pagos_previos
          union all select 'cotizacion_condiciones', count(*) from public.cotizacion_condiciones
          union all select 'cotizacion_ediciones', count(*) from public.cotizacion_ediciones
          union all select 'autorizacion_emitida', count(*) from p39_priv.autorizacion_emitida
          union all select 'autorizacion_cerrada', count(*) from p39_priv.autorizacion_cerrada
          union all select 'ventas', count(*) from public.ventas
          union all select 'abonos', count(*) from public.abonos) b on b.t = a.t
   where a.n <> b.n;
  if v_dif is not null then
    raise exception 'ROLLBACK 217 ABORTADO: cambiaron conteos (%); no se retira nada.', v_dif;
  end if;
  if p39_priv.frontera_activa() or public.edicion_cotizaciones_habilitada() then
    raise exception 'ROLLBACK 217 ABORTADO: la frontera o la edición siguen activas.';
  end if;
  raise notice 'ROLLBACK 217 COMPLETO: frontera desactivada, permisos restaurados, conteos iguales; la edición quedó apagada.';
end $$;

commit;
