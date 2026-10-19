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
-- Qué hace: deshabilita los tres disparadores de frontera y restaura la línea
-- base de permisos de PRODUCCIÓN previa a la 217 (P10 = 30 en el preflight 216):
-- INSERT/UPDATE/DELETE para anon y authenticated, y lo que la 217 le retiró a
-- service_role. NUNCA concede TRUNCATE a anon ni a authenticated en servicios,
-- pagos previos ni condiciones: Producción no lo tenía, aunque la 217 lo revoque
-- también en bases que sí lo traían por los permisos por defecto de Supabase.
-- Si al final existiera alguno de esos seis, aborta. No toca datos: compara los
-- conteos antes y después y aborta si algo cambió.
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

-- Línea base de Producción previa a la 217 (P10 = 30): lo que la 217 revocó a los
-- roles de la API, SALVO TRUNCATE para anon y authenticated, que nunca tuvieron.
grant insert, update, delete on public.cotizacion_servicios to anon, authenticated;
grant insert, update, delete, truncate on public.cotizacion_servicios to service_role;
grant insert, update, delete on public.cotizacion_pagos_previos to anon, authenticated;
grant delete, truncate on public.cotizacion_pagos_previos to service_role;
grant insert, update, delete on public.cotizacion_condiciones to anon, authenticated;
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
  -- Nunca más permisos que la línea base: ni directo ni vía PUBLIC.
  if exists (select 1 from (values ('anon'), ('authenticated')) rol_api(rol),
                           (values ('public.cotizacion_servicios'), ('public.cotizacion_pagos_previos'), ('public.cotizacion_condiciones')) tabla(n)
              where has_table_privilege(rol_api.rol, tabla.n, 'TRUNCATE')) then
    raise exception 'ROLLBACK 217 ABORTADO: anon o authenticated quedarían con TRUNCATE en servicios, pagos previos o condiciones (Producción no lo tenía).';
  end if;
  raise notice 'ROLLBACK 217 COMPLETO: frontera desactivada, permisos de la línea base restaurados (sin TRUNCATE para anon/authenticated), conteos iguales; la edición quedó apagada.';
end $$;

commit;
