-- ROLLBACK 260 — devuelve el tarifario al estado de la 256/258/259: vista, política de lectura, función de invalidación y disparadores de la 181; quita las tablas, columnas y funciones de la 260.
--
-- ANTES (en este orden):
--   1. Apaga TARIFARIO_PUBLICACION_POR_LOTES en Vercel y espera el redeploy (o revierte el código): el código nuevo llama funciones que este script elimina.
--   2. Si pg_cron está habilitado, este script retira sus dos trabajos. Si usas la ruta /api/cron/publicacion-tarifario, quita su entrada de vercel.json.
--   3. Ejecuta REPETIDAMENTE hasta que devuelva 0 (cada pasada borra una tanda; no tiene que caber en un solo timeout):
--        delete from public.tarifario_resultado where ctid in (
--          select r.ctid from public.tarifario_resultado r join public.armado_paquetes ap on ap.id = r.paquete_id
--           where (r.generacion is not null and r.generacion is distinct from ap.tarifario_generacion_publicada)
--             or (r.generacion is null and ap.tarifario_por_generacion) limit 2000);
--      (son las filas de generaciones NO publicadas: sin la 260 serían visibles y mezclarían precios viejos con nuevos).
--   4. Cuando no queden publicaciones en la cola (select count(*) from public.tarifario_publicacion_cola where estado <> 'fallida' = 0) corre este script.
-- Este script ABORTA (sin cambiar nada) si quedan filas de generaciones no publicadas o publicaciones en curso.
-- Efecto sobre los datos: los paquetes que tenían filas ocultas por la invalidación diferencial pasan a «pendiente» y con el snapshot BLOQUEADO (el comportamiento de la 181: se ocultan enteros
-- hasta regenerarlos). El resto sigue publicado tal cual; la composición de la 258 y el diagnóstico de la 256 no se tocan.
begin;

-- Solo se revierte lo que es EXACTAMENTE la 260 (huella): si otra migración o un cambio ajeno tocó estas tres definiciones, revertir las pisaría. Aborta sin cambiar nada.
do $$
declare
  v_inv text := md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.tarifario_invalidar(bigint[],boolean)')), chr(13), ''));
  v_vis text := md5(pg_get_viewdef(to_regclass('public.tarifario_resultado_publicable'), true));
  v_pol text := (select md5(pg_get_expr(pl.polqual, pl.polrelid)) from pg_policy pl where pl.polrelid = 'public.tarifario_resultado'::regclass and pl.polname = 'tarifario_resultado: lectura');
begin
  if v_inv is distinct from '444686e7dee9843b80da3dcca7f54da5' then raise exception 'ROLLBACK 260 ABORTADO (REVISAR): tarifario_invalidar no es la definición de la 260 (huella %); hay un cambio ajeno o ya se revirtió.', v_inv; end if;
  if v_vis is distinct from '04f7b9f1b8e7053ef45335ce9cce0688' then raise exception 'ROLLBACK 260 ABORTADO (REVISAR): la vista tarifario_resultado_publicable no es la de la 260 (huella %); hay un cambio ajeno o ya se revirtió.', v_vis; end if;
  if v_pol is distinct from '585e5a4716a0e2ed88e09462d126e6e4' then raise exception 'ROLLBACK 260 ABORTADO (REVISAR): la política de lectura de tarifario_resultado no es la de la 260 (huella %); hay un cambio ajeno o ya se revirtió.', v_pol; end if;
end $$;

do $$
begin
  if exists (select 1 from public.tarifario_publicacion_cola where estado <> 'fallida') then
    raise exception 'ROLLBACK 260 ABORTADO: hay publicaciones en curso en tarifario_publicacion_cola. Espera a que terminen o retira el trabajador y vacía la cola.';
  end if;
  if exists (select 1 from public.tarifario_resultado r join public.armado_paquetes ap on ap.id = r.paquete_id
              where (r.generacion is not null and r.generacion is distinct from ap.tarifario_generacion_publicada) or (r.generacion is null and ap.tarifario_por_generacion)) then
    raise exception 'ROLLBACK 260 ABORTADO: quedan filas de generaciones NO publicadas. Ejecuta el DELETE por tandas del paso 3 de la cabecera hasta que devuelva 0.';
  end if;
