-- 286 · #97 — PLAN de comisión del aliado (aliado por id, % congelado, BNC explícita, versionado) y su MATERIALIZACIÓN al confirmar el contrato.
--
-- CICLO DE VIDA (decisión del dueño, coordinada con #75). Se ACTIVA de forma EXPLÍCITA (p97_priv.ciclo, activar_286_ciclo_comision.sql), nunca por detectar qué funciones existen:
--   REGLA INVARIANTE (con el interruptor en cualquier posición): un contrato PENDIENTE solo tiene PLAN informativo, nunca una comisión exigible; se materializa únicamente al CONFIRMAR (gancho de #75).
--   El interruptor solo cambia lo HISTÓRICO/no pendiente: apagado = los contratos ya confirmados/'activo' conservan su tratamiento de siempre (la comisión nace al crear/convertir); apagar NO materializa planes ni cambia estados. El plan se liga al contrato por ventas.contrato_uid (284).
--   Requisito de la 286: la 284 de #75 (identidad). Dependencia del ciclo encendido: la 288 de #75 (gancho único de confirmación); si falta, no se puede activar y, encendido, crear/convertir se rechaza.
--   · Cotización y contrato PENDIENTE: solo existe el PLAN (cálculo informativo). No hay fila exigible en aliados_b2b ni cuenta de cobro.
--   · CONFIRMADO: `public.materializar_comision_b2b(numero)` crea UNA vez la fila exigible copiando el plan sellado (sin recalcular con parámetros de hoy).
--     Es idempotente y no duplica filas históricas. **#75 es el único que modifica el gancho de confirmación** (`confirmar_venta` y la confirmación por abono)
--     y llama a esta función en la MISMA transacción; esta migración NO toca `confirmar_venta`.
--   · NETO: el descuento va en el precio desde la creación; su fila descontada no es una comisión por pagar (no pasa por el plan).
--   · UN solo plan (tabla `comision_plan`) y UNA sola función de materialización para todos los recorridos (dinámica, Reservar, manual, negociado).
--
-- NÚMERO: coordinado con #75, que usa 282, 284 y 285 en su rama; esta migración toma la 286.
-- REGLA (confirmada por el dueño): base = total − BNC − (participaciónAliadoEnRecobro > 0 ? recobroTotal : 0);
--   totalAliado = comisiónOrdinaria(base, %) + participaciónAliadoEnRecobro. La condición se evalúa sobre el IMPORTE final que se paga al aliado.
-- ALCANCE: cotizaciones dinámicas independientes (tipo 'manual', modo 'simple', sin origen de comparativa, sin paquete 100 % dinámico). NETO y las
--   hijas de comparativa NO se tocan. No escribe ventas.impuesto ni cambia el significado de ventas.comision_b2b.
-- ACTIVACIÓN EN TRES FASES (sin ventana de bloqueo): esta migración es COMPATIBLE con el código anterior y NO exige el acuerdo.
--   FASE 1  preflight_286 → esta migración → postcheck_286. Interruptor p97_priv.corte.exigir = false: lo que cree el código viejo (sin acuerdo) se convierte
--           como siempre; la regla NETO nueva tampoco está activa. El acuerdo existe y se valida si una cotización lo trae.
--   FASE 2  desplegar el código nuevo (crea cotizaciones con crear_cotizacion_manual_con_acuerdo). Validar en Preview/producción.
--   FASE 3  supabase/scripts/activar_286_exigir_acuerdo.sql (con su verificación previa): fija el CORTE DEFINITIVO = mayor id de cotización en ese instante y pone
--           exigir = true. Lo creado antes (aunque sea por el código viejo) queda histórico y convertible; solo lo posterior exige acuerdo y usa la regla NETO nueva.
--   Desactivar = supabase/scripts/desactivar_286_exigir_acuerdo.sql (apaga la exigencia y CONSERVA todos los acuerdos).
-- HISTÓRICAS: lo anterior al corte conserva su comportamiento; no se asigna aliado por nombre ni se completan acuerdos viejos; nada se recalcula.
-- ROLLBACK: supabase/scripts/rollback_286_cotizacion_comision_acuerdo.sql — SE NIEGA si existen acuerdos sellados (conservar la evidencia ≠ desactivar la función).

-- REQUISITO: la identidad interna del contrato de #75 (284, ya aplicada): el plan se liga al contrato por `ventas.contrato_uid`, no por número ni por fecha.
do $req$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid') then
    raise exception '286: requiere la identidad de contrato de #75 (284: ventas.contrato_uid). Aplicarla antes.' using errcode = 'P0001';
  end if;
end $req$;

create schema if not exists p97_priv;
revoke all on schema p97_priv from public, anon, authenticated;

-- ═══ 1. Interruptor de activación y corte DEFINITIVO ═══
-- Al aplicar: cotizacion_id_max = NULL y exigir = false → nada cambia para quien no trae acuerdo.
-- Fase 3 (activar): cotizacion_id_max se FIJA (no al migrar: así nada creado por el código viejo después de migrar queda bloqueado) y exigir = true.
--   · regla NETO nueva: rige para id > cotizacion_id_max y, una vez fijado el corte, NO se apaga (lo ya sellado bajo ella no se recalcula distinto).
--   · exigir acuerdo: solo mientras exigir = true (desactivar_286 lo apaga sin tocar el corte ni los acuerdos).
create table if not exists p97_priv.corte (
  id boolean primary key default true check (id),
  exigir boolean not null default false,
  cotizacion_id_max bigint,
  activado_en timestamptz,
  check (not exigir or cotizacion_id_max is not null)
);
insert into p97_priv.corte (exigir) values (false) on conflict (id) do nothing;
-- ¿Es POSTERIOR al corte definitivo (usa la regla NETO nueva)? Falso mientras no se haya fijado el corte.
create or replace function p97_priv.es_posterior_al_corte(p_cot bigint) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p_cot > c.cotizacion_id_max from p97_priv.corte c limit 1), false)
$$;
-- ¿Se le EXIGE acuerdo? Posterior al corte y con la exigencia encendida.
create or replace function p97_priv.exige_acuerdo(p_cot bigint) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.exigir and p_cot > c.cotizacion_id_max from p97_priv.corte c limit 1), false)
$$;

