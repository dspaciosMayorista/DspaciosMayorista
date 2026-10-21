-- ═════════════════════════════════════════════════════════════════════════
-- 222 · #50 (A, ADITIVA) — hija manual de una comparativa con precio NETO.
--
-- Número reservado por el Coordinador (bitácora de #50, 2026-10-20). Scripts:
-- supabase/scripts/{preflight,postcheck,rollback}_222_neto_hija_manual.sql y
-- test_222_*.sql / test_222_*.sh (SOLO bases desechables: CI o local).
--
-- Orden de despliegue: preflight 222 → 222 → postcheck 222 → app nueva →
-- 223 (cierre) → postcheck 223. Con SOLO la 222 la app vieja sigue creando
-- hijas en PVP con las firmas viejas y la modalidad NO es obligatoria.
-- UNA diferencia en el desfase de despliegue: si la clave de idempotencia ya se
-- usó y la hija ya quedó sellada, el reintento de una instancia VIEJA de la app
-- (que no manda modalidad) recibe COMPARATIVA_CLAVE en vez de la hija. Pasa solo
-- mientras convivan app vieja y app nueva; se documenta en el PR.
--
-- NO edita la 198, la 164, la 205, la 206, la 211, la 216 ni la 217. La RPC 198
-- (`convertir_cotizacion_a_contrato`, `registrar_pago_previo`) queda
-- EXACTAMENTE igual (la 216 comprueba su md5 y aquí también). Lo único que se
-- reemplaza con CREATE OR REPLACE y la MISMA firma son cuatro funciones públicas
-- que conservan el comportamiento PVP/B2C/legado de siempre, salvo la excepción
-- de arriba (reintento de la app vieja sobre una hija ya sellada):
--   · elegir_opcion_comparativa_sesion        (211)  + sella si el recibo trae modalidad
--   · resolver_solicitud_comparativa          (211)  → delega en p50_priv.resolver_impl
--   · registrar_pago_previo_rev               (216)  + rama NETO
--   · convertir_cotizacion_manual_controlada  (216)  + validación previa y complemento
-- y se agregan dos funciones con nombre NUEVO (sin sobrecarga, para no crear
-- ambigüedad en PostgREST): registrar_validacion_comparativa_n50 y
-- resolver_solicitud_comparativa_n50.
--
-- ── Diseño B (bitácora, ciclo 1 A3) ───────────────────────────────────────
-- La hija conserva `cotizaciones.precio_venta` = PVP (la cotización pública y
-- los items del contrato quedan a PVP). El NETO vive en `cotizacion_neto`
-- (cabecera sellada) y `cotizacion_neto_componentes` (reparto por fila, SOLO
-- para el snapshot de condiciones de pago). El wrapper de pago fija el exigido
-- y `precio_total_congelado` en NETO; tras la 198 `p50_priv.completar_conversion`
-- (SECURITY DEFINER) rebaja `ventas.precio_venta` a NETO y completa la forma
-- NETO que leen todos los consumidores (`comision_estado = 'descontada'`,
-- `modo_compra = 'neta'`, `comision_b2b` = descuento y una fila de
-- `aliados_b2b` descontada, SIN retención: decisión 3).
--
-- ── Reglas (D-1 … D-6, Q-1 … Q-4) ─────────────────────────────────────────
--  · Toda hija es ASISTIDA: la modalidad la fija un rol interno al crearla
--    (superadmin, gerencia, administración, operaciones; `venta` no). Sin
--    aliado del catálogo no hay NETO. (Q-5) PVP sí se permite sin aliado: la
--    hija nace legada, SIN sello, como hoy; ni la 223 la deja sin salida.
--  · Base del descuento = PVP − tiquetes − recobro (si se reconoce la
--    participación; si no, el recobro entra a la base). Los niños entran.
--    Comisión ordinaria = round(base × %) en unidades de moneda (como #30);
--    participación = min(recobroAliado, recobro) solo si se reconoce.
--  · Descuento 0 ⇒ no hay NETO.
--  · Margen sobre el TOTAL: (NETO − costo total) / NETO ≥ 6 % con la tolerancia
--    de medio peso de `margenContrato.ts`; solo tiquetes: 2 % EXACTO, solo
--    superadmin autoriza; el 6 % lo autorizan superadmin o administración.
--    NETO < costo total o costo total = 0 ⇒ rechazo sin excepción.
--  · Las validaciones corren al sellar (al crear la hija) y otra vez antes de la
--    198: un rechazo nuevo nunca consume consecutivo.
--  · La hija NETO se sella con `payload.recobroAliado = 0` para que la 198 no
--    cree la fila de recobro pendiente (la participación ya va dentro del
--    descuento: se descuenta UNA vez, sin pago aparte).
--  · Las hijas de comparativa NO son editables por #39 (216: `bloquear_para_editar`),
--    así que el sello nunca queda desactualizado.
--
-- ── Frontera ───────────────────────────────────────────────────────────────
-- No agrega, renombra ni deshabilita disparadores de la frontera de #39 y no
-- cambia los permisos de `cotizaciones`, `cotizacion_servicios`,
-- `cotizacion_pagos_previos` ni `cotizacion_condiciones`. `p50_priv` no se
-- expone: solo `service_role` tiene USAGE (el wrapper INVOKER llama a sus
-- funciones). Las dos tablas nuevas tienen RLS, ninguna policy y SELECT solo
-- para `service_role`; las escribe únicamente `sellar_hija` (definer).
-- ═════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

-- ═════════════════════════════════════════════════════════════════════════
-- 0. Guardas: dependencias presentes, frontera activa y la 198 intacta.
-- ═════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)') is null
     or to_regprocedure('public.registrar_pago_previo(bigint,numeric,text,numeric,text,text,date,uuid,text,jsonb,numeric,numeric)') is null
     or to_regprocedure('public.registrar_pago_previo_rev(bigint,numeric,text,numeric,text,text,date,uuid,text,integer,jsonb,numeric,numeric)') is null
     or to_regprocedure('public.convertir_cotizacion_manual_controlada(bigint,uuid)') is null
     or to_regprocedure('public.registrar_validacion_comparativa(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb)') is null
     or to_regprocedure('public.elegir_opcion_comparativa_sesion(uuid,text)') is null
     or to_regprocedure('public.resolver_solicitud_comparativa(bigint,text,text,text)') is null
     or to_regprocedure('f211_priv.crear_hija(bigint,text,text,integer,text,uuid,uuid,bigint,text,text,jsonb)') is null
     or to_regprocedure('p39_priv.componentes_manual(bigint)') is null
     or to_regprocedure('p39_priv.composicion_coincide(bigint,jsonb)') is null
     or to_regprocedure('public._autorizado_pago_previo(uuid)') is null
     or to_regclass('public.cotizacion_comparativa_validaciones') is null
     or to_regclass('public.aliados_b2b') is null
     or to_regclass('public.aliados') is null then
    raise exception '222: faltan piezas de las migraciones 164/198/205/206/211/216/217. No se aplicó nada.';
  end if;
  if not p39_priv.frontera_activa() then
    raise exception '222: la frontera de #39 (217) no está activa. Aplica la 217 antes.';
  end if;
  if to_regclass('p50_priv.config') is not null or to_regclass('public.cotizacion_neto') is not null then
    raise exception '222: ya hay objetos de #50. No se aplicó nada.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), ''))
     <> 'edc9975010746e53e4af6a75ad9763dc' then
    raise exception '222: el cuerpo de la RPC 198 de conversión no es el esperado; no se aplica.';
  end if;
end $$;

create schema p50_priv;
revoke all on schema p50_priv from public, anon, authenticated;
-- Solo el wrapper INVOKER (service_role) necesita USAGE; anon/authenticated nada.
grant usage on schema p50_priv to service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Interruptor de la modalidad obligatoria (lo enciende la 223).
-- ═════════════════════════════════════════════════════════════════════════
create table p50_priv.config (
  id boolean primary key default true check (id),
  exigir_modalidad boolean not null default false,
  actualizado_en timestamptz not null default now()
);
insert into p50_priv.config (id) values (true);
revoke all on p50_priv.config from public, anon, authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Columnas nuevas en los recibos (aditivas, nulas = comportamiento de siempre).
-- ═════════════════════════════════════════════════════════════════════════
alter table public.cotizacion_comparativa_validaciones
  add column modalidad text check (modalidad is null or modalidad in ('pvp', 'neto')),
  add column reconoce_recobro boolean,
  add column autorizar_margen boolean not null default false;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Tablas del sello NETO (solo inserción, RLS, SELECT solo para service_role).
-- ═════════════════════════════════════════════════════════════════════════
create table public.cotizacion_neto (
  cotizacion_id   bigint primary key,
  tenant          text not null,
  modalidad       text not null check (modalidad in ('pvp', 'neto')),
  reconoce_recobro boolean,
  aliado_id       bigint references public.aliados (id) on delete restrict,
  tipo_asesor     text not null check (tipo_asesor in ('interno', 'agencia', 'freelance')),
  moneda          text not null check (moneda in ('COP', 'USD')),
  pvp_total       numeric(15,2) not null check (pvp_total > 0),
  -- Solo NETO:
  tiquetes        numeric(15,2),
  recobro         numeric(15,2),
  ninos_total     numeric(15,2),
  recobro_aliado_original numeric(15,2),
  base_comision   numeric(15,2),
  pct_comision    numeric(5,4),
  comision_ordinaria numeric(15,2),
  participacion_recobro numeric(15,2),
  descuento_total numeric(15,2),
  neto_total      numeric(15,2),
  costo_total     numeric(15,2),
  margen          numeric(9,6),
  piso            numeric(5,4),
  solo_tiquetes   boolean,
  autorizado_por  uuid,
  autorizado_rol  text,
  autorizado_en   timestamptz,
  creado_por_id   uuid,
  creado_en       timestamptz not null default now(),
  constraint cotizacion_neto_cot_fk foreign key (cotizacion_id, tenant)
    references public.cotizaciones (id, tenant) on delete restrict,
  -- Un B2B sellado siempre lleva su aliado; un B2C nunca.
  constraint cotizacion_neto_aliado check ((tipo_asesor = 'interno') = (aliado_id is null)),
  constraint cotizacion_neto_pvp check (
    modalidad <> 'pvp' or (neto_total is null and descuento_total is null and reconoce_recobro is null)
  ),
  constraint cotizacion_neto_neto check (
    modalidad <> 'neto' or (
      tipo_asesor <> 'interno'
      and reconoce_recobro is not null
      and descuento_total is not null and descuento_total > 0
      and neto_total is not null and neto_total = pvp_total - descuento_total
      and costo_total is not null and costo_total > 0 and neto_total >= costo_total
      and base_comision is not null and base_comision >= 0
      and pct_comision is not null and solo_tiquetes is not null and piso is not null
      and comision_ordinaria is not null and participacion_recobro is not null
      and descuento_total = comision_ordinaria + participacion_recobro
    )
  )
);
comment on table public.cotizacion_neto is
  '#50: sello de la modalidad (PVP/NETO) de una hija manual de comparativa. Una fila por hija, solo inserción.';

create table public.cotizacion_neto_componentes (
  cotizacion_id   bigint not null references public.cotizacion_neto (cotizacion_id) on delete restrict,
  orden           integer not null,
  servicio_id     bigint,
  tipo_servicio   text not null,
  pvp             numeric(15,2) not null,
  descuento       numeric(15,2) not null check (descuento >= 0),
  neto            numeric(15,2) not null,
  primary key (cotizacion_id, orden),
  constraint cotizacion_neto_componentes_neto check (neto = pvp - descuento)
);
comment on table public.cotizacion_neto_componentes is
  '#50: reparto del descuento por fila de servicio (mismo orden que p39_priv.componentes_manual). Solo para el snapshot de condiciones de pago.';

alter table public.cotizacion_neto enable row level security;
alter table public.cotizacion_neto_componentes enable row level security;
revoke all on public.cotizacion_neto, public.cotizacion_neto_componentes from public, anon, authenticated, service_role;
-- El servidor (panel de pagos, ficha) lee con service_role; NINGUNA escritura directa.
grant select on public.cotizacion_neto, public.cotizacion_neto_componentes to service_role;

create or replace function p50_priv.tg_solo_insercion() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  raise exception 'El sello NETO de una cotización no se modifica ni se borra (%).', tg_table_name using errcode = '42501';
end $$;
create trigger trg_cotizacion_neto_inmutable before update or delete on public.cotizacion_neto
  for each row execute function p50_priv.tg_solo_insercion();
create trigger trg_cotizacion_neto_truncate before truncate on public.cotizacion_neto
  for each statement execute function p50_priv.tg_solo_insercion();
create trigger trg_cotizacion_neto_comp_inmutable before update or delete on public.cotizacion_neto_componentes
  for each row execute function p50_priv.tg_solo_insercion();
create trigger trg_cotizacion_neto_comp_truncate before truncate on public.cotizacion_neto_componentes
  for each statement execute function p50_priv.tg_solo_insercion();

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Funciones privadas.
-- ═════════════════════════════════════════════════════════════════════════

-- 4.1 ¿Se exige la modalidad? (lo cambia la 223)
create or replace function p50_priv.exigir_modalidad() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.exigir_modalidad from p50_priv.config c where c.id), false)
$$;

