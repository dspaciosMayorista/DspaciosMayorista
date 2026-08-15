-- ───────────────────────────────────────────────────────────────────────────
-- 151 · PROGRAMAS — persistir la "tarifa comisionable" del proveedor
--
-- QUÉ ARREGLA
--   En "Salidas y precios" (modo_precio = 'salida') el asesor puede marcar
--   "El proveedor da tarifa comisionable" y cargar, por acomodación, la
--   TARIFA del proveedor en vez del neto — `calcularNetoPrograma()`
--   (lib/calc/programaPrecio.ts, SIN CAMBIOS en esta migración) calcula el
--   neto a partir de esa tarifa + la regla (modo/valor/% comisión).
--
--   Nada de eso se guardaba: el check, la regla (modo/valor/% comisión) y las
--   cuatro tarifas del proveedor (sencilla/doble/triple/múltiple) solo vivían
--   en estado de React. `guardarSalidas` únicamente persistía los NETOS ya
--   calculados. Al volver a entrar al programa, el check aparecía apagado,
--   la regla volvía a sus defaults y las tarifas originales desaparecían —
--   solo quedaban los netos (que sí sobrevivían, por eso el paquete seguía
--   viéndose bien en el tarifario, pero era imposible reabrir/ajustar la
--   tarifa que le dio origen a ese neto sin volver a pedírsela al proveedor).
--
-- QUÉ AGREGA
--   `programas`: si la regla está activa + su configuración (modo/valor/%
--   comisión), a nivel de PROGRAMA — un programa usa una sola regla para
--   todas sus salidas, igual que hoy vive el toggle en la UI.
--
--   `programa_salidas`: la TARIFA ORIGINAL del proveedor por acomodación
--   (sencilla/doble/triple/múltiple), SEPARADA del neto ya calculado
--   (`neto_*`, columnas existentes desde la 068). Niño no tiene tarifa de
--   proveedor (se ajusta directo, como ya hacía la UI).
--
-- POR QUÉ SEPARADO DE NETO
--   El neto es lo que se monta (entra al PVP tal cual, vía `pvpPrograma` —
--   SIN CAMBIOS). La tarifa es el dato de origen: sirve para reabrir/auditar
--   la calculadora, nunca se reconstruye desde el neto (la resta no es
--   reversible sin conocer modo/valor/% comisión exactos usados en su
--   momento, y aun conociéndolos, redondeos ya aplicados lo harían impreciso).
--
-- REGISTROS EXISTENTES
--   `regla_comisionable` nace en `false` y las 4 tarifas en `null` — ningún
--   backfill, ni se tocan los `neto_*` ya cargados. Un programa creado antes
--   de esta migración simplemente abre con el check apagado, exactamente
--   como se veía hasta ahora (nunca se guardaba nada, así que no hay tarifa
--   "verdadera" que reconstruir).
--
-- GUARDADO ATÓMICO — `guardar_programa_salidas()`
--   `guardarSalidas` (como el resto de acciones de este módulo: ciudades,
--   días, matriz, inclusiones, tours) hace DELETE + INSERT con dos llamadas
--   separadas de supabase-js — no hay transacción entre ellas. Si el DELETE
--   corre y el INSERT falla (constraint, red, lo que sea), el programa queda
--   SIN salidas aunque la acción devuelva `ok:false` y la UI muestre el
--   error: el daño ya está hecho.
--
--   Para lo que toca esta migración (salidas + la regla comisionable, que se
--   guardan juntas desde el mismo botón "Guardar") se reemplaza por una
--   única función de Postgres: UPDATE de la regla + DELETE + INSERT de
--   salidas, las tres dentro de la misma invocación — Postgres ejecuta un
--   `plpgsql` como una sola transacción implícita, así que si el INSERT
--   final falla (p. ej. un valor no numérico que se cuela), TODO se revierte,
--   incluido el DELETE: el programa queda exactamente como estaba antes de
--   guardar, nunca a medias.
--
--   `language plpgsql` SIN `security definer`: corre con el rol de quien
--   llama (`authenticated`), así que las policies de `programas` y
--   `programa_salidas` (068/031: superadmin/gerencia/administracion/
--   operaciones) se evalúan igual que si fueran dos `update`/`delete`/
--   `insert` sueltos — no hay bypass de RLS ni necesita un candado de rol
--   aparte dentro de la función.
--
--   El resto de acciones de este módulo (ciudades, días, matriz, inclusiones,
--   tours, blackouts) NO se tocan aquí: mismo patrón, mismo riesgo, pero
--   fuera del alcance de esta migración — no se guardan junto con la regla
--   comisionable desde el mismo botón, así que no hace falta unirlas para
--   cerrar el caso que motivó este cambio.
-- ───────────────────────────────────────────────────────────────────────────

-- ── 1. Programa: si la regla está activa + su configuración ────────────────
alter table public.programas
  add column if not exists regla_comisionable boolean not null default false,
  add column if not exists regla_comisionable_modo text not null default 'pct',
  add column if not exists regla_comisionable_valor numeric(15,4),
  add column if not exists regla_comisionable_pct_comision numeric(15,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'programas_regla_comisionable_modo_check'
  ) then
    alter table public.programas
      add constraint programas_regla_comisionable_modo_check
      check (regla_comisionable_modo in ('pct', 'impuesto', 'ninguno'));
  end if;