-- ═══ 1.b Interruptor EXPLÍCITO del ciclo de vida de la comisión (pendiente = solo plan; exigible al confirmar) ═══
-- Apagado (al aplicar): la regla comercial es la de siempre (la comisión nace al crear/convertir). Se enciende SOLO con activar_286_ciclo_comision.sql, que verifica las
-- dependencias necesarias; la regla NO cambia según qué funciones existan. Encendido, si una dependencia falta, crear/convertir un contrato B2B se rechaza con un diagnóstico claro.
create table if not exists p97_priv.ciclo (
  id boolean primary key default true check (id),
  activo boolean not null default false,
  activado_en timestamptz
);
insert into p97_priv.ciclo (activo) values (false) on conflict (id) do nothing;
create or replace function p97_priv.ciclo_activo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.activo from p97_priv.ciclo c limit 1), false)
$$;
create or replace function p97_priv.dependencias_ciclo() returns table (dependencia text, cumplida boolean, detalle text)
language sql stable security definer set search_path = public, pg_temp as $$
  select * from (values
    ('identidad de contrato de #75 (284): ventas.contrato_uid',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'contrato_uid'),
       'sin ella el plan no puede ligarse inequívocamente a un contrato'),
    ('guarda de identidad sobre comision_plan (284)',
       to_regclass('public.contrato_guardas_config') is not null and exists (select 1 from public.contrato_guardas_config g where g.tabla = 'comision_plan'),
       'comision_plan debe estar clasificada en contrato_guardas_config (la 286 la registra si la 284 ya existe)'),
    ('gancho de confirmación ÚNICO de #75 (288): confirmar_venta → materializar_obligaciones → materializar_comision_b2b',
       exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.confirmar_venta(text)') and p.prosrc like '%materializar_obligaciones%')
       and exists (select 1 from pg_proc p where p.oid = to_regprocedure('p75_priv.materializar_obligaciones(text)') and p.prosrc like '%materializar_comision_b2b%'),
       'aplicar la 288 de #75 (la confirmación debe llamar a materializar_comision_b2b dentro de su transacción)')
  ) v(dependencia, cumplida, detalle)
$$;
create or replace function p97_priv.exigir_dependencias() returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_faltan text;
begin
  select string_agg(d.dependencia || ' — ' || d.detalle, '; ') into v_faltan from p97_priv.dependencias_ciclo() d where not d.cumplida;
  if v_faltan is not null then
    raise exception 'CICLO_97: un contrato pendiente solo registra el plan de comisión y se materializa al confirmar, pero faltan dependencias: %. No se crea ni convierte el contrato. Aplica lo que falta (284 y 288 de #75).', v_faltan using errcode = 'P0001';
  end if;
end $$;
revoke all on function p97_priv.ciclo_activo(), p97_priv.dependencias_ciclo(), p97_priv.exigir_dependencias() from public, anon, authenticated, service_role;

-- ═══ 2. Acuerdo versionado (solo inserción) ═══
-- El % del recobro del aliado se guardaba con 4 decimales (numeric(5,4)): 33.333 de 100.000 quedaba en 33.330. Se ensancha a numeric(25,20): conserva EXACTAMENTE los valores
-- existentes y, con importes de hasta numeric(15,2) (< 10^13), el error de representar participación/recobro es < 5e-8 pesos: el importe pactado sale exacto.
-- Si aun así un caso no se pudiera representar, `p97_priv.importes` lo RECHAZA (no se ajusta en silencio). Ninguna vista, regla ni restricción depende de la columna.
alter table public.aliados_b2b alter column pct_recobro_aliado type numeric(25,20);

create table if not exists public.comision_plan (
  id                 bigint        generated always as identity primary key,
  cotizacion_id      bigint        null references public.cotizaciones (id) on delete restrict,   -- plan nacido en una cotización (y, tras convertir, ligado al contrato)
  numero_contrato    text          null,                                                          -- etiqueta visible (puede cambiar al renumerar); NO identifica al contrato
  contrato_uid       uuid          null,                                                          -- IDENTIDAD del contrato (ventas.contrato_uid) al que pertenece esta versión; null solo mientras el plan es de una cotización sin contrato
  version            integer       not null check (version >= 1),
  tenant             text          not null,
  economico_rev      integer       not null,
  aliado_id          bigint        not null references public.aliados (id) on delete restrict,
  tipo_asesor        text          not null check (tipo_asesor in ('agencia', 'freelance')),
  moneda             text          not null check (moneda in ('COP', 'USD')),
  pvp_total          numeric(15,2) not null check (pvp_total > 0),
  bnc                numeric(15,2) not null check (bnc >= 0),             -- explícita: 0 escrito ≠ ausencia (sin fila)
  recobro_total      numeric(15,2) not null default 0 check (recobro_total >= 0),
  recobro_aliado     numeric(15,2) not null default 0 check (recobro_aliado >= 0 and recobro_aliado <= recobro_total),
  base_comision      numeric(15,2) not null check (base_comision >= 0),
  pct_comision       numeric(5,4)  not null check (pct_comision >= 0 and pct_comision <= 1),
  pct_origen         text          not null check (pct_origen in ('aliado', 'general', 'defecto')),
  comision_ordinaria numeric(15,2) not null,
  total_aliado       numeric(15,2) not null,                               -- ordinaria + participación en el recobro
  creado_por_id      uuid,
  creado_en          timestamptz   not null default now(),
  constraint plan97_origen check (cotizacion_id is not null or contrato_uid is not null),
  constraint acuerdo97_bnc check (bnc <= pvp_total),
  -- Anti doble pago: si el aliado participa del recobro, el recobro sale de la base de la comisión ordinaria (misma regla que NETO, 222).
  constraint acuerdo97_base check (base_comision = greatest(pvp_total - bnc - case when recobro_aliado > 0 then recobro_total else 0 end, 0)),
  constraint acuerdo97_ordinaria check (comision_ordinaria = round(base_comision * pct_comision)),
  constraint acuerdo97_total check (total_aliado = comision_ordinaria + recobro_aliado)
);
-- Cadena de versiones: por cotización (si la hay) o por IDENTIDAD de contrato (contrato_uid). Un plan sin contrato_uid es evidencia de una cotización: nunca se elige para un contrato. Una versión nueva por cambio de importes; al convertir se LIGA al contrato con una versión más (mismos importes).
create unique index if not exists plan97_cadena_uq on public.comision_plan ((coalesce(cotizacion_id::text, 'U:' || contrato_uid::text)), version);
create index if not exists plan97_uid_ix on public.comision_plan (contrato_uid) where contrato_uid is not null;
create index if not exists plan97_contrato_ix on public.comision_plan (numero_contrato) where numero_contrato is not null;
comment on table public.comision_plan is
  '#97: PLAN de comisión del aliado (cálculo informativo mientras el contrato está pendiente). Solo inserción; versionado. Al confirmar, public.materializar_comision_b2b copia la última versión a aliados_b2b una sola vez.';