-- 4.2 Reparto exacto en centavos: mayor resto; el centavo sobrante va a la fila
-- de menor posición. Pesos <= 0 no reciben nada.
create or replace function p50_priv.repartir(p_total bigint, p_pesos bigint[]) returns bigint[]
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  n int := coalesce(array_length(p_pesos, 1), 0);
  v_sum numeric := 0;
  v_out bigint[] := '{}';
  v_resto numeric[] := '{}';
  v_asignado bigint := 0;
  v_falta bigint;
  v_val numeric;
  v_mejor int;
  i int;
  j int;
begin
  if n = 0 then return '{}'; end if;
  if coalesce(p_total, 0) <= 0 then return array_fill(0::bigint, array[n]); end if;
  for i in 1..n loop
    v_sum := v_sum + greatest(coalesce(p_pesos[i], 0), 0);
  end loop;
  if v_sum = 0 then return array_fill(0::bigint, array[n]); end if;
  for i in 1..n loop
    v_val := p_total::numeric * greatest(coalesce(p_pesos[i], 0), 0)::numeric;
    v_out := v_out || floor(v_val / v_sum)::bigint;
    v_resto := v_resto || (v_val - floor(v_val / v_sum) * v_sum);
    v_asignado := v_asignado + v_out[i];
  end loop;
  v_falta := p_total - v_asignado;
  while v_falta > 0 loop
    v_mejor := 0;
    for j in 1..n loop
      if coalesce(p_pesos[j], 0) > 0 and (v_mejor = 0 or v_resto[j] > v_resto[v_mejor]) then
        v_mejor := j;
      end if;
    end loop;
    exit when v_mejor = 0;
    v_out[v_mejor] := v_out[v_mejor] + 1;
    v_resto[v_mejor] := -1;
    v_falta := v_falta - 1;
  end loop;
  return v_out;
end $$;

