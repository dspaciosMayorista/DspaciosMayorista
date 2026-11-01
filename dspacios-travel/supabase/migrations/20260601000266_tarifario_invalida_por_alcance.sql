-- ─────────────────────────────────────────────────────────────────────────────
-- 266 · El tarifario publicado se invalida al editar los precios por alcance y las franjas de un servicio (aditiva, sin tocar migraciones anteriores).
--
-- Hueco que cierra: la 181 invalida el tarifario de los paquetes que usan un servicio cuando cambia `servicio_temporadas`, `servicio_tarifa_pax` o el catálogo
-- (`servicios_adicionales`). La 255 y la 262 agregaron más fuentes de PRECIO del servicio que esos disparadores no ven:
--   · `servicio_precio_alcance`      (precio por alcance y rango de pasajeros de una vigencia)  — cuelga de `servicio_temporada_id`, no de `servicio_id`;
--   · `servicio_suplementos_franja`  (suplemento por franja horaria de traslado)                — idem;
--   · `servicios_adicionales.tipo_receptivo / combo_incluye_traslado / combo_traslado_alcance` (cómo se cobra el traslado de un combo).
-- Sin disparador, editar uno de ellos dejaba las filas viejas publicadas y vendibles hasta que alguien regenerara a mano. Ahora cualquier alta, baja o cambio EFECTIVO
-- llama a `tarifario_invalidar(paquetes que usan el servicio, true)`: sube la revisión de fuente, deja el paquete «pendiente» y lo oculta (`tarifario_snapshot_publicable = false`)
-- hasta regenerar; una publicación por lotes en curso queda descartada por la revisión (la activación la rechaza).
--
-- NO depende de la 260 (funciona igual con la 181 y con la 260): usa `tarifario_invalidar(bigint[], boolean)` con la firma estable que tiene desde la 181. NO cambia precios, reglas ni el límite de 30 s.
-- Idempotente. Rollback: supabase/scripts/rollback_266_tarifario_invalida_por_alcance.sql.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.servicio_precio_alcance') is null or to_regclass('public.servicio_suplementos_franja') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'servicios_adicionales' and column_name = 'combo_traslado_alcance') then
    raise exception '266 ABORTADA: falta la 255 o la 262 (servicio_precio_alcance / servicio_suplementos_franja / servicios_adicionales.combo_traslado_alcance).';
  end if;
  if to_regprocedure('public.tarifario_invalidar(bigint[],boolean)') is null then
    raise exception '266 ABORTADA: falta tarifario_invalidar(bigint[], boolean) (migración 181).';
  end if;
end $$;

-- Vigencia → servicio → paquetes que lo usan. Todo cambio efectivo oculta (bloquear = true): un precio por alcance nuevo, editado o retirado cambia lo que cuesta una venta.
create or replace function public.tarifario_trg_bump_por_vigencia_servicio()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids bigint[];
begin
  if TG_OP = 'UPDATE' and to_jsonb(NEW) = to_jsonb(OLD) then return NEW; end if;
  select array_agg(distinct a.paquete_id order by a.paquete_id) into v_ids
    from public.armado_servicios a
    join public.servicio_temporadas t on t.servicio_id = a.servicio_id
   where t.id = any (array_remove(array[case when TG_OP <> 'INSERT' then OLD.servicio_temporada_id end, case when TG_OP <> 'DELETE' then NEW.servicio_temporada_id end], null));
  -- Candado de los paquetes SIEMPRE en orden de id: dos guardados concurrentes que comparten paquetes no se bloquean entre sí (sin esto, el UPDATE multifila de tarifario_invalidar los toma en orden físico y dos transacciones se cruzan → deadlock).
  perform 1 from public.armado_paquetes where id = any (v_ids) order by id for update;
  perform public.tarifario_invalidar(v_ids, true);
  return coalesce(NEW, OLD);
end $$;

-- Campos del catálogo que la 262 agregó y que deciden cómo se cobra el servicio. (El alta y la baja ya las cubre el disparador de la 181 sobre servicios_adicionales.)
create or replace function public.tarifario_trg_bump_servicio_alcance_catalogo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids bigint[];
begin
  if NEW.tipo_receptivo is not distinct from OLD.tipo_receptivo
     and NEW.combo_incluye_traslado is not distinct from OLD.combo_incluye_traslado
     and NEW.combo_traslado_alcance is not distinct from OLD.combo_traslado_alcance then return NEW; end if;
  select array_agg(distinct paquete_id order by paquete_id) into v_ids from public.armado_servicios where servicio_id = NEW.id;
  perform 1 from public.armado_paquetes where id = any (v_ids) order by id for update;   -- mismo orden de candado que arriba
  perform public.tarifario_invalidar(v_ids, true);
  return NEW;
end $$;

revoke all on function public.tarifario_trg_bump_por_vigencia_servicio() from public, anon, authenticated;
revoke all on function public.tarifario_trg_bump_servicio_alcance_catalogo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_servicio_precio_alcance on public.servicio_precio_alcance;
create trigger tarifario_trg_servicio_precio_alcance after insert or delete or update on public.servicio_precio_alcance
  for each row execute function public.tarifario_trg_bump_por_vigencia_servicio();

drop trigger if exists tarifario_trg_servicio_suplementos_franja on public.servicio_suplementos_franja;
create trigger tarifario_trg_servicio_suplementos_franja after insert or delete or update on public.servicio_suplementos_franja
  for each row execute function public.tarifario_trg_bump_por_vigencia_servicio();

drop trigger if exists tarifario_trg_servicios_alcance_catalogo on public.servicios_adicionales;
create trigger tarifario_trg_servicios_alcance_catalogo after update of tipo_receptivo, combo_incluye_traslado, combo_traslado_alcance on public.servicios_adicionales
  for each row execute function public.tarifario_trg_bump_servicio_alcance_catalogo();