-- La fila exigible de aliados_b2b creada por el plan queda marcada (idempotencia y diagnóstico: las filas históricas tienen plan_id nulo).
alter table public.aliados_b2b add column if not exists plan_id bigint;
create unique index if not exists aliados_b2b_plan_uq on public.aliados_b2b (numero_contrato) where plan_id is not null;
alter table public.comision_plan enable row level security;
revoke all on public.comision_plan from public, anon, authenticated, service_role;
grant select on public.comision_plan to service_role;

-- Solo inserción. ÚNICA excepción (acordada con #75, versión LIBERACION_PLAN_V2): borrar el plan de UN contrato PENDIENTE que se está eliminando para reutilizar su número. Exige TODO:
--   · DELETE (nunca UPDATE); · la fila pertenece a una identidad (contrato_uid) y la marca transaccional `app.p75_eliminando_uid` es EXACTAMENTE esa identidad (un número no basta: otra vida del mismo
--     número tiene otro contrato_uid y sus planes no se tocan); · el contrato con esa identidad existe y está PENDIENTE; · el plan NO está materializado (ninguna comisión exigible lo referencia).
-- Los planes de la COTIZACIÓN (contrato_uid nulo) nunca se borran: el acuerdo sobrevive para reabrir y convertir de nuevo.
create or replace function p97_priv.tg_solo_insercion() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and old.contrato_uid is not null
     and coalesce(current_setting('app.p75_eliminando_uid', true), '') = old.contrato_uid::text
     and exists (select 1 from public.ventas v where v.contrato_uid = old.contrato_uid and v.estado = 'pendiente')
     and not exists (select 1 from public.aliados_b2b b where b.plan_id = old.id and not coalesce(b.descontada_en_precio, false)) then
    return old;
  end if;
  raise exception 'ACUERDO_97: el acuerdo de comisión es de solo inserción (cambia de versión, no se edita).' using errcode = 'P0001';
end $$;
comment on function p97_priv.tg_solo_insercion() is 'LIBERACION_PLAN_V2: solo inserción; DELETE únicamente del plan no materializado de un contrato PENDIENTE cuya identidad (contrato_uid) coincide con app.p75_eliminando_uid (#75).';
drop trigger if exists trg_acuerdo97_inmutable on public.comision_plan;
create trigger trg_acuerdo97_inmutable before update or delete on public.comision_plan
  for each row execute function p97_priv.tg_solo_insercion();

-- ═══ 3. Cálculo único (espejo de la política vigente de Reservar: % del aliado → parámetro general → 12 % agencia / 11 % freelance) ═══
create or replace function p97_priv.importes(p_cot bigint, p_aliado bigint, p_bnc numeric)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c public.cotizaciones; a public.aliados;
  v_tipo text; v_param numeric; v_pct numeric; v_origen text;
  v_pvp numeric; v_rec numeric; v_rec_ali numeric; v_base numeric; v_ord numeric;
begin
  select * into c from public.cotizaciones where id = p_cot;
  if not found then raise exception 'ACUERDO_97: la cotización % no existe.', p_cot using errcode = 'P0001'; end if;
  if c.tipo is distinct from 'manual' or c.modo is distinct from 'simple' then
    raise exception 'ACUERDO_97: solo las cotizaciones dinámicas llevan este acuerdo.' using errcode = 'P0001';
  end if;
  v_tipo := coalesce(nullif(c.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo not in ('agencia', 'freelance') then
    raise exception 'ACUERDO_97: la cotización no es B2B.' using errcode = 'P0001';
  end if;
  if c.moneda not in ('COP', 'USD') then raise exception 'ACUERDO_97: moneda de la cotización inválida (%).', c.moneda using errcode = 'P0001'; end if;
  select * into a from public.aliados where id = p_aliado;
  if not found then raise exception 'ACUERDO_97: el aliado % no existe en el catálogo.', p_aliado using errcode = 'P0001'; end if;
  if a.tipo is not null and lower(a.tipo) not like '%' || (case v_tipo when 'agencia' then 'agencia' else 'free' end) || '%' then
    raise exception 'ACUERDO_97: el aliado es de tipo %, la cotización es %.', a.tipo, v_tipo using errcode = 'P0001';
  end if;
  if p_bnc is null then
    raise exception 'ACUERDO_97: indica la base no comisionable (escribe 0 si no hay).' using errcode = 'P0001';
  end if;
  v_pvp := coalesce(c.precio_venta, 0);
  if v_pvp <= 0 then raise exception 'ACUERDO_97: la cotización no tiene total.' using errcode = 'P0001'; end if;
  if p_bnc < 0 or p_bnc > v_pvp then raise exception 'ACUERDO_97: la BNC debe estar entre 0 y el total (%).', v_pvp using errcode = 'P0001'; end if;
  v_rec := greatest(coalesce((c.payload->>'recobro')::numeric, 0), 0);
  v_rec_ali := least(greatest(coalesce((c.payload->>'recobroAliado')::numeric, 0), 0), v_rec);
  -- La fila guarda la participación como % (numeric(25,20)): debe reproducir EXACTAMENTE el importe pactado al centavo; si no, se rechaza (no se ajusta en silencio).
  if v_rec_ali > 0 and round(v_rec * round(v_rec_ali / v_rec, 20), 2) is distinct from round(v_rec_ali, 2) then
    raise exception 'ACUERDO_97: la participación del aliado en el recobro (%) no se puede representar exactamente como porcentaje del recobro (%); ajusta los importes.', v_rec_ali, v_rec using errcode = 'P0001';
  end if;
  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case v_tipo when 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  if a.pct_comision is not null then v_pct := a.pct_comision; v_origen := 'aliado';
  elsif v_param is not null then v_pct := v_param; v_origen := 'general';
  else v_pct := case v_tipo when 'agencia' then 0.12 else 0.11 end; v_origen := 'defecto'; end if;
  v_pct := round(v_pct, 4);
  -- Regla confirmada por el dueño: el recobro COMPLETO sale de la base solo si lo que se le paga al aliado de él (importe final) es > 0.
  v_base := greatest(v_pvp - p_bnc - case when v_rec_ali > 0 then v_rec else 0 end, 0);
  v_ord := round(v_base * v_pct);
  return jsonb_build_object('tenant', c.tenant, 'rev', c.economico_rev, 'tipo', v_tipo, 'moneda', c.moneda, 'pvp', v_pvp, 'bnc', p_bnc,
    'recobro', v_rec, 'recobro_aliado', v_rec_ali, 'base', v_base, 'pct', v_pct, 'origen', v_origen, 'ordinaria', v_ord, 'total', v_ord + v_rec_ali);
end $$;

create or replace function p97_priv.insertar_version(p_cot bigint, p_aliado bigint, p_bnc numeric, p_origen_fijo text, p_pct_fijo numeric, p_usuario uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare k jsonb; v_ver integer; v_pct numeric; v_origen text; v_base numeric; v_ord numeric;
begin
  k := p97_priv.importes(p_cot, p_aliado, p_bnc);
  -- Una versión nueva CONSERVA el % acordado (no se recalcula con el catálogo de hoy); la versión 1 toma el vigente.
  v_pct := coalesce(p_pct_fijo, (k->>'pct')::numeric);
  v_origen := coalesce(p_origen_fijo, k->>'origen');
  v_base := (k->>'base')::numeric;
  v_ord := round(v_base * v_pct);
  select coalesce(max(version), 0) + 1 into v_ver from public.comision_plan where cotizacion_id = p_cot;
  insert into public.comision_plan (cotizacion_id, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc,
    recobro_total, recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_por_id)
  values (p_cot, v_ver, k->>'tenant', (k->>'rev')::int, p_aliado, k->>'tipo', k->>'moneda', (k->>'pvp')::numeric, p_bnc,
    (k->>'recobro')::numeric, (k->>'recobro_aliado')::numeric, v_base, v_pct, v_origen, v_ord, v_ord + (k->>'recobro_aliado')::numeric, p_usuario);
  return v_ver;
end $$;

-- ═══ 4. Sellado al CREAR la cotización: una sola transacción con la creación (la 216 no se modifica) ═══
create or replace function public.crear_cotizacion_manual_con_acuerdo(
  p_usuario_id uuid, p_tenant text, p_cabecera jsonb, p_servicios jsonb, p_aliado_id bigint, p_bnc numeric
) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  v_id := public.crear_cotizacion_manual(p_usuario_id, p_tenant, p_cabecera, p_servicios);
  perform p97_priv.insertar_version(v_id, p_aliado_id, p_bnc, null, null, p_usuario_id);
  return v_id;   -- cualquier rechazo del acuerdo deshace también la cotización
end $$;
revoke all on function public.crear_cotizacion_manual_con_acuerdo(uuid, text, jsonb, jsonb, bigint, numeric) from public, anon, authenticated, service_role;
grant execute on function public.crear_cotizacion_manual_con_acuerdo(uuid, text, jsonb, jsonb, bigint, numeric) to service_role;

-- ═══ 5. Edición de la cotización → nueva versión con los importes vigentes (conserva aliado, % y BNC) ═══
create or replace function p97_priv.tg_nueva_version() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.comision_plan; k jsonb;
begin
  select * into u from public.comision_plan where cotizacion_id = new.id order by version desc limit 1;
  if not found then return new; end if;                                   -- histórica o interna: nada que versionar
  k := p97_priv.importes(new.id, u.aliado_id, u.bnc);                      -- rechaza (y deshace la edición) si la BNC ya supera el nuevo total
  if (k->>'pvp')::numeric is distinct from u.pvp_total or (k->>'recobro')::numeric is distinct from u.recobro_total
     or (k->>'recobro_aliado')::numeric is distinct from u.recobro_aliado or k->>'moneda' is distinct from u.moneda then
    perform p97_priv.insertar_version(new.id, u.aliado_id, u.bnc, u.pct_origen, u.pct_comision, null);
  end if;
  return new;
end $$;
drop trigger if exists trg_cot_acuerdo97 on public.cotizaciones;
create trigger trg_cot_acuerdo97 after update of precio_venta, payload, moneda on public.cotizaciones
  for each row execute function p97_priv.tg_nueva_version();

-- ═══ 6. Conversión: validar ANTES de numerar y aplicar DESPUÉS (una sola fila de aliados_b2b; ordinaria y recobro desglosados en el acuerdo) ═══
create or replace function p97_priv.validar(p_cot bigint) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cotizaciones; u public.comision_plan; k jsonb; v_tipo text;
begin
  select * into c from public.cotizaciones where id = p_cot;
  v_tipo := coalesce(nullif(c.payload->>'tipoAsesor', ''), 'interno');
  if v_tipo not in ('agencia', 'freelance') then return; end if;
  -- Alcance: solo la dinámica independiente. Las hijas de comparativa (NETO/PVP sellado, aliado_id en la cotización) y el paquete 100 % dinámico
  -- (paquete_din_id) conservan su camino; no se les exige este acuerdo.
  if c.modo is distinct from 'simple' or c.tipo is distinct from 'manual' or c.cotizacion_origen_id is not null
     or c.paquete_din_id is not null or c.aliado_id is not null then return; end if;
  select * into u from public.comision_plan where cotizacion_id = p_cot order by version desc limit 1;
  if not found then
    if p97_priv.exige_acuerdo(c.id) then
      raise exception 'ACUERDO_97: esta cotización B2B no tiene acuerdo de comisión; créala de nuevo con el aliado del catálogo y la BNC.' using errcode = 'P0001';
    end if;
    return;                                                                -- histórica: se conserva el comportamiento de siempre (sin completar ni asignar por nombre)
  end if;
  k := p97_priv.importes(p_cot, u.aliado_id, u.bnc);
  if (k->>'pvp')::numeric is distinct from u.pvp_total or (k->>'recobro')::numeric is distinct from u.recobro_total
     or (k->>'recobro_aliado')::numeric is distinct from u.recobro_aliado or k->>'moneda' is distinct from u.moneda then
    raise exception 'ACUERDO_97: el acuerdo de comisión no corresponde a los importes vigentes de la cotización (versión %).', u.version using errcode = 'P0001';
  end if;
end $$;

create or replace function p97_priv.aplicar(p_cot bigint, p_numero text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.comision_plan; a public.aliados; v public.ventas;
begin
  select * into u from public.comision_plan where cotizacion_id = p_cot order by version desc limit 1;
  if not found then return; end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  select * into a from public.aliados where id = u.aliado_id;
  if v.moneda is distinct from u.moneda or abs(coalesce(v.precio_venta, 0) - u.pvp_total) > 0.5 then
    raise exception 'ACUERDO_97: el contrato % no coincide con el plan (moneda o total).', p_numero using errcode = 'P0001';
  end if;
  -- Un PENDIENTE solo deja plan (se materializa al confirmar): sus dependencias deben estar con el interruptor en cualquier posición, o la comisión nunca nacería
  -- (la conversión se rechaza ANTES de ligar nada; la transacción se deshace).
  if v.estado is not distinct from 'pendiente' or p97_priv.ciclo_activo() then perform p97_priv.exigir_dependencias(); end if;
  update public.ventas set aliado_id = a.id, tipo_asesor = u.tipo_asesor, updated_at = now() where numero_contrato = p_numero;   -- vínculo por ID, nunca por nombre
  -- El plan queda LIGADO AL CONTRATO por su IDENTIDAD (contrato_uid): una versión más de la MISMA cadena, mismos importes. Solo inserción; una sola vez por contrato.
  if not exists (select 1 from public.comision_plan where contrato_uid = v.contrato_uid) then
    insert into public.comision_plan (cotizacion_id, numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total,
                                      recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_por_id)
    select cotizacion_id, p_numero, v.contrato_uid, version + 1, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total,
           recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_por_id
      from public.comision_plan where id = u.id;
  end if;
  if v.estado in ('confirmado', 'activo') then
    perform p97_priv.materializar(p_numero, true);   -- ya confirmado (tratamiento histórico): completa la fila que creó la 198, con el interruptor en cualquier posición
  else
    -- Un contrato PENDIENTE no tiene comisión exigible NUNCA: la 198 crea al convertir la fila del recobro del aliado; en ESTA conversión (contrato recién numerado, sin abonos
    -- a comisión, sin plan_id) se retira y su importe queda en el plan, que se materializa al confirmar. Nada histórico ni pagado se toca.
    delete from public.aliados_b2b b
     where b.numero_contrato = p_numero and b.plan_id is null
       and not exists (select 1 from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id);
  end if;
end $$;
revoke all on function p97_priv.validar(bigint), p97_priv.aplicar(bigint, text) from public, anon, authenticated, service_role;
grant usage on schema p97_priv to service_role;
grant execute on function p97_priv.validar(bigint), p97_priv.aplicar(bigint, text) to service_role;
-- Las funciones internas y de trigger no son una puerta: PostgreSQL concede EXECUTE a PUBLIC por defecto, se retira.
revoke all on function p97_priv.importes(bigint, bigint, numeric), p97_priv.insertar_version(bigint, bigint, numeric, text, numeric, uuid),
                       p97_priv.tg_nueva_version(), p97_priv.tg_solo_insercion() from public, anon, authenticated, service_role;


-- ═══ 6.b NETO: regla del recobro por participación monetaria (copia íntegra de p50_priv.calcular de la 222 con 4 líneas cambiadas) ═══
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
  v_excl boolean;
  v_nueva boolean;
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
  -- 286 (#97): regla confirmada. El recobro sale de la base y de las unidades de reparto SOLO si la participación monetaria final del aliado es > 0
  -- (participación = casilla marcada y su importe). La casilla sola no decide. Rige solo para lo POSTERIOR al corte definitivo y con la activación hecha
  -- (fase 3); antes de activar —y para todo lo histórico— se conserva el cálculo de siempre.
  v_nueva := p97_priv.es_posterior_al_corte(p_cot);
  v_excl := coalesce(p_reconoce, false) and (not v_nueva or v_rec_ali > 0);
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
  if not v_excl and v_r > 0 then
    v_pesos := v_pesos || v_r;
    v_pos := v_pos || (-1);
  end if;
  for i in 1..coalesce(array_length(v_pesos, 1), 0) loop
    v_suma_pesos := v_suma_pesos + v_pesos[i];
  end loop;

  v_base := greatest(v_precio - v_t - case when v_excl then v_r else 0 end, 0);
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

-- ═══ 6.c Plan de los contratos de TODOS los recorridos + materialización (única), ligados por IDENTIDAD de contrato ═══
-- `registrar_comision_b2b_reserva` conserva su firma, sus validaciones y la modalidad NETA (fila descontada, no exigible).
-- · Ciclo APAGADO: PVP/comisionable inserta la fila exigible al crear (la regla de siempre).
-- · Ciclo ENCENDIDO: exige las dependencias y registra el PLAN (ligado a ventas.contrato_uid); la fila nace al confirmar. Un contrato que ya nace confirmado/'activo' (tratamiento
--   histórico) materializa en el acto.
create or replace function public.registrar_comision_b2b_reserva(p_numero text, p_aliado_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol    text := public.mi_rol()::text;
  v        public.ventas;
  a        public.aliados;
  v_param  numeric;
  v_pct    numeric;
  v_bruto  numeric;
  v_base   numeric;
  v_id     bigint;
  v_origen text;
  v_ver    integer;
begin
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta','agencia','freelance') then
    raise exception 'No autorizado para registrar la comisión de la reserva.' using errcode = '42501';
  end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant_cotizacion(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  if v.financiero_estado is distinct from 'pendiente'
     or v.financiero_actualizado_en < now() - interval '5 minutes' then
    raise exception 'La comisión de reserva solo se registra mientras se crea el contrato %.', p_numero using errcode = 'P0001';
  end if;
  if v.tipo_asesor not in ('agencia','freelance') then
    raise exception 'El contrato % no es una venta B2B.', p_numero using errcode = 'P0001';
  end if;
  if v.aliado_id is distinct from p_aliado_id then
    raise exception 'El aliado no coincide con el de la venta %.', p_numero using errcode = 'P0001';
  end if;
  select * into a from public.aliados where id = p_aliado_id;
  if not found then
    raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
  end if;
  if a.tipo is not null and a.tipo <> v.tipo_asesor then
    raise exception 'El aliado es de tipo %, la venta es %.', a.tipo, v.tipo_asesor using errcode = 'P0001';
  end if;
  if v_rol in ('agencia','freelance')
     and (select u.aliado_id from public.usuarios u where u.id = auth.uid()) is distinct from p_aliado_id then
    raise exception 'Un aliado solo registra su propia comisión.' using errcode = '42501';
  end if;
  -- Sin duplicados: ni fila (histórica o NETA) ni plan de ESTE contrato (por identidad).
  if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero)
     or exists (select 1 from public.comision_plan c where c.contrato_uid = v.contrato_uid) then
    raise exception 'El contrato % ya tiene comisión B2B.', p_numero using errcode = '23505';
  end if;

  select pt.valor into v_param from public.parametros_tributarios pt
   where pt.parametro = case when v.tipo_asesor = 'agencia' then 'COMISION_AGENCIA' else 'COMISION_FREELANCE' end;
  v_pct := coalesce(a.pct_comision, v_param, case when v.tipo_asesor = 'agencia' then 0.12 else 0.11 end);
  v_origen := case when a.pct_comision is not null then 'aliado' when v_param is not null then 'general' else 'defecto' end;
  v_bruto := coalesce(v.precio_venta, 0) + case when v.modo_compra = 'neta' then coalesce(v.comision_b2b, 0) else 0 end;
  v_base  := greatest(0, v_bruto - coalesce(v.impuesto, 0));
  if v.modo_compra in ('neta','comisionable')
     and abs(round(v_base * v_pct) - coalesce(v.comision_b2b, -1000000)) > 1 then
    raise exception 'La comisión de la venta % (%) no coincide con la calculada (%).',
      p_numero, v.comision_b2b, round(v_base * v_pct) using errcode = 'P0001';
  end if;

  if v.modo_compra = 'neta' or (not p97_priv.ciclo_activo() and v.estado is distinct from 'pendiente') then
    -- NETO (el descuento ya está en el precio: queda REGISTRADA la fila descontada, pagada, nunca por pagar ni pago adicional) o ciclo apagado con contrato NO pendiente
    -- (tratamiento histórico: fila exigible al crear). Un PENDIENTE nunca entra aquí salvo NETO: va al plan, con el interruptor en cualquier posición.
    insert into public.aliados_b2b (
      numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
      precio_venta, base_comision, base_explicita, pct_comision,
      recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion,
      estado, descontada_en_precio
    ) values (
      v.numero_contrato, v.tenant, a.nombre, a.nit, v.tipo_asesor, a.id,
      v_bruto, v_base, true, v_pct,
      0, 0, coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0),
      case when v.modo_compra = 'neta' then 'pagada' else 'pendiente' end,
      v.modo_compra = 'neta'
    ) returning id into v_id;
    return v_id;
  end if;

  -- PVP/comisionable (pendiente con cualquier interruptor; no pendiente con ciclo encendido): dependencias verificadas y PLAN ligado a la identidad del contrato; la fila exigible nace al confirmar.
  perform p97_priv.exigir_dependencias();
  select coalesce(max(c.version), 0) + 1 into v_ver from public.comision_plan c where c.cotizacion_id is null and c.contrato_uid = v.contrato_uid;
  insert into public.comision_plan (cotizacion_id, numero_contrato, contrato_uid, version, tenant, economico_rev, aliado_id, tipo_asesor, moneda, pvp_total, bnc, recobro_total,
                                    recobro_aliado, base_comision, pct_comision, pct_origen, comision_ordinaria, total_aliado, creado_por_id)
  values (null, p_numero, v.contrato_uid, v_ver, v.tenant, 0, a.id, v.tipo_asesor, coalesce(v.moneda, 'COP'), v_bruto, coalesce(v.impuesto, 0), 0, 0,
          v_base, round(v_pct, 4), v_origen, round(v_base * round(v_pct, 4)), round(v_base * round(v_pct, 4)), auth.uid())
  returning id into v_id;
  -- Un contrato que NACE ya confirmado ('activo': tratamiento histórico) no tiene transición posterior que materialice su plan: se materializa aquí, con la misma función.
  if v.estado in ('confirmado', 'activo') then perform p97_priv.materializar(p_numero, false); end if;
  return v_id;
end;
$$;
revoke all on function public.registrar_comision_b2b_reserva(text, bigint) from public, anon;
grant execute on function public.registrar_comision_b2b_reserva(text, bigint) to authenticated, service_role;

-- Solo materializa contratos CONFIRMADOS/'activo' (no existe ruta forzada para pendientes). p_completar: completa la fila que la 198 creó en ESA conversión (contrato ya confirmado).
-- El plan se elige por la IDENTIDAD del contrato (ventas.contrato_uid); un plan de otro contrato —aunque comparta número, fecha o llegue tarde— jamás se elige.
create or replace function p97_priv.materializar(p_numero text, p_completar boolean) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.ventas; u public.comision_plan; a public.aliados; b public.aliados_b2b; v_id bigint; v_total numeric;
begin
  -- Sin sesión de usuario (tareas internas) pasa; con sesión, solo quien puede ver el contrato. Un contrato inexistente o no visible es un no-op (no revela su existencia).
  if auth.uid() is not null and not public.puede_ver_contrato(p_numero) then return null; end if;
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then return null; end if;
  if v.estado not in ('confirmado', 'activo') then return null; end if;
  select * into u from public.comision_plan where contrato_uid = v.contrato_uid order by id desc limit 1;
  if not found then return null; end if;                                                 -- sin plan de ESTE contrato (histórico, NETO, interno, o plan huérfano de otro)
  select x.id into v_id from public.aliados_b2b x where x.numero_contrato = p_numero and x.plan_id is not null limit 1;
  if found then return v_id; end if;                                                    -- ya materializada
  select * into a from public.aliados where id = u.aliado_id;
  if p_completar then
    select * into b from public.aliados_b2b x where x.numero_contrato = p_numero and x.plan_id is null order by x.id limit 1 for update;
  else
    select * into b from public.aliados_b2b x where x.numero_contrato = p_numero and x.aliado_id = u.aliado_id order by x.id limit 1;
    if found then return b.id; end if;                                                  -- ya hay una fila del mismo aliado (histórica): no se duplica ni se toca
  end if;
  if v.moneda is distinct from u.moneda or abs(coalesce(v.precio_venta, 0) - u.pvp_total) > 0.5 then
    raise exception 'PLAN_97: el contrato % ya no coincide con su plan de comisión (moneda o total); no se materializa en silencio.', p_numero using errcode = 'P0001';
  end if;
  if b.id is not null then
    update public.aliados_b2b set aliado_id = a.id, aliado = a.nombre, nit = a.nit, tipo_aliado = u.tipo_asesor, precio_venta = u.pvp_total,
           base_comision = u.base_comision, base_explicita = true, pct_comision = u.pct_comision, comision_valor = u.comision_ordinaria,
           recobro_total = u.recobro_total, pct_recobro_aliado = case when u.recobro_total > 0 then u.recobro_aliado / u.recobro_total else 0 end,
           aplica_retencion = coalesce(a.aplica_retencion, false), pct_retencion = coalesce(a.pct_retencion, 0), plan_id = u.id
     where id = b.id;
    v_id := b.id;
  else
    insert into public.aliados_b2b (numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id, precio_venta, base_comision, base_explicita, pct_comision, comision_valor,
                                    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado, descontada_en_precio, plan_id)
    values (p_numero, v.tenant, a.nombre, a.nit, u.tipo_asesor, a.id, u.pvp_total, u.base_comision, true, u.pct_comision, u.comision_ordinaria,
            u.recobro_total, case when u.recobro_total > 0 then u.recobro_aliado / u.recobro_total else 0 end,
            coalesce(a.aplica_retencion, false), coalesce(a.pct_retencion, 0), 'pendiente', false, u.id)
    returning id into v_id;
  end if;
  -- Debe liquidar el plan AL CENTAVO con la fórmula real (comision_b2b_total sin retención).
  select coalesce(comision_valor, base_comision * pct_comision) + recobro_total * coalesce(pct_recobro_aliado, 0.5) into v_total from public.aliados_b2b where id = v_id;
  if abs(v_total - u.total_aliado) > 0.005 then
    raise exception 'PLAN_97: la comisión de la fila (%) no cuadra con el plan (%); se revierte la confirmación.', v_total, u.total_aliado using errcode = 'P0001';
  end if;
  return v_id;
end $$;
revoke all on function p97_priv.materializar(text, boolean) from public, anon, authenticated, service_role;

-- MATERIALIZACIÓN ÚNICA (pública). La llama #75 desde su transición pendiente → confirmado (misma transacción, bajo la identidad declarada del contrato); es el ÚNICO gancho.
-- · Solo actúa con el contrato CONFIRMADO (o 'activo', el estado histórico, ya confirmado por definición); pendiente/anulado: no hace nada. Sin plan de este contrato: no hace nada.
-- · Idempotente y concurrente-segura: FOR UPDATE de ventas + índice único (numero_contrato where plan_id is not null). Reintentos devuelven la misma fila.
-- · No duplica: si ya hay una fila del MISMO aliado (histórica o manual) no inserta otra y la devuelve; no borra, recalcula ni desactiva nada.
-- · Copia el plan sellado (comision_valor = ordinaria; participación del recobro como %); NO consulta el % vigente del catálogo.
create or replace function public.materializar_comision_b2b(p_numero text) returns bigint
language sql security definer set search_path = public, pg_temp as $$
  select p97_priv.materializar(p_numero, false)
$$;
revoke all on function public.materializar_comision_b2b(text) from public, anon;
grant execute on function public.materializar_comision_b2b(text) to authenticated, service_role;

-- Estado del ciclo para el CÓDIGO (informativo: NO decide el estado de nacimiento del manual, que es siempre pendiente en Mayorista; el código solo lo usa para rechazar un B2B sin ciclo; 'activo' conserva su tratamiento histórico). Solo service_role.
create or replace function public.p97_ciclo_comision_activo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p97_priv.ciclo_activo()
$$;
revoke all on function public.p97_ciclo_comision_activo() from public, anon, authenticated, service_role;
grant execute on function public.p97_ciclo_comision_activo() to service_role;
-- Dependencias del ciclo de comisión para el CÓDIGO (crearContrato la consulta ANTES de numerar un B2B pendiente). NULL = todas cumplidas; si no, la lista de lo que falta.
-- Envoltorio mínimo de p97_priv.dependencias_ciclo(): NO expone el esquema privado ni depende del interruptor. Solo service_role.
create or replace function public.p97_dependencias_comision_faltantes() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(d.dependencia || ' — ' || d.detalle, '; ') from p97_priv.dependencias_ciclo() d where not d.cumplida
$$;
revoke all on function public.p97_dependencias_comision_faltantes() from public, anon, authenticated, service_role;
grant execute on function public.p97_dependencias_comision_faltantes() to service_role;

-- Si #75 (284) ya está aplicada, el plan de contrato se clasifica en su registro de guardas (mismo criterio que aliados_b2b). Sin 284 no hace nada: la 286 sigue independiente.
do $$
begin
  if to_regclass('public.contrato_guardas_config') is not null then
    insert into public.contrato_guardas_config (tabla, modo, motivo)
    values ('comision_plan', 'estricto', 'plan de comisión por número de contrato (solo inserción; las filas de cotización no llevan número)')
    on conflict (tabla) do nothing;
    if to_regprocedure('public.contrato_instalar_guardas()') is not null then perform public.contrato_instalar_guardas(); end if;
  end if;
end $$;

-- Estado de la regla NETO nueva para el CÓDIGO (la vista previa debe coincidir con lo que sellará la base): solo service_role.
create or replace function public.p97_regla_neto_activa() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select cotizacion_id_max is not null from p97_priv.corte limit 1), false)
$$;
revoke all on function public.p97_regla_neto_activa() from public, anon, authenticated, service_role;
grant execute on function public.p97_regla_neto_activa() to service_role;
revoke all on function p97_priv.es_posterior_al_corte(bigint), p97_priv.exige_acuerdo(bigint) from public, anon, authenticated, service_role;

-- ═══ 7. Envoltura de la 242 (copia íntegra) + validar/aplicar del acuerdo ═══
create or replace function public.convertir_cotizacion_manual_controlada(
  p_cotizacion_id bigint, p_usuario_id uuid
) returns text
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_tipo text;
  v_modo text;
  v_aut bigint;
  v_res text;
  v_rol text;
  v_tenant_cot text;
  v_tenant_vta text;
  v_tenant_act text;
begin
  -- Autorización VIGENTE del actor (usuario existente, activo y de rol interno de conversión) ANTES de leer o devolver nada, incluso un contrato ya existente.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select c.tipo, c.modo, c.tenant into v_tipo, v_modo, v_tenant_cot from public.cotizaciones c where c.id = p_cotizacion_id for update;
  if not found then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  -- Y su acceso a la agencia de la cotización (superadmin = excepción global), con el mismo mensaje que la conversión de #75; también sobre el contrato ya creado.
  select u.tenant into v_tenant_act from public.usuarios u where u.id = p_usuario_id;
  if v_rol <> 'superadmin' and v_tenant_act is distinct from v_tenant_cot then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant_cot;
  end if;
  if v_modo = 'comparativa' then
    raise exception 'COMPARATIVA_NO_COBRABLE: una comparativa no se convierte en contrato; elige una opción primero.' using errcode = 'P0001';
  end if;
  if v_tipo is distinct from 'manual' then
    raise exception 'Solo las cotizaciones dinámicas se convierten por esta vía.' using errcode = 'P0001';
  end if;
  -- Ya convertida (reintento, respuesta perdida o llamada concurrente que esperó el FOR UPDATE de arriba): se devuelve ESE contrato y no se vuelve a ejecutar
  -- ninguna parte de la conversión (ni el traslado de CxP a previstas de #75, ni la materialización): la conversión ya se completó y su resultado no se toca.
  select v.numero_contrato, v.tenant into v_res, v_tenant_vta from public.ventas v where v.cotizacion_id = p_cotizacion_id;
  if found then
    if v_rol <> 'superadmin' and v_tenant_act is distinct from v_tenant_vta then
      raise exception 'No tienes acceso a la agencia (tenant %) de este contrato.', v_tenant_vta;
    end if;
    return v_res;
  end if;
  -- 242 (#40 E3): una abierta vencida se rechaza ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform public.p40_exigir_cotizacion_vigente(p_cotizacion_id);
  -- #50: todo rechazo nuevo ANTES de numerar (la 198 toma el consecutivo y no lo devuelve).
  perform p50_priv.validar_conversion(p_cotizacion_id, p_usuario_id);
  -- 286 (#97): el acuerdo de comisión debe corresponder a los importes vigentes (antes de numerar).
  perform p97_priv.validar(p_cotizacion_id);
  v_aut := p39_priv.emitir(p_cotizacion_id, 'conversion', p_usuario_id);
  v_res := public.convertir_cotizacion_a_contrato(p_cotizacion_id, p_usuario_id);
  perform p50_priv.completar_conversion(p_cotizacion_id, v_res);
  -- 286 (#97): enlaza el aliado por id y completa la ÚNICA fila de aliados_b2b con el acuerdo (después de la 198 y de completar_conversion).
  perform p97_priv.aplicar(p_cotizacion_id, v_res);
  -- 241: el tipo elegido para el titular en la cotización pasa al contrato junto al número que ya copió la 198 (mismo número con CC y con CE no se confunden).
  update public.ventas v
     set cliente_tipo_documento = t.tipo
    from (
      select case
               when nullif(btrim(c.payload#>>'{cliente,numeroDoc}'), '') is null then null
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) = 'PASAPORTE' then 'PAS'
               when upper(btrim(c.payload#>>'{cliente,tipoDoc}')) in ('CC', 'CE', 'TI', 'RC', 'PAS', 'PPT', 'NIT') then upper(btrim(c.payload#>>'{cliente,tipoDoc}'))
               else null
             end as tipo
        from public.cotizaciones c where c.id = p_cotizacion_id
    ) t
   where v.numero_contrato = v_res and v.cotizacion_id = p_cotizacion_id;
  perform p39_priv.cerrar(v_aut);
  return v_res;
end $$;

revoke all on function public.convertir_cotizacion_manual_controlada(bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.convertir_cotizacion_manual_controlada(bigint, uuid) to service_role;