-- 4.3 Roles. Los que pueden fijar NETO y los que autorizan bajar de un piso.
create or replace function p50_priv.rol_fija_neto(p_rol text) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(p_rol in ('superadmin', 'gerencia', 'administracion', 'operaciones'), false)
$$;
-- Espejo de ROLES_EXCEPCION_MARGEN (lib/contrato/margenContrato.ts) para el 6 %;
-- solo superadmin para el 2 % de solo tiquetes.
create or replace function p50_priv.rol_autoriza_margen(p_rol text, p_solo_tiquetes boolean) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(case when p_solo_tiquetes then p_rol = 'superadmin'
                       else p_rol in ('superadmin', 'administracion') end, false)
$$;

-- 4.4 Evaluación del margen sobre el TOTAL (espejo de `evaluarMargenContrato`,
-- modo neto, en enteros). 6 %: (NETO + 0,5) x 0,94 >= costos (tolerancia de
-- medio peso = 50 centavos). 2 % de solo tiquetes: EXACTO, NETO x 0,98 >= costos.
create or replace function p50_priv.evaluar_margen(p_neto bigint, p_costos bigint, p_solo boolean) returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object(
    'piso_bps', case when p_solo then 200 else 600 end,
    'costo_cero', coalesce(p_costos, 0) <= 0,
    'bajo_costo', coalesce(p_costos, 0) > 0 and p_neto < p_costos,
    'cumple', case
                when coalesce(p_costos, 0) <= 0 then false
                when p_solo then p_neto::numeric * 9800 >= p_costos::numeric * 10000
                else (p_neto + 50)::numeric * 9400 >= p_costos::numeric * 10000
              end,
    'margen', case when p_neto > 0 then round((p_neto - coalesce(p_costos, 0))::numeric / p_neto, 6) else 0 end
  )
$$;

-- 4.5 Cálculo del NETO de una hija (todo en centavos). `p_rec_ali` es la
-- participación del aliado en el recobro tal como la declaró la cotización
-- (después de sellar el payload queda en 0, por eso se guarda aparte).
create or replace function p50_priv.calcular(p_cot bigint, p_reconoce boolean, p_pct numeric, p_rec_ali numeric)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  v_precio bigint;
  v_t bigint := 0;
  v_r bigint;
  v_n bigint;
  v_rec_ali bigint;
  v_costos bigint;
  v_base bigint;
  v_ord bigint;
  v_part bigint;
  v_d bigint;
  v_neto bigint;
  v_suma_pesos bigint := 0;
  r record;
  i int;
  k int;
  n_rows int := 0;
  n_tick int := 0;
  v_ord_arr int[] := '{}';
  v_srv bigint[] := '{}';
  v_tip text[] := '{}';
  v_pvp bigint[] := '{}';
  v_pesos bigint[] := '{}';
  v_pos int[] := '{}';
  v_shares bigint[];
  v_desc bigint[];
  v_filas jsonb := '[]'::jsonb;
begin
  select * into c from public.cotizaciones where id = p_cot;
  if not found then
    raise exception 'COMPARATIVA_DATOS: la cotización % no existe.', p_cot using errcode = 'P0001';
  end if;
  v_precio := round(coalesce(c.precio_venta, 0) * 100)::bigint;
  v_r := round(greatest(coalesce((c.payload->>'recobro')::numeric, 0), 0) * 100)::bigint;
  v_n := round(greatest(floor(coalesce((c.payload->>'ninos')::numeric, 0)), 0)
               * greatest(coalesce((c.payload->>'tarifaNino')::numeric, 0), 0) * 100)::bigint;
  v_rec_ali := least(round(greatest(coalesce(p_rec_ali, 0), 0) * 100)::bigint, v_r);
  select coalesce(sum(round(coalesce(s.costo_neto, 0) * 100)), 0)::bigint into v_costos
    from public.cotizacion_servicios s where s.cotizacion_id = p_cot;

  -- Filas de servicio con valor > 0, en el mismo orden que p39_priv.componentes_manual.
  for r in
    select (row_number() over (order by s.orden, s.id) - 1)::int as ord, s.id as sid, s.tipo_servicio as tip,
           round(s.valor * 100)::bigint as v
      from public.cotizacion_servicios s
     where s.cotizacion_id = p_cot and coalesce(s.valor, 0) > 0
     order by s.orden, s.id
  loop
    n_rows := n_rows + 1;
    v_ord_arr := v_ord_arr || r.ord;
    v_srv := v_srv || r.sid;
    v_tip := v_tip || r.tip;
    v_pvp := v_pvp || r.v;
    if r.tip = 'aereo' then
      v_t := v_t + r.v;
      n_tick := n_tick + 1;
    end if;
  end loop;

  -- Unidades sobre las que se reparte la comisión ordinaria: filas no-tiquete,
  -- niños (si hay) y recobro (solo si NO se reconoce la participación).
  for i in 1..n_rows loop
    if v_tip[i] <> 'aereo' then
      v_pesos := v_pesos || v_pvp[i];
      v_pos := v_pos || i;
    end if;
  end loop;
  if v_n > 0 then
    v_pesos := v_pesos || v_n;
    v_pos := v_pos || 0;
  end if;
  if not coalesce(p_reconoce, false) and v_r > 0 then
    v_pesos := v_pesos || v_r;
    v_pos := v_pos || (-1);
  end if;
  for i in 1..coalesce(array_length(v_pesos, 1), 0) loop
    v_suma_pesos := v_suma_pesos + v_pesos[i];
  end loop;

  v_base := greatest(v_precio - v_t - case when coalesce(p_reconoce, false) then v_r else 0 end, 0);
  if v_suma_pesos > 0 and coalesce(p_pct, 0) > 0 then
    -- Mismo redondeo que #30 (`Math.round(base x pct)` / `round(v_base * v_pct)`): a la unidad de moneda.
    v_ord := (round(v_base::numeric / 100 * p_pct) * 100)::bigint;
  else
    v_ord := 0;
  end if;
  v_part := case when coalesce(p_reconoce, false) then v_rec_ali else 0 end;
  v_d := v_ord + v_part;
  v_neto := v_precio - v_d;

  v_shares := p50_priv.repartir(v_ord, v_pesos);
  if n_rows > 0 then v_desc := array_fill(0::bigint, array[n_rows]); end if;
  for k in 1..coalesce(array_length(v_pesos, 1), 0) loop
    if v_pos[k] > 0 then v_desc[v_pos[k]] := v_shares[k]; end if;
  end loop;
  for i in 1..n_rows loop
    v_filas := v_filas || jsonb_build_object(
      'orden', v_ord_arr[i], 'servicio_id', v_srv[i], 'tipo', v_tip[i],
      'pvp', v_pvp[i], 'descuento', v_desc[i], 'neto', v_pvp[i] - v_desc[i]);
  end loop;

  return jsonb_build_object(
    'precio', v_precio, 'tiquetes', v_t, 'recobro', v_r, 'ninos', v_n, 'rec_ali', v_rec_ali,
    'base', v_base, 'ordinaria', v_ord, 'participacion', v_part, 'descuento', v_d, 'neto', v_neto,
    'costos', v_costos, 'solo_tiquetes', (n_rows > 0 and n_tick = n_rows), 'filas', v_filas);
end $$;

