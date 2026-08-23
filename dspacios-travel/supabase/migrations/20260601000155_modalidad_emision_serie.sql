-- ───────────────────────────────────────────────────────────────────────────
-- 155 · VUELOS — modalidad_emision: 'individual' pasa a llamarse 'serie'
-- FASE TRANSITORIA (aditiva) — NO renombra datos, NO cierra el dominio viejo.
--
-- ⚠️ REESCRITA (revisión de PR #268): la versión original de esta migración
-- hacía el UPDATE 'individual'→'serie' Y cerraba el CHECK/RPC a solo
-- ('serie','grupo') en el MISMO paso. Eso deja una ventana de interrupción:
--   · Si la migración corre ANTES de desplegar el código nuevo: el código
--     VIEJO (todavía sirviendo tráfico) sigue mandando 'individual' al
--     formulario/CSV/RPC → el CHECK ya cerrado lo rechaza → el asesor no
--     puede crear/editar bloqueos hasta que termine el despliegue.
--   · Si se despliega el código nuevo ANTES de correr la migración: el
--     código nuevo manda 'serie' → el CHECK viejo (solo individual/grupo)
--     lo rechaza → mismo problema, en la dirección contraria.
-- No hay un orden migración/despliegue que evite la ventana con una sola
-- migración que hace ambas cosas a la vez. Se separa en dos pasos, mismo
-- patrón ya usado en 153/154 (cotizaciones: aislamiento por tenant):
--
--   155 (esta, ADITIVA) → el CHECK y el RPC aceptan LOS TRES valores
--                          ('individual','serie','grupo'). NO se toca ningún
--                          dato. Segura de correr ANTES del despliegue: el
--                          código viejo (que solo conoce 'individual') sigue
--                          funcionando exactamente igual.
--   ↓ desplegar el código nuevo (lee 'individual' Y 'serie' como "Serie" en
--     toda la UI; ESCRIBE únicamente 'serie' — nunca vuelve a producir
--     'individual') ↓
--   ↓ smoke test: crear/editar un bloqueo, confirmar que guarda 'serie' ↓
--   158 (aparte, CIERRE) → convierte cualquier 'individual' remanente a
--                          'serie' y cierra el CHECK/RPC a solo
--                          ('serie','grupo'). Se corre DESPUÉS del
--                          despliegue y el smoke test, nunca antes.
--
-- En NINGÚN punto de esta secuencia hay una combinación código+esquema que
-- rompa: código viejo + esquema 155 (ambos conocen 'individual', CHECK
-- también acepta 'serie' pero el código viejo nunca lo escribe) · código
-- nuevo + esquema 155 (el código escribe 'serie', el CHECK ya lo acepta) ·
-- código nuevo + esquema 158 (mismo caso, dominio ya cerrado). La única
-- combinación que NO se soporta a propósito es código viejo + esquema 158
-- (el CHECK ya no acepta 'individual') — por diseño, 158 solo se corre
-- DESPUÉS de confirmar que el código nuevo ya está sirviendo tráfico.
--
-- "Sistema" (la tercera modalidad del negocio, para el inventario de
-- Empaquetados — migración 156) NUNCA se agrega a este CHECK: un bloqueo
-- negociado (`bloqueos_vuelo`) nunca es "Sistema" por definición — ver el
-- comentario de columna más abajo.
--
-- QUÉ HACE
--   1. Reemplaza el CHECK constraint: modalidad_emision in
--      ('individual','serie','grupo'). Amplía, nunca resta.
--   2. Actualiza el comentario de la columna (documenta la transición).
--   3. Reemplaza el RPC `actualizar_control_bloqueo()` (migración 152) para
--      que el dominio válido incluya 'individual' Y 'serie' (leídos/
--      etiquetados igual, como "Serie", en el detalle del historial) además
--      de 'grupo'. El resto de la función (SELECT...FOR UPDATE + UPDATE +
--      INSERT atómico en `bloqueo_cambios`, resolución del actor por
--      `auth.uid()`, sin `security definer`) queda IDÉNTICO a la 152.
--   4. Repite explícitamente `revoke ... from public/anon` + `grant execute
--      ... to authenticated` sobre esa misma función (ronda posterior,
--      consulta preventiva en producción): la 152 ya revocaba de PUBLIC,
--      pero no de `anon` — y Supabase le da a `anon` un grant EXECUTE
--      directo al crear cualquier función nueva (vía `ALTER DEFAULT
--      PRIVILEGES` a nivel de proyecto), así que ese acceso sobrevive un
--      `create or replace` que solo repita el `revoke from public`. Ver el
--      comentario junto al `revoke`, más abajo.
--
-- QUÉ NO CAMBIA
--   Ningún dato existente. `estado_emision`/`estado_pago`, la tabla
--   `bloqueo_cambios`, y toda la mecánica del RPC salvo el dominio/etiquetas
--   de modalidad (punto 3) y los privilegios de ejecución (punto 4).
--
-- ATOMICIDAD: todo el archivo corre en una transacción explícita
-- (`begin`/`commit`) por consistencia con el resto de migraciones recientes,
-- aunque al ser puramente aditiva no tiene un punto de fallo esperado.
--
-- ROLLBACK PROBADO: `supabase/scripts/rollback_155_modalidad_emision_serie.sql`
-- — cierra el CHECK/RPC de vuelta a solo ('individual','grupo'). Solo tiene
-- sentido si el código nuevo (que ya escribe 'serie') también se revierte al
-- mismo tiempo o antes — ver el aviso dentro del script.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- 1) CHECK constraint ampliado — acepta individual/serie/grupo (nunca resta).
alter table public.bloqueos_vuelo
  drop constraint if exists bloqueos_vuelo_modalidad_emision_check;
