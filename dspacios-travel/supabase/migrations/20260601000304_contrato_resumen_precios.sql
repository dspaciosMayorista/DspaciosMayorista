-- ───────────────────────────────────────────────────────────
-- 304 · RESUMEN DE PRECIOS DEL CLIENTE CONGELADO EN EL CONTRATO (#94)
--
-- QUÉ RESUELVE
-- La cotización de Tarifario guarda el resumen de precios por pasajero (`cotizaciones.detalle.resumenPrecios`, #94/#52). Al convertirla en contrato ese resumen se
-- perdía: el contrato (ficha interna, enlace público, impresión y PDF) volvía a mostrar importes por ítem. Aquí se guarda, por contrato, el resumen que le corresponde
-- (las unidades de SU grupo), para que los documentos lo lean sin recalcular nada.
--
-- DISEÑO
--   · Tabla aparte (no una columna de `ventas`): `venta` solo lee `ventas_basica` (144). El resumen contiene SOLO importes de cara al cliente (grupos de pasajeros,
--     tarifa, subtotal, nombres de lo incluido): nunca costos, comisiones ni proveedores.
--   · Una fila por contrato (PK = `numero_contrato`), `ON DELETE CASCADE` desde `ventas`: `eliminar_contrato` y `revertir_contrato_incompleto` la limpian, y un número
--     reutilizado (#75) NUNCA hereda el resumen del contrato anterior (la fila muere con su venta).
--   · CHECK ESTRICTO (`p94_resumen_valido`): versión, modalidad, moneda, claves y tipos de cada unidad y grupo; rechaza nulos, estructura incompleta y sumas que no cuadran.
--   · Lectura por HERENCIA (`puede_ver_contrato`, 141/144). Escritura: NINGUNA policy para `authenticated`; solo `service_role` (la conversión del servidor).
--   · Guardas de identidad (284): clasificada `estricto` e instalada; la escritura del servidor declara la identidad del contrato como el resto de sus hijas.
--   · Elegibilidad #75 (289): es PREPARACIÓN, no un compromiso real; no impide eliminar y reutilizar el consecutivo. `dtm_reuso_bloqueos` se redefine igual que la 289
--     (cuerpo idéntico + este nombre en la lista de preparación), con comprobación del md5 de la 289 para no pisar una versión distinta.
--   · Sin backfill: un contrato histórico sin snapshot NO recibe un reparto inventado.
--   · El documento solo lo usa si `resumenAplicable()` lo confirma contra el acuerdo vigente (modalidad, moneda y total exigible).
--
-- Exige 284 y 289. Aditiva e idempotente. Rollback: supabase/scripts/rollback_304_contrato_resumen_precios.sql
-- ───────────────────────────────────────────────────────────
begin;

do $$
begin
  if to_regclass('public.contrato_guardas_config') is null then raise exception '304: falta la 284 (guardas de identidad).'; end if;
  if to_regprocedure('public.dtm_reuso_bloqueos(text,boolean)') is null then raise exception '304: falta la 289 (elegibilidad DTM).'; end if;
  -- Idempotente: si la 304 ya la redefinió (su comentario lo dice) no se vuelve a comparar contra la 289.
  if coalesce(obj_description('public.dtm_reuso_bloqueos(text,boolean)'::regprocedure, 'pg_proc'), '') not like '%304 (#94%'
     and md5(replace((select prosrc from pg_proc where oid = 'public.dtm_reuso_bloqueos(text,boolean)'::regprocedure), chr(13), '')) is distinct from '9335ed80ca236f434802527daaeeb10d' then
    raise exception '304: dtm_reuso_bloqueos no es la de la 289; no se reemplaza.';
  end if;
end $$;

-- ── 1) Validación estricta del resumen ───────────────────────────────────
create or replace function public.p94_entero(j jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_typeof(j), '') = 'number' and (j #>> '{}') ~ '^[0-9]{1,15}$'
$$;

create or replace function public.p94_resumen_valido(r jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  u jsonb; g jsonb; s jsonb;
  suma_u bigint; suma_total bigint := 0;
begin
  if r is null or jsonb_typeof(r) <> 'object' then return false; end if;
  if r->'version' is distinct from '1'::jsonb then return false; end if;
  if coalesce(jsonb_typeof(r->'modalidad'), '') <> 'string' or (r->>'modalidad') not in ('pvp', 'neto') then return false; end if;
  if coalesce(jsonb_typeof(r->'moneda'), '') <> 'string' or btrim(r->>'moneda') = '' then return false; end if;
  if not public.p94_entero(r->'totalCentavos') then return false; end if;
  if coalesce(jsonb_typeof(r->'unidades'), '') <> 'array' or jsonb_array_length(r->'unidades') = 0 then return false; end if;
  for u in select value from jsonb_array_elements(r->'unidades') loop
    if jsonb_typeof(u) <> 'object' then return false; end if;
    if coalesce(jsonb_typeof(u->'ref'), '') <> 'string' or btrim(u->>'ref') = '' then return false; end if;
    if not public.p94_entero(u->'ajusteCentavos') or not public.p94_entero(u->'totalCentavos') then return false; end if;
    if coalesce(jsonb_typeof(u->'grupos'), '') <> 'array' or jsonb_array_length(u->'grupos') = 0 then return false; end if;
    suma_u := (u->>'ajusteCentavos')::bigint;
    for g in select value from jsonb_array_elements(u->'grupos') loop
      if jsonb_typeof(g) <> 'object' then return false; end if;
      if coalesce(jsonb_typeof(g->'tipo'), '') <> 'string' or (g->>'tipo') not in ('adulto', 'nino', 'nino2', 'infante') then return false; end if;
      if not public.p94_entero(g->'cantidad') or (g->>'cantidad')::bigint < 1 then return false; end if;
      if not public.p94_entero(g->'tarifaCentavos') or not public.p94_entero(g->'subtotalCentavos') then return false; end if;
      if (g->>'subtotalCentavos')::bigint <> (g->>'cantidad')::bigint * (g->>'tarifaCentavos')::bigint then return false; end if;
      if coalesce(jsonb_typeof(g->'incluye'), '') <> 'array' then return false; end if;
      for s in select value from jsonb_array_elements(g->'incluye') loop
        if jsonb_typeof(s) <> 'string' then return false; end if;
      end loop;
      if coalesce(jsonb_typeof(g->'cupos'), '') <> 'array' then return false; end if;
      for s in select value from jsonb_array_elements(g->'cupos') loop
        if jsonb_typeof(s) <> 'string' then return false; end if;
      end loop;
      suma_u := suma_u + (g->>'subtotalCentavos')::bigint;
    end loop;
    if suma_u <> (u->>'totalCentavos')::bigint then return false; end if;
    suma_total := suma_total + suma_u;
  end loop;
  return suma_total = (r->>'totalCentavos')::bigint;
end $$;

-- ── 2) La tabla ──────────────────────────────────────────────────────────
create table if not exists public.contrato_resumen_precios (
  numero_contrato text primary key references public.ventas(numero_contrato) on delete cascade,
  resumen jsonb not null,
  created_at timestamptz not null default now(),
  constraint contrato_resumen_precios_valido check (public.p94_resumen_valido(resumen))
);
comment on table public.contrato_resumen_precios is
  '#94 · Resumen de precios del cliente (grupos de pasajeros, tarifa por persona y subtotal) congelado al convertir la cotización. Solo importes de cara al cliente.';

alter table public.contrato_resumen_precios enable row level security;
drop policy if exists contrato_resumen_precios_select on public.contrato_resumen_precios;
create policy contrato_resumen_precios_select on public.contrato_resumen_precios
  for select to authenticated using (public.puede_ver_contrato(numero_contrato));

revoke all on public.contrato_resumen_precios from anon;
revoke all on public.contrato_resumen_precios from authenticated;
grant select on public.contrato_resumen_precios to authenticated;
grant select, insert, update, delete on public.contrato_resumen_precios to service_role;

-- ── 3) Guardas de identidad (284): estricta, como las demás hijas escritas por número ──
insert into public.contrato_guardas_config (tabla, modo, motivo)
values ('contrato_resumen_precios', 'estricto', 'resumen de precios del cliente congelado al convertir (#94)')
on conflict (tabla) do nothing;
select public.contrato_instalar_guardas();

-- ── 4) Elegibilidad #75 (289): preparación, no compromiso. Cuerpo de la 289 + este nombre en `prep`. ──
create or replace function public.dtm_reuso_bloqueos(p_numero text, p_vivo boolean)
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b    text[] := '{}';
  v    public.ventas%rowtype;
  j    jsonb;
  k    text;
  r    record;
  x    boolean;
  -- Campos de `ventas` que deben seguir vacíos: facturación emitida y agrupación de conversión de varios contratos. El resto de los campos comerciales ES preparación.
  campos constant text[] := array['facturado','numero_documento','grupo_conversion'];
  -- Tablas de PREPARACIÓN: no bloquean por existir. Las que tienen estado real se comprueban aparte más abajo (sillas, vuelo, facturación, CxP, comisión, plan #97).
  prep constant text[] := array[
    'contrato_alojamiento_bernalo','contrato_condiciones','contrato_financiero_pendiente','contrato_hoteles','contrato_items','contrato_obligaciones_previstas',
    'contrato_pasajeros','contrato_programa_estancia','contrato_programa_estancia_costo','contrato_servicios','contrato_vuelos','restriccion_overrides','cuotas',
    'rentabilidad','avisos','cotizaciones','comision_plan','contrato_facturacion','contrato_vuelo_control','sillas','cuentas_por_pagar','aliados_b2b',
    'contrato_resumen_precios'];
begin
  begin
    if p_numero is null or p_numero !~ '^DTM-[0-9]{4,}$' then
      return array['NO_ES_DTM'];
    end if;

    select * into v from public.ventas where numero_contrato = p_numero;
    if p_vivo then
      if not found then return array['NO_EXISTE']; end if;
      if not coalesce((select c.habilitado from public.dtm_reuso_config c limit 1), false) then
        b := b || 'REUSO_DESHABILITADO'::text;
      end if;
      if v.tenant is distinct from 'mayorista' then b := b || 'TENANT_NO_MAYORISTA'::text; end if;
      if v.estado is distinct from 'pendiente' then
        b := b || ('ESTADO_ACTUAL_' || upper(coalesce(v.estado, 'NULL')));
      end if;
      if v.financiero_estado is distinct from 'completo' then b := b || 'FINANCIERO_INCOMPLETO'::text; end if;
      -- «Nunca confirmado»: el estado actual no lo prueba; lo prueba la historia de auditoría de `ventas`.
      if not exists (select 1 from public.auditoria a
                      where a.tabla = 'ventas' and a.accion = 'INSERT' and a.registro_id = p_numero) then
        b := b || 'SIN_EVENTO_DE_CREACION_EN_AUDITORIA'::text;
      end if;
      if exists (select 1 from public.auditoria a
                  where a.tabla = 'ventas' and a.registro_id = p_numero
                    and ((a.antes is not null and a.antes->>'estado' is distinct from 'pendiente')
                      or (a.despues is not null and a.despues->>'estado' is distinct from 'pendiente'))) then
        b := b || 'ESTADO_DISTINTO_DE_PENDIENTE_EN_HISTORIA'::text;
      end if;
      j := to_jsonb(v);
      foreach k in array campos loop
        if not public.dtm_valor_vacio(j->>k) then b := b || ('CAMPO_COMERCIAL_' || upper(k)); end if;
      end loop;
    elsif found then
      b := b || 'EXISTE_EN_VENTAS'::text;
    end if;

    -- Relaciones: toda tabla del esquema public con columna numero_contrato / contrato_numero o FK hacia ventas. Las de PREPARACIÓN se saltan; cualquier otra (incluida una futura) bloquea.
    for r in
      select distinct t.relname::text as tabla, t.col
        from (
          select c.relname, a.attname::text as col
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           where c.relkind in ('r', 'p') and a.attname in ('numero_contrato', 'contrato_numero')
          union
          select c.relname, a.attname::text
            from pg_constraint k
            join pg_class c on c.oid = k.conrelid
            join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
           where k.contype = 'f' and k.confrelid = 'public.ventas'::regclass
        ) t
       where t.relname <> 'ventas' and not (t.relname = any (prep))
       order by 1
    loop
      begin
        execute format('select exists (select 1 from public.%I where %I = $1)', r.tabla, r.col) into x using p_numero;
        if x then b := b || ('RELACION_' || upper(r.tabla)); end if;
      exception when others then
        b := b || ('LECTURA_FALLIDA_' || upper(r.tabla));
      end;
    end loop;

    -- Estado real de las tablas de preparación que pueden esconder un compromiso. Cada comprobación falla cerrado de forma independiente.
    begin   -- sillas: solo las asignaciones en plazo se liberan; confirmada, emitida, cambio, etc. bloquean
      if exists (select 1 from public.sillas s where s.numero_contrato = p_numero and s.estado is distinct from 'en_plazo') then b := b || 'SILLAS_NO_LIBERABLES'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_SILLAS'::text; end;

    begin   -- vuelo emitido
      if exists (select 1 from public.contrato_vuelo_control c where c.numero_contrato = p_numero and coalesce(c.estado_emision, 'pendiente') is distinct from 'pendiente') then b := b || 'VUELO_EMITIDO'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_VUELO_CONTROL'::text; end;

    begin   -- clasificación contable ya presentada a la DIAN o con asiento/revisión
      if exists (select 1 from public.contrato_facturacion f where f.numero_contrato = p_numero
                  and (coalesce(f.dian_emitida, false) or f.asiento_factura_id is not null or f.revision_id is not null)) then b := b || 'FACTURACION_EMITIDA'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_CONTRATO_FACTURACION'::text; end;

    begin   -- CxP: sin pagos, sin retenciones y sin protección #63
      if exists (select 1 from public.cuentas_por_pagar c join public.cxp_pagos p on p.cuenta_por_pagar_id = c.id where c.numero_contrato = p_numero) then b := b || 'CXP_CON_PAGOS'::text; end if;
      if exists (select 1 from public.cuentas_por_pagar c join public.retenciones_cxp p on p.cuenta_por_pagar_id = c.id where c.numero_contrato = p_numero) then b := b || 'CXP_CON_RETENCIONES'::text; end if;
      if exists (select 1 from public.cuentas_por_pagar c where c.numero_contrato = p_numero and c.aceptacion_63_id is not null) then b := b || 'CXP_63_PROTEGIDA'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_CXP'::text; end;

    begin   -- comisión: solo la ya DESCONTADA en el precio (NETO), sin pagos ni revisiones, es preparación
      if exists (select 1 from public.aliados_b2b a where a.numero_contrato = p_numero and not coalesce(a.descontada_en_precio, false)) then b := b || 'COMISION_EXIGIBLE'::text; end if;
      if exists (select 1 from public.aliados_b2b a join public.comision_b2b_pagos p on p.aliado_b2b_id = a.id where a.numero_contrato = p_numero) then b := b || 'COMISION_CON_PAGOS'::text; end if;
      if exists (select 1 from public.aliados_b2b a join public.comision_b2b_revision p on p.aliado_b2b_id = a.id where a.numero_contrato = p_numero) then b := b || 'COMISION_CON_REVISION'::text; end if;
    exception when others then b := b || 'LECTURA_FALLIDA_COMISION'::text; end;

    begin   -- plan de comisión de #97 (solo inserción): se borra con el contrato SOLO si la 286 aplicada trae la versión esperada de la liberación (LIBERACION_PLAN_V2, por contrato_uid) y el plan no está materializado
      if p_vivo and to_regclass('public.comision_plan') is not null then
        execute 'select exists (select 1 from public.comision_plan where contrato_uid = $1)' into x using v.contrato_uid;
        if x then
          if coalesce(obj_description(to_regprocedure('p97_priv.tg_solo_insercion()'), 'pg_proc'), '') not like 'LIBERACION_PLAN_V2:%' then
            b := b || 'PLAN_COMISION_SIN_LIBERACION_97'::text;
          end if;
          execute 'select exists (select 1 from public.comision_plan c join public.aliados_b2b a on a.plan_id = c.id where c.contrato_uid = $1 and not coalesce(a.descontada_en_precio, false))' into x using v.contrato_uid;
          if x then b := b || 'PLAN_COMISION_MATERIALIZADO'::text; end if;
        end if;
      end if;
    exception when others then b := b || 'LECTURA_FALLIDA_PLAN_COMISION'::text; end;

    begin
      if exists (select 1 from storage.objects o where starts_with(o.name, p_numero || '/')) then
        b := b || 'ARCHIVOS_EN_STORAGE'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_STORAGE'::text;
    end;

    -- Referencias MANUALES de texto (sillas.contrato_manual): sin FK ni columna numero_contrato; una silla que apunta al contrato por referencia manual bloquea el número.
    begin
      if exists (select 1 from (select distinct s.contrato_manual as ref from public.sillas s where s.contrato_manual is not null) m
                  where exists (select 1 from public._resolver_contrato_manual(m.ref) rm where rm.numero_contrato = p_numero)) then
        b := b || 'REFERENCIA_MANUAL_EN_SILLA'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_REFERENCIA_MANUAL'::text;
    end;

    begin
      if exists (select 1 from public.asientos_contables s
                  where s.referencia ~ ('(^|[^0-9A-Za-z])' || p_numero || '($|[^0-9])')
                     or s.descripcion ~ ('(^|[^0-9A-Za-z])' || p_numero || '($|[^0-9])')) then
        b := b || 'ASIENTOS_CONTABLES'::text;
      end if;
    exception when others then
      b := b || 'LECTURA_FALLIDA_ASIENTOS'::text;
    end;

    return b;
  exception when others then
    return array['LECTURA_FALLIDA: ' || sqlerrm];
  end;
end;
$$;
comment on function public.dtm_reuso_bloqueos(text, boolean) is
  'Migración 289 (#75) + 304 (#94: contrato_resumen_precios es preparación). Motivos por los que un DTM NO puede liberarse (vivo=true) o reutilizarse (vivo=false); vacío = candidato elegible. La PREPARACIÓN no bloquea; los compromisos reales sí; lo no clasificado bloquea (falla cerrado).';
revoke all on function public.dtm_reuso_bloqueos(text, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