-- 4.6 Sellar la hija recién creada (misma transacción que `crear_hija`).
create or replace function p50_priv.sellar_hija(
  p_hija bigint, p_modalidad text, p_reconoce boolean, p_autorizar boolean, p_actor uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h public.cotizaciones;
  u public.usuarios;
  a public.aliados;
  v_tipo text;
  v_moneda text;
  v_pct numeric;
  v_param numeric;
  v_rec_ali numeric;
  k jsonb;
  ev jsonb;
  v_solo boolean;
  v_neto bigint;
  v_costos bigint;
  v_autorizado boolean := false;
begin
  select * into h from public.cotizaciones where id = p_hija for update;
  if not found or h.cotizacion_origen_id is null or h.tipo is distinct from 'manual' then
    raise exception 'COMPARATIVA_DATOS: la modalidad PVP/NETO solo aplica a la cotización elegida de una comparativa manual.' using errcode = 'P0001';
  end if;
  if p_modalidad is null or p_modalidad not in ('pvp', 'neto') then
    raise exception 'COMPARATIVA_DATOS: la modalidad debe ser PVP o NETO.' using errcode = 'P0001';
  end if;
  select * into u from public.usuarios where id = p_actor;
  if not found or u.activo is not true
     or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta')
     or (u.rol <> 'superadmin' and u.tenant is distinct from h.tenant) then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
  end if;
  if exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = p_hija) then
    raise exception 'COMPARATIVA_DATOS: la modalidad de esta cotización ya está fijada.' using errcode = 'P0001';
  end if;
  v_tipo := coalesce(nullif(h.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo not in ('interno', 'agencia', 'freelance') then
    raise exception 'COMPARATIVA_DATOS: el tipo de venta de la cotización no es válido.' using errcode = 'P0001';
  end if;
  v_moneda := coalesce(nullif(h.moneda, ''), 'COP');

  -- B2C: solo PVP; el sello deja constancia de que se eligió.
  if v_tipo = 'interno' then
    if p_modalidad = 'neto' then
      raise exception 'COMPARATIVA_DATOS: el precio NETO solo aplica a ventas de una agencia o freelance del catálogo.' using errcode = 'P0001';
    end if;
    insert into public.cotizacion_neto (cotizacion_id, tenant, modalidad, aliado_id, tipo_asesor, moneda, pvp_total, creado_por_id)
    values (p_hija, h.tenant, 'pvp', null, 'interno', v_moneda, h.precio_venta, p_actor);
    return;
  end if;

  -- B2B sin aliado del catálogo (Q-5): PVP se permite SIN sellar (comportamiento de hoy,
  -- Q-4: la hija sigue legada y la 198 hace lo de siempre); solo NETO exige aliado.
  if h.aliado_id is null then
    if p_modalidad = 'pvp' then
      return;
    end if;
    raise exception 'COMPARATIVA_DATOS: el precio NETO necesita la agencia o freelance del catálogo; la comparativa no lo trae. Usa PVP o enlaza el aliado.' using errcode = 'P0001';
  end if;
  -- B2B con aliado: se verifica contra la base (no contra nombres).
  select * into a from public.aliados where id = h.aliado_id;
  if not found then
    raise exception 'COMPARATIVA_DATOS: el aliado de la cotización no existe en el catálogo.' using errcode = 'P0001';
  end if;
  if a.tipo is not null and lower(a.tipo) not like '%' || (case v_tipo when 'agencia' then 'agencia' else 'free' end) || '%' then
    raise exception 'COMPARATIVA_DATOS: el aliado es de otro tipo que la venta.' using errcode = 'P0001';
  end if;

  if p_modalidad = 'pvp' then
    insert into public.cotizacion_neto (cotizacion_id, tenant, modalidad, aliado_id, tipo_asesor, moneda, pvp_total, creado_por_id)
    values (p_hija, h.tenant, 'pvp', a.id, v_tipo, v_moneda, h.precio_venta, p_actor);
    return;
  end if;

  -- ── NETO ────────────────────────────────────────────────────────────────
  if not p50_priv.rol_fija_neto(u.rol::text) then
    raise exception 'COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones.' using errcode = 'P0001';
  end if;
  if p_reconoce is null then
    raise exception 'COMPARATIVA_DATOS: indica si se reconoce la participación del aliado en el recobro.' using errcode = 'P0001';
  end if;

  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v_tipo = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  -- A 4 decimales (la columna es numeric(5,4)): lo que se calcula es lo que queda sellado.
  v_pct := round(coalesce(a.pct_comision, v_param, case when v_tipo = 'agencia' then 0.12 else 0.11 end), 4);
  v_rec_ali := greatest(coalesce((h.payload->>'recobroAliado')::numeric, 0), 0);

  k := p50_priv.calcular(p_hija, p_reconoce, v_pct, v_rec_ali);
  v_neto := (k->>'neto')::bigint;
  v_costos := (k->>'costos')::bigint;
  v_solo := (k->>'solo_tiquetes')::boolean;

  if (k->>'descuento')::bigint <= 0 then
    raise exception 'COMPARATIVA_DATOS: con descuento 0 no hay precio NETO; esta venta se hace a PVP.' using errcode = 'P0001';
  end if;
  ev := p50_priv.evaluar_margen(v_neto, v_costos, v_solo);
  if (ev->>'costo_cero')::boolean then
    raise exception 'COMPARATIVA_DATOS: el costo total de la cotización es 0; no se puede fijar un precio NETO.' using errcode = 'P0001';
  end if;
  if (ev->>'bajo_costo')::boolean then
    raise exception 'COMPARATIVA_DATOS: el total NETO (%) queda por debajo del costo total (%); no se autoriza para ningún rol.',
      round(v_neto / 100.0), round(v_costos / 100.0) using errcode = 'P0001';
  end if;
  if not (ev->>'cumple')::boolean then
    if not coalesce(p_autorizar, false) then
      raise exception 'COMPARATIVA_DATOS: el total NETO (%) no cubre el margen mínimo del % % con costos de % (margen actual: % %). Requiere autorización de %.',
        round(v_neto / 100.0), (ev->>'piso_bps')::int / 100, '%', round(v_costos / 100.0),
        round((ev->>'margen')::numeric * 100, 2), '%',
        case when v_solo then 'superadmin' else 'superadmin o administración' end using errcode = 'P0001';
    end if;
    if not p50_priv.rol_autoriza_margen(u.rol::text, v_solo) then
      raise exception 'COMPARATIVA_DATOS: tu rol no puede autorizar un margen por debajo del mínimo; lo autoriza %.',
        case when v_solo then 'superadmin' else 'superadmin o administración' end using errcode = 'P0001';
    end if;
    v_autorizado := true;
  end if;

  insert into public.cotizacion_neto (
    cotizacion_id, tenant, modalidad, reconoce_recobro, aliado_id, tipo_asesor, moneda, pvp_total,
    tiquetes, recobro, ninos_total, recobro_aliado_original, base_comision, pct_comision,
    comision_ordinaria, participacion_recobro, descuento_total, neto_total, costo_total, margen, piso,
    solo_tiquetes, autorizado_por, autorizado_rol, autorizado_en, creado_por_id)
  values (
    p_hija, h.tenant, 'neto', p_reconoce, a.id, v_tipo, v_moneda, (k->>'precio')::numeric / 100,
    (k->>'tiquetes')::numeric / 100, (k->>'recobro')::numeric / 100, (k->>'ninos')::numeric / 100,
    v_rec_ali, (k->>'base')::numeric / 100, v_pct,
    (k->>'ordinaria')::numeric / 100, (k->>'participacion')::numeric / 100, (k->>'descuento')::numeric / 100,
    v_neto::numeric / 100, v_costos::numeric / 100, (ev->>'margen')::numeric, (ev->>'piso_bps')::numeric / 10000,
    v_solo, case when v_autorizado then p_actor end, case when v_autorizado then u.rol::text end,
    case when v_autorizado then now() end, p_actor);

  insert into public.cotizacion_neto_componentes (cotizacion_id, orden, servicio_id, tipo_servicio, pvp, descuento, neto)
  select p_hija, (f->>'orden')::int, (f->>'servicio_id')::bigint, f->>'tipo',
         (f->>'pvp')::numeric / 100, (f->>'descuento')::numeric / 100, (f->>'neto')::numeric / 100
    from jsonb_array_elements(k->'filas') f;

  -- La participación ya va DENTRO del descuento: la 198 no debe crear la fila de
  -- recobro pendiente (sería pagarla dos veces).
  update public.cotizaciones
     set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{recobroAliado}', '0'::jsonb, true)
   where id = p_hija;
end $$;

-- 4.7 ¿El recibo/elección repite la modalidad ya sellada? (reintentos con la misma clave)
create or replace function p50_priv.modalidad_coincide(p_hija bigint, p_modalidad text, p_reconoce boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_modalidad is null then not exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = p_hija)
    else exists (select 1 from public.cotizacion_neto n
                  where n.cotizacion_id = p_hija and n.modalidad = p_modalidad
                    and (p_modalidad <> 'neto' or n.reconoce_recobro is not distinct from p_reconoce))
      -- Q-5: PVP de una venta B2B sin aliado del catálogo no deja sello (queda legada).
      or (p_modalidad = 'pvp'
          and not exists (select 1 from public.cotizacion_neto n where n.cotizacion_id = p_hija)
          and exists (select 1 from public.cotizaciones h
                       where h.id = p_hija and h.tipo = 'manual' and h.cotizacion_origen_id is not null
                         and h.aliado_id is null
                         and coalesce(nullif(h.payload->>'tipoAsesor', ''), 'interno') <> 'interno'))
  end
$$;

-- 4.8 ¿La hija es de una venta B2B CON aliado del catálogo y por tanto requiere modalidad cuando se exige?
create or replace function p50_priv.requiere_modalidad(p_hija bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.cotizaciones h
                  where h.id = p_hija and h.tipo = 'manual' and h.cotizacion_origen_id is not null
                    and h.aliado_id is not null  -- Q-5: sin aliado del catálogo solo cabe PVP, que no se exige ni se sella
                    and coalesce(nullif(h.payload->>'tipoAsesor', ''), 'interno') <> 'interno')
$$;

-- 4.9 Comparación del snapshot del primer pago con el reparto NETO sellado.
-- Mismas filas que `p39_priv.componentes_manual`, con el valor NETO; el PVP
-- sellado debe seguir igual al de los servicios (integridad).
create or replace function p50_priv.composicion_neto_coincide(p_cot bigint, p_snapshot jsonb) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  with esp as (
    select m.orden, m.tipo_componente, m.referencia_externa, round(n.neto, 2) as valor_componente
      from p39_priv.componentes_manual(p_cot) m
      join public.cotizacion_neto_componentes n on n.cotizacion_id = p_cot and n.orden = m.orden
     where round(n.pvp, 2) = m.valor_componente
  ), rec as (
    select (r->>'orden')::integer as orden,
           r->>'tipo_componente' as tipo_componente,
           nullif(r->>'referencia_externa', '') as referencia_externa,
           round(coalesce((r->>'valor_componente')::numeric, 0), 2) as valor_componente
      from jsonb_array_elements(case when jsonb_typeof(p_snapshot) = 'array' then p_snapshot else '[]'::jsonb end) r
  )
  select coalesce(jsonb_typeof(p_snapshot) = 'array', false)
     and (select count(*) from esp) = (select count(*) from p39_priv.componentes_manual(p_cot))
     and (select count(*) from esp) = (select count(*) from rec)
     and not exists (select * from esp except select * from rec)
     and not exists (select * from rec except select * from esp)
$$;

-- 4.10 Validaciones previas a la 198 (nada de esto consume consecutivo).
create or replace function p50_priv.validar_conversion(p_cot bigint, p_usuario uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  n public.cotizacion_neto;
  a public.aliados;
  v_rol text;
  v_actor_tenant text;
  v_tipo text;
  k jsonb;
  ev jsonb;
  v_filas int;
  v_iguales int;
begin
  select * into c from public.cotizaciones where id = p_cot;
  select * into n from public.cotizacion_neto where cotizacion_id = p_cot;
  if not found then
    return;  -- hija legada o B2C sin sello: no hay nada que validar (la identidad se completa después si existe).
  end if;
  v_rol := public._autorizado_pago_previo(p_usuario);
  select u.tenant into v_actor_tenant from public.usuarios u where u.id = p_usuario;
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from c.tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', c.tenant using errcode = '42501';
  end if;
  v_tipo := coalesce(nullif(c.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo is distinct from n.tipo_asesor then
    raise exception 'NETO: el tipo de venta de la cotización cambió desde que se fijó la modalidad.' using errcode = 'P0001';
  end if;
  if v_tipo <> 'interno' then
    if c.aliado_id is null or c.aliado_id is distinct from n.aliado_id then
      raise exception 'NETO: el aliado de la cotización no coincide con el de la modalidad fijada.' using errcode = 'P0001';
    end if;
    select * into a from public.aliados where id = n.aliado_id;
    if not found then
      raise exception 'NETO: el aliado de la cotización ya no existe en el catálogo.' using errcode = 'P0001';
    end if;
    if a.tipo is not null and lower(a.tipo) not like '%' || (case v_tipo when 'agencia' then 'agencia' else 'free' end) || '%' then
      raise exception 'NETO: el aliado es de otro tipo que la venta.' using errcode = 'P0001';
    end if;
  end if;
  if n.modalidad <> 'neto' then
    return;
  end if;

  -- Integridad: se recalcula con lo sellado (porcentaje y participación originales).
  k := p50_priv.calcular(p_cot, n.reconoce_recobro, n.pct_comision, n.recobro_aliado_original);
  if (k->>'neto')::numeric / 100 is distinct from n.neto_total
     or (k->>'descuento')::numeric / 100 is distinct from n.descuento_total
     or (k->>'costos')::numeric / 100 is distinct from n.costo_total
     or (k->>'precio')::numeric / 100 is distinct from n.pvp_total then
    raise exception 'NETO: la cotización no coincide con el precio NETO fijado; no se puede convertir.' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where nc.pvp is not null and round(nc.pvp * 100) = (f->>'pvp')::numeric
                                       and round(nc.descuento * 100) = (f->>'descuento')::numeric)
    into v_filas, v_iguales
    from jsonb_array_elements(k->'filas') f
    left join public.cotizacion_neto_componentes nc on nc.cotizacion_id = p_cot and nc.orden = (f->>'orden')::int;
  if v_filas <> v_iguales
     or v_filas <> (select count(*) from public.cotizacion_neto_componentes nc2 where nc2.cotizacion_id = p_cot) then
    raise exception 'NETO: el reparto por servicio no coincide con el precio NETO fijado; no se puede convertir.' using errcode = 'P0001';
  end if;

  -- Margen y piso absoluto, otra vez, ANTES de numerar.
  ev := p50_priv.evaluar_margen(round(n.neto_total * 100)::bigint, round(n.costo_total * 100)::bigint, n.solo_tiquetes);
  if (ev->>'costo_cero')::boolean or (ev->>'bajo_costo')::boolean then
    raise exception 'NETO: el total NETO no cubre el costo total; no se puede convertir.' using errcode = 'P0001';
  end if;
  if not (ev->>'cumple')::boolean
     and (n.autorizado_por is null or not p50_priv.rol_autoriza_margen(n.autorizado_rol, n.solo_tiquetes)) then
    raise exception 'NETO: el margen está por debajo del mínimo y no hay una autorización registrada; no se puede convertir.' using errcode = 'P0001';
  end if;
  if c.precio_total_congelado is distinct from n.neto_total then
    raise exception 'NETO: el total congelado de la cotización no es el precio NETO; no se puede convertir.' using errcode = 'P0001';
  end if;
end $$;

-- 4.11 Después de la 198, en la MISMA transacción: identidad del aliado (PVP y
-- NETO, sellada o legada con aliado) y forma NETO del contrato.
create or replace function p50_priv.completar_conversion(p_cot bigint, p_numero text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones;
  n public.cotizacion_neto;
  a public.aliados;
  v_tipo text;
  v_aliado bigint;
  v_sellada boolean;
begin
  select * into c from public.cotizaciones where id = p_cot;
  select * into n from public.cotizacion_neto where cotizacion_id = p_cot;
  v_sellada := found;
  v_tipo := coalesce(nullif(c.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo not in ('agencia', 'freelance') then
    return;
  end if;
  v_aliado := case when v_sellada then n.aliado_id else c.aliado_id end;
  if v_aliado is null then
    return;  -- legada sin aliado: se mantiene el comportamiento de siempre (Q-4).
  end if;
  select * into a from public.aliados where id = v_aliado;
  if not found
     or (a.tipo is not null and lower(a.tipo) not like '%' || (case v_tipo when 'agencia' then 'agencia' else 'free' end) || '%') then
    if v_sellada then
      raise exception 'NETO: el aliado de la cotización no es válido; se revierte la conversión.' using errcode = 'P0001';
    end if;
    return;  -- legada: no se propaga un aliado dudoso.
  end if;

  update public.ventas
     set aliado_id = a.id,
         tipo_asesor = v_tipo,
         agencia_nombre = case when v_tipo = 'agencia' then a.nombre else agencia_nombre end,
         freelance_nombre = case when v_tipo = 'freelance' then a.nombre else freelance_nombre end,
         updated_at = now()
   where numero_contrato = p_numero;
  -- La fila de recobro que crea la 198 en PVP (si hay) queda enlazada al aliado.
  update public.aliados_b2b set aliado_id = a.id
   where numero_contrato = p_numero and aliado_id is null;

  if v_sellada and n.modalidad = 'neto' then
    update public.ventas
       set precio_venta = n.neto_total,
           modo_compra = 'neta',
           comision_b2b = n.descuento_total,
           comision_estado = 'descontada',
           updated_at = now()
     where numero_contrato = p_numero;
    if not found then
      raise exception 'NETO: no se encontró el contrato % recién creado.', p_numero using errcode = 'P0001';
    end if;
    insert into public.aliados_b2b (
      numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
      precio_venta, base_comision, base_explicita, pct_comision, comision_valor,
      recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion,
      estado, descontada_en_precio
    ) values (
      p_numero, c.tenant, a.nombre, a.nit, v_tipo, a.id,
      n.pvp_total, n.base_comision, true, n.pct_comision, n.descuento_total,
      0, 0, false, 0,
      'pagada', true
    );
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Funciones públicas.
-- ═════════════════════════════════════════════════════════════════════════

-- 5.1 Recibo de validación con modalidad (solo canal interno). Envuelve la de
-- la 211 sin copiarla y deja la modalidad en el recibo (no entra en su huella:
-- el reintento lo compara `modalidad_coincide`).
create or replace function public.registrar_validacion_comparativa_n50(
  p_madre_id bigint, p_opcion_ref text, p_acomodacion_ref text, p_version integer,
  p_canal text, p_actor_id uuid, p_precio_reliquidado numeric, p_moneda text,
  p_disponibilidad_ok boolean, p_datos_cliente jsonb,
  p_modalidad text, p_reconoce boolean, p_autorizar boolean
) returns uuid
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_id uuid;
  u public.usuarios;
begin
  if p_modalidad is not null then
    if p_modalidad not in ('pvp', 'neto') then
      raise exception 'COMPARATIVA_DATOS: la modalidad debe ser PVP o NETO.' using errcode = 'P0001';
    end if;
    if p_canal is distinct from 'interno' then
      raise exception 'COMPARATIVA_DATOS: la modalidad solo la fija el personal interno.' using errcode = 'P0001';
    end if;
    select * into u from public.usuarios where id = p_actor_id;
    if not found or u.activo is not true or u.rol not in ('superadmin', 'gerencia', 'administracion', 'operaciones', 'venta') then
      raise exception 'COMPARATIVA_NO_AUTORIZADO: no tienes permiso para esta cotización.' using errcode = '42501';
    end if;
    if p_modalidad = 'neto' then
      if not p50_priv.rol_fija_neto(u.rol::text) then
        raise exception 'COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones.' using errcode = 'P0001';
      end if;
      if p_reconoce is null then
        raise exception 'COMPARATIVA_DATOS: indica si se reconoce la participación del aliado en el recobro.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_id := public.registrar_validacion_comparativa(p_madre_id, p_opcion_ref, p_acomodacion_ref, p_version, p_canal,
            p_actor_id, p_precio_reliquidado, p_moneda, p_disponibilidad_ok, p_datos_cliente);

  if p_modalidad is not null then
    update public.cotizacion_comparativa_validaciones
       set modalidad = p_modalidad,
           reconoce_recobro = case when p_modalidad = 'neto' then p_reconoce else null end,
           autorizar_margen = coalesce(p_autorizar, false)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- 5.2 Elegir con sesión (211:904) — mismo cuerpo, más: reintento que compara la
-- modalidad y sellado de la hija si el recibo la trae.
create or replace function public.elegir_opcion_comparativa_sesion(p_validacion uuid, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  r public.cotizacion_comparativa_validaciones; v_uid uuid := auth.uid(); v_hija bigint; v_prev public.cotizacion_comparativa_eventos;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into r from public.cotizacion_comparativa_validaciones where id = p_validacion for update;
  if not found or r.canal = 'publico' or r.actor_id is distinct from v_uid then
    raise exception 'COMPARATIVA_RECIBO: recibo inválido.' using errcode = 'P0001';
  end if;
  -- Identidad y propiedad releídas desde la base con auth.uid() (no desde el recibo),
  -- ANTES de cualquier respuesta: tampoco un reintento devuelve datos a quien ya no puede actuar.
  if r.canal = 'interno' then
    perform f211_priv.interno_activo(v_uid, r.tenant);
  else
    perform f211_priv.b2b_propietario(v_uid, r.cotizacion_id);
  end if;
  if r.consumida_en is not null then
    if r.clave = p_clave then return r.hija_id; end if;
    raise exception 'COMPARATIVA_RECIBO: el recibo ya fue usado.' using errcode = 'P0001';
  end if;
  if r.expira_en <= now() then
    raise exception 'COMPARATIVA_RECIBO: el recibo venció; vuelve a intentarlo.' using errcode = 'P0001';
  end if;
  -- Idempotencia por clave de madre (otro recibo, misma clave → misma hija o rechazo).
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = r.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then
    if v_prev.huella = r.huella and p50_priv.modalidad_coincide(v_prev.hija_id, r.modalidad, r.reconoce_recobro) then
      return v_prev.hija_id;
    end if;
    raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
  end if;
  v_hija := f211_priv.crear_hija(r.cotizacion_id, r.opcion_ref, r.acomodacion_ref, r.version, r.canal,
                                 v_uid, r.id, null, p_clave, r.huella, null);
  if r.modalidad is not null then
    perform p50_priv.sellar_hija(v_hija, r.modalidad, r.reconoce_recobro, r.autorizar_margen, v_uid);
  elsif p50_priv.exigir_modalidad() and p50_priv.requiere_modalidad(v_hija) then
    raise exception 'COMPARATIVA_DATOS: elige la modalidad de la venta B2B (PVP o NETO) antes de continuar.' using errcode = 'P0001';
  end if;
  update public.cotizacion_comparativa_validaciones
     set consumida_en = now(), hija_id = v_hija, clave = p_clave, datos_cliente = null
   where id = r.id;
  return v_hija;
end $$;

-- 5.3 Resolver una solicitud (211:1094) — cuerpo único en `p50_priv.resolver_impl`;
-- la firma vieja delega sin modalidad (PVP de siempre) y la nueva la recibe.
create or replace function p50_priv.resolver_impl(
  p_solicitud bigint, p_decision text, p_motivo text, p_clave text,
  p_modalidad text, p_reconoce boolean, p_autorizar boolean
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
declare
  v_uid uuid := auth.uid(); sol public.cotizacion_comparativa_solicitudes; c public.cotizaciones;
  v_hija bigint; v_prev public.cotizacion_comparativa_eventos; v_cot bigint;
begin
  if v_uid is null then
    raise exception 'COMPARATIVA_NO_AUTORIZADO: inicia sesión para continuar.' using errcode = '42501';
  end if;
  perform f211_priv.purgar_ip_huella();
  -- ORDEN DE BLOQUEOS ÚNICO en toda la comparativa: MADRE primero, luego solicitud
  -- (así lo hacen registrar_solicitud y crear_hija). Bloquear primero la solicitud
  -- provocaba un deadlock entre dos confirmaciones de solicitudes distintas.
  select cotizacion_id into v_cot from public.cotizacion_comparativa_solicitudes where id = p_solicitud;
  if v_cot is null then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  select * into c from public.cotizaciones where id = v_cot for update;
  select * into sol from public.cotizacion_comparativa_solicitudes where id = p_solicitud for update;
  if not found then
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud no existe.' using errcode = 'P0001';
  end if;
  perform f211_priv.interno_activo(v_uid, sol.tenant);
  if p_decision not in ('confirmar', 'rechazar') then
    raise exception 'COMPARATIVA_DATOS: decisión inválida.' using errcode = 'P0001';
  end if;
  if p_modalidad is not null and p_modalidad not in ('pvp', 'neto') then
    raise exception 'COMPARATIVA_DATOS: la modalidad debe ser PVP o NETO.' using errcode = 'P0001';
  end if;
  if sol.estado <> 'pendiente' then
    if p_decision = 'confirmar' and sol.estado = 'atendida' and sol.hija_id is not null then
      if p50_priv.modalidad_coincide(sol.hija_id, p_modalidad, p_reconoce) then return sol.hija_id; end if;
      raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
    end if;
    raise exception 'COMPARATIVA_NO_DISPONIBLE: la solicitud ya fue resuelta.' using errcode = 'P0001';
  end if;
  if p_decision = 'rechazar' then
    update public.cotizacion_comparativa_solicitudes
       set estado = 'rechazada', verificada_por = v_uid, motivo = left(p_motivo, 300), ip_huella = null, atendida_en = now()
     where id = sol.id;
    insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, actor_tipo, actor_id)
    values (sol.cotizacion_id, sol.tenant, 'solicitud_rechazada', sol.id, 'interno', v_uid);
    return null;
  end if;
  -- Confirmar: vencimiento efectivo (72 h o vigencia de la madre).
  if sol.created_at < now() - interval '72 hours' then
    raise exception 'COMPARATIVA_VENCIDA: la solicitud venció (72 h).' using errcode = 'P0001';
  end if;
  if p_clave is null or length(p_clave) < 8 or length(p_clave) > 80 then
    raise exception 'COMPARATIVA_DATOS: clave de idempotencia inválida.' using errcode = 'P0001';
  end if;
  select * into v_prev from public.cotizacion_comparativa_eventos
   where cotizacion_id = sol.cotizacion_id and tipo = 'elegida' and clave = p_clave;
  if found then
    if p50_priv.modalidad_coincide(v_prev.hija_id, p_modalidad, p_reconoce) then return v_prev.hija_id; end if;
    raise exception 'COMPARATIVA_CLAVE: la clave ya se usó con otros datos.' using errcode = 'P0001';
  end if;
  if p_modalidad = 'neto' then
    -- Falla temprano y con claridad, antes de crear nada (sellar_hija lo vuelve a exigir).
    if not exists (select 1 from public.usuarios u where u.id = v_uid and p50_priv.rol_fija_neto(u.rol::text)) then
      raise exception 'COMPARATIVA_DATOS: tu rol no puede fijar el precio NETO; pídeselo a gerencia, administración u operaciones.' using errcode = 'P0001';
    end if;
  end if;
  v_hija := f211_priv.crear_hija(sol.cotizacion_id, sol.opcion_ref, sol.acomodacion_ref, sol.version, 'interno',
              v_uid, null, sol.id, p_clave,
              encode(sha256(convert_to(concat_ws('|', sol.id, sol.opcion_ref, sol.acomodacion_ref, v_uid), 'UTF8')), 'hex'), null);
  if p_modalidad is not null then
    perform p50_priv.sellar_hija(v_hija, p_modalidad, p_reconoce, p_autorizar, v_uid);
  elsif p50_priv.exigir_modalidad() and p50_priv.requiere_modalidad(v_hija) then
    raise exception 'COMPARATIVA_DATOS: elige la modalidad de la venta B2B (PVP o NETO) antes de confirmar.' using errcode = 'P0001';
  end if;
  update public.cotizacion_comparativa_solicitudes
     set estado = 'atendida', hija_id = v_hija, verificada_por = v_uid, ip_huella = null, atendida_en = now()
   where id = sol.id;
  insert into public.cotizacion_comparativa_eventos (cotizacion_id, tenant, tipo, solicitud_id, hija_id, actor_tipo, actor_id)
  values (sol.cotizacion_id, sol.tenant, 'solicitud_atendida', sol.id, v_hija, 'interno', v_uid);
  return v_hija;
end $$;

create or replace function public.resolver_solicitud_comparativa(p_solicitud bigint, p_decision text, p_motivo text, p_clave text)
returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
begin
  return p50_priv.resolver_impl(p_solicitud, p_decision, p_motivo, p_clave, null, null, false);
end $$;

create or replace function public.resolver_solicitud_comparativa_n50(
  p_solicitud bigint, p_decision text, p_motivo text, p_clave text,
  p_modalidad text, p_reconoce boolean, p_autorizar boolean
) returns bigint
language plpgsql security definer set search_path = public, pg_temp set lock_timeout = '10s' as $$
begin
  return p50_priv.resolver_impl(p_solicitud, p_decision, p_motivo, p_clave, p_modalidad, p_reconoce, p_autorizar);
end $$;

-- 5.4 Wrapper de pago (216:833) — misma firma; la rama PVP/legada es idéntica.
create or replace function public.registrar_pago_previo_rev(
  p_cotizacion_id bigint, p_valor numeric, p_moneda text, p_trm numeric, p_forma_pago text, p_referencia text,
  p_fecha_pago date, p_usuario_id uuid, p_idempotency_key text, p_rev_esperada integer,
  p_snapshot jsonb default null, p_exigido_total_moneda numeric default null, p_pct_efectivo numeric default null
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tenant text;
  v_tipo text;
  v_modo text;
  v_rev integer;
  v_congelada timestamptz;
  v_rol text;
  v_actor_tenant text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_aut bigint;
  v_res text;
  v_mod text;
  v_neto numeric;
begin
  select c.tenant, c.tipo, c.modo, c.economico_rev, c.condicion_pago_congelada_en
    into v_tenant, v_tipo, v_modo, v_rev, v_congelada
    from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select u.tenant into v_actor_tenant from public.usuarios u where u.id = p_usuario_id;
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant using errcode = '42501';
  end if;
  if v_tipo is distinct from 'manual' or v_modo is distinct from 'simple' then
    raise exception 'Los pagos previos solo aplican a cotizaciones dinámicas.' using errcode = 'P0001';
  end if;
  -- Reintento con una clave ya usada: la 198 devuelve el pago original SIN escribir
  -- (o rechaza si cambió algún dato). No necesita autorización.
  if v_key is not null and exists (select 1 from public.cotizacion_pagos_previos p where p.idempotency_key = v_key) then
    return public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  end if;
  -- #50: modalidad sellada de la hija (NETO = la rama nueva; todo lo demás, como siempre).
  select n.modalidad, n.neto_total into v_mod, v_neto
    from public.cotizacion_neto n where n.cotizacion_id = p_cotizacion_id;
  -- Primer pago: la misma revisión que leyó la app y la misma composición.
  if v_congelada is null then
    if p_rev_esperada is distinct from v_rev then
      raise exception 'PAGO_39_REVISION: la cotización cambió desde que se preparó el pago; recarga la página e inténtalo de nuevo.' using errcode = 'P0001';
    end if;
    if v_mod = 'neto' then
      if p_snapshot is null or not p50_priv.composicion_neto_coincide(p_cotizacion_id, p_snapshot) then
        raise exception 'NETO: las condiciones enviadas no corresponden al precio NETO de la cotización; recarga la página.' using errcode = 'P0001';
      end if;
      if p_exigido_total_moneda is null
         or p_exigido_total_moneda > v_neto + 0.005
         or abs(p_exigido_total_moneda - (select coalesce(sum((r->>'monto_exigido')::numeric), 0) from jsonb_array_elements(p_snapshot) r)) > 0.01
         or exists (select 1 from jsonb_array_elements(p_snapshot) r
                     where coalesce((r->>'monto_exigido')::numeric, 0) > coalesce((r->>'valor_componente')::numeric, 0) + 0.005
                        or coalesce((r->>'monto_exigido')::numeric, 0) < 0) then
        raise exception 'NETO: el pago mínimo exigido no es coherente con el precio NETO; recarga la página.' using errcode = 'P0001';
      end if;
      -- La 198 compara el sobrepago con el PVP guardado: aquí con el NETO, antes de llamarla.
      if p_valor > v_neto + 0.005 then
        raise exception 'NETO: el pago (%) excede el total NETO de la cotización (%).', p_valor, v_neto using errcode = 'P0001';
      end if;
    elsif p_snapshot is null or not p39_priv.composicion_coincide(p_cotizacion_id, p_snapshot) then
      raise exception 'PAGO_39_COMPOSICION: las condiciones enviadas no corresponden a los servicios actuales de la cotización; recarga la página.' using errcode = 'P0001';
    end if;
  end if;
  v_aut := p39_priv.emitir(p_cotizacion_id, 'pago', p_usuario_id);
  v_res := public.registrar_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_trm, p_forma_pago, p_referencia, p_fecha_pago,
                                        p_usuario_id, p_idempotency_key, p_snapshot, p_exigido_total_moneda, p_pct_efectivo);
  -- NETO: el primer pago congeló el PVP (la 198 no lo conoce); el total congelado pasa a NETO
  -- en la MISMA transacción, de modo que los pagos siguientes se topan contra el NETO.
  if v_mod = 'neto' and v_congelada is null then
    update public.cotizaciones set precio_total_congelado = v_neto where id = p_cotizacion_id;
  end if;
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

-- 5.5 Wrapper de conversión (216:921) — misma firma. Sin sello y sin aliado, idéntico.
create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
begin
  select c.tipo, c.modo into v_tipo, v_modo from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida: la 198 devuelve el número existente sin escribir nada.
  if exists (select 1 from public.ventas v where v.cotizacion_id = p_cotizacion_id) then
    return public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  end if;
  -- #50: todo rechazo nuevo ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. ACL de funciones
-- ═════════════════════════════════════════════════════════════════════════
revoke all on all functions in schema p50_priv from public, anon, authenticated, service_role;
-- Solo las que llama el wrapper INVOKER (service_role).
grant execute on function p50_priv.composicion_neto_coincide(bigint, jsonb) to service_role;
grant execute on function p50_priv.validar_conversion(bigint, uuid) to service_role;
grant execute on function p50_priv.completar_conversion(bigint, text) to service_role;

revoke all on function public.registrar_validacion_comparativa_n50(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb, text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.registrar_validacion_comparativa_n50(bigint, text, text, integer, text, uuid, numeric, text, boolean, jsonb, text, boolean, boolean)
  to service_role;
-- «Con sesión»: identidad de auth.uid(); ni siquiera service_role (mismo criterio que la 211).
revoke all on function public.resolver_solicitud_comparativa_n50(bigint, text, text, text, text, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.resolver_solicitud_comparativa_n50(bigint, text, text, text, text, boolean, boolean) to authenticated;
-- Las cinco reemplazadas conservan su ACL (CREATE OR REPLACE no la toca); se reafirma.
revoke all on function public.elegir_opcion_comparativa_sesion(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resolver_solicitud_comparativa(bigint, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.elegir_opcion_comparativa_sesion(uuid, text) to authenticated;
grant execute on function public.resolver_solicitud_comparativa(bigint, text, text, text) to authenticated;
revoke all on function public.registrar_pago_previo_rev(bigint, numeric, text, numeric, text, text, date, uuid, text, integer, jsonb, numeric, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.registrar_pago_previo_rev(bigint, numeric, text, numeric, text, text, date, uuid, text, integer, jsonb, numeric, numeric) to service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Verificación en la misma transacción
-- ═════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('cotizacion_neto', 'cotizacion_neto_componentes') and c.relrowsecurity;
  if v_n <> 2 then raise exception '222: RLS no quedó activo en las 2 tablas nuevas (%).', v_n; end if;
  if has_table_privilege('anon', 'public.cotizacion_neto', 'select')
     or has_table_privilege('authenticated', 'public.cotizacion_neto', 'select')
     or has_table_privilege('authenticated', 'public.cotizacion_neto_componentes', 'select')
     or has_table_privilege('service_role', 'public.cotizacion_neto', 'insert,update,delete,truncate')
     or has_table_privilege('service_role', 'public.cotizacion_neto_componentes', 'insert,update,delete,truncate')
     or not has_table_privilege('service_role', 'public.cotizacion_neto', 'select') then
    raise exception '222: grants inesperados sobre las tablas nuevas.';
  end if;
  if has_schema_privilege('anon', 'p50_priv', 'USAGE') or has_schema_privilege('authenticated', 'p50_priv', 'USAGE')
     or not has_schema_privilege('service_role', 'p50_priv', 'USAGE') then
    raise exception '222: permisos inesperados sobre p50_priv.';
  end if;
  if has_function_privilege('authenticated', 'public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.convertir_cotizacion_manual_controlada(bigint,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'p50_priv.sellar_hija(bigint,text,boolean,boolean,uuid)', 'EXECUTE') then
    raise exception '222: grants inesperados en las funciones.';
  end if;
  if not p39_priv.frontera_activa() then
    raise exception '222: la frontera de #39 dejó de estar activa.';
  end if;
  if md5(replace((select prosrc from pg_proc where oid = to_regprocedure('public.convertir_cotizacion_a_contrato(bigint,uuid)')), chr(13), ''))
     <> 'edc9975010746e53e4af6a75ad9763dc' then
    raise exception '222: el cuerpo de la RPC 198 cambió.';
  end if;
  if p50_priv.exigir_modalidad() then
    raise exception '222: la modalidad no debe ser obligatoria con solo la 222.';
  end if;
end $$;

commit;