alter table public.bloqueos_vuelo
  add constraint bloqueos_vuelo_modalidad_emision_check
  check (modalidad_emision in ('individual', 'serie', 'grupo'));

-- 2) Comentario actualizado (documenta la transición en curso).
comment on column public.bloqueos_vuelo.modalidad_emision is
  'Serie o grupo (antes: individual/grupo — "individual" se renombra a "serie"). '
  'FASE TRANSITORIA (migración 155): el CHECK todavía acepta ''individual'' además de '
  '''serie''/''grupo'' — el código nuevo LEE ambos como "Serie" pero solo ESCRIBE ''serie''. '
  'La migración 158 (cierre, posterior al despliegue) convierte cualquier ''individual'' '
  'remanente y cierra el dominio a solo serie/grupo. Obligatoria en registros nuevos '
  '(validada en crearBloqueo); null en registros anteriores a la 152 = "Sin definir" en la '
  'UI, nunca se infiere. "Sistema" (la tercera modalidad del negocio) NUNCA es un valor de '
  'esta columna: es la modalidad implícita de toda fila de la tabla `empaquetados` '
  '(migración 156) cuando se muestra fusionada en Control Vuelos.';

-- 3) RPC ampliado — mismo cuerpo que la migración 152, el dominio válido
--    ahora incluye 'individual' Y 'serie' (ambos se etiquetan "Serie" en el
--    detalle del historial). El resto de la función (SELECT...FOR UPDATE +
--    UPDATE + INSERT atómico, sin `security definer`) queda idéntico a la 152.
--
-- ⚠️ CORREGIDO (consulta preventiva en producción, ronda posterior a esta
-- migración): el comentario original de este bloque afirmaba que un `create
-- or replace function` con la MISMA firma "no hace falta volver a hacer
-- grant/revoke (sobreviven un REPLACE)" — cierto en el sentido estricto de
-- que Postgres preserva los privilegios YA EXISTENTES sobre la función al
-- reemplazarla, pero la premisa completa era falsa: la consulta preventiva
-- corrida en producción (antes de ejecutar esta migración) mostró que
-- `actualizar_control_bloqueo` tiene HOY `anon EXECUTE = true`, pese a que
-- la migración 152 (ya corrida) sí hacía `revoke all ... from public` —
-- **Supabase otorga EXECUTE directo a `anon`/`authenticated` sobre toda
-- función nueva vía `ALTER DEFAULT PRIVILEGES` a nivel de proyecto,
-- INDEPENDIENTE de PUBLIC** — así que `revoke ... from public` nunca alcanzó
-- el grant explícito que Supabase le dio a `anon` en el momento de crearse.
-- Por eso este `create or replace` (y el de la migración 158) ahora repiten
-- el `revoke`/`grant` explícitamente — incluyendo el `revoke ... from anon`
-- que faltaba — en vez de asumir que sobreviven solos.
create or replace function public.actualizar_control_bloqueo(
  p_bloqueo_id        bigint,
  p_modalidad_emision text,
  p_estado_emision    text,
  p_estado_pago       text,
  p_nota              text
)
returns void
language plpgsql
as $$
declare
  v_modalidad_antes text;
  v_emision_antes   text;
  v_pago_antes      text;
  v_detalle         text := '';
  v_registrado_por  text;
begin
  if p_modalidad_emision not in ('individual', 'serie', 'grupo') then
    raise exception 'Modalidad de emisión inválida.';
  end if;
  if p_estado_emision not in ('pendiente', 'emitido') then
    raise exception 'Estado de emisión inválido.';
  end if;
  if p_estado_pago not in ('pendiente', 'pagado') then
    raise exception 'Estado de pago inválido.';
  end if;

  select modalidad_emision, estado_emision, estado_pago
    into v_modalidad_antes, v_emision_antes, v_pago_antes
    from public.bloqueos_vuelo
   where id = p_bloqueo_id
     for update;

  if not found then
    raise exception 'Bloqueo no encontrado o sin permiso para verlo.';
  end if;

  if coalesce(v_modalidad_antes, '') <> p_modalidad_emision then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Modalidad de emisión: '
      || coalesce(case v_modalidad_antes when 'individual' then 'Serie' when 'serie' then 'Serie' when 'grupo' then 'Grupo' end, 'Sin definir')
      || ' → '
      || (case p_modalidad_emision when 'individual' then 'Serie' when 'serie' then 'Serie' when 'grupo' then 'Grupo' end);
  end if;

  if coalesce(v_emision_antes, '') <> p_estado_emision then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de emisión: '
      || coalesce(case v_emision_antes when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end, 'Sin definir')
      || ' → '
      || (case p_estado_emision when 'pendiente' then 'Pendiente' when 'emitido' then 'Emitido' end);
  end if;

  if coalesce(v_pago_antes, '') <> p_estado_pago then
    v_detalle := v_detalle || (case when v_detalle <> '' then ' · ' else '' end)
      || 'Estado de pago: '
      || coalesce(case v_pago_antes when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end, 'Sin definir')
      || ' → '
      || (case p_estado_pago when 'pendiente' then 'Pendiente' when 'pagado' then 'Pagado' end);
  end if;

  if v_detalle = '' and coalesce(trim(p_nota), '') = '' then
    raise exception 'No hay cambios para registrar.';
  end if;

  if v_detalle <> '' then
    update public.bloqueos_vuelo
       set modalidad_emision = p_modalidad_emision,
           estado_emision = p_estado_emision,
           estado_pago = p_estado_pago,
           updated_at = now()
     where id = p_bloqueo_id;

    if not found then
      raise exception 'No se pudo actualizar el bloqueo (sin permiso de escritura).';
    end if;
  end if;

  select coalesce(u.nombre, u.email) into v_registrado_por
    from public.usuarios u
   where u.id = auth.uid();

  insert into public.bloqueo_cambios (bloqueo_id, detalle, nota, registrado_por)
  values (p_bloqueo_id, nullif(v_detalle, ''), nullif(trim(p_nota), ''), v_registrado_por);
end;
$$;

comment on function public.actualizar_control_bloqueo(bigint, text, text, text, text) is
  'Actualiza modalidad/estado de emisión/estado de pago de un bloqueo y registra el cambio '
  'en bloqueo_cambios en UNA sola transacción (SELECT ... FOR UPDATE + UPDATE + INSERT) — '
  'si el INSERT del historial falla, el UPDATE también se revierte. SIN security definer: '
  'corre con el rol del que llama, sujeta a las mismas policies de bloqueos_vuelo/bloqueo_cambios. '
  'FASE TRANSITORIA (155): dominio válido individual/serie/grupo (ambos individual y serie se '
  'etiquetan "Serie"); la migración 158 cierra el dominio a solo serie/grupo.';

-- Repetido explícitamente en cada `create or replace` de esta función (152,
-- 155, 158) — nunca se asume que sobrevive sola. `revoke ... from public`
-- por sí solo NO bastaba (ver el comentario junto al `create or replace` más
-- arriba): Supabase otorga EXECUTE directo a `anon`/`authenticated` sobre
-- funciones nuevas vía `ALTER DEFAULT PRIVILEGES` a nivel de proyecto, así
-- que hay que revocárselo a `anon` explícitamente, no solo a PUBLIC.
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from public;
revoke all on function public.actualizar_control_bloqueo(bigint, text, text, text, text) from anon;
grant execute on function public.actualizar_control_bloqueo(bigint, text, text, text, text) to authenticated;

commit;
