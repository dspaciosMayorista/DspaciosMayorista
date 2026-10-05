-- ───────────────────────────────────────────────────────────────────────────
-- 203 · GENERACIÓN ACOTADA DE TARIFAS DE CALCULADORA + HISTORIAL INTERNO
--       (pendientes #15 y #26 de TASKS.md)
--
-- Número 203: reservado por el dueño para Tarifas. Se escribió como "201"
-- provisional y se RENUMERÓ antes de ejecutarse en ningún entorno, porque la
-- 201 de `main` y de Producción es de Vuelos
-- (`20260601000201_pasajero_antes_contrato_vuelos.sql`). Reservas vigentes:
-- 202 CRM, 203 Tarifas, 204 Contabilidad.
-- Depende de la 179 y de `auditoria` (087/108); se aplica DESPUÉS de la 201
-- (probada sobre la cadena real 1–201). NO depende de la 202 (reservada para
-- CRM, otro trabajo que puede esperar): la 203 puede aplicarse antes que ella.
--
-- ⚠️ Cruce FUTURO con la 202 (o cualquier migración posterior): si instala
-- auditoría global — p. ej. recorriendo las tablas de `public` para adjuntar
-- `trg_auditoria`, como hizo la 087 —, su autor DEBE EXCLUIR
-- `tarifa_hotel_historial` y `hotel_temporadas_historial` (igual que la 087
-- excluye `auditoria` y `tarifario_resultado`). Ya son historial inmutable:
-- auditarlas duplicaría cada versión completa en `auditoria`. El postcheck de
-- la 203 tiene un chequeo para re-correr después de esa migración.
--
-- ⚠️ NO SE HA EJECUTADO EN NINGÚN ENTORNO REMOTO. Solo se probó en una base
-- local desechable (`supabase/scripts/pruebas/test_203_tarifas_generacion_acotada.sh`).
--
-- Problema que corrige (auditoría #26):
--   `reemplazar_tarifas_hotel_calculadora` (migración 179), en modo
--   "agregar", borraba TODAS las filas de `tarifa_hotel` del régimen generado
--   — incluidas otras temporadas y promociones del mismo régimen que la
--   calculadora no estaba generando — y solo reinsertaba las calculadas. Es el
--   patrón DELETE de la promoción + INSERT de la base nueva que muestra la
--   auditoría del hotel 59 (vigencia 674). "Reemplazar TODAS" borraba además
--   las filas de vigencias vencidas, que eran la única copia consultable de
--   esos precios.
--
-- Qué agrega:
--   1) `hotel_temporadas_historial`: versión anterior COMPLETA de cada
--      vigencia antes de editarla o eliminarla (trigger). Es lo que permite
--      saber cómo era una vigencia renombrada o borrada.
--   2) `tarifa_hotel_historial`: versión anterior COMPLETA de cada fila de
--      `tarifa_hotel` antes de reemplazarla, editarla o borrarla (trigger),
--      con autor, fecha, motivo y la FOTO de su vigencia en ese momento
--      (`vigencia`, `vigencia_fuente`):
--        · 'actual'        — filas de `hotel_temporadas` con ese nombre al
--                            momento del cambio;
--        · 'historial'     — la vigencia ya no existía con ese nombre (fue
--                            renombrada o eliminada antes): se toma su última
--                            versión de `hotel_temporadas_historial`;
--        · 'no_encontrada' — no hay rastro de la vigencia.
--      Así la consulta nunca presenta metadatos ACTUALES de la vigencia como
--      si fueran los de la versión histórica.
--      `auditoria_id` (único, NULL para lo que escribe el trigger) queda
--      reservado para una incorporación futura desde `auditoria` (ver
--      `reconstruir_tarifas_desde_auditoria`): hace idempotente esa carga. Esta
--      migración NO la ejecuta.
--   3) Triggers AFTER UPDATE OR DELETE en `hotel_temporadas` y `tarifa_hotel`:
--      cubren TODOS los caminos (calculadora, edición/borrado manual, renombre,
--      Studio). El motivo lo fija quien escribe con
--      `set_config('app.tarifa_motivo', …, true)`; si no, queda 'edicion' o
--      'eliminacion'. Sin FK a `hoteles`: el historial sobrevive al hotel (y una
--      FK haría fallar su borrado en cascada).
--   4) `generar_tarifas_hotel_calculadora(p_hotel_id, p_filas, p_previas,
--      p_reemplazar_todo, p_motivo)`: reemplazo transaccional ACOTADO.
--        · agregar: borra solo las filas cuya clave (categoría, régimen,
--          temporada) viene en el lote;
--        · reemplazar todo: borra las filas del hotel EXCEPTO las de vigencias
--          con compra cerrada;
--        · rechaza filas de vigencias con compra cerrada (todas sus filas de
--          `hotel_temporadas` con `compra_fin` anterior a `fecha_negocio()`,
--          migración 198), claves vacías y claves repetidas;
--        · CONCURRENCIA: bloquea el hotel, sus vigencias y sus tarifas (en ese
--          orden) y, DENTRO de la misma transacción, compara las filas actuales
--          con `p_previas` — la foto que vio quien generó al cargar la vista
--          previa (solo las claves del lote; en "reemplazar todo", todo el
--          hotel). Si algo cambió entre la vista previa y la escritura, rechaza
--          y pide recargar. `p_previas` solo sirve para RECHAZAR, nunca
--          autoriza nada.
--        · PROMOS ESCRITAS A MANO (calculadora Mixta, vigencias `descuento_pct`,
--          filas sin `precio_final_autoritativo`): "generar" y "reemplazar
--          todo" nunca las borran, aunque la foto coincida. Solo las reemplaza
--          `calculadora_sustituir_manual`, y únicamente si: el lote trae UNA
--          fila, marcada como precio final, con `temporada_base` en una
--          vigencia 'tarifa' del hotel, y la clave tiene hoy una promo escrita
--          a mano que coincide con la foto confirmada.
--          ⚠️ SQL NO recalcula los VALORES de esa fila (no verifica el −% desde
--          la base ni que el infante quede intacto). Esa comprobación la hace
--          la Server Action `sustituirPromoManualMixta`: recalcula con
--          `filaSustitucionMixta` y compara con la vista previa ANTES de llamar
--          a la RPC. Quien llame la RPC directo con un rol operativo puede
--          escribir en esa celda valores no calculados — lo mismo que ya puede
--          hacer escribiendo `tarifa_hotel` directo (policy FOR ALL, 016).
--        · `p_motivo` es una ETIQUETA, no una autorización: la autorización es
--          el rol real (`mi_rol()`), y el motivo se rechaza si no coincide con
--          lo que la llamada hace de verdad. El autor lo pone el trigger con
--          `auth.uid()`, que el cliente no puede falsificar.
--      La función de la 179 queda sin cambios (rollback de código), pero el
--      código ya no la llama.
--   5) `consultar_historial_tarifas(...)`: paginación por cursor (orden
--      estable `registrado_en desc, id desc`) y búsqueda del lado del servidor.
--      SECURITY INVOKER: la RLS de la tabla decide quién ve qué.
--   6) `reconstruir_tarifas_desde_auditoria(p_hotel_id)`: SOLO LECTURA. Lista
--      las versiones de `tarifa_hotel` que `auditoria` (087/108) conserva de
--      antes de esta migración, con la vigencia reconstruida al momento de cada
--      cambio. SECURITY INVOKER: hereda la RLS de `auditoria` (solo superadmin
--      y gerencia). No escribe nada.
--
-- No toca datos: no hay backfill, no restaura ni regenera tarifas de ningún
-- hotel (en particular, nada del hotel 59 / vigencia 674).
--
-- Ninguna de estas tablas/funciones la lee el motor de cotización, reserva o
-- tarifario: el historial nunca se cotiza ni se publica.
--
-- Orden de despliegue: preflight → esta migración → postcheck → código. El
-- código nuevo llama a `generar_tarifas_hotel_calculadora` y a
-- `consultar_historial_tarifas`; si se despliega antes, "Generar tarifas"
-- falla con "function does not exist" sin borrar nada (falla cerrado) y la
-- ficha muestra el historial como "no disponible".
-- Preflight / postcheck / rollback:
--   supabase/scripts/{preflight,postcheck,rollback}_203_tarifas_generacion_acotada.sql
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ── 1) Historial de vigencias ─────────────────────────────────────────────
create table if not exists public.hotel_temporadas_historial (
  id             bigserial primary key,
  temporada_id   bigint not null,
  hotel_id       bigint not null,               -- sin FK a propósito (ver cabecera)
  operacion      text   not null check (operacion in ('UPDATE', 'DELETE')),
  motivo         text   not null,
  datos          jsonb  not null,               -- fila completa ANTES del cambio
  autor_id       uuid,
  autor_email    text,
  registrado_en  timestamptz not null default now()
);

