-- PREFLIGHT de la 307 (#53) — UNA sola consulta de SOLO LECTURA (pegar completa en el editor SQL; devuelve todos los controles).
-- Comprueba lo que la 307 necesita (y que aún no está aplicada) y dimensiona lo que cambia SU comportamiento. No escribe nada.
--   OK = listo · REVISAR = detener y revisar antes de aplicar · INFO = dato para decidir/avisar.
with c as (
  select 1 o, 'migración 288 aplicada: p75_priv.regla_confirmacion existe y todavía tiene la rama NETO' control,
         (to_regprocedure('p75_priv.regla_confirmacion(text)') is not null and position('neto_total' in coalesce(pg_get_functiondef(to_regprocedure('p75_priv.regla_confirmacion(text)')), '')) > 0)::int valor, 1 esperado
  union all select 2, 'p75_priv.estado_minimo y p75_priv.pagado_en existen (la 307 los reutiliza)',
         (to_regprocedure('p75_priv.estado_minimo(text)') is not null and to_regprocedure('p75_priv.pagado_en(text,text,numeric)') is not null)::int, 1
  union all select 3, 'public.liberar_vencidas(date) existe (la 307 la redefine con la misma firma)', (to_regprocedure('public.liberar_vencidas(date)') is not null)::int, 1
  union all select 4, 'dependencias de la 307: fn_auditoria, mi_rol, puede_ver_contrato, contrato_declarar_identidad, _vaciar_sillas',
         (to_regprocedure('public.fn_auditoria()') is not null and to_regprocedure('public.mi_rol()') is not null and to_regprocedure('public.puede_ver_contrato(text)') is not null
          and to_regprocedure('public.contrato_declarar_identidad(text,uuid)') is not null and to_regprocedure('public._vaciar_sillas(bigint[],text)') is not null)::int, 1
  union all select 5, 'ventas.contrato_uid existe (vida del contrato para el acuerdo)', (select count(*)::int from information_schema.columns where table_schema='public' and table_name='ventas' and column_name='contrato_uid'), 1
  union all select 6, 'la 307 NO está aplicada todavía (no existe contrato_minimo_acuerdo ni las funciones nuevas)',
         (to_regclass('public.contrato_minimo_acuerdo') is null and to_regprocedure('public.contratos_pagados_completos(text[])') is null)::int, 1
  union all select 7, 'migraciones 303–306 presentes por OBJETO (hotel_categorias.descripcion, contrato_resumen_precios, cotizaciones.clave_envio)',
         ((select count(*) from information_schema.columns where table_schema='public' and table_name='hotel_categorias' and column_name='descripcion') = 1
          and to_regclass('public.contrato_resumen_precios') is not null
          and (select count(*) from information_schema.columns where table_schema='public' and table_name='cotizaciones' and column_name='clave_envio') = 1)::int, 1
  union all select 8, 'guardas de identidad (284): contrato_guardas_config y contrato_instalar_guardas existen (la 307 clasifica la tabla nueva)',
         (to_regclass('public.contrato_guardas_config') is not null and to_regprocedure('public.contrato_instalar_guardas()') is not null)::int, 1
  union all select 9, 'dtm_reuso_bloqueos es EXACTAMENTE la de la 304 (md5 e417b53e…): la 307 la reemplaza cambiando solo la lista de preparación',
         (md5(replace(coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)')), ''), chr(13), '')) = 'e417b53ecf0de9523e222f9c45debd9a')::int, 1
  union all select 10, 'ninguna tabla de contrato SIN clasificar hoy (si hubiera, contrato_instalar_guardas() abortaría la 307)',
         (select count(*)::int from pg_class c join pg_namespace s on s.oid = c.relnamespace and s.nspname = 'public'
            where c.relkind in ('r','p') and c.relname <> 'contrato_minimo_acuerdo'
              and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero'))
                   or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.ventas'::regclass) or c.relname = 'ventas')
              and not exists (select 1 from public.contrato_guardas_config g where g.tabla = c.relname::text)), 0
  union all select 11, 'dtm_reuso_config existe (la 307 NO toca el interruptor del reuso)', (to_regclass('public.dtm_reuso_config') is not null)::int, 1
)
select control, valor, esperado, case when valor = esperado then 'OK' else 'REVISAR' end estado from c
union all select 'INFO · ciclo de comisión #97 (1 = activo; la 307 NO lo toca)', p97_priv.ciclo_activo()::int, null, 'INFO'
union all select 'INFO · reuso de consecutivos habilitado (1 = sí; la 307 NO lo toca y debe quedar igual)', coalesce((select c.habilitado::int from public.dtm_reuso_config c limit 1), -1), null, 'INFO'
union all select 'INFO · pendientes vencidos CON pagos que el vencimiento actual cancelaría y la 307 conservará',
       (select count(*)::int from public.ventas v where v.estado = 'pendiente' and v.plazo < (now() at time zone 'America/Bogota')::date
          and exists (select 1 from public.abonos a where a.numero_contrato = v.numero_contrato and (coalesce(a.valor_abono,0) > 0 or coalesce(a.monto_cop,0) > 0))), null, 'INFO'
union all select 'INFO · pendientes vencidos SIN pagos (se cancelan como siempre)',
       (select count(*)::int from public.ventas v where v.estado = 'pendiente' and v.plazo < (now() at time zone 'America/Bogota')::date
          and not exists (select 1 from public.abonos a where a.numero_contrato = v.numero_contrato and (coalesce(a.valor_abono,0) > 0 or coalesce(a.monto_cop,0) > 0))), null, 'INFO'
union all select 'INFO · pendientes NETO (descontada) con pagos: hoy exigen el total; con la 307 aplican su condición congelada (o 30 %); nada se confirma solo hasta el próximo pago o reintento',
       (select count(*)::int from public.ventas v where v.estado = 'pendiente' and v.comision_estado = 'descontada'
          and exists (select 1 from public.abonos a where a.numero_contrato = v.numero_contrato and a.valor_abono > 0)), null, 'INFO'
union all select 'INFO · contratos con voucher preparado (el acceso del aliado pasa a exigir pago completo)', (select count(distinct numero_contrato)::int from public.vouchers), null, 'INFO'
order by 4, 1;
