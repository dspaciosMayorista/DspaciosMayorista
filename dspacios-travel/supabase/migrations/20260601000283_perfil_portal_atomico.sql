-- ───────────────────────────────────────────────────────────────────────────
-- 283 · Mi perfil del portal B2B — guardado ATÓMICO (#25)
--
-- Antes, la acción hacía UPDATE, INSERT en `auditoria` y, si la auditoría fallaba, otro UPDATE para «restaurar»: tres
-- peticiones independientes. La restauración no garantizaba rollback y podía pisar una edición concurrente.
--
-- Esta función hace el cambio y su auditoría con actor en UNA transacción (la de la propia llamada): si algo falla, Postgres
-- revierte todo y no hay nada que restaurar. Además:
--   · bloquea la fila del usuario (`for update`), así que dos ediciones del mismo usuario se serializan;
--   · compara los valores que el cliente VIO (`p_esperado`) con los actuales dentro del bloqueo: una edición hecha sobre datos
--     ya cambiados devuelve `conflicto` en vez de sobrescribir;
--   · deriva la ficha de `usuarios.aliado_id` (no recibe id de ficha) y vuelve a verificar titular/freelance, ficha no compartida
--     y acceso heredado: la autorización sigue saliendo de la sesión (la app pasa el id de la sesión) y la base no la delega;
--   · solo las llaves permitidas; el resto de columnas (NIT, banco, rol, activo, tenant…) es inalcanzable por aquí;
--   · el `antes/despues/cambios` de la auditoría se arma desde las filas reales, no desde lo que diga el llamante.
-- Solo `service_role` puede ejecutarla (la app la llama tras autenticar la sesión). Aditiva: no cambia tablas ni datos.
-- Rollback: supabase/scripts/rollback_283_perfil_portal_atomico.sql
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.guardar_perfil_portal(
  p_actor_id    uuid,
  p_actor_email text,
  p_seccion     text,
  p_cambios     jsonb,
  p_esperado    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u          public.usuarios%rowtype;
  v_f          public.aliados%rowtype;
  v_fila       jsonb;
  v_permitidos text[];
  v_k          text;
  v_nuevo      jsonb;
  v_actual     jsonb;
  v_antes      jsonb := '{}'::jsonb;
  v_despues    jsonb := '{}'::jsonb;
  v_cambios    jsonb := '{}'::jsonb;
  v_tabla      text;
  v_registro   text;
  v_esperado   jsonb := coalesce(p_esperado, '{}'::jsonb);
begin
  if p_actor_id is null or p_seccion is null or p_seccion not in ('usuario', 'ficha')
     or p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or jsonb_typeof(v_esperado) <> 'object' then
    return jsonb_build_object('ok', false, 'codigo', 'solicitud_invalida');
  end if;

  -- Bloqueo de la fila del usuario: serializa ediciones simultáneas del mismo usuario.
  select * into v_u from public.usuarios where id = p_actor_id for update;
  if not found or v_u.activo is not true or v_u.rol::text not in ('agencia', 'freelance') then
    return jsonb_build_object('ok', false, 'codigo', 'no_autorizado');
  end if;

  if p_seccion = 'usuario' then
    -- `acceso_legacy_nombre` distinto de false (true o desconocido): el nombre puede ser llave de acceso → no se toca.
    if v_u.acceso_legacy_nombre is distinct from false then
      return jsonb_build_object('ok', false, 'codigo', 'nombre_legacy');
    end if;
    v_permitidos := array['nombre'];
    v_tabla := 'usuarios';
    v_registro := v_u.id::text;
    v_fila := to_jsonb(v_u);
  else
    if v_u.agencia_id is not null then
      return jsonb_build_object('ok', false, 'codigo', 'agente');
    end if;
    if v_u.aliado_id is null then
      return jsonb_build_object('ok', false, 'codigo', 'sin_ficha');
    end if;
    if exists (
      select 1 from public.usuarios o
      where o.aliado_id = v_u.aliado_id and o.id <> v_u.id and o.rol::text in ('agencia', 'freelance')
        and o.agencia_id is null and o.activo is true
    ) then
      return jsonb_build_object('ok', false, 'codigo', 'ficha_compartida');
    end if;
    select * into v_f from public.aliados where id = v_u.aliado_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'codigo', 'sin_ficha');
    end if;
    v_permitidos := case when v_u.rol::text = 'agencia'
      then array['nombre', 'contacto', 'telefono', 'email', 'direccion']
      else array['nombre', 'telefono', 'email', 'direccion'] end;
    v_tabla := 'aliados';
    v_registro := v_f.id::text;
    v_fila := to_jsonb(v_f);
  end if;

  -- Solo llaves permitidas y valores de texto (o null en los opcionales).
  for v_k in select jsonb_object_keys(p_cambios) loop
    if v_k <> all (v_permitidos) then
      return jsonb_build_object('ok', false, 'codigo', 'campo_no_permitido');
    end if;
    v_nuevo := p_cambios -> v_k;
    if jsonb_typeof(v_nuevo) not in ('string', 'null') then
      return jsonb_build_object('ok', false, 'codigo', 'solicitud_invalida');
    end if;
    if v_k = 'nombre' and (jsonb_typeof(v_nuevo) <> 'string' or char_length(btrim(v_nuevo #>> '{}')) not between 3 and 120) then
      return jsonb_build_object('ok', false, 'codigo', 'solicitud_invalida');
    end if;
  end loop;

  -- Dentro del bloqueo: lo que el usuario vio debe seguir vigente; lo que no cambia de verdad se descarta.
  for v_k in select jsonb_object_keys(p_cambios) loop
    v_actual := coalesce(v_fila -> v_k, 'null'::jsonb);
    if coalesce(v_esperado -> v_k, 'null'::jsonb) is distinct from v_actual then
      return jsonb_build_object('ok', false, 'codigo', 'conflicto');
    end if;
    v_nuevo := coalesce(p_cambios -> v_k, 'null'::jsonb);
    if v_nuevo is distinct from v_actual then
      v_antes   := v_antes   || jsonb_build_object(v_k, v_actual);
      v_despues := v_despues || jsonb_build_object(v_k, v_nuevo);
      v_cambios := v_cambios || jsonb_build_object(v_k, jsonb_build_object('antes', v_actual, 'despues', v_nuevo));
    end if;
  end loop;

  if v_despues = '{}'::jsonb then
    return jsonb_build_object('ok', true, 'cambios', '[]'::jsonb);
  end if;

  if p_seccion = 'usuario' then
    update public.usuarios set nombre = v_despues ->> 'nombre' where id = v_u.id;
  else
    update public.aliados set
      nombre    = case when v_despues ? 'nombre'    then v_despues ->> 'nombre'    else nombre    end,
      contacto  = case when v_despues ? 'contacto'  then v_despues ->> 'contacto'  else contacto  end,
      telefono  = case when v_despues ? 'telefono'  then v_despues ->> 'telefono'  else telefono  end,
      email     = case when v_despues ? 'email'     then v_despues ->> 'email'     else email     end,
      direccion = case when v_despues ? 'direccion' then v_despues ->> 'direccion' else direccion end
    where id = v_f.id;
  end if;

  -- Misma transacción: si este INSERT falla, el UPDATE de arriba se revierte solo.
  insert into public.auditoria (actor_id, actor_email, actor_nombre, actor_rol, accion, tabla, registro_id, antes, despues, cambios)
  values (v_u.id, p_actor_email, v_u.nombre, v_u.rol::text, 'UPDATE', v_tabla, v_registro,
          v_antes, v_despues || jsonb_build_object('_via', 'portal_b2b_perfil'), v_cambios);

  return jsonb_build_object('ok', true, 'cambios', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(v_despues) as t(k)));
end;
$$;

comment on function public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb) is
  'Guardado atómico de «Mi perfil» del portal B2B: cambio + auditoría con actor en una transacción, bloqueo de fila y comparación '
  'de valores esperados. Solo service_role. Migración 283.';

revoke all on function public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb) from public;
revoke all on function public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb) from anon;
revoke all on function public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb) from authenticated;
grant execute on function public.guardar_perfil_portal(uuid, text, text, jsonb, jsonb) to service_role;