create index if not exists hotel_temporadas_historial_nombre_idx
  on public.hotel_temporadas_historial (hotel_id, (btrim(datos->>'nombre')), id desc);

-- ── 2) Historial de tarifas ───────────────────────────────────────────────
create table if not exists public.tarifa_hotel_historial (
  id               bigserial primary key,
  tarifa_id        bigint not null,
  hotel_id         bigint not null,             -- sin FK a propósito (ver cabecera)
  operacion        text   not null check (operacion in ('UPDATE', 'DELETE')),
  motivo           text   not null,
  datos            jsonb  not null,             -- fila completa ANTES del cambio
  vigencia         jsonb  not null default '[]'::jsonb,
  vigencia_fuente  text   not null default 'no_encontrada'
                   check (vigencia_fuente in ('actual', 'historial', 'no_encontrada', 'auditoria', 'auditoria_previa')),
  autor_id         uuid,
  autor_email      text,
  registrado_en    timestamptz not null default now(),
  auditoria_id     bigint unique                -- reservado: incorporación futura desde `auditoria`
);

create index if not exists tarifa_hotel_historial_hotel_idx
  on public.tarifa_hotel_historial (hotel_id, registrado_en desc, id desc);

comment on table public.hotel_temporadas_historial is
  'Migración 203: versión anterior de cada vigencia (trigger). Historial inmutable: NO adjuntar trg_auditoria (excluir de cualquier auditoría global).';
