-- ───────────────────────────────────────────────────────────────────────────
-- 188 · crm_pasajeros_contrato_lectura — "Pasajeros de contratos" en el CRM
--
-- NUMERACIÓN (actualizado): esta migración nació como "187" en una rama
-- aislada (`worktree-dashboard-scroll-pasajeros-minorista`, creada desde
-- `main` limpio por instrucción explícita, sin mezclar con el trabajo de
-- "búsqueda de pasajero por documento" de otra rama). Esa OTRA migración
-- 187 (`buscar_pasajero_por_documento`, rama `claude/directorio-
-- pasajeros-187`) YA SE APLICÓ en staging — no es una colisión pendiente,
-- es un HECHO consumado: el número 187 ya está tomado. Esta migración se
-- renumeró a **188** (archivo, funciones auxiliares de prueba y scripts
-- preflight/postcheck/rollback/test) para no chocar — mismo criterio ya
-- usado en este proyecto para la colisión 157/158 (ver CLAUDE.md, sección
-- "Estado del proyecto").
--
-- ⚠️ ORDEN DE INTEGRACIÓN OBLIGATORIO: primero fusionar/aplicar la rama de
-- "búsqueda de pasajero por documento" (187, ya en staging), DESPUÉS esta
-- (188). Nunca al revés — 188 no depende funcionalmente de 187 (usa sus
-- propias funciones, no las de la 187), pero invertir el orden de
-- aplicación en una base que ya tiene la 187 corrida generaría contratos
-- de prueba con números que podrían confundirse entre las dos baterías de
-- test si se corren fuera de orden. Esta migración NO modifica ni
-- reaplica la 187 — es aditiva e independiente.
--
-- QUÉ RESUELVE
-- El CRM (`crm_contactos`) y los pasajeros de un contrato
-- (`contrato_pasajeros`) son dos cosas DISTINTAS que hoy se confundían:
--   - `crm_contactos` es la base de MARKETING (campañas de email/difusión,
--     "acepta_publicidad") — sin columna `tenant`, leída hoy con
--     `auth.uid() is not null` sin ningún otro filtro (migración 042):
--     cualquier rol interno ve TODOS los contactos de las DOS agencias.
--   - `contrato_pasajeros` es la lista real de viajeros de cada contrato —
--     nunca se copió a `crm_contactos`, y no debe copiarse en masa: son
--     datos personales de gente que compró un viaje, no gente que aceptó
--     publicidad. Auditoría en staging: 195 filas con documento en 52
--     contratos Minorista (dato real, no hipotético) que HOY no se pueden
--     consultar desde el CRM en absoluto.
--
-- Esta migración agrega SOLO una función de lectura paginada,
-- `crm_pasajeros_contrato_buscar` — nunca escribe en `crm_contactos`, nunca
-- marca a nadie como destinatario de campaña, nunca infiere
-- `acepta_publicidad`. El nombre histórico combinado de
-- `contrato_pasajeros.nombre` se devuelve TAL CUAL (nunca se parte por
-- heurística — mismo criterio que el resto del proyecto para este campo).
--
-- PERMISOS — MISMO criterio ya usado por `puede_ver_contrato`/
-- `soy_asesor_del_contrato` (migraciones 141/142/144, sin duplicar su
-- lista de roles):
--   - superadmin/gerencia: pasajeros de AMBAS agencias.
--   - administracion/operaciones: solo pasajeros de contratos de SU
--     agencia (`usuarios.tenant`).
--   - venta: SOLO pasajeros de contratos donde es el asesor asignado.
--   - Cualquier rol externo (agencia/freelance/cliente_final) o sin
--     sesión: rechazado ANTES de tocar la tabla — no depende de que el
--     front-end no llame esta función.
-- La función es SECURITY DEFINER (necesario: `venta` no tiene SELECT
-- directo sobre `ventas` desde la migración 144, y esta función hace JOIN
-- con esa tabla para resolver tenant/asesor) — el aislamiento real lo dan
-- las condiciones EXPLÍCITAS del WHERE, no la RLS de `ventas` dentro de
-- esta función (mismo patrón ya usado en el proyecto, ver el comentario
-- de auditoría equivalente en la migración 167/`puede_ver_contrato`).
--
-- Preflight/postcheck/rollback/test en supabase/scripts/*188_crm_pasajeros*.
-- No ejecutada en producción — pendiente de validación y aprobación del
-- dueño. No toca el núcleo atómico de pasajeros/sillas de la migración 167.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create or replace function public.crm_pasajeros_contrato_buscar(
  p_busqueda    text default null,
  p_pagina      integer default 1,
  p_tam_pagina  integer default 50
)
returns table (
  pasajero_id       bigint,
  numero_contrato   text,
  tenant            text,
  nombre            text,
  tipo_id           text,
  identificacion    text,
  fecha_nacimiento  date,
  total_filas       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tam       constant integer := least(greatest(coalesce(p_tam_pagina, 50), 1), 100);
  v_offset    integer;
  v_busqueda  text;
begin
  -- Autoridad real de acceso — mismo candado NULL-safe que
  -- buscar_pasajero_por_documento (rama de pasajeros): `mi_rol()` devuelve
  -- NULL para un usuario interno desactivado (migración 140), y un `if
  -- <NULL> then` en PL/pgSQL se trata como FALSE (no entra al cuerpo) — un
  -- `not in` desnudo dejaría pasar a un inactivo sin excepción explícita.
  -- `coalesce(..., true)` fuerza el rechazo también en ese caso.
  if coalesce(public.mi_rol()::text not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'), true) then
    raise exception 'Sin permiso para consultar pasajeros de contratos.';
  end if;

  if p_pagina is null or p_pagina < 1 then
    raise exception 'Página inválida.';
  end if;
  v_offset := (p_pagina - 1) * v_tam;

  v_busqueda := nullif(trim(p_busqueda), '');
  if v_busqueda is not null and length(v_busqueda) > 100 then
    raise exception 'Término de búsqueda demasiado largo.';
  end if;

  -- Documento con formato de búsqueda ILIKE ('%…%') se escapa a mano:
  -- backslash primero (para no duplicar el escape de los otros dos),
  -- luego '%' y '_' — v_busqueda es texto libre del usuario, nunca debe
  -- poder inyectar sus propios comodines para ensanchar la búsqueda más
  -- allá de lo que el candado de permiso ya autoriza (que de todas formas
  -- es "todo lo que ya puede listar" — pero mejor no depender de eso).
  if v_busqueda is not null then
    v_busqueda := replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  return query
    with visibles as (
      select cp.id as pasajero_id, cp.numero_contrato, v.tenant, cp.nombre, cp.tipo_id, cp.identificacion, cp.fecha_nacimiento
        from public.contrato_pasajeros cp
        join public.ventas v on v.numero_contrato = cp.numero_contrato
       where public.puede_ver_contrato(cp.numero_contrato)
         and (public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(cp.numero_contrato))
         and (
           v_busqueda is null
           or cp.nombre ilike ('%' || v_busqueda || '%') escape '\'
           or cp.identificacion ilike ('%' || v_busqueda || '%') escape '\'
           or cp.numero_contrato ilike ('%' || v_busqueda || '%') escape '\'
         )
    ),
    contado as (
      select count(*) as n from visibles
    )
    select vi.pasajero_id, vi.numero_contrato, vi.tenant, vi.nombre, vi.tipo_id, vi.identificacion, vi.fecha_nacimiento,
           c.n as total_filas
      from visibles vi cross join contado c
     order by vi.numero_contrato desc, vi.pasajero_id asc
     limit v_tam offset v_offset;
end;
$$;

comment on function public.crm_pasajeros_contrato_buscar(text, integer, integer) is
  'Lectura PAGINADA de contrato_pasajeros para el CRM ("Pasajeros de '
  'contratos", separado de crm_contactos) — nunca escribe, nunca marca '
  'destinatarios de campaña, nunca copia a crm_contactos. Mismo criterio '
  'de permiso/tenant que puede_ver_contrato/soy_asesor_del_contrato: '
  'superadmin/gerencia ambas agencias, administracion/operaciones la '
  'propia, venta solo sus contratos, cualquier rol externo o sin sesión '
  'rechazado. `nombre` se devuelve TAL CUAL (nunca partido por '
  'heurística). p_busqueda hace ILIKE sobre nombre/identificacion/'
  'numero_contrato, con los comodines del usuario escapados. `total_filas` '
  'viaja en cada fila para paginar sin una segunda consulta. Migración 188 '
  '(renumerada desde 187 tras confirmarse que la migración 187 real '
  '—búsqueda de pasajero por documento, otra rama— ya se aplicó en '
  'staging — ver la nota de numeración en la cabecera del archivo).';

revoke all on function public.crm_pasajeros_contrato_buscar(text, integer, integer) from public, anon;
grant execute on function public.crm_pasajeros_contrato_buscar(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
