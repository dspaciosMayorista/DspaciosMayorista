-- ───────────────────────────────────────────────────────────────────────────
-- 181 · TARIFARIO — publicación atómica de snapshots + revisión de fuentes
--
-- FASE 1 de la corrección de "snapshots desactualizados durante la
-- recalculación" (pendiente #1 de TASKS.md). Diagnóstico completo en las
-- notas de la rama `diagnostico/snapshots-recalculo` (no versionadas en el
-- repo). Esta migración es SOLO infraestructura SQL — no cambia todavía
-- ningún lector (`lib/tarifario/*`, `cotizar.ts`, `computo.ts`) ni la UI.
--
-- PROBLEMA QUE CIERRA
--   `generarTarifario()` (app/(dashboard)/dashboard/paquetes/actions.ts) hace
--   `delete` + `insert` sobre `tarifario_resultado` como DOS llamadas HTTP
--   sueltas, sin ningún candado de concurrencia ni forma de saber si las
--   fuentes (tarifa_hotel, hotel_temporadas, armado_*, etc.) cambiaron
--   DURANTE las ~10 consultas que hace antes de llegar a publicar. Un cálculo
--   viejo puede terminar después de uno nuevo y pisarlo; un insert fallido
--   deja el paquete sin snapshot; y nada bloquea la lectura de un paquete
--   desactivado o de una tarifa recién eliminada mientras espera el próximo
--   recálculo.
--
-- DISEÑO (4 conceptos separados, todos en `armado_paquetes`)
--   1. `tarifario_revision_fuente`   — sube SOLO por trigger, en la MISMA
--      transacción que la fuente cambia. Es la huella de "algo cambió".
--   2. `tarifario_revision_publicada`— qué revisión de fuentes estaba vigente
--      cuando la ÚLTIMA publicación exitosa completó su cálculo.
--   3. `tarifario_generacion`/`tarifario_generacion_publicada`/
--      `tarifario_estado`/`tarifario_error`/`tarifario_actualizado_en` —
--      intento/estado de CÁLCULO (pendiente/recalculando/listo/fallido).
--      Puramente observabilidad — ningún lector público la consulta todavía
--      (queda para una fase de UI posterior).
--   4. `tarifario_snapshot_publicable` — publicabilidad del snapshot YA
--      escrito en `tarifario_resultado`. Un lector de fase futura la usará
--      para decidir si sigue mostrando lo que hay o no; en esta fase solo se
--      escribe, todavía no se lee en ningún lugar de la aplicación.
--
-- POR QUÉ TRIGGERS Y NO LLAMADAS OPCIONALES DESDE TYPESCRIPT
--   Un incremento de revisión llamado "a mano" desde cada Server Action
--   depende de que TODO camino de escritura presente y futuro (incluidas las
--   cargas masivas CSV que insertan fila por fila con `sb.from(...).insert`,
--   el RPC de la calculadora, y cualquier corrección manual del dueño en el
--   SQL Editor) recuerde invocarlo — exactamente el riesgo que motivó esta
--   ronda. Un trigger `AFTER` en la tabla fuente es la única garantía real:
--   dispara sin importar por dónde entró la escritura. Mismo criterio que ya
--   usa este proyecto para el trigger genérico de auditoría (`trg_auditoria`,
--   migración 087, adjuntado a TODAS las tablas base).
--
-- OLD Y NEW, SIEMPRE LOS DOS
--   Todo trigger que resuelve "a qué paquetes afecta este cambio" vía un JOIN
--   (tarifa_hotel/hotel_temporadas → armado_hoteles.hotel_id; servicio_
--   tarifa_pax/servicio_temporadas/servicios_adicionales → armado_servicios.
--   servicio_id; bloqueos_vuelo → armado_vuelos.bloqueo_id; empaquetados →
--   armado_empaquetados.empaquetado_id) usa la UNIÓN de la clave ANTES
--   (`OLD`) y DESPUÉS (`NEW`) del cambio — nunca `coalesce(NEW.x, OLD.x)`, que
--   dejaría sin invalidar a los paquetes asociados al valor ANTERIOR si la
--   clave foránea cambia en el mismo UPDATE. En un trigger combinado
--   (`AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`), `OLD` es NULL en
--   INSERT y `NEW` es NULL en DELETE — Postgres lo garantiza, no hace falta
--   ninguna guarda de `TG_OP` para leer sus campos con seguridad.
--
-- SECURITY DEFINER EN LOS TRIGGERS — JUSTIFICACIÓN DEMOSTRABLE
--   `bloqueos_vuelo` y `empaquetados` son escribibles por el rol
--   `control_vuelo` (migración 137: "bloqueos: escritura control";
--   migración 156: "empaquetados: escritura control"), pero `armado_paquetes`
--   y `tarifario_resultado` NO incluyen `control_vuelo` en su policy de
--   escritura (migración 018: solo superadmin/gerencia/administracion/
--   operaciones). Un trigger `SECURITY INVOKER` en `bloqueos_vuelo` que
--   intentara actualizar `armado_paquetes` bajo una sesión `control_vuelo`
--   fallaría en silencio (RLS filtra 0 filas, sin error) — la revisión de
--   fuente NUNCA subiría para un cambio de vuelo hecho por ese rol. Los 9
--   triggers de esta migración son `SECURITY DEFINER` con `search_path`
--   fijo, y NO exponen ningún RPC invocable directo (`revoke execute from
--   public` explícito en cada función): solo se disparan como efecto de una
--   escritura que YA pasó la RLS de SU PROPIA tabla, nunca a través de una
--   llamada `sb.rpc()`.
--
-- SIN RECURSIÓN
--   El trigger de `armado_paquetes` está acotado a
--   `UPDATE OF pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio,
--   fecha_viaje_fin, noches, activo, moneda` — la sintaxis `UPDATE OF
--   <columnas>` de Postgres hace que el trigger NUNCA dispare cuando el
--   único cambio es en las columnas `tarifario_*` (el helper
--   `tarifario_invalidar()` solo escribe esas columnas). Mismo criterio en
--   `hoteles` (`UPDATE OF moneda, modelo_tarifario`) y en
--   `servicios_adicionales` (`UPDATE OF precio_persona, recargo_individual,
--   liquidacion, moneda`) — además de evitar recursión, evita invalidar por
--   cambios cosméticos (nombre, descripción, foto).
--
-- INSERT ADITIVO VS. UPDATE/DELETE INVALIDANTE
--   Para las tablas que son "catálogo de tarifa/promoción/vuelo/servicio"
--   (tarifa_hotel, hotel_temporadas, bloqueos_vuelo, empaquetados,
--   salidas_dinamicas, servicio_tarifa_pax, servicio_temporadas,
--   servicios_adicionales): un INSERT agrega una opción nueva sin tocar nada
--   ya publicado → sube la revisión y deja `tarifario_snapshot_publicable`
--   TAL COMO ESTABA (nunca se fuerza a `true`, nunca se fuerza a `false`).
--   Un UPDATE o un DELETE sí puede estar cambiando/quitando algo que YA
--   estaba publicado → sube la revisión Y bloquea (`tarifario_snapshot_
--   publicable = false`).
--   Para las tablas de "armado"/ámbito del paquete completo (armado_hoteles,
--   armado_vuelos, armado_servicios, armado_empaquetados, columnas de
--   armado_paquetes, moneda/modelo de hoteles): CUALQUIER operación bloquea
--   siempre — agregar o quitar un hotel/vuelo/servicio del armado, o cambiar
--   fechas/margen/impuesto/moneda, cambia el PVP de TODO el paquete, nunca es
--   "aditivo" en el sentido de dejar intacto lo ya publicado.
--
-- ACTIVAR/DESACTIVAR UN PAQUETE
--   El trigger de `armado_paquetes` incluye la columna `activo` en su lista
--   `UPDATE OF` y siempre bloquea (`tarifario_snapshot_publicable = false`)
--   sin importar la dirección del cambio — esto YA satisface las dos reglas
--   del dueño con el mismo mecanismo: desactivar bloquea de inmediato, y
--   activar queda bloqueado hasta que una publicación exitosa (ver
--   `publicar_tarifario_resultado` más abajo, que hace
--   `tarifario_snapshot_publicable = activo`) lo rehabilite.
--
-- RPC (contrato exacto documentado en el comentario de cada función)
--   `iniciar_generacion_tarifario(p_paquete_id)` — SECURITY INVOKER (misma
--     policy de `armado_paquetes` que ya protegía esto). Pide un número de
--     generación nuevo y captura la revisión de fuente VIGENTE en ese
--     instante — ambos ANTES de que el caller empiece a calcular.
--   `publicar_tarifario_resultado(p_paquete_id, p_generacion,
--     p_revision_capturada, p_filas)` — SECURITY DEFINER + candado de rol
--     explícito (mismo patrón que `reemplazar_tarifas_hotel_calculadora`,
--     migración 179 — reemplaza TODAS las filas de un paquete, no un ajuste
--     puntual). Publica solo si generación Y revisión siguen vigentes;
--     `delete`+`insert`+actualización de estado en UNA transacción.
--   `marcar_generacion_fallida(p_paquete_id, p_generacion,
--     p_revision_capturada, p_error)` — SECURITY INVOKER. Solo toca el
--     intento vigente (generación Y revisión de fuente coincidentes con el
--     estado actual); nunca rehabilita un snapshot bloqueado.
--
-- Preflight / postcheck / rollback / pruebas:
--   supabase/scripts/{preflight,postcheck,rollback,test}_181_tarifario_snapshots_atomicos.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── A. Columnas nuevas en armado_paquetes ───────────────────────────────────
alter table public.armado_paquetes
  add column if not exists tarifario_revision_fuente bigint not null default 0,
  add column if not exists tarifario_revision_publicada bigint,
  add column if not exists tarifario_generacion bigint not null default 0,
  add column if not exists tarifario_generacion_publicada bigint,
  add column if not exists tarifario_estado text not null default 'pendiente',
  add column if not exists tarifario_error text,
  add column if not exists tarifario_actualizado_en timestamptz,
  add column if not exists tarifario_snapshot_publicable boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.armado_paquetes'::regclass
      and conname = 'armado_paquetes_tarifario_estado_check'
  ) then
    alter table public.armado_paquetes
      add constraint armado_paquetes_tarifario_estado_check
      check (tarifario_estado in ('pendiente', 'recalculando', 'listo', 'fallido'));
  end if;