end $$;

-- pg_cron (si existe): fuera los dos trabajos.
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname in ('tarifario_cola_correr', 'tarifario_cola_purga');
  end if;
exception when others then
  raise notice 'rollback 260: no se pudieron retirar los trabajos de pg_cron (%): retíralos a mano.', sqlerrm;
end $$;

-- Los paquetes con filas ocultas por la invalidación diferencial vuelven al comportamiento de la 181 (snapshot bloqueado hasta regenerar) y esas filas se borran.
update public.armado_paquetes set tarifario_snapshot_publicable = false, tarifario_estado = 'pendiente'
 where id in (select paquete_id from public.tarifario_fila_oculta);
delete from public.tarifario_resultado where id in (select fila_id from public.tarifario_fila_oculta);

-- Disparadores nuevos fuera; los dos por fila de la 181 de vuelta.
drop trigger if exists tarifario_trg_tarifa_hotel_ins on public.tarifa_hotel;
drop trigger if exists tarifario_trg_tarifa_hotel_upd on public.tarifa_hotel;
drop trigger if exists tarifario_trg_tarifa_hotel_del on public.tarifa_hotel;
drop trigger if exists tarifario_trg_hotel_temporadas_ins on public.hotel_temporadas;
drop trigger if exists tarifario_trg_hotel_temporadas_upd on public.hotel_temporadas;
drop trigger if exists tarifario_trg_hotel_temporadas_del on public.hotel_temporadas;
drop trigger if exists tarifario_pub_monolitica on public.armado_paquetes;
drop trigger if exists tarifario_resultado_sellar on public.tarifario_resultado;   -- versiones previas del diseño