end $$;

comment on column public.programas.regla_comisionable is
  'El proveedor da tarifa comisionable (no el neto) en las salidas de este programa. Migración 151.';
comment on column public.programas.regla_comisionable_modo is
  '''pct'' | ''impuesto'' | ''ninguno'' — cómo se saca la base comisionable de la tarifa. Ver lib/calc/programaPrecio.ts.';
comment on column public.programas.regla_comisionable_valor is
  '% a restar (modo ''pct'') o monto del impuesto (modo ''impuesto''). Sin unidades de moneda fijas: en la del programa.';
comment on column public.programas.regla_comisionable_pct_comision is
  '% de comisión sobre la base comisionable.';

-- ── 2. Salidas: tarifa ORIGINAL del proveedor por acomodación ───────────────
alter table public.programa_salidas
  add column if not exists tarifa_sencilla numeric(15,2),
  add column if not exists tarifa_doble    numeric(15,2),
  add column if not exists tarifa_triple   numeric(15,2),
  add column if not exists tarifa_multiple numeric(15,2);

comment on column public.programa_salidas.tarifa_sencilla is
  'Tarifa del proveedor (antes de comisión) para Sencilla. Dato de origen de neto_sencilla — nunca se reconstruye uno del otro. Migración 151.';
comment on column public.programa_salidas.tarifa_doble is
  'Tarifa del proveedor (antes de comisión) para Doble. Ver tarifa_sencilla.';
comment on column public.programa_salidas.tarifa_triple is
  'Tarifa del proveedor (antes de comisión) para Triple. Ver tarifa_sencilla.';
comment on column public.programa_salidas.tarifa_multiple is
  'Tarifa del proveedor (antes de comisión) para Múltiple. Ver tarifa_sencilla.';

-- ── 3. Guardado atómico de la regla + las salidas ───────────────────────────
create or replace function public.guardar_programa_salidas(
  p_programa_id bigint,
  p_regla       jsonb,
  p_salidas     jsonb
)
returns void
language plpgsql
as $$
begin
  if not exists (select 1 from public.programas where id = p_programa_id) then
    raise exception 'El programa % no existe.', p_programa_id;
  end if;

  update public.programas
     set regla_comisionable = coalesce((p_regla->>'activa')::boolean, false),
         regla_comisionable_modo = coalesce(p_regla->>'modo', 'pct'),
         regla_comisionable_valor = nullif(p_regla->>'valor', '')::numeric,
         regla_comisionable_pct_comision = nullif(p_regla->>'pctComision', '')::numeric,
         updated_at = now()
   where id = p_programa_id;

  delete from public.programa_salidas where programa_id = p_programa_id;

  insert into public.programa_salidas (
    programa_id, orden, etiqueta, fecha_desde, fecha_hasta, noches, columna,
    neto_sencilla, neto_doble, neto_triple, neto_multiple, neto_nino, bajo_solicitud,
    tarifa_sencilla, tarifa_doble, tarifa_triple, tarifa_multiple
  )
  select
    p_programa_id,
    x.orden,
    x.etiqueta,
    x.fecha_desde,
    x.fecha_hasta,
    x.noches,
    x.columna,
    x.neto_sencilla, x.neto_doble, x.neto_triple, x.neto_multiple, x.neto_nino,
    coalesce(x.bajo_solicitud, false),
    x.tarifa_sencilla, x.tarifa_doble, x.tarifa_triple, x.tarifa_multiple
  from jsonb_to_recordset(coalesce(p_salidas, '[]'::jsonb)) as x(
    orden           int,
    etiqueta        text,
    fecha_desde     date,
    fecha_hasta     date,
    noches          int,
    columna         text,
    neto_sencilla   numeric,
    neto_doble      numeric,
    neto_triple     numeric,
    neto_multiple   numeric,
    neto_nino       numeric,
    bajo_solicitud  boolean,
    tarifa_sencilla numeric,
    tarifa_doble    numeric,
    tarifa_triple   numeric,
    tarifa_multiple numeric
  );
end;
$$;

comment on function public.guardar_programa_salidas(bigint, jsonb, jsonb) is
  'Reemplaza la regla comisionable de un programa y sus salidas en una sola transacción '
  '(UPDATE + DELETE + INSERT) — si el INSERT falla, el DELETE también se revierte y el '
  'programa no queda sin salidas. SIN security definer: corre con el rol del que llama, '
  'sujeto a las mismas policies de programas/programa_salidas. Migración 151.';

-- No es security definer, así que no hay privilegio que revocar de más — pero
-- se deja explícito el grant a `authenticated` (igual que el resto de RPCs de
-- este módulo) para que anon no la vea en el catálogo de funciones callables.
revoke all on function public.guardar_programa_salidas(bigint, jsonb, jsonb) from public;
grant execute on function public.guardar_programa_salidas(bigint, jsonb, jsonb) to authenticated;