end $$;

create index if not exists idx_armado_paquetes_tarifario_estado
  on public.armado_paquetes(tarifario_estado);

comment on column public.armado_paquetes.tarifario_revision_fuente is
  'Contador monotónico, incrementado SOLO por trigger, en la misma transacción que cualquier fuente relevante del paquete cambia (tarifa_hotel/hotel_temporadas/armado_*/salidas_dinamicas/bloqueos_vuelo/empaquetados/servicios_adicionales/servicio_tarifa_pax/servicio_temporadas/hoteles.moneda-modelo_tarifario/columnas de este mismo paquete). Migración 181.';
comment on column public.armado_paquetes.tarifario_revision_publicada is
  'Valor de tarifario_revision_fuente que estaba vigente cuando la última publicación EXITOSA completó su cálculo. NULL = nunca publicado bajo este mecanismo. Migración 181.';
comment on column public.armado_paquetes.tarifario_generacion is
  'Contador monotónico de INTENTOS de cálculo (manual o automático), incrementado por iniciar_generacion_tarifario(). Migración 181.';
comment on column public.armado_paquetes.tarifario_generacion_publicada is
  'Valor de tarifario_generacion de la última publicación EXITOSA. NULL = nunca publicado bajo este mecanismo. Migración 181.';
comment on column public.armado_paquetes.tarifario_estado is
  'pendiente=hay un recálculo debido (revisión de fuente cambió desde la última publicación o nunca se publicó); recalculando=un cálculo está en curso; listo=la última publicación tuvo éxito; fallido=el último intento falló (ver tarifario_error). Puramente observabilidad, ningún lector público la consulta. Migración 181.';