comment on table public.tarifa_hotel_historial is
  'Migración 203: versión anterior de cada tarifa con la foto de su vigencia (trigger). Historial inmutable: NO adjuntar trg_auditoria (excluir de cualquier auditoría global).';

-- ── RLS: solo lectura interna; inmutables por la API ──────────────────────
alter table public.hotel_temporadas_historial enable row level security;
alter table public.tarifa_hotel_historial enable row level security;

drop policy if exists "hotel_temporadas_historial: lectura interna" on public.hotel_temporadas_historial;
create policy "hotel_temporadas_historial: lectura interna" on public.hotel_temporadas_historial
  for select
  using (coalesce(public.mi_rol()::text, '') in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

drop policy if exists "tarifa_hotel_historial: lectura interna" on public.tarifa_hotel_historial;
create policy "tarifa_hotel_historial: lectura interna" on public.tarifa_hotel_historial
  for select
  using (coalesce(public.mi_rol()::text, '') in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

revoke all on table public.hotel_temporadas_historial, public.tarifa_hotel_historial from public, anon;
revoke insert, update, delete, truncate on table public.hotel_temporadas_historial, public.tarifa_hotel_historial
  from authenticated, service_role;
grant select on table public.hotel_temporadas_historial, public.tarifa_hotel_historial to authenticated;

-- ── 3) Triggers ───────────────────────────────────────────────────────────
create or replace function public.fn_hotel_temporadas_historial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_motivo text := nullif(btrim(coalesce(current_setting('app.tarifa_motivo', true), '')), '');
  v_uid    uuid;
  v_email  text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new;
  end if;
  -- Autor en bloques separados: si uno falla (sin contexto de auth), el otro se conserva.
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;
  insert into public.hotel_temporadas_historial (temporada_id, hotel_id, operacion, motivo, datos, autor_id, autor_email)
  values (old.id, old.hotel_id, tg_op,
          coalesce(v_motivo, case tg_op when 'UPDATE' then 'edicion' else 'eliminacion' end),
          to_jsonb(old), v_uid, v_email);
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create or replace function public.fn_tarifa_hotel_historial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_motivo  text := nullif(btrim(coalesce(current_setting('app.tarifa_motivo', true), '')), '');
  v_uid     uuid;
  v_email   text;
  v_vig     jsonb;
  v_fuente  text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return new; -- sin cambio real, nada que versionar
  end if;
  -- Autor en bloques separados: si uno falla (sin contexto de auth, SQL
  -- directo), el otro se conserva.
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  begin v_email := auth.jwt() ->> 'email'; exception when others then v_email := null; end;

  -- Foto de la vigencia AL MOMENTO del cambio (no la de hoy).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) into v_vig
  from public.hotel_temporadas t
  where t.hotel_id = old.hotel_id and btrim(t.nombre) = btrim(old.temporada);
  if jsonb_array_length(v_vig) > 0 then
    v_fuente := 'actual';
  else
    -- Renombrada o eliminada antes: su última versión con ese nombre.
    select coalesce(jsonb_agg(x.datos order by x.temporada_id), '[]'::jsonb) into v_vig
    from (
      select distinct on (h.temporada_id) h.temporada_id, h.datos
      from public.hotel_temporadas_historial h
      where h.hotel_id = old.hotel_id and btrim(h.datos->>'nombre') = btrim(old.temporada)
      order by h.temporada_id, h.id desc
    ) x;
    v_fuente := case when jsonb_array_length(v_vig) > 0 then 'historial' else 'no_encontrada' end;
  end if;

  insert into public.tarifa_hotel_historial
    (tarifa_id, hotel_id, operacion, motivo, datos, vigencia, vigencia_fuente, autor_id, autor_email)
  values (
    old.id, old.hotel_id, tg_op,
    coalesce(v_motivo, case tg_op when 'UPDATE' then 'edicion' else 'eliminacion' end),
    to_jsonb(old), v_vig, v_fuente, v_uid, v_email
  );
  return case tg_op when 'DELETE' then old else new end;