-- tarifario_invalidar EXACTAMENTE como la dejó la 181 (copiada literal de esa migración; el postcheck/prueba comprueba su huella 8f84…).
create or replace function public.tarifario_invalidar(p_paquete_ids bigint[], p_bloquear boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_paquete_ids is null or array_length(p_paquete_ids, 1) is null then
    return;
  end if;
  if p_bloquear then
    update public.armado_paquetes
      set tarifario_revision_fuente = tarifario_revision_fuente + 1,
          tarifario_estado = 'pendiente',
          tarifario_snapshot_publicable = false
      where id = any(p_paquete_ids);
  else
    -- INSERT aditivo: sube la revisión (hay algo nuevo que publicar) pero
    -- NUNCA toca tarifario_snapshot_publicable — si ya estaba bloqueado por
    -- otra invalidación previa, sigue bloqueado; si estaba en true, sigue en
    -- true (el snapshot anterior no perdió validez por el solo hecho de que
    -- se haya agregado una opción nueva).
    update public.armado_paquetes
      set tarifario_revision_fuente = tarifario_revision_fuente + 1,
          tarifario_estado = 'pendiente'
      where id = any(p_paquete_ids);
  end if;
end;
$$;

comment on function public.tarifario_invalidar(bigint[], boolean) is
  'Helper interno de los triggers de invalidación del tarifario — NUNCA se expone como RPC (revoke execute from public/anon/authenticated). Sube tarifario_revision_fuente y marca tarifario_estado=''pendiente'' para los paquetes dados; con p_bloquear=true también fuerza tarifario_snapshot_publicable=false. Migración 181.';
revoke all on function public.tarifario_invalidar(bigint[], boolean) from public, anon, authenticated;

drop trigger if exists tarifario_trg_tarifa_hotel on public.tarifa_hotel;
create trigger tarifario_trg_tarifa_hotel
  after insert or update or delete on public.tarifa_hotel
  for each row execute function public.tarifario_trg_bump_por_hotel();
drop trigger if exists tarifario_trg_hotel_temporadas on public.hotel_temporadas;
create trigger tarifario_trg_hotel_temporadas
  after insert or update or delete on public.hotel_temporadas
  for each row execute function public.tarifario_trg_bump_por_hotel();

-- Política de lectura de la 182 y vista de la 256 (r.* con todas las columnas, como antes). La vista se recrea porque `create or replace` no puede quitar columnas.
-- La vista NO se puede borrar: otras vistas dependen de ella (p. ej. tarifario_resumen). Se REEMPLAZA conservando su identidad, con la misma lista explícita de columnas de la 256
-- (todas las de la tabla salvo las 4 de la 260) y el filtro de la 256; así deja de usar las columnas nuevas y luego se pueden quitar de la tabla. Conserva opciones y permisos.
do $$
declare v_cols text;
begin
  select string_agg(format('r.%I', a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.tarifario_resultado'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('generacion', 'revision_fuente', 'lote');
  execute format($v$
    create or replace view public.tarifario_resultado_publicable
      with (security_barrier = true, security_invoker = false)
    as
    select %s
      from public.tarifario_resultado r
      join public.armado_paquetes ap on ap.id = r.paquete_id
     where ap.tarifario_snapshot_publicable = true
       and ap.activo = true
  $v$, v_cols);
end $$;
drop policy if exists "tarifario_resultado: lectura" on public.tarifario_resultado;
create policy "tarifario_resultado: lectura" on public.tarifario_resultado
  for select
  using (
    coalesce(public.mi_rol()::text, '') in ('superadmin', 'gerencia', 'administracion', 'operaciones')
    or public.tarifario_paquete_publicable(paquete_id)
  );
alter table public.tarifario_resultado drop column if exists generacion, drop column if exists revision_fuente, drop column if exists lote;

-- Funciones y tablas de la 260.
drop function if exists public.tarifario_cola_correr(integer);
drop function if exists public.tarifario_publicacion_avanzar(bigint, bigint);
drop function if exists public.tarifario_publicacion_avanzar_i(bigint, bigint);
drop function if exists public.tarifario_publicacion_encolar(bigint, bigint);
drop function if exists public.tarifario_lote_espera_guardar(bigint, bigint, integer, text);
drop function if exists public.tarifario_lote_limpiar(bigint, integer);
drop function if exists public.tarifario_lote_limpiar_i(bigint, integer);
drop function if exists public.tarifario_lote_activar(bigint, bigint);
drop function if exists public.tarifario_lote_activar_i(bigint, bigint);
drop function if exists public.tarifario_lote_agregar(bigint, bigint, integer, text);
drop function if exists public.tarifario_lote_agregar_i(bigint, bigint, integer, text);
drop function if exists public.tarifario_publicacion_pendiente(bigint);
drop function if exists public.tarifario_publicacion_estado(bigint, bigint);
drop function if exists public.tarifario_manifiesto_crear(bigint, bigint, bigint, text, jsonb, jsonb, smallint, text, numeric, text);
drop function if exists public.tarifario_cambio_hotel(jsonb);
drop function if exists public.tarifario_evaluar_ocultar(bigint, bigint, text, text, bigint, integer, boolean);
drop function if exists public.tarifario_trg_tarifa_ins();
drop function if exists public.tarifario_trg_tarifa_upd();
drop function if exists public.tarifario_trg_tarifa_del();
drop function if exists public.tarifario_trg_vigencia_ins();
drop function if exists public.tarifario_trg_vigencia_upd();
drop function if exists public.tarifario_trg_vigencia_del();
drop function if exists public.tarifario_vigencia_aplica(public.hotel_temporadas, date, date, text);
drop function if exists public.tarifario_neto_de(public.tarifa_hotel, text);
drop function if exists public.tarifario_pub_monolitica();
drop function if exists public.tarifario_resultado_sellar();
drop function if exists public.tarifario_fila_publicada(bigint, bigint, bigint);
drop table if exists public.tarifario_publicacion_cola;
drop table if exists public.tarifario_lote_espera;
drop table if exists public.tarifario_lote_control;
drop table if exists public.tarifario_manifiesto_lote;
drop table if exists public.tarifario_manifiesto;
drop table if exists public.tarifario_fila_oculta;
drop table if exists public.tarifario_resultado_neto;
drop table if exists public.tarifario_cambio_fuente;
drop function if exists public.tarifario_manifiesto_inmutable();   -- después de las tablas: sus disparadores dependen de ella
alter table public.armado_paquetes drop column if exists tarifario_por_generacion;
drop index if exists public.idx_tarifario_resultado_paquete_generacion;

notify pgrst, 'reload schema';
commit;