comment on column public.armado_paquetes.tarifario_error is
  'Mensaje SANEADO (nunca el error crudo de Postgres/Supabase) del último intento fallido de generarTarifario. Migración 181.';
comment on column public.armado_paquetes.tarifario_actualizado_en is
  'Momento de la última transición de tarifario_estado (publicación exitosa o fallo). Migración 181.';
comment on column public.armado_paquetes.tarifario_snapshot_publicable is
  'Si el snapshot YA escrito en tarifario_resultado para este paquete puede seguir mostrándose/vendiéndose. false = una mutación invalidante (UPDATE/DELETE de una fuente ya publicada, cambio de armado/fechas/margen/impuesto/moneda/modelo, o el paquete está desactivado) bloqueó el snapshot anterior hasta la próxima publicación exitosa. Ningún lector la consulta todavía en esta fase — se agrega para que la próxima fase (lectores) no necesite otra migración. Migración 181.';

-- ── B. Helper compartido — ÚNICO punto que escribe las columnas de arriba
--       desde un trigger. No expone RPC (revoke de execute más abajo). ─────
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

-- ── C. Funciones de trigger (una por forma de fan-out) ──────────────────────

-- C.1 — Por HOTEL: tarifa_hotel, hotel_temporadas. INSERT=aditivo, UPDATE/DELETE=bloquea.
create or replace function public.tarifario_trg_bump_por_hotel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_hoteles
    where hotel_id = any(array_remove(array[OLD.hotel_id, NEW.hotel_id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_hotel() from public, anon, authenticated;

drop trigger if exists tarifario_trg_tarifa_hotel on public.tarifa_hotel;
create trigger tarifario_trg_tarifa_hotel
  after insert or update or delete on public.tarifa_hotel
  for each row execute function public.tarifario_trg_bump_por_hotel();

drop trigger if exists tarifario_trg_hotel_temporadas on public.hotel_temporadas;
create trigger tarifario_trg_hotel_temporadas
  after insert or update or delete on public.hotel_temporadas
  for each row execute function public.tarifario_trg_bump_por_hotel();

-- C.2 — Por SERVICIO (tarifas/temporadas del servicio): servicio_tarifa_pax,
--        servicio_temporadas. INSERT=aditivo, UPDATE/DELETE=bloquea.
create or replace function public.tarifario_trg_bump_por_servicio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_servicios
    where servicio_id = any(array_remove(array[OLD.servicio_id, NEW.servicio_id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_servicio() from public, anon, authenticated;

drop trigger if exists tarifario_trg_servicio_tarifa_pax on public.servicio_tarifa_pax;
create trigger tarifario_trg_servicio_tarifa_pax
  after insert or update or delete on public.servicio_tarifa_pax
  for each row execute function public.tarifario_trg_bump_por_servicio();

drop trigger if exists tarifario_trg_servicio_temporadas on public.servicio_temporadas;
create trigger tarifario_trg_servicio_temporadas
  after insert or update or delete on public.servicio_temporadas
  for each row execute function public.tarifario_trg_bump_por_servicio();

-- C.3 — El SERVICIO del catálogo (servicios_adicionales) — columnas que
--        afectan precio/liquidación Y contenido ya publicado (`nombre`,
--        `descripcion` se denormalizan en tarifario_resultado — auditoría de
--        Fase 1, ronda 4). INSERT=aditivo (en la práctica un servicio nuevo
--        aún no tiene fila en armado_servicios, fan-out vacío), UPDATE/DELETE
--        de estas columnas=bloquea. `IS DISTINCT FROM` evita invalidar en un
--        UPDATE no-op (mismo criterio que C.8/C.8bis).
create or replace function public.tarifario_trg_bump_servicio_catalogo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  if TG_OP = 'UPDATE'
    and NEW.nombre is not distinct from OLD.nombre
    and NEW.descripcion is not distinct from OLD.descripcion
    and NEW.precio_persona is not distinct from OLD.precio_persona
    and NEW.recargo_individual is not distinct from OLD.recargo_individual
    and NEW.liquidacion is not distinct from OLD.liquidacion
    and NEW.moneda is not distinct from OLD.moneda
  then
    return NEW;
  end if;

  select array_agg(distinct paquete_id) into v_ids
    from public.armado_servicios
    where servicio_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_servicio_catalogo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_servicios_adicionales on public.servicios_adicionales;
create trigger tarifario_trg_servicios_adicionales
  after insert or delete or update of nombre, descripcion, precio_persona, recargo_individual, liquidacion, moneda
  on public.servicios_adicionales
  for each row execute function public.tarifario_trg_bump_servicio_catalogo();

-- C.4 — ARMADO directo (paquete_id propio de la fila): armado_hoteles,
--        armado_vuelos, armado_servicios, armado_empaquetados. Cualquier
--        operación bloquea siempre (agregar/quitar cambia el paquete completo).
create or replace function public.tarifario_trg_bump_armado_directo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  v_ids := array_remove(array[OLD.paquete_id, NEW.paquete_id], null);
  perform public.tarifario_invalidar(v_ids, true);
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_armado_directo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_armado_hoteles on public.armado_hoteles;
create trigger tarifario_trg_armado_hoteles
  after insert or update or delete on public.armado_hoteles
  for each row execute function public.tarifario_trg_bump_armado_directo();

drop trigger if exists tarifario_trg_armado_vuelos on public.armado_vuelos;
create trigger tarifario_trg_armado_vuelos
  after insert or update or delete on public.armado_vuelos
  for each row execute function public.tarifario_trg_bump_armado_directo();

drop trigger if exists tarifario_trg_armado_servicios on public.armado_servicios;
create trigger tarifario_trg_armado_servicios
  after insert or update or delete on public.armado_servicios
  for each row execute function public.tarifario_trg_bump_armado_directo();

drop trigger if exists tarifario_trg_armado_empaquetados on public.armado_empaquetados;
create trigger tarifario_trg_armado_empaquetados
  after insert or update or delete on public.armado_empaquetados
  for each row execute function public.tarifario_trg_bump_armado_directo();

-- C.5 — Por BLOQUEO aéreo negociado: bloqueos_vuelo (fan-out vía
--        armado_vuelos.bloqueo_id). INSERT=aditivo (un bloqueo recién creado
--        aún no está enlazado a ningún paquete — fan-out vacío en la
--        práctica), UPDATE de fecha/tarifa/ruta o DELETE=bloquea.
create or replace function public.tarifario_trg_bump_por_bloqueo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_vuelos
    where bloqueo_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_bloqueo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_bloqueos_vuelo on public.bloqueos_vuelo;
create trigger tarifario_trg_bloqueos_vuelo
  after insert or delete or update of tarifa_para_empaquetar, fecha_ida, fecha_regreso, ruta
  on public.bloqueos_vuelo
  for each row execute function public.tarifario_trg_bump_por_bloqueo();

-- C.6 — Por EMPAQUETADO (vuelo por sistema): empaquetados (fan-out vía
--        armado_empaquetados.empaquetado_id). Mismo criterio aditivo/bloqueo
--        que bloqueos_vuelo.
create or replace function public.tarifario_trg_bump_por_empaquetado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  select array_agg(distinct paquete_id) into v_ids
    from public.armado_empaquetados
    where empaquetado_id = any(array_remove(array[OLD.id, NEW.id], null));
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_por_empaquetado() from public, anon, authenticated;

drop trigger if exists tarifario_trg_empaquetados on public.empaquetados;
create trigger tarifario_trg_empaquetados
  after insert or delete or update of activo, compra_inicio, compra_fin, tarifa_para_empaquetar, fecha_ida, fecha_regreso, ruta
  on public.empaquetados
  for each row execute function public.tarifario_trg_bump_por_empaquetado();

-- C.7 — SALIDAS DINÁMICAS (paquete_id propio). INSERT=aditivo (una salida
--        nueva no invalida las demás), UPDATE/DELETE de una salida existente
--        (fecha/tarifa/activo)=bloquea.
create or replace function public.tarifario_trg_bump_salida_dinamica()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  v_ids := array_remove(array[OLD.paquete_id, NEW.paquete_id], null);
  perform public.tarifario_invalidar(v_ids, TG_OP <> 'INSERT');
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public.tarifario_trg_bump_salida_dinamica() from public, anon, authenticated;

drop trigger if exists tarifario_trg_salidas_dinamicas on public.salidas_dinamicas;
create trigger tarifario_trg_salidas_dinamicas
  after insert or update or delete on public.salidas_dinamicas
  for each row execute function public.tarifario_trg_bump_salida_dinamica();

-- C.8 — armado_paquetes: columnas propias que cambian el cálculo completo O
--        el contenido ya publicado. SIEMPRE bloquea (agregar/quitar del
--        armado, o cambiar identidad/contenido, nunca es "aditivo" a nivel
--        de paquete). `UPDATE OF <columnas>` es también lo que evita la
--        recursión (ver cabecera) — nunca dispara por un cambio en las
--        columnas tarifario_* que este mismo mecanismo escribe.
--
--        ⚠️ Auditoría de Fase 1, ronda 3 (hallazgo P1 "carrera entre moneda
--        preliminar y autoritativa"): `moneda` se sacó de esta lista a
--        propósito. Confirmado en código (PaqueteConfig/configToRow en este
--        mismo archivo) que NINGÚN formulario/acción escribe
--        `armado_paquetes.moneda` directamente — la única escritora es
--        `generarTarifario`, que la deriva de los hoteles/servicios del
--        paquete y ahora la persiste DENTRO de `publicar_tarifario_resultado`
--        (ver D.2 más abajo), en la MISMA transacción que publica las filas
--        calculadas con esos mismos datos. Es decir: moneda dejó de ser una
--        "fuente" que un humano edita y pasa a ser un dato DERIVADO del
--        cálculo — igual que `precio_pvp` no tiene su propio trigger de
--        invalidación. La causa REAL de un cambio de moneda (el hotel/
--        servicio que cambió) sigue cubierta por sus propios triggers
--        (`tarifario_trg_bump_hotel_moneda_modelo`,
--        `tarifario_trg_bump_armado_directo`) — no se pierde cobertura,
--        solo se elimina la carrera de escribir la CACHÉ antes de tener el
--        valor autoritativo.
--
--        Auditoría de Fase 1, ronda 3 (hallazgo P1 "cobertura incompleta de
--        fuentes"): `generarTarifario` lee y publica `nombre`/`tipo`/
--        `destino_id` (denormalizados en cada fila de `tarifario_resultado`
--        como `paquete_nombre`/`modulo`/`destino_id`+`destino_nombre`), pero
--        el trigger no los vigilaba — se agregan acá. Cambiar cualquiera de
--        los tres modifica CONTENIDO ya publicado (no solo el cálculo), así
--        que por defecto BLOQUEA — mismo criterio que el resto de columnas
--        de este trigger.
create or replace function public.tarifario_trg_bump_armado_paquetes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Auditoría de Fase 1, hallazgo 4: `UPDATE OF <columnas>` dispara el
  -- trigger cuando esas columnas son TARGET del UPDATE, sin importar si el
  -- valor realmente cambió. Un no-op de este tipo (guardar el formulario de
  -- configuración sin cambiar nada) no debe invalidar un snapshot que sigue
  -- siendo exacto. Se compara CADA columna con `IS DISTINCT FROM` (seguro
  -- con NULL) y solo se invalida si AL MENOS UNA cambió de verdad.
  if NEW.nombre is distinct from OLD.nombre
    or NEW.tipo is distinct from OLD.tipo
    or NEW.destino_id is distinct from OLD.destino_id
    or NEW.pct_mk is distinct from OLD.pct_mk
    or NEW.impuesto_tipo is distinct from OLD.impuesto_tipo
    or NEW.impuesto_fijo is distinct from OLD.impuesto_fijo
    or NEW.fecha_viaje_inicio is distinct from OLD.fecha_viaje_inicio
    or NEW.fecha_viaje_fin is distinct from OLD.fecha_viaje_fin
    or NEW.noches is distinct from OLD.noches
    or NEW.activo is distinct from OLD.activo
  then
    perform public.tarifario_invalidar(array[NEW.id], true);
  end if;
  return NEW;
end;
$$;
revoke all on function public.tarifario_trg_bump_armado_paquetes() from public, anon, authenticated;

-- ⚠️ `moneda` DELIBERADAMENTE fuera de esta lista `UPDATE OF` (ver el
-- comentario largo arriba) — la escritura autoritativa de moneda que hace
-- `publicar_tarifario_resultado` nunca dispara este trigger, sin importar
-- qué valor tenga, porque la columna ni siquiera está vigilada.
drop trigger if exists tarifario_trg_armado_paquetes on public.armado_paquetes;
create trigger tarifario_trg_armado_paquetes
  after update of nombre, tipo, destino_id, pct_mk, impuesto_tipo, impuesto_fijo, fecha_viaje_inicio, fecha_viaje_fin, noches, activo
  on public.armado_paquetes
  for each row execute function public.tarifario_trg_bump_armado_paquetes();

-- C.8bis — destinos: SOLO `nombre` (denormalizado en tarifario_resultado
--          como `destino_nombre`). Fan-out vía armado_paquetes.destino_id —
--          invalida TODOS los paquetes de ese destino. Bloquea solo si el
--          nombre cambió de verdad (auditoría de Fase 1, ronda 4: `IS
--          DISTINCT FROM`, mismo criterio de no-op que el resto de triggers
--          de esta migración — antes invalidaba incondicionalmente en cada
--          UPDATE de nombre, incluido un guardado sin cambios reales).
create or replace function public.tarifario_trg_bump_destino_nombre()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  if NEW.nombre is not distinct from OLD.nombre then
    return NEW;
  end if;

  select array_agg(distinct id) into v_ids
    from public.armado_paquetes
    where destino_id = new.id;
  perform public.tarifario_invalidar(v_ids, true);
  return NEW;
end;
$$;
revoke all on function public.tarifario_trg_bump_destino_nombre() from public, anon, authenticated;

drop trigger if exists tarifario_trg_destinos_nombre on public.destinos;
create trigger tarifario_trg_destinos_nombre
  after update of nombre
  on public.destinos
  for each row execute function public.tarifario_trg_bump_destino_nombre();

-- C.9 — hoteles: moneda/modelo_tarifario Y `nombre` (denormalizado en
--        tarifario_resultado como `hotel_nombre` — auditoría de Fase 1,
--        ronda 4; se conserva el nombre de función/trigger pese al alcance
--        ampliado, pedido explícito del dueño de "ampliar" sin "renombrar").
--        Fan-out vía armado_hoteles.hotel_id. Bloquea solo si alguna de las
--        tres cambió de verdad (`IS DISTINCT FROM`, mismo criterio de no-op
--        que el resto de esta migración).
create or replace function public.tarifario_trg_bump_hotel_moneda_modelo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[];
begin
  if NEW.nombre is not distinct from OLD.nombre
    and NEW.moneda is not distinct from OLD.moneda
    and NEW.modelo_tarifario is not distinct from OLD.modelo_tarifario
  then
    return NEW;
  end if;

  select array_agg(distinct paquete_id) into v_ids
    from public.armado_hoteles
    where hotel_id = new.id;
  perform public.tarifario_invalidar(v_ids, true);
  return NEW;
end;
$$;
revoke all on function public.tarifario_trg_bump_hotel_moneda_modelo() from public, anon, authenticated;

drop trigger if exists tarifario_trg_hoteles_moneda_modelo on public.hoteles;
create trigger tarifario_trg_hoteles_moneda_modelo
  after update of nombre, moneda, modelo_tarifario
  on public.hoteles
  for each row execute function public.tarifario_trg_bump_hotel_moneda_modelo();

-- ── D. RPC de generación/publicación (invocados desde generarTarifario) ────

-- D.1 — Pide un número de generación nuevo y captura la revisión de fuente
--       VIGENTE en ese instante — AMBOS antes de que el caller arranque las
--       ~10 consultas de cálculo. SECURITY INVOKER: corre bajo la misma
--       policy de escritura de armado_paquetes que ya protegía este UPDATE
--       (superadmin/gerencia/administracion/operaciones, migración 018) — no
--       hace falta elevar privilegios para tocar la fila propia del paquete
--       que el caller ya puede editar.
create or replace function public.iniciar_generacion_tarifario(p_paquete_id bigint)
returns table(generacion bigint, revision_capturada bigint)
language plpgsql
security invoker
as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'iniciar_generacion_tarifario: rol sin permiso de escritura sobre armado_paquetes';
  end if;

  return query
  update public.armado_paquetes
    set tarifario_generacion = tarifario_generacion + 1,
        tarifario_estado = 'recalculando'
    where id = p_paquete_id
    returning tarifario_generacion, tarifario_revision_fuente;

  if not found then
    raise exception 'iniciar_generacion_tarifario: paquete % no encontrado o sin permiso de escritura', p_paquete_id;
  end if;
end;
$$;

comment on function public.iniciar_generacion_tarifario(bigint) is
  'Paso 1 de la publicación atómica del tarifario: incrementa tarifario_generacion y devuelve, en la MISMA fila, la generación nueva y la tarifario_revision_fuente VIGENTE en este instante (a capturar por el caller ANTES de calcular). SECURITY INVOKER, sujeta a la policy de escritura de armado_paquetes. Migración 181.';
revoke all on function public.iniciar_generacion_tarifario(bigint) from public, anon;
grant execute on function public.iniciar_generacion_tarifario(bigint) to authenticated;

-- D.2 — Publica atómicamente: rechaza si la generación o la revisión de
--       fuente capturada ya no coinciden con las actuales; si coinciden,
--       delete+insert+actualización de estado en UNA transacción. SECURITY
--       DEFINER + candado de rol propio (mismo patrón que
--       reemplazar_tarifas_hotel_calculadora, migración 179 — reemplaza
--       TODAS las filas de tarifario_resultado de un paquete, no un ajuste
--       puntual sobre una fila que el caller ya puede editar por RLS).
--
--       CONTRATO EXACTO:
--         p_paquete_id          — paquete cuyo snapshot se reemplaza.
--         p_generacion          — el valor devuelto por
--                                  iniciar_generacion_tarifario() al empezar
--                                  este cálculo.
--         p_revision_capturada  — la tarifario_revision_fuente devuelta por
--                                  la MISMA llamada.
--         p_moneda              — 'COP' o 'USD', la moneda AUTORITATIVA que
--                                  generarTarifario resolvió con las mismas
--                                  lecturas que produjeron p_filas. Se
--                                  persiste en armado_paquetes.moneda en esta
--                                  misma transacción (dato DERIVADO, no una
--                                  fuente independiente — ver el trigger de
--                                  armado_paquetes más arriba). GOBIERNA
--                                  también la columna `moneda` de TODAS las
--                                  filas insertadas (auditoría de Fase 1,
--                                  ronda 4) — un paquete es de una sola
--                                  moneda, así que ninguna fila puede
--                                  publicarse en una distinta a `p_moneda`;
--                                  cualquier `moneda` que el payload declare
--                                  por fila se IGNORA por completo, igual
--                                  criterio que `paquete_activo`/`paquete_id`.
--         p_filas               — arreglo jsonb de filas a insertar. Columnas
--                                  permitidas: exactamente las mismas que
--                                  tarifario_resultado.Insert en
--                                  types/database.ts, MENOS id/created_at
--                                  (nunca se leen del payload — Postgres los
--                                  genera), MENOS paquete_id y MENOS moneda
--                                  (se usan SIEMPRE p_paquete_id/p_moneda,
--                                  nunca lo que traiga la fila).
--       DEVUELVE: true si publicó, false si se descartó (generación o
--       revisión superadas — el caller debe tratarlo como "no publicado",
--       nunca como éxito).
create or replace function public.publicar_tarifario_resultado(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_moneda text,
  p_filas jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_generacion_actual bigint;
  v_revision_actual   bigint;
  v_activo            boolean;
  v_fila              jsonb;
  v_fila_paquete      bigint;
  v_insertadas        integer := 0;
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'publicar_tarifario_resultado: rol sin permiso de escritura sobre tarifario_resultado';
  end if;
  if p_paquete_id is null or p_generacion is null or p_revision_capturada is null then
    raise exception 'publicar_tarifario_resultado: p_paquete_id, p_generacion y p_revision_capturada son obligatorios';
  end if;
  -- Auditoría de Fase 1, ronda 3 (hallazgo P1 "carrera entre moneda
  -- preliminar y autoritativa"): `moneda` es un dato DERIVADO del mismo
  -- cálculo que produce `p_filas` — se recibe y persiste AQUÍ, en la misma
  -- transacción, en vez de escribirse por separado antes de capturar el
  -- token (ver el comentario largo en el trigger de armado_paquetes, más
  -- arriba en esta migración). Solo admite los 2 valores reales de la
  -- columna `moneda` de tarifario_resultado/armado_paquetes.
  --
  -- ⚠️ `p_moneda is null or ...`, NUNCA `p_moneda not in (...)` a secas
  -- (auditoría de Fase 1, ronda 4): si `p_moneda` llega NULL, `NULL not in
  -- (...)` evalúa a NULL, y `if NULL then` en PL/pgSQL es FALSO — la
  -- excepción nunca se lanzaría y un NULL seguiría de largo hasta el INSERT,
  -- violando el NOT NULL de `tarifario_resultado.moneda` con un error menos
  -- claro. Mismo defecto ya corregido antes en `mi_rol()` (migración 179).
  if p_moneda is null or p_moneda not in ('COP', 'USD') then
    raise exception 'publicar_tarifario_resultado: p_moneda debe ser COP o USD, recibido: %', p_moneda;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'publicar_tarifario_resultado: p_filas debe ser un arreglo jsonb';
  end if;

  -- Candado de fila + lectura del estado actual, dentro de la transacción —
  -- serializa dos publicaciones concurrentes del MISMO paquete (la segunda
  -- espera a que la primera libere el FOR UPDATE antes de comparar). También
  -- lee `activo` AQUÍ (auditoría de Fase 1, hallazgo 3): el `paquete_activo`
  -- de CADA fila insertada viene de esta lectura autoritativa, NUNCA del
  -- payload — un caller no puede publicar un snapshot que se declare activo
  -- mientras el paquete real está desactivado, ni al revés.
  select tarifario_generacion, tarifario_revision_fuente, activo
    into v_generacion_actual, v_revision_actual, v_activo
    from public.armado_paquetes
    where id = p_paquete_id
    for update;

  if not found then
    raise exception 'publicar_tarifario_resultado: paquete % no encontrado', p_paquete_id;
  end if;

  -- Rechazo #1: alguien más ya pidió (o publicó) una generación más nueva.
  if v_generacion_actual <> p_generacion then
    return false;
  end if;

  -- Rechazo #2 (el hallazgo central de esta ronda): las FUENTES cambiaron
  -- DURANTE este cálculo, aunque nadie haya pedido una generación nueva
  -- todavía. Publicar ahora mezclaría datos calculados contra una versión
  -- vieja de las fuentes con lo que hay en la base en este instante. Queda
  -- 'pendiente' (nunca 'recalculando' colgado en falso) — la mutación que
  -- invalidó ya disparó su propio trigger de recálculo automático por su
  -- cuenta, nadie necesita "hacerse cargo" de este intento puntual.
  if v_revision_actual <> p_revision_capturada then
    update public.armado_paquetes set tarifario_estado = 'pendiente' where id = p_paquete_id;
    return false;
  end if;

  -- Validación COMPLETA del lote ANTES de tocar una sola fila (fail-closed
  -- real, mismo criterio que reemplazar_tarifas_hotel_calculadora): ninguna
  -- fila puede declarar un paquete_id distinto al solicitado.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'publicar_tarifario_resultado: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'paquete_id' and v_fila->>'paquete_id' is not null then
      begin
        v_fila_paquete := (v_fila->>'paquete_id')::bigint;
      exception when others then
        raise exception 'publicar_tarifario_resultado: paquete_id de una fila no es numérico: %', v_fila->>'paquete_id';
      end;
      if v_fila_paquete <> p_paquete_id then
        raise exception 'publicar_tarifario_resultado: una fila declara paquete_id % distinto al solicitado (%)', v_fila_paquete, p_paquete_id;
      end if;
    end if;
  end loop;

  delete from public.tarifario_resultado where paquete_id = p_paquete_id;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    -- Columnas EXPLÍCITAS únicamente (nunca `select *`/`insert *`): `id` y
    -- `created_at` nunca se leen del payload (Postgres los genera); el
    -- `paquete_id` insertado es SIEMPRE p_paquete_id, nunca el de la fila.
    insert into public.tarifario_resultado (
      paquete_id, paquete_nombre, paquete_activo, modulo, bloqueo_id, bloqueo_label,
      empaquetado_id, hotel_id, hotel_nombre, servicio_id, servicio_nombre,
      destino_id, destino_nombre, categoria, regimen, acomodacion, noches,
      fecha_ida, fecha_regreso, pax_desde, pax_hasta, tipo_tarifa,
      base_comisionable, impuesto, precio_pvp, descripcion, recargo_individual,
      moneda, salida_id, temporada_ganadora, es_promocion, precio_final_autoritativo,
      procedencia_temporadas, procedencia_mixta
    ) values (
      p_paquete_id,
      v_fila->>'paquete_nombre',
      -- Auditoría de Fase 1, hallazgo 3: `paquete_activo` IGNORA por
      -- completo lo que traiga el payload — siempre es `v_activo`, leído
      -- arriba del `armado_paquetes` real dentro del mismo `FOR UPDATE`. Un
      -- payload que declare `paquete_activo: true` sobre un paquete
      -- desactivado (o viceversa) nunca se respeta.
      v_activo,
      (v_fila->>'modulo')::public.tarifario_modulo,
      (v_fila->>'bloqueo_id')::bigint,
      v_fila->>'bloqueo_label',
      (v_fila->>'empaquetado_id')::bigint,
      (v_fila->>'hotel_id')::bigint,
      v_fila->>'hotel_nombre',
      (v_fila->>'servicio_id')::bigint,
      v_fila->>'servicio_nombre',
      (v_fila->>'destino_id')::bigint,
      v_fila->>'destino_nombre',
      v_fila->>'categoria',
      v_fila->>'regimen',
      (v_fila->>'acomodacion')::public.acomodacion_tipo,
      (v_fila->>'noches')::integer,
      (v_fila->>'fecha_ida')::date,
      (v_fila->>'fecha_regreso')::date,
      (v_fila->>'pax_desde')::integer,
      (v_fila->>'pax_hasta')::integer,
      v_fila->>'tipo_tarifa',
      coalesce((v_fila->>'base_comisionable')::numeric, 0),
      coalesce((v_fila->>'impuesto')::numeric, 0),
      coalesce((v_fila->>'precio_pvp')::numeric, 0),
      v_fila->>'descripcion',
      (v_fila->>'recargo_individual')::numeric,
      -- Auditoría de Fase 1, ronda 4: `p_moneda` GOBIERNA la moneda de TODAS
      -- las filas — igual criterio que `paquete_activo`/`paquete_id`, nunca
      -- se lee `v_fila->>'moneda'`. Un paquete es de UNA sola moneda (regla
      -- de negocio ya validada por generarTarifario antes de calcular
      -- `filas`); permitir que el payload declarara una moneda distinta por
      -- fila habría dejado un paquete USD con filas COP mezcladas — el
      -- hallazgo confirmado que motivó este cambio.
      p_moneda,
      (v_fila->>'salida_id')::bigint,
      v_fila->>'temporada_ganadora',
      (v_fila->>'es_promocion')::boolean,
      (v_fila->>'precio_final_autoritativo')::boolean,
      -- Auditoría de Fase 1, hallazgo 1: `v_fila->'procedencia_temporadas'`
      -- directo insertaría el escalar jsonb `null` (JSON null, NOT NULL en
      -- Postgres) cuando la clave está presente con valor `null` — distinto
      -- de SQL NULL. Se normaliza explícitamente: clave ausente O valor
      -- `null`::jsonb ⇒ SQL NULL; cualquier otro valor (incl. un arreglo
      -- vacío `[]`) se inserta tal cual. Los CHECK de la migración 180 sobre
      -- esta columna no se tocan.
      case
        when not (v_fila ? 'procedencia_temporadas')
          or v_fila->'procedencia_temporadas' = 'null'::jsonb
        then null
        else v_fila->'procedencia_temporadas'
      end,
      coalesce((v_fila->>'procedencia_mixta')::boolean, false)
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  -- Regla del dueño: una publicación exitosa habilita el snapshot SOLO si el
  -- paquete sigue activo (`tarifario_snapshot_publicable = activo`) — nunca
  -- `true` a secas. Un paquete desactivado que de todas formas se regenera
  -- (ej. por un trigger de hotel disparado mientras está inactivo) publica
  -- su snapshot correctamente pero SIGUE bloqueado para lectores.
  -- `moneda = p_moneda` (auditoría de Fase 1, ronda 3): escrita EN LA MISMA
  -- transacción/UPDATE que el resto del estado de publicación, con el valor
  -- AUTORITATIVO que generarTarifario acaba de usar para calcular `p_filas`
  -- — nunca puede quedar desincronizada de las filas que se publicaron.
  -- Esta columna no está en la lista `UPDATE OF` del trigger de
  -- armado_paquetes (ver esa migración más arriba), así que este UPDATE
  -- nunca se re-invalida a sí mismo sin importar el valor.
  update public.armado_paquetes set
    tarifario_generacion_publicada = p_generacion,
    tarifario_revision_publicada = p_revision_capturada,
    tarifario_estado = 'listo',
    tarifario_error = null,
    tarifario_snapshot_publicable = v_activo,
    tarifario_actualizado_en = now(),
    moneda = p_moneda
  where id = p_paquete_id;

  return true;
end;
$$;

comment on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) is
  'Publica atómicamente (delete+insert+actualización de estado en UNA transacción) el snapshot de tarifario_resultado de un paquete. Rechaza (devuelve false, sin tocar tarifario_resultado) si p_generacion o p_revision_capturada ya no coinciden con el estado actual de armado_paquetes; rechaza con excepción (sin borrar el snapshot anterior) si p_moneda es NULL o distinto de COP/USD. tarifario_snapshot_publicable queda igual a armado_paquetes.activo tras una publicación exitosa. p_moneda GOBIERNA la moneda de TODAS las filas insertadas y de armado_paquetes.moneda (dato DERIVADO del mismo cálculo, ver el trigger de armado_paquetes) en la misma transacción — cualquier `moneda` que el payload declare por fila se ignora por completo, igual criterio que paquete_activo/paquete_id; nunca queda una fila desincronizada de la moneda del paquete. SECURITY DEFINER con candado de rol propio (mismo conjunto que reemplazar_tarifas_hotel_calculadora, migración 179). Migración 181.';
revoke all on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) from public, anon;
grant execute on function public.publicar_tarifario_resultado(bigint, bigint, bigint, text, jsonb) to authenticated;

-- D.3 — Marca el intento vigente como fallido. SECURITY INVOKER (mismo
--       criterio que iniciar_generacion_tarifario: solo toca la fila propia
--       del paquete bajo la policy de escritura ya existente).
create or replace function public.marcar_generacion_fallida(
  p_paquete_id bigint,
  p_generacion bigint,
  p_revision_capturada bigint,
  p_error text
)
returns void
language plpgsql
security invoker
as $$
begin
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'marcar_generacion_fallida: rol sin permiso de escritura sobre armado_paquetes';
  end if;

  -- Auditoría de Fase 1 (segundo hallazgo P1): filtra por AMBOS,
  -- tarifario_generacion = p_generacion Y tarifario_revision_fuente =
  -- p_revision_capturada — no basta con la generación. Si mientras el
  -- cálculo fallaba alguien más ya inició una generación más nueva (la
  -- generación cambió), o si una fuente cambió de verdad SIN que nadie
  -- pidiera una generación nueva todavía (la revisión cambió, misma
  -- generación — exactamente el caso que motivó capturar la revisión desde
  -- el principio), este UPDATE no afecta ninguna fila: un intento VIEJO
  -- nunca pisa el estado/error de una situación más reciente. NUNCA toca
  -- tarifario_snapshot_publicable: un fallo no rehabilita nada que ya
  -- estuviera bloqueado (ver diseño en la cabecera de la migración).
  update public.armado_paquetes
    set tarifario_estado = 'fallido',
        tarifario_error = left(coalesce(p_error, 'Error desconocido.'), 2000),
        tarifario_actualizado_en = now()
    where id = p_paquete_id
      and tarifario_generacion = p_generacion
      and tarifario_revision_fuente = p_revision_capturada;
end;
$$;

comment on function public.marcar_generacion_fallida(bigint, bigint, bigint, text) is
  'Marca tarifario_estado=fallido con un mensaje SANEADO, solo si tarifario_generacion Y tarifario_revision_fuente siguen siendo las del intento que falló (nunca pisa una generación o revisión más nueva). Nunca modifica tarifario_snapshot_publicable. SECURITY INVOKER, sujeta a la policy de escritura de armado_paquetes. Migración 181.';
revoke all on function public.marcar_generacion_fallida(bigint, bigint, bigint, text) from public, anon;
grant execute on function public.marcar_generacion_fallida(bigint, bigint, bigint, text) to authenticated;

commit;