end;
$$;

revoke all on function public.fn_hotel_temporadas_historial() from public, anon, authenticated;
revoke all on function public.fn_tarifa_hotel_historial() from public, anon, authenticated;

drop trigger if exists trg_hotel_temporadas_historial on public.hotel_temporadas;
create trigger trg_hotel_temporadas_historial
  after update or delete on public.hotel_temporadas
  for each row execute function public.fn_hotel_temporadas_historial();

drop trigger if exists trg_tarifa_hotel_historial on public.tarifa_hotel;
create trigger trg_tarifa_hotel_historial
  after update or delete on public.tarifa_hotel
  for each row execute function public.fn_tarifa_hotel_historial();

-- ── 4) Generación acotada ─────────────────────────────────────────────────
-- Clave de negocio de una fila (categoría, régimen, temporada), sin espacios
-- sobrantes, con un separador que no aparece en los nombres.
create or replace function public._tarifa_clave(p_fila jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select btrim(coalesce(p_fila->>'tipo_habitacion', '')) || chr(31) ||
         btrim(coalesce(p_fila->>'alimentacion', ''))    || chr(31) ||
         btrim(coalesce(p_fila->>'temporada', ''))
$$;

-- Huella de un CONJUNTO de filas de `tarifa_hotel` (orden indiferente): clave
-- + precio final + los 7 valores. Los números se normalizan (`trim_scale`), así
-- que 454000 y 454000.00 dan la misma huella. Sirve igual para filas de la
-- tabla (`to_jsonb`) y para la foto que manda el cliente.
create or replace function public._tarifa_huella(p_filas jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(string_agg(h, E'\n' order by h), '')
  from (
    select concat_ws('|',
      public._tarifa_clave(f),
      case when coalesce((f->>'precio_final_autoritativo')::boolean, false) then 't' else 'f' end,
      coalesce(trim_scale((f->>'neto_sencilla')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_doble')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_triple')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_multiple')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_nino')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_nino2')::numeric)::text, '-'),
      coalesce(trim_scale((f->>'neto_infante')::numeric)::text, '-')) as h
    from jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
  ) x
$$;

revoke all on function public._tarifa_clave(jsonb) from public, anon, authenticated;
revoke all on function public._tarifa_huella(jsonb) from public, anon, authenticated;

create or replace function public.generar_tarifas_hotel_calculadora(
  p_hotel_id         bigint,
  p_filas            jsonb,
  p_previas          jsonb,                   -- foto de las tarifas que vio quien genera (solo para rechazar)
  p_reemplazar_todo  boolean default false,
  p_motivo           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy         date := public.fecha_negocio();   -- regla común (migración 198)
  v_protegidas  text[];
  v_promos_pct  text[];
  v_tipo_calc   text;
  v_claves      text[];
  v_fila        jsonb;
  v_hotel_fila  bigint;
  v_choque      text;
  v_borradas    integer;
  v_insertadas  integer := 0;
  v_motivo      text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''),
                                 case when p_reemplazar_todo then 'calculadora_reemplazar_todo' else 'calculadora_generar' end);
  v_recargar    constant text := 'Recarga la página y vuelve a revisar la vista previa antes de generar.';
begin
  -- Mismo candado que la 179 (coalesce: un rol NULL nunca pasa).
  if coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerencia', 'administracion', 'operaciones') then
    raise exception 'generar_tarifas_hotel_calculadora: rol sin permiso de escritura sobre tarifa_hotel';
  end if;
  if p_hotel_id is null then
    raise exception 'generar_tarifas_hotel_calculadora: hotel_id requerido';
  end if;
  if v_motivo not in ('calculadora_generar', 'calculadora_reemplazar_todo', 'calculadora_sustituir_manual') then
    raise exception 'generar_tarifas_hotel_calculadora: motivo no permitido: %', v_motivo;
  end if;
  -- El motivo es una etiqueta: debe coincidir con lo que la llamada hace.
  if p_reemplazar_todo and v_motivo <> 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: reemplazar todo solo admite el motivo calculadora_reemplazar_todo';
  end if;
  if not p_reemplazar_todo and v_motivo = 'calculadora_reemplazar_todo' then
    raise exception 'generar_tarifas_hotel_calculadora: el motivo calculadora_reemplazar_todo exige p_reemplazar_todo';
  end if;
  if p_previas is null or jsonb_typeof(p_previas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: falta la foto de las tarifas cargadas (p_previas). %', v_recargar;
  end if;
  if not exists (select 1 from public.hoteles where id = p_hotel_id) then
    raise exception 'generar_tarifas_hotel_calculadora: el hotel % no existe', p_hotel_id;
  end if;
  if p_filas is null or jsonb_typeof(p_filas) <> 'array' then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas debe ser un arreglo jsonb';
  end if;
  if jsonb_array_length(p_filas) = 0 then
    raise exception 'generar_tarifas_hotel_calculadora: p_filas no puede ser un arreglo vacío';
  end if;

  -- Validación COMPLETA del lote antes de borrar nada.
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    if jsonb_typeof(v_fila) <> 'object' then
      raise exception 'generar_tarifas_hotel_calculadora: cada elemento de p_filas debe ser un objeto jsonb';
    end if;
    if v_fila ? 'hotel_id' and v_fila->>'hotel_id' is not null then
      begin
        v_hotel_fila := (v_fila->>'hotel_id')::bigint;
      exception when others then
        raise exception 'generar_tarifas_hotel_calculadora: hotel_id de una fila no es numérico: %', v_fila->>'hotel_id';
      end;
      if v_hotel_fila <> p_hotel_id then
        raise exception 'generar_tarifas_hotel_calculadora: una fila declara hotel_id % distinto al solicitado (%)', v_hotel_fila, p_hotel_id;
      end if;
    end if;
    if coalesce(btrim(v_fila->>'tipo_habitacion'), '') = ''
       or coalesce(btrim(v_fila->>'alimentacion'), '') = ''
       or coalesce(btrim(v_fila->>'temporada'), '') = '' then
      raise exception 'generar_tarifas_hotel_calculadora: cada fila necesita categoría, régimen y temporada';
    end if;
  end loop;

  select k into v_choque
  from (
    select btrim(f->>'tipo_habitacion') || ' / ' || btrim(f->>'alimentacion') || ' / ' || btrim(f->>'temporada') as k
    from jsonb_array_elements(p_filas) f
  ) x
  group by k having count(*) > 1
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la combinación % viene repetida en el lote', v_choque;
  end if;

  -- ── Bloqueos: TODO lo que sigue (comprobar y escribir) ocurre con el hotel
  -- bloqueado, en esta misma transacción. Orden fijo hotel → vigencias →
  -- tarifas. `FOR UPDATE` sobre `hoteles` choca con el `FOR KEY SHARE` que toma
  -- cualquier INSERT concurrente en `tarifa_hotel` de este hotel (FK), así que
  -- una fila nueva escrita a mano espera o hace esperar; `FOR UPDATE` sobre las
  -- tarifas cubre ediciones y borrados concurrentes de filas existentes. En
  -- READ COMMITTED cada sentencia siguiente ve lo que la otra sesión confirmó.
  perform 1 from public.hoteles where id = p_hotel_id for update;
  perform 1 from public.hotel_temporadas where hotel_id = p_hotel_id for share;
  perform 1 from public.tarifa_hotel where hotel_id = p_hotel_id for update;

  -- Vigencias con compra cerrada = histórico: no se reescriben ni se recrean.
  select coalesce(array_agg(nombre), '{}') into v_protegidas
  from (
    select btrim(nombre) as nombre
    from public.hotel_temporadas
    where hotel_id = p_hotel_id and nombre is not null
    group by btrim(nombre)
    having bool_and(compra_fin is not null and compra_fin < v_hoy)
  ) p;

  select btrim(f->>'temporada') into v_choque
  from jsonb_array_elements(p_filas) f
  where btrim(f->>'temporada') = any(v_protegidas)
  limit 1;
  if v_choque is not null then
    raise exception 'generar_tarifas_hotel_calculadora: la vigencia "%" tiene la compra cerrada; sus tarifas se conservan y no se regeneran', v_choque;
  end if;

  -- ── Concurrencia: lo que hay HOY (bajo bloqueo) debe ser lo que se vio en la
  -- vista previa. Reemplazar todo: todo el hotel. Agregar/sustituir: las
  -- claves del lote (una clave que no existía debe seguir sin existir).
  select array_agg(distinct public._tarifa_clave(f)) into v_claves from jsonb_array_elements(p_filas) f;
  if p_reemplazar_todo then
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t where t.hotel_id = p_hotel_id))
       <> public._tarifa_huella(p_previas) then
      raise exception 'generar_tarifas_hotel_calculadora: las tarifas del hotel cambiaron después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  else
    if public._tarifa_huella((select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tarifa_hotel t
                              where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)))
       <> public._tarifa_huella((select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(p_previas) f
                                 where public._tarifa_clave(f) = any(v_claves))) then
      raise exception 'generar_tarifas_hotel_calculadora: alguna de las tarifas que se iban a escribir cambió después de cargar la vista previa; no se escribió nada. %', v_recargar;
    end if;
  end if;

  -- ── Promos escritas a mano (Mixta + vigencia descuento_pct + sin precio
  -- final): misma definición que la calculadora (`analizarMixta`). Nunca las
  -- borra "generar" ni "reemplazar todo"; "sustituir" solo con sus condiciones.
  select tipo into v_tipo_calc from public.hotel_calculadora where hotel_id = p_hotel_id;
  select coalesce(array_agg(distinct btrim(nombre)), '{}') into v_promos_pct
  from public.hotel_temporadas where hotel_id = p_hotel_id and tipo = 'descuento_pct' and nombre is not null;

  if v_motivo = 'calculadora_sustituir_manual' then
    v_fila := p_filas -> 0;
    if jsonb_array_length(p_filas) <> 1 then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir reemplaza UNA sola fila por llamada';
    end if;
    if coalesce(v_tipo_calc, '') <> 'mixta' or not (btrim(v_fila->>'temporada') = any(v_promos_pct)) then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir solo aplica a una promoción %% de un hotel con calculadora Mixta';
    end if;
    if not coalesce((v_fila->>'precio_final_autoritativo')::boolean, false)
       or not exists (select 1 from public.hotel_temporadas t
                      where t.hotel_id = p_hotel_id and btrim(t.nombre) = btrim(coalesce(v_fila->>'temporada_base', ''))
                        and coalesce(t.tipo, 'tarifa') = 'tarifa') then
      raise exception 'generar_tarifas_hotel_calculadora: sustituir exige una fila marcada como precio final y con temporada_base en una vigencia ''tarifa'' del hotel';
    end if;
    if not exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves))
       or exists (select 1 from public.tarifa_hotel t where t.hotel_id = p_hotel_id and public._tarifa_clave(to_jsonb(t)) = any(v_claves)
                  and coalesce(t.precio_final_autoritativo, false)) then
      raise exception 'generar_tarifas_hotel_calculadora: no hay una promoción escrita a mano que sustituir en esa celda; usa "Generar"';
    end if;
  else
    select btrim(t.temporada) || ' · ' || btrim(t.tipo_habitacion) || ' · ' || btrim(t.alimentacion) into v_choque
    from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and coalesce(v_tipo_calc, '') = 'mixta'
      and not coalesce(t.precio_final_autoritativo, false)
      and btrim(t.temporada) = any(v_promos_pct)
      and case when p_reemplazar_todo
               then not (btrim(t.temporada) = any(v_protegidas))
               else public._tarifa_clave(to_jsonb(t)) = any(v_claves) end
    limit 1;
    if v_choque is not null then
      raise exception 'generar_tarifas_hotel_calculadora: % es una promoción escrita a mano; no se sobrescribe al generar. Sustitúyela celda por celda o déjala como está. %', v_choque, v_recargar;
    end if;
  end if;

  perform set_config('app.tarifa_motivo', v_motivo, true);

  if p_reemplazar_todo then
    delete from public.tarifa_hotel t
    where t.hotel_id = p_hotel_id
      and (t.temporada is null or not (btrim(t.temporada) = any(v_protegidas)));
  else
    delete from public.tarifa_hotel t
    using (
      select distinct btrim(f->>'tipo_habitacion') as tipo, btrim(f->>'alimentacion') as alim, btrim(f->>'temporada') as temp
      from jsonb_array_elements(p_filas) f
    ) k
    where t.hotel_id = p_hotel_id
      and btrim(t.tipo_habitacion) = k.tipo
      and btrim(t.alimentacion) = k.alim
      and btrim(t.temporada) = k.temp;
  end if;
  get diagnostics v_borradas = row_count;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    insert into public.tarifa_hotel (
      hotel_id, tipo_habitacion, alimentacion, temporada,
      neto_sencilla, neto_doble, neto_triple, neto_multiple,
      neto_nino, neto_nino2, neto_infante, nota_infante, notas,
      edad_infante_min, edad_infante_max, edad_nino_min, edad_nino_max,
      precio_final_autoritativo, temporada_base
    ) values (
      p_hotel_id,
      btrim(v_fila->>'tipo_habitacion'),
      btrim(v_fila->>'alimentacion'),
      btrim(v_fila->>'temporada'),
      (v_fila->>'neto_sencilla')::numeric,
      (v_fila->>'neto_doble')::numeric,
      (v_fila->>'neto_triple')::numeric,
      (v_fila->>'neto_multiple')::numeric,
      (v_fila->>'neto_nino')::numeric,
      (v_fila->>'neto_nino2')::numeric,
      (v_fila->>'neto_infante')::numeric,
      v_fila->>'nota_infante',
      v_fila->>'notas',
      (v_fila->>'edad_infante_min')::integer,
      (v_fila->>'edad_infante_max')::integer,
      (v_fila->>'edad_nino_min')::integer,
      (v_fila->>'edad_nino_max')::integer,
      coalesce((v_fila->>'precio_final_autoritativo')::boolean, false),
      v_fila->>'temporada_base'
    );
    v_insertadas := v_insertadas + 1;
  end loop;

  return jsonb_build_object(
    'borradas', v_borradas,
    'insertadas', v_insertadas,
    'protegidas', to_jsonb(v_protegidas)
  );
