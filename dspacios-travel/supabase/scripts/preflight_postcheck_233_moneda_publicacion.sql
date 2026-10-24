-- ───────────────────────────────────────────────────────────────────────────
-- 233 · PREFLIGHT + POSTCHECK INTEGRAL (UNA sola consulta, SOLO LECTURA). Columnas: control · valor (observado) · esperado · estado.
--   OK = cumple lo esperado · REVISAR = falta algo o requiere decisión · INFO = dato (o pendiente de una fase anterior).
-- Se corre DOS veces con el mismo archivo:
--   1) ANTES de la 233: la estructura sale REVISAR ("pendiente") y los controles de datos ya son decisivos
--      (en particular 'paquetes_publicados_con_fuentes_en_otra_moneda' y 'paquetes_63_que_requieren_trm_sin_trm').
--   2) DESPUÉS de la 233: TODO debe salir OK (los INFO son solo datos). Comparar 'tarifarios_publicables' con el del preflight: no debe cambiar.
-- No imprime filas de negocio: solo conteos, ids (máx. 20) y estados. Funciona antes y después porque lee la columna nueva por jsonb.
-- ───────────────────────────────────────────────────────────────────────────
with
p as (
  select x.id, x.activo, x.tipo::text as tipo, x.modo_oferta, x.trm_oferta, x.moneda, x.tarifario_snapshot_publicable as publicable,
         to_jsonb(x) ->> 'moneda_publicacion' as mp,
         exists (select 1 from public.tarifario_resultado r where r.paquete_id = x.id) as con_snapshot
    from public.armado_paquetes x
),
-- Hoy (Bogotá) y destinos aéreos efectivos por paquete (#67/220): lo usan los filtros de «fuentes que REALMENTE aportan».
hoy as (select (now() at time zone 'America/Bogota')::date as d),
ef as (
  select p.id as paquete_id,
         public.destinos_aereos_efectivos_67(
           x.destino_id, coalesce(x.destinos_aereos_alternativos, false),
           coalesce((select array_agg(a.destino_id) from public.armado_paquete_destinos_aereos a where a.paquete_id = x.id), '{}'::bigint[])) as ids
    from p join public.armado_paquetes x on x.id = p.id
),
-- Fuentes con su moneda real que SÍ aportan al precio (espejo de lib/reservar/aporteFuentes90.ts y de public.p63_requiere_trm):
--   hoteles (no por unidad) y servicios del armado; vuelos de Bloqueo/Sistema con fechas, vigencia y destino permitido (Bloqueo);
--   salidas dinámicas vigentes con noches (la vinculada, además, con su vuelo elegible, permitido y la copia al día).
fz as (
  select ah.paquete_id, h.moneda, 'hotel' as tipo
    from public.armado_hoteles ah join public.hoteles h on h.id = ah.hotel_id where coalesce(h.modelo_tarifario, '') <> 'unidad'
  union all
  select s.paquete_id, sa.moneda, 'servicio'
    from public.armado_servicios s join public.servicios_adicionales sa on sa.id = s.servicio_id
  union all
  select av.paquete_id, b.moneda, 'vuelo'
    from public.armado_vuelos av join public.bloqueos_vuelo b on b.id = av.bloqueo_id
    join p on p.id = av.paquete_id join ef on ef.paquete_id = av.paquete_id
   where b.fecha_ida is not null and b.fecha_regreso is not null and (p.tipo <> 'bloqueo' or (b.destino_id is not null and b.destino_id = any (ef.ids)))
  union all
  select ae.paquete_id, e.moneda, 'vuelo'
    from public.armado_empaquetados ae join public.empaquetados e on e.id = ae.empaquetado_id
    join p on p.id = ae.paquete_id join ef on ef.paquete_id = ae.paquete_id cross join hoy
   where e.activo and e.fecha_ida is not null and e.fecha_regreso is not null
     and (e.compra_inicio is null or hoy.d >= e.compra_inicio) and (e.compra_fin is null or hoy.d <= e.compra_fin)
     and (p.tipo <> 'bloqueo' or (e.destino_id is not null and e.destino_id = any (ef.ids)))
  union all
  select sd.paquete_id, case when sd.empaquetado_id is null then sd.moneda else e.moneda end, 'salida'
    from public.salidas_dinamicas sd
    join ef on ef.paquete_id = sd.paquete_id cross join hoy
    left join public.empaquetados e on e.id = sd.empaquetado_id
   where sd.activo and sd.fecha_ida is not null and sd.fecha_regreso is not null and sd.fecha_regreso > sd.fecha_ida
     and sd.fecha_ida >= hoy.d and (sd.compra_inicio is null or hoy.d >= sd.compra_inicio) and (sd.compra_fin is null or hoy.d <= sd.compra_fin)
     and (sd.empaquetado_id is null
          or (e.id is not null and e.activo and btrim(coalesce(e.record, '')) = '' and e.fecha_ida is not null and e.fecha_regreso is not null
              and (e.compra_inicio is null or hoy.d >= e.compra_inicio) and (e.compra_fin is null or hoy.d <= e.compra_fin)
              and e.fecha_ida >= hoy.d and e.moneda in ('COP', 'USD') and coalesce(e.tarifa_para_empaquetar, 0) > 0
              and e.destino_id is not null and e.destino_id = any (ef.ids)
              and round(coalesce(sd.valor_tiquete, 0), 2) = round(e.tarifa_para_empaquetar, 2)
              and round(coalesce(sd.fee_infante, 0), 2) = round(coalesce(e.fee_infante, 0), 2)
              and sd.fecha_ida = e.fecha_ida and sd.fecha_regreso is not distinct from e.fecha_regreso
              and btrim(coalesce(sd.ruta, '')) = btrim(coalesce(e.ruta, '')) and btrim(coalesce(sd.aerolinea, '')) = btrim(coalesce(e.aerolinea, ''))
              and sd.moneda = e.moneda))
),
req as (  -- ¿requiere TRM? (en el modo 63 los vuelos del armado no entran a la oferta)
  select paquete_id, bool_or(moneda = 'USD' and tipo <> 'vuelo') as requiere
    from fz group by paquete_id
),
-- Paquetes con tarifario ya publicado en modo de siempre: al regenerar, el evaluador compara cada fuente QUE APORTA con la moneda con que se publicó
-- (la moneda de una salida dinámica manual no cuenta fuera del modo 63).
incompat as (
  select distinct p.id
    from p join fz on fz.paquete_id = p.id
   where p.modo_oferta = 'legacy' and p.con_snapshot and p.moneda in ('COP', 'USD') and fz.tipo <> 'salida' and fz.moneda is distinct from p.moneda
),
est as (
  select
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'moneda_publicacion') as col,
    exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_moneda_publicacion_chk') as chk_mp,
    coalesce((select pg_get_constraintdef(oid) not like '%trm_oferta%' from pg_constraint
               where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_chk'), false) as chk_63_sin_trm,
    exists (select 1 from pg_constraint where conrelid = 'public.armado_paquetes'::regclass and conname = 'armado_paquetes_modo63_moneda_chk') as chk_63_cop,
    coalesce((select not a.attnotnull from pg_attribute a where a.attrelid = 'public.tarifario_oferta_63'::regclass and a.attname = 'trm'), false)
      and coalesce((select not a.attnotnull from pg_attribute a where a.attrelid = 'public.p63_oferta'::regclass and a.attname = 'trm'), false) as trm_nullable,
    coalesce((select pg_get_constraintdef(oid) like '%valor_cop_63 = valor_total%' from pg_constraint
               where conrelid = 'public.cuentas_por_pagar'::regclass and conname = 'cuentas_por_pagar_cop63_chk'), false) as chk_cxp,
    exists (select 1 from pg_trigger where tgrelid = 'public.armado_paquetes'::regclass and tgname = 'tr_inv_moneda_publicacion_90' and tgenabled = 'O') as trg_inv,
    coalesce((select pg_get_functiondef(f.oid) like '%p63_requiere_trm%' from pg_proc f
               where f.proname = 'publicar_tarifario_resultado_63' and f.pronamespace = 'public'::regnamespace), false) as fn_publicar,
    coalesce((select pg_get_functiondef(f.oid) like '%p63_requiere_trm%' from pg_proc f
               where f.proname = 'crear_cotizacion_oferta_63' and f.pronamespace = 'public'::regnamespace), false) as fn_cotizar,
    coalesce((select pg_get_functiondef(f.oid) like '%p63_requiere_trm%' from pg_proc f
               where f.proname = 'aceptar_oferta_63' and f.pronamespace = 'public'::regnamespace), false) as fn_aceptar,
    coalesce((select pg_get_functiondef(f.oid) like '%la oferta aceptada no tiene TRM%' from pg_proc f
               where f.proname = 'p63_registrar_financiero' and f.pronamespace = 'public'::regnamespace), false) as fn_registrar,
    to_regprocedure('public.p63_requiere_trm(bigint)') is not null as fn_requiere
),
ap as (
  select (col and chk_mp and chk_63_sin_trm and chk_63_cop and trm_nullable and chk_cxp and trg_inv and fn_publicar and fn_cotizar and fn_aceptar and fn_registrar and fn_requiere) as aplicada
    from est
)
select control, valor, esperado, estado
  from (
    select 1 as ord, 'migracion_233_estructura' as control,
           case when (select aplicada from ap) then 'aplicada' else 'pendiente' end as valor, 'aplicada' as esperado,
           case when (select aplicada from ap) then 'OK' else 'REVISAR' end as estado
    union all select 2, 'columna_y_check_moneda_publicacion', ((select col from est) and (select chk_mp from est))::text, 'true',
           case when (select col and chk_mp from est) then 'OK' else 'REVISAR' end
    union all select 3, 'modo63_no_exige_trm_y_solo_cop', ((select chk_63_sin_trm from est) and (select chk_63_cop from est))::text, 'true',
           case when (select chk_63_sin_trm and chk_63_cop from est) then 'OK' else 'REVISAR' end
    union all select 4, 'trm_nullable_en_oferta_y_publicacion_63', (select trm_nullable from est)::text, 'true', case when (select trm_nullable from est) then 'OK' else 'REVISAR' end
    union all select 5, 'cxp_equivalente_sin_trm_solo_si_cop_igual_al_valor', (select chk_cxp from est)::text, 'true', case when (select chk_cxp from est) then 'OK' else 'REVISAR' end
    union all select 6, 'trigger_invalida_al_cambiar_moneda_publicacion', (select trg_inv from est)::text, 'true', case when (select trg_inv from est) then 'OK' else 'REVISAR' end
    union all select 7, 'rpc_publicar_cotizar_aceptar_registrar_validan_trm_requerida',
           ((select fn_publicar and fn_cotizar and fn_aceptar and fn_registrar from est))::text, 'true',
           case when (select fn_publicar and fn_cotizar and fn_aceptar and fn_registrar from est) then 'OK' else 'REVISAR' end
    union all select 8, 'p63_requiere_trm_existe_y_no_la_ejecuta_anon_ni_authenticated',
           case when (select fn_requiere from est)
                then (not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE')
                      and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE'))::text
                else 'no existe' end, 'true',
           case when not (select fn_requiere from est) then 'REVISAR'
                when not has_function_privilege('anon', 'public.p63_requiere_trm(bigint)', 'EXECUTE')
                     and not has_function_privilege('authenticated', 'public.p63_requiere_trm(bigint)', 'EXECUTE') then 'OK' else 'REVISAR' end
    union all select 9, 'tablas_privadas_63_con_rls_y_sin_acceso_anon_ni_authenticated',
           ((select relrowsecurity from pg_class where oid = 'public.p63_oferta'::regclass)
            and (select relrowsecurity from pg_class where oid = 'public.tarifario_oferta_63'::regclass)
            and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'SELECT')
            and not has_table_privilege('anon', 'public.tarifario_oferta_63', 'SELECT') and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'SELECT'))::text, 'true',
           case when (select relrowsecurity from pg_class where oid = 'public.p63_oferta'::regclass)
                     and (select relrowsecurity from pg_class where oid = 'public.tarifario_oferta_63'::regclass)
                     and not has_table_privilege('anon', 'public.p63_oferta', 'SELECT') and not has_table_privilege('authenticated', 'public.p63_oferta', 'SELECT')
                     and not has_table_privilege('anon', 'public.tarifario_oferta_63', 'SELECT') and not has_table_privilege('authenticated', 'public.tarifario_oferta_63', 'SELECT')
                then 'OK' else 'REVISAR' end
    union all
    -- DECISIVO ANTES: un paquete de siempre con tarifario publicado y una fuente en OTRA moneda que la publicada se rechazaría al regenerar
    -- (mezcla fuera del modo 63, Entrega E). Debe ser 0; si no, decidir cada caso antes de desplegar el código.
    select 10, 'paquetes_publicados_con_fuentes_en_otra_moneda', (select count(*) from incompat)::text, '0',
           case when (select count(*) from incompat) = 0 then 'OK' else 'REVISAR' end
    union all select 11, 'ids_de_esos_paquetes (máx. 20)',
           coalesce((select string_agg(id::text, ', ' order by id) from (select id from incompat order by id limit 20) t), 'ninguno'), 'ninguno',
           case when (select count(*) from incompat) = 0 then 'OK' else 'REVISAR' end
    union all
    -- DECISIVO: un paquete 63 que hoy requiere TRM y no la tiene no podría publicar ni cotizar.
    select 12, 'paquetes_63_que_requieren_trm_sin_trm',
           (select count(*) from p join req on req.paquete_id = p.id where p.modo_oferta = 'cop_trm_63' and req.requiere and p.trm_oferta is null)::text, '0',
           case when (select count(*) from p join req on req.paquete_id = p.id where p.modo_oferta = 'cop_trm_63' and req.requiere and p.trm_oferta is null) = 0 then 'OK' else 'REVISAR' end
    union all select 13, 'paquetes_63_total / con_fuentes_en_usd / sin_ninguna_fuente_en_usd',
           (select count(*) from p where p.modo_oferta = 'cop_trm_63')::text || ' / '
           || (select count(*) from p join req on req.paquete_id = p.id where p.modo_oferta = 'cop_trm_63' and req.requiere)::text || ' / '
           || (select count(*) from p where p.modo_oferta = 'cop_trm_63' and not exists (select 1 from req where req.paquete_id = p.id and req.requiere))::text,
           'dato', 'INFO'
    union all
    -- Tras la 233 el backfill debe estar completo para todo paquete con tarifario publicado o en modo 63.
    select 14, 'paquetes_con_snapshot_o_modo63_sin_moneda_publicacion (tras la 233)',
           (select count(*) from p where p.mp is null and (p.con_snapshot or p.modo_oferta = 'cop_trm_63'))::text, '0',
           case when not (select aplicada from ap) then 'INFO'
                when (select count(*) from p where p.mp is null and (p.con_snapshot or p.modo_oferta = 'cop_trm_63')) = 0 then 'OK' else 'REVISAR' end
    union all
    select 15, 'moneda_publicacion_distinta_de_la_publicada_en_modo_de_siempre (tras la 233)',
           (select count(*) from p where p.modo_oferta = 'legacy' and p.con_snapshot and p.mp is distinct from p.moneda)::text, '0',
           case when not (select aplicada from ap) then 'INFO'
                when (select count(*) from p where p.modo_oferta = 'legacy' and p.con_snapshot and p.mp is distinct from p.moneda) = 0 then 'OK' else 'REVISAR' end
    union all
    select 16, 'paquetes_63_con_moneda_publicacion_distinta_de_cop (tras la 233)',
           (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.mp is not null and p.mp <> 'COP')::text, '0',
           case when not (select aplicada from ap) then 'INFO'
                when (select count(*) from p where p.modo_oferta = 'cop_trm_63' and p.mp is not null and p.mp <> 'COP') = 0 then 'OK' else 'REVISAR' end
    union all
    select 17, 'paquetes_activos_sin_tarifario_publicado_que_deberan_elegir_moneda',
           (select count(*) from p where p.activo and not p.con_snapshot and p.modo_oferta = 'legacy' and p.mp is null)::text, 'dato (se eligen en la configuración del paquete)', 'INFO'
    union all
    select 18, 'tarifarios_publicables (comparar antes/después: la 233 NO debe cambiarlo)',
           (select count(*) from p where coalesce(p.publicable, false))::text, 'igual al preflight', 'INFO'
    union all
    select 19, 'ofertas_63_abiertas / con_trm_nula',
           (select count(*) from public.p63_oferta where estado = 'abierta')::text || ' / '
           || (select count(*) from public.p63_oferta o where o.estado = 'abierta' and to_jsonb(o) ->> 'trm' is null)::text, 'dato', 'INFO'
    union all
    select 20, 'obligaciones_aceptadas_con_equivalente_cop_sin_trm',
           (select count(*) from public.cuentas_por_pagar c where c.aceptacion_63_id is not null and c.trm_63 is null)::text, 'dato (0 hasta que se acepte una oferta sin TRM)', 'INFO'
    union all
    select 21, 'obligaciones_aceptadas_en_usd_sin_trm',
           (select count(*) from public.cuentas_por_pagar c where c.aceptacion_63_id is not null and c.moneda = 'USD' and c.trm_63 is null)::text, '0',
           case when (select count(*) from public.cuentas_por_pagar c where c.aceptacion_63_id is not null and c.moneda = 'USD' and c.trm_63 is null) = 0 then 'OK' else 'REVISAR' end
  ) q
 order by ord;