end;
$$;

comment on function public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text) is
  'Escribe EN UNA TRANSACCIÓN, con el hotel bloqueado, las tarifas generadas por la calculadora. Agregar: reemplaza solo las claves (categoría, régimen, temporada) del lote. Reemplazar todo: borra las filas del hotel salvo las de vigencias con compra cerrada. Rechaza si las filas cambiaron respecto de p_previas (foto de la vista previa). Nunca reescribe una vigencia con compra cerrada ni una promoción escrita a mano (Mixta), salvo calculadora_sustituir_manual con sus condiciones. No recalcula los valores de una sustitución: esa verificación la hace la Server Action sustituirPromoManualMixta. Cada fila reemplazada queda en tarifa_hotel_historial (trigger).';

revoke all on function public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.generar_tarifas_hotel_calculadora(bigint, jsonb, jsonb, boolean, text) to authenticated;

-- ── 5) Consulta paginada del historial (servidor) ─────────────────────────
-- Orden estable `registrado_en desc, id desc` con cursor (keyset): agregar
-- versiones nuevas mientras se pagina no repite ni salta filas. La búsqueda
-- (sin distinguir mayúsculas) cubre categoría, régimen, temporada, temporada
-- base, motivo, operación y autor. SECURITY INVOKER: la RLS decide quién ve.
create or replace function public.consultar_historial_tarifas(
  p_hotel_id           bigint,
  p_busqueda           text default null,
  p_cursor_registrado  timestamptz default null,
  p_cursor_id          bigint default null,
  p_limite             integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_limite  integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_q       text := nullif(btrim(coalesce(p_busqueda, '')), '');
  v_patron  text;
  v_total   bigint;
  v_filas   jsonb;
  v_n       integer;
  v_ultima  jsonb;
begin
  if p_hotel_id is null then
    raise exception 'consultar_historial_tarifas: hotel_id requerido';
  end if;
  if (p_cursor_registrado is null) <> (p_cursor_id is null) then
    raise exception 'consultar_historial_tarifas: el cursor necesita registrado_en e id';
  end if;
  if v_q is not null then
    v_patron := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select count(*) into v_total
  from public.tarifa_hotel_historial h
  where h.hotel_id = p_hotel_id
    and (v_patron is null or concat_ws(' ',
          h.datos->>'tipo_habitacion', h.datos->>'alimentacion', h.datos->>'temporada',
          h.datos->>'temporada_base', h.motivo, h.operacion, h.autor_email) ilike v_patron);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.registrado_en desc, x.id desc), '[]'::jsonb), count(*)
    into v_filas, v_n
  from (
    select h.id, h.tarifa_id, h.operacion, h.motivo, h.registrado_en, h.autor_email,
           h.datos, h.vigencia, h.vigencia_fuente, h.auditoria_id
    from public.tarifa_hotel_historial h
    where h.hotel_id = p_hotel_id
      and (v_patron is null or concat_ws(' ',
            h.datos->>'tipo_habitacion', h.datos->>'alimentacion', h.datos->>'temporada',
            h.datos->>'temporada_base', h.motivo, h.operacion, h.autor_email) ilike v_patron)
      and (p_cursor_id is null or (h.registrado_en, h.id) < (p_cursor_registrado, p_cursor_id))
    order by h.registrado_en desc, h.id desc
    limit v_limite + 1
  ) x;

  -- Se pidió una fila de más solo para saber si hay otra página.
  if v_n > v_limite then
    v_filas := v_filas - v_limite;
    v_ultima := v_filas -> (v_limite - 1);
  end if;

  return jsonb_build_object(
    'total', v_total,
    'filas', v_filas,
    'siguiente', case when v_ultima is null then null
                      else jsonb_build_object('registrado_en', v_ultima->'registrado_en', 'id', v_ultima->'id') end
  );
end;
$$;

revoke all on function public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer) from public, anon;
grant execute on function public.consultar_historial_tarifas(bigint, text, timestamptz, bigint, integer) to authenticated;

-- ── 6) Lo que `auditoria` conserva de antes de esta migración (solo lectura) ─
-- Para cada UPDATE/DELETE de `tarifa_hotel` registrado por `fn_auditoria`
-- (087/108) devuelve la fila completa anterior y la vigencia RECONSTRUIDA al
-- momento del cambio: por cada vigencia conocida del hotel, su último evento
-- de auditoría anterior (su `despues`, o nada si fue DELETE) o, si no hay, su
-- primer evento posterior (su `antes`, o nada si fue INSERT) o, si tampoco
-- hay, la fila actual. Ordena por `auditoria.id` (precisión dentro de la
-- misma transacción). Marca si el historial nuevo ya capturó ese mismo cambio
-- (`capturado_por_historial`) y si ya se incorporó (`ya_incorporado`).
-- SECURITY INVOKER: hereda la RLS de `auditoria` (superadmin/gerencia).
create or replace function public.reconstruir_tarifas_desde_auditoria(p_hotel_id bigint default null)
returns table (
  auditoria_id             bigint,
  registrado_en            timestamptz,
  operacion                text,
  hotel_id                 bigint,
  tarifa_id                bigint,
  autor_email              text,
  datos                    jsonb,
  vigencia                 jsonb,
  vigencia_fuente          text,
  existe_fila_actual       boolean,
  capturado_por_historial  boolean,
  ya_incorporado           boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ev as (
    select a.id, a.creado_en, a.accion, a.actor_email, a.antes,
           (a.antes->>'hotel_id')::bigint as hotel_id
    from public.auditoria a
    where a.tabla = 'tarifa_hotel' and a.accion in ('UPDATE', 'DELETE') and a.antes is not null
      and (p_hotel_id is null or (a.antes->>'hotel_id')::bigint = p_hotel_id)
  ),
  cand as (
    select distinct x.hotel_id, x.temporada_id
    from (
      select t.hotel_id, t.id as temporada_id from public.hotel_temporadas t
      union all
      select (coalesce(a.antes, a.despues)->>'hotel_id')::bigint, (coalesce(a.antes, a.despues)->>'id')::bigint
      from public.auditoria a
      where a.tabla = 'hotel_temporadas'
    ) x
    where x.hotel_id in (select ev.hotel_id from ev)
  )
  select
    e.id, e.creado_en, e.accion, e.hotel_id, (e.antes->>'id')::bigint, e.actor_email, e.antes,
    coalesce(v.vig, p.vig, '[]'::jsonb),
    case when v.vig is not null then 'auditoria' when p.vig is not null then 'auditoria_previa' else 'no_encontrada' end,
    exists (
      select 1 from public.tarifa_hotel th
      where th.hotel_id = e.hotel_id
        and btrim(th.tipo_habitacion) = btrim(e.antes->>'tipo_habitacion')
        and btrim(th.alimentacion) = btrim(e.antes->>'alimentacion')
        and btrim(th.temporada) = btrim(e.antes->>'temporada')
    ),
    exists (
      select 1 from public.tarifa_hotel_historial h
      where h.tarifa_id = (e.antes->>'id')::bigint and h.registrado_en = e.creado_en and h.operacion = e.accion
    ),
    exists (select 1 from public.tarifa_hotel_historial h where h.auditoria_id = e.id)
  from ev e
  left join lateral (
    select jsonb_agg(s.estado order by s.temporada_id) as vig
    from (
      select c.temporada_id,
        case
          when b.id is not null then case when b.accion = 'DELETE' then null else b.despues end
          when f.id is not null then case when f.accion = 'INSERT' then null else f.antes end
          else (select to_jsonb(t) from public.hotel_temporadas t where t.id = c.temporada_id)
        end as estado
      from cand c
      left join lateral (
        select a.id, a.accion, a.despues from public.auditoria a
        where a.tabla = 'hotel_temporadas' and a.registro_id = c.temporada_id::text and a.id < e.id
        order by a.id desc limit 1
      ) b on true
      left join lateral (
        select a.id, a.accion, a.antes from public.auditoria a
        where a.tabla = 'hotel_temporadas' and a.registro_id = c.temporada_id::text and a.id > e.id
        order by a.id asc limit 1
      ) f on true
      where c.hotel_id = e.hotel_id
    ) s
    where s.estado is not null and btrim(s.estado->>'nombre') = btrim(e.antes->>'temporada')
  ) v on true
  -- Si con ese nombre no existía ninguna vigencia en ese momento (renombrada o
  -- eliminada ANTES del cambio de la tarifa), la última versión conocida con
  -- ese nombre — marcada 'auditoria_previa', nunca como si estuviera vigente.
  left join lateral (
    select jsonb_agg(z.datos order by z.tid) as vig
    from (
      select distinct on (a.registro_id) a.registro_id as tid, a.antes as datos
      from public.auditoria a
      where a.tabla = 'hotel_temporadas' and a.accion in ('UPDATE', 'DELETE') and a.id < e.id
        and (a.antes->>'hotel_id')::bigint = e.hotel_id
        and btrim(a.antes->>'nombre') = btrim(e.antes->>'temporada')
      order by a.registro_id, a.id desc
    ) z
  ) p on v.vig is null
  order by e.id;
$$;

revoke all on function public.reconstruir_tarifas_desde_auditoria(bigint) from public, anon;
grant execute on function public.reconstruir_tarifas_desde_auditoria(bigint) to authenticated;

commit;
