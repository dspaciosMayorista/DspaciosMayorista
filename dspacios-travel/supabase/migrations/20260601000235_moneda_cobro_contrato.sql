-- ───────────────────────────────────────────────────────────────────────────
-- 235 · MONEDA DE COBRO DEL CONTRATO (#90 Entrega F · #63)
--
-- QUÉ YA RESOLVIÓ LA 234 (no se rehace)
--   · La oferta #63 se publica, se cotiza y se contrata en COP o USD (la ELEGIDA por el paquete) y el contrato nace en esa moneda.
--   · Paquete USD con TODAS las fuentes en USD publica y cotiza SIN TRM; la oferta USD sin TRM exige la TRM PROVISIONAL ingresada al contratar,
--     que se congela (p63_aceptacion.trm_provisional) antes de numerar y de crear CxP o asientos en COP.
--   · Las CxP conservan su moneda de origen con su equivalente COP congelado. Nada de eso cambia aquí.
--
-- QUÉ FALTABA (decisión del dueño, #90 F)
--   Hasta la 234, la moneda de cobro era SIEMPRE la de la oferta (ventas.moneda). Ahora quien convierte la cotización a contrato DEBE elegir,
--   de forma EXPRESA, COP o USD para COBRAR (no hay valor por defecto: omitirla se rechaza ANTES de reservar el número):
--     · Misma moneda que la oferta: sin conversión, sin TRM de cobro (la elección igualmente queda registrada).
--     · Moneda distinta: el total a cobrar se convierte UNA sola vez, con la TRM de COBRO que INGRESA quien contrata (positiva y finita; sin respaldo
--       en trm_referencia ni reutilización silenciosa de la TRM de publicación), sobre el importe final aceptado (plan B2B ya aplicado). Se redondea como
--       las ventas (COP al mil hacia arriba, USD al dólar hacia arriba) y se CONGELA en la aceptación y en el contrato.
--   La oferta conserva su moneda e importes (ventas.moneda, ventas.precio_venta, costos y CxP no se reconvierten). La comisión B2B queda en la
--   moneda de la oferta. Solo el personal interno puede elegir una moneda de cobro distinta (se valida en el servidor).
--
-- QUÉ HACE (ADITIVA; la 227 y la 234 no se editan: sus funciones se reemplazan con CREATE OR REPLACE / DROP+CREATE)
--   1. ventas y p63_aceptacion: moneda_cobro, trm_cobro, total_cobro (NULL = contrato anterior o fuera del modo 63: se cobra en ventas.moneda).
--      CHECK de coherencia: sin conversión ⇒ sin TRM ni total; con conversión ⇒ TRM y total positivos.
--   2. p63_total_cobro(base, moneda de la oferta, moneda de cobro, TRM): la ÚNICA fórmula de conversión (USD→COP × TRM, COP→USD / TRM, a centavos y
--      luego redondeo de venta). NULL si no hay conversión.
--   3. aceptar_oferta_63 gana p_moneda_cobro y p_trm_cobro (la firma de 6 argumentos se elimina). Para un intento NUEVO p_moneda_cobro es OBLIGATORIA
--      (p63_cobro_requerido, sin numerar). Un reintento de un intento 'preparada' ya existente NO numera y devuelve lo congelado; ahí p_moneda_cobro
--      puede venir NULL (compatibilidad: reintento tras caída y aceptaciones anteriores a la 235 con cobro NULL, que se cobran en la moneda de la
--      oferta); una elección distinta de la congelada se rechaza (p63_cobro_cambio). Devuelve 'cobro' {moneda, trm, total}.
--      Defensa en profundidad: trg_p63_aceptacion_cobro_requerido impide insertar cualquier aceptación NUEVA sin moneda de cobro.
--   4. trg_ventas_aceptacion_63_ins: la cabecera lleva EXACTAMENTE la moneda de cobro, la TRM y el total congelados en el intento.
--   5. trg_p63_inmutable: la elección de cobro de una aceptación no se modifica.
--   6. trg_ventas_cobro_congelado: en un contrato con conversión de cobro, ni la elección ni la moneda ni el precio_venta se editan (el total
--      convertido dejaría de ser coherente); y la elección de cobro de cualquier contrato no se cambia después de creada.
--   7. ventas_basica (la vista del rol venta) expone moneda_cobro, trm_cobro y total_cobro, para que el asesor vea cuánto se cobra y en qué
--      moneda sin tocar la tabla base (CREATE OR REPLACE con las columnas AL FINAL; el resto de la definición queda idéntico a la 156).
--   8. fn_dashboard_cartera_por_moneda: moneda, total y abonos en la moneda de COBRO congelada (histórico/NULL: igual que antes).
--   9. Facturación: f208_priv.importes_factura rechaza (F4451 FIN_COBRO_OTRA_MONEDA) un contrato cuyo cobro difiere de la oferta, y un trigger sobre
--      contrato_facturacion lo respalda; restringe public.facturar_factura mientras el tratamiento contable (fase C) esté pendiente.
--
-- QUÉ NO HACE
--   No toca datos existentes (las columnas nuevas quedan NULL en todo lo anterior), ACL de otras funciones, RLS ni CxP. No cubre la mezcla general
--   de monedas fuera del modo 63 (E) ni diferencias de cambio contables (C): quedan fuera de este corte.
--
-- ORDEN DE DESPLIEGUE: la 234 aplicada primero. La 235 se aplica INMEDIATAMENTE ANTES del despliegue del código nuevo, no con antelación: el código
--   anterior llama aceptar_oferta_63 con seis argumentos (p_trm_provisional como último) y, una vez aplicada la 235, esa llamada NO puede crear nuevas
--   aceptaciones #63 — la RPC responde p63_cobro_requerido (sin reservar número ni gastar consecutivo) porque exige la elección expresa de la moneda de
--   cobro, que solo el código nuevo envía. Hay por tanto una interrupción BREVE y CONTROLADA de la conversión de cotizaciones #63 a contrato entre la
--   aplicación de la 235 y el fin del despliegue del código nuevo; el resto de la aplicación no se ve afectado. Un reintento de un intento ya aceptado
--   (preparada) sí se sigue atendiendo sin elección (devuelve lo congelado y no numera). Tampoco se puede desplegar el código nuevo ANTES de la 235:
--   llama a una firma de ocho argumentos que aún no existe. Por eso se aplican seguidas, con la 235 primero y el despliegue inmediatamente después.
-- Rollback: supabase/scripts/rollback_235_moneda_cobro.sql (se niega si ya hay contratos o aceptaciones con conversión de cobro).
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ═══ 0. Prerrequisitos (fallan cerrado) ═══════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ventas' and column_name = 'moneda_cobro') then
    raise exception '235 ya aplicada (existe ventas.moneda_cobro). No se re-aplica.';
  end if;
  if to_regprocedure('public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'p63_aceptacion' and column_name = 'trm_provisional')
     or to_regprocedure('public.trg_p63_inmutable()') is null
     or to_regprocedure('public.trg_ventas_aceptacion_63_ins()') is null then
    raise exception '235 ABORTADA: falta la 234 (aceptar_oferta_63 con p_trm_provisional y p63_aceptacion.trm_provisional).';
  end if;
end $$;

-- ═══ 1. Columnas y coherencia ═════════════════════════════════════════════
alter table public.ventas
  add column moneda_cobro text,
  add column trm_cobro numeric(15,4),
  add column total_cobro numeric(18,2);
alter table public.ventas add constraint ventas_cobro_chk check (
  (moneda_cobro is null and trm_cobro is null and total_cobro is null)
  or (moneda_cobro in ('COP', 'USD') and (
        (moneda_cobro = coalesce(moneda, 'COP') and trm_cobro is null and total_cobro is null)
     or (moneda_cobro <> coalesce(moneda, 'COP') and coalesce(trm_cobro, 0) > 0 and coalesce(total_cobro, 0) > 0)))
);
comment on column public.ventas.moneda_cobro is
  'Moneda en la que se COBRA el contrato (COP/USD). NULL = contrato anterior o fuera del modo 63: se cobra en ventas.moneda. Si difiere de ventas.moneda, el total a cobrar es total_cobro (conversión única con trm_cobro, congelada). Migración 235.';
comment on column public.ventas.trm_cobro is 'TRM (COP por USD) ingresada al contratar para convertir el total a cobrar; solo si moneda_cobro difiere de moneda. Congelada. Migración 235.';
comment on column public.ventas.total_cobro is 'Total a cobrar en moneda_cobro (precio_venta convertido UNA vez con trm_cobro y redondeado como una venta). NULL si no hay conversión. Migración 235.';

alter table public.p63_aceptacion
  add column moneda_cobro text,
  add column trm_cobro numeric(15,4),
  add column total_cobro numeric(18,2);
alter table public.p63_aceptacion add constraint p63_aceptacion_cobro_chk check (
  (moneda_cobro is null and trm_cobro is null and total_cobro is null)
  or (moneda_cobro in ('COP', 'USD') and ((trm_cobro is null and total_cobro is null) or (coalesce(trm_cobro, 0) > 0 and coalesce(total_cobro, 0) > 0)))
);
comment on column public.p63_aceptacion.moneda_cobro is 'Moneda de cobro elegida al contratar (congelada con el intento). NULL = aceptación anterior a la 235 (se cobra en la moneda de la oferta). Migración 235.';

-- ═══ 2. La única fórmula de conversión de cobro ═══════════════════════════
create or replace function public.p63_total_cobro(p_base numeric, p_moneda_oferta text, p_moneda_cobro text, p_trm numeric)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $fn$
  select case
    when p_base is null or p_moneda_oferta is null or p_moneda_cobro is null or p_moneda_oferta = p_moneda_cobro then null
    when p_trm is null or p_trm <= 0 then null
    when p_moneda_cobro = 'COP' then ceil(round(p_base * p_trm, 2) / 1000) * 1000
    else ceil(round(p_base / p_trm, 2))
  end
$fn$;
comment on function public.p63_total_cobro(numeric, text, text, numeric) is
  '235: total a cobrar cuando la moneda de cobro difiere de la de la oferta: USD→COP = base × TRM (COP al mil hacia arriba); COP→USD = base / TRM (USD al dólar hacia arriba); a centavos antes de redondear. NULL si no hay conversión o falta una entrada. Espejo de lib/finanzas/cobro.ts.';
revoke all on function public.p63_total_cobro(numeric, text, text, numeric) from public, anon, authenticated;

-- ═══ 3. La elección de cobro de una aceptación no se modifica ═════════════
create or replace function public.trg_p63_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'p63_historico: % es historia de lo aceptado y no se borra', tg_table_name;
  end if;
  if tg_table_name = 'p63_oferta' then
    if new.cotizacion_id is distinct from old.cotizacion_id or new.tenant is distinct from old.tenant
       or new.paquete_id is distinct from old.paquete_id or new.salida_id is distinct from old.salida_id
       or new.trm is distinct from old.trm or new.rev_fuente is distinct from old.rev_fuente
       or new.rev_publicada is distinct from old.rev_publicada or new.gen_publicada is distinct from old.gen_publicada
       or new.rev_costos is distinct from old.rev_costos or new.huella is distinct from old.huella
       or new.huella_financiera is distinct from old.huella_financiera or new.snapshot is distinct from old.snapshot
       or new.creada_en is distinct from old.creada_en then
      raise exception 'p63_inmutable: el snapshot y la identidad de una oferta cotizada no se modifican';
    end if;
  else
    if new.oferta_id is distinct from old.oferta_id or new.cotizacion_id is distinct from old.cotizacion_id
       or new.tenant is distinct from old.tenant or new.numero_contrato is distinct from old.numero_contrato
       or new.usuario_id is distinct from old.usuario_id or new.fecha_negocio is distinct from old.fecha_negocio
       or new.snapshot is distinct from old.snapshot or new.creada_en is distinct from old.creada_en
       or new.trm_provisional is distinct from old.trm_provisional
       or new.moneda_cobro is distinct from old.moneda_cobro or new.trm_cobro is distinct from old.trm_cobro
       or new.total_cobro is distinct from old.total_cobro then
      raise exception 'p63_inmutable: el snapshot y la identidad de una aceptación no se modifican';
    end if;
    if (old.estado = 'completa' and new.estado <> 'completa') or (old.estado = 'descartada' and new.estado <> 'descartada') then
      raise exception 'p63_inmutable: una aceptación % no vuelve a otro estado', old.estado;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.trg_p63_inmutable() from public, anon, authenticated;

-- ═══ 3b. Ninguna aceptación NUEVA nace sin moneda de cobro (la RPC es la única que inserta; esto lo hace estructural) ═══
create or replace function public.trg_p63_aceptacion_cobro_requerido()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.moneda_cobro is null then
    raise exception 'p63_cobro_requerido: una aceptación nueva debe llevar la moneda de cobro elegida';
  end if;
  return new;
end;
$fn$;
revoke all on function public.trg_p63_aceptacion_cobro_requerido() from public, anon, authenticated;
create trigger trg_p63_aceptacion_cobro_requerido
  before insert on public.p63_aceptacion
  for each row execute function public.trg_p63_aceptacion_cobro_requerido();

-- ═══ 4. aceptar_oferta_63 con la moneda de cobro ═════════════════════════
drop function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric);
create or replace function public.aceptar_oferta_63(
  p_cotizacion        bigint,
  p_tenant            text,
  p_usuario           uuid,
  p_huella            text,
  p_huella_financiera text,
  p_trm_provisional   numeric default null,
  p_moneda_cobro      text    default null,
  p_trm_cobro         numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o        public.p63_oferta;
  v_a        public.p63_aceptacion;
  v_s        public.salidas_dinamicas;
  v_e        public.empaquetados;
  v_snap     jsonb;
  v_paquete  bigint;
  v_salida   bigint;
  v_emp      bigint;
  v_hoy      date;
  v_activo   boolean;
  v_tipo     text;
  v_modo     text;
  v_trm      numeric;
  v_mp       text;
  v_trm_prov numeric;
  v_publica  boolean;
  v_rev_f    bigint;
  v_rev_p    bigint;
  v_gen_p    bigint;
  v_rev_c    bigint;
  v_numero   text;
  v_id       bigint;
  v_vig      jsonb;
  v_mo       text;
  v_mc       text;
  v_trm_c    numeric;
  v_total_c  numeric;
  v_base     numeric;
  v_b2b      jsonb;
begin
  if p_usuario is null or not exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo is true) then
    raise exception 'p63_no_autorizado: usuario inexistente o inactivo';
  end if;
  -- 235: forma de la moneda y la TRM de COBRO (la elección expresa de quien convierte). Nulas = se cobra en la moneda de la oferta, sin conversión.
  if p_moneda_cobro is not null and p_moneda_cobro not in ('COP', 'USD') then
    raise exception 'p63_cobro_invalido: la moneda de cobro debe ser COP o USD, recibida: %', p_moneda_cobro;
  end if;
  if p_trm_cobro is not null and (p_trm_cobro = 'NaN'::numeric or p_trm_cobro <= 0 or p_trm_cobro >= 100000000000 or round(p_trm_cobro, 4) <= 0) then
    raise exception 'p63_cobro_trm_invalida: la TRM de cobro debe ser un número positivo y finito (pesos por dólar), recibida: %', p_trm_cobro;
  end if;
  if p_moneda_cobro is null and p_trm_cobro is not null then
    raise exception 'p63_cobro_invalido: se envió una TRM de cobro sin indicar la moneda de cobro';
  end if;
  select * into v_o from public.p63_oferta where cotizacion_id = p_cotizacion;
  if not found then
    raise exception 'p63_sin_oferta: la cotización % no tiene una oferta en COP con TRM', p_cotizacion;
  end if;
  if v_o.tenant is distinct from p_tenant or p_tenant is distinct from 'mayorista' then
    raise exception 'p63_no_autorizado: la oferta no pertenece a la agencia indicada';
  end if;
  v_snap := v_o.snapshot;
  v_paquete := v_o.paquete_id;
  v_salida := v_o.salida_id;
  v_emp := nullif(v_snap ->> 'empaquetado_id', '')::bigint;
  v_mo := coalesce(nullif(v_snap ->> 'moneda', ''), 'COP');

  -- Candados en orden fijo.
  if v_emp is not null then
    perform 1 from public.empaquetados e where e.id = v_emp for share;
  end if;
  if v_salida is not null then
    perform 1 from public.salidas_dinamicas s where s.id = v_salida for share;
  end if;
  perform 1 from public.armado_paquetes p where p.id = v_paquete for no key update;
  select * into v_o from public.p63_oferta where id = v_o.id for update;

  -- Idempotencia: el mismo reintento recibe el MISMO intento (mismo número y mismo snapshot), nunca uno nuevo.
  select * into v_a from public.p63_aceptacion where oferta_id = v_o.id and estado <> 'descartada';
  if found then
    if v_a.estado = 'preparada' then
      -- 235: la moneda de cobro ya quedó CONGELADA con el intento. Un reintento que pida otra moneda u otra TRM no la cambia: se rechaza.
      if p_moneda_cobro is not null and (
           p_moneda_cobro is distinct from coalesce(v_a.moneda_cobro, v_mo)
           or (p_moneda_cobro is distinct from v_mo and round(p_trm_cobro, 4) is distinct from v_a.trm_cobro)) then
        raise exception 'p63_cobro_cambio: la moneda o la TRM de cobro de este contrato ya quedaron congeladas (%, TRM %); no se cambian en un reintento',
          coalesce(v_a.moneda_cobro, v_mo), coalesce(v_a.trm_cobro::text, 'sin conversión');
      end if;
      return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato,
                                'fecha_negocio', v_a.fecha_negocio, 'snapshot', v_a.snapshot,
                                'financiero', public.p63_financiero_derivado(v_a.id),
                                'cobro', jsonb_build_object('moneda', v_a.moneda_cobro, 'trm', v_a.trm_cobro, 'total', v_a.total_cobro));
    end if;
    return jsonb_build_object('estado', v_a.estado, 'aceptacion_id', v_a.id, 'numero_contrato', v_a.numero_contrato);
  end if;
  if v_o.estado <> 'abierta' then
    raise exception 'p63_oferta_cerrada: la oferta de la cotización % ya fue convertida y no se reabre; genera una cotización nueva', p_cotizacion;
  end if;
  -- 235: un intento NUEVO exige la elección EXPRESA de la moneda de cobro (COP o USD, también cuando es la misma de la oferta). Se valida antes de
  -- revalidar, de reservar el número y de crear nada. (El reintento de un intento existente ya salió arriba con lo congelado.)
  if p_moneda_cobro is null then
    raise exception 'p63_cobro_requerido: elige la moneda de cobro (COP o USD) antes de generar el contrato';
  end if;

  -- Revalidación en ESTE instante (hora de Bogotá).
  v_hoy := public.p63_hoy_bogota();
  select p.activo, p.tipo::text, p.modo_oferta, p.trm_oferta, p.tarifario_snapshot_publicable, p.tarifario_revision_fuente,
         p.tarifario_revision_publicada, p.tarifario_generacion_publicada, p.p63_rev_costos, p.moneda_publicacion
    into v_activo, v_tipo, v_modo, v_trm, v_publica, v_rev_f, v_rev_p, v_gen_p, v_rev_c, v_mp
    from public.armado_paquetes p where p.id = v_paquete;
  if not found or v_activo is not true or v_tipo is distinct from 'dinamico' or v_modo is distinct from 'cop_trm_63' then
    raise exception 'p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM';
  end if;
  if v_trm is distinct from v_o.trm then
    raise exception 'p63_oferta_cambio: la TRM del paquete cambió desde la cotización';
  end if;
  -- 234: la moneda de la oferta es la que se cotizó; si el paquete cambió de moneda de publicación desde entonces, no se acepta.
  if coalesce(v_mp, 'COP') is distinct from coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') then
    raise exception 'p63_oferta_cambio: la moneda de publicación del paquete cambió desde la cotización';
  end if;
  -- 233/234 (#93): una oferta cotizada SIN TRM no se acepta si ahora hay una fuente que convertir (o cambió la moneda) y el paquete sigue sin TRM.
  if v_trm is null and public.p63_requiere_trm(v_paquete) then
    raise exception 'p63_oferta_cambio: ahora hay componentes en USD y el paquete no tiene TRM; genera una cotización nueva';
  end if;
  if v_publica is not true or v_rev_p is distinct from v_o.rev_publicada or v_gen_p is distinct from v_o.gen_publicada then
    raise exception 'p63_oferta_cambio: el tarifario publicado del paquete cambió desde la cotización';
  end if;
  if v_rev_f is distinct from v_o.rev_fuente or v_rev_c is distinct from v_o.rev_costos then
    raise exception 'p63_oferta_cambio: una fuente, un costo, un proveedor o una retención del paquete cambió desde la cotización';
  end if;
  if p_huella is distinct from v_o.huella or p_huella_financiera is distinct from v_o.huella_financiera then
    raise exception 'p63_oferta_cambio: el precio, el vuelo o los costos recalculados ya no coinciden con lo cotizado';
  end if;

  if v_salida is not null then
    select * into v_s from public.salidas_dinamicas where id = v_salida;
    if not found or v_s.paquete_id is distinct from v_paquete or v_s.activo is not true then
      raise exception 'p63_oferta_cambio: la salida ya no existe o fue desactivada';
    end if;
    if v_s.empaquetado_id is distinct from v_emp then
      raise exception 'p63_oferta_cambio: el vínculo de la salida con Empaquetados cambió';
    end if;
    if (v_s.compra_inicio is not null and v_hoy < v_s.compra_inicio) or (v_s.compra_fin is not null and v_hoy > v_s.compra_fin) then
      raise exception 'p63_oferta_cambio: la salida está fuera de su vigencia de compra';
    end if;
    if v_s.fecha_ida is null or v_s.fecha_ida < v_hoy then
      raise exception 'p63_oferta_cambio: la fecha de la salida ya pasó';
    end if;
    if v_emp is not null then
      select * into v_e from public.empaquetados where id = v_emp;
      if not found or v_e.activo is not true then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya no existe o fue desactivado';
      end if;
      if nullif(btrim(coalesce(v_e.record, '')), '') is not null then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado ya tiene record (PNR)';
      end if;
      if (v_e.compra_inicio is not null and v_hoy < v_e.compra_inicio) or (v_e.compra_fin is not null and v_hoy > v_e.compra_fin)
         or v_e.fecha_ida is null or v_e.fecha_ida < v_hoy then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado está fuera de vigencia';
      end if;
      -- 230: el vuelo vinculado puede estar en COP o en USD (se convierte × TRM al publicar y al cotizar); sin moneda válida o sin tarifa, no.
      if v_e.moneda is null or v_e.moneda not in ('COP', 'USD') or coalesce(v_e.tarifa_para_empaquetar, 0) <= 0 then
        raise exception 'p63_oferta_cambio: el vuelo de Empaquetados vinculado no tiene una moneda válida (COP o USD) o no tiene tarifa';
      end if;
      if round(coalesce(v_s.valor_tiquete, 0), 2) is distinct from round(v_e.tarifa_para_empaquetar, 2)
         or round(coalesce(v_s.fee_infante, 0), 2) is distinct from round(coalesce(v_e.fee_infante, 0), 2)
         or v_s.moneda is distinct from v_e.moneda
         or v_s.fecha_ida is distinct from v_e.fecha_ida or v_s.fecha_regreso is distinct from v_e.fecha_regreso
         or coalesce(v_s.ruta, '') is distinct from coalesce(v_e.ruta, '')
         or coalesce(v_s.aerolinea, '') is distinct from coalesce(v_e.aerolinea, '') then
        raise exception 'p63_oferta_cambio: la salida ya no coincide con su vuelo de Empaquetados';
      end if;
      -- Destino aéreo permitido (220/#67): misma guarda que al vincular. Re-entra en el candado del paquete que ya tenemos.
      perform public.validar_vinculo_aereo_67(v_paquete, 'empaquetado', v_emp);
    end if;
  end if;

  -- Vigencia de COMPRA de las tarifas de hotel y servicios que respaldan el precio (snapshot.vigencias: la temporada/promoción que ganó cada noche
  -- o cada servicio, con sus límites de compra, tal como se leyeron al cotizar). Con la fecha de negocio de Bogotá de ESTA transacción: una tarifa
  -- cuya compra cerró (o aún no abre) se rechaza aunque ningún UPDATE haya movido una revisión (cruce de medianoche).
  for v_vig in select e from jsonb_array_elements(coalesce(v_snap -> 'vigencias', '[]'::jsonb)) as e loop
    if (nullif(v_vig ->> 'compra_inicio', '') is not null and v_hoy < (v_vig ->> 'compra_inicio')::date)
       or (nullif(v_vig ->> 'compra_fin', '') is not null and v_hoy > (v_vig ->> 'compra_fin')::date) then
      raise exception 'p63_oferta_cambio: la tarifa "%" de % ya no está en su vigencia de compra', v_vig ->> 'ref', v_vig ->> 'origen';
    end if;
  end loop;

  -- 234: una oferta en USD SIN TRM (todas sus fuentes en USD, nada que convertir) tiene obligaciones en USD que la contabilidad (en pesos)
  -- devenga por su equivalente COP. Esa TRM PROVISIONAL la INGRESA expresamente quien convierte la cotización a contrato y queda CONGELADA en la
  -- aceptación (inmutable): las CxP y los asientos en COP salen de ella y no se mueven después. NO hay respaldo automático en
  -- el parámetro de TRM de referencia (aunque exista y sea válido): sin tasa ingresada no se contrata ni se reserva número (nunca 1 ni el
  -- nominal en dólares como pesos). Esto incluye la llamada de 5 argumentos: el 6.º parámetro vale NULL por defecto y entonces se rechaza.
  if v_o.trm is null and coalesce(nullif(v_snap ->> 'moneda', ''), 'COP') = 'USD' then
    if p_trm_provisional is null then
      raise exception 'p63_trm_requerida: la oferta está en USD sin TRM: quien la convierte a contrato debe ingresar la TRM provisional (pesos por dólar) para congelar el equivalente en COP de las obligaciones';
    end if;
    -- Debe ser finita y positiva (y no redondear a 0 con 4 decimales).
    if p_trm_provisional = 'NaN'::numeric or p_trm_provisional <= 0 or p_trm_provisional >= 100000000000 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo y finito (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
    v_trm_prov := round(p_trm_provisional, 4);
    if v_trm_prov <= 0 then
      raise exception 'p63_trm_invalida: la TRM provisional debe ser un número positivo (pesos por dólar), recibida: %', p_trm_provisional;
    end if;
  end if;

  -- 235: MONEDA DE COBRO (elegida expresamente). Si es la de la oferta no hay conversión. Si quien convierte pide la OTRA moneda, la conversión se
  -- hace UNA sola vez, sobre el importe final aceptado (con el plan B2B ya aplicado), con la TRM de cobro INGRESADA (sin respaldo en ninguna otra
  -- tasa) y se congela con el intento: la oferta conserva su moneda e importes, y no se reconvierte ningún componente. El total se redondea como
  -- las ventas (COP al mil hacia arriba, USD al dólar hacia arriba) después de pasar a centavos.
  v_mc := p_moneda_cobro;
  if v_mc = v_mo then
    if p_trm_cobro is not null then
      raise exception 'p63_cobro_invalido: se cobra en la moneda de la oferta (%): no lleva TRM de cobro', v_mo;
    end if;
    v_trm_c := null;
    v_total_c := null;
  else
    if p_trm_cobro is null then
      raise exception 'p63_cobro_trm_requerida: cobrar en % una oferta en % exige la TRM de cobro (pesos por dólar), ingresada por quien convierte', v_mc, v_mo;
    end if;
    v_trm_c := round(p_trm_cobro, 4);
    v_b2b := v_snap -> 'b2b';
    v_base := case when jsonb_typeof(v_b2b) = 'object' then (v_b2b ->> 'precio_final')::numeric else (v_snap -> 'cabecera' ->> 'precio_venta')::numeric end;
    v_total_c := public.p63_total_cobro(v_base, v_mo, v_mc, v_trm_c);
    if v_total_c is null or v_total_c <= 0 then
      raise exception 'p63_cobro_invalido: el importe convertido para cobrar no es válido';
    end if;
  end if;

  -- Número reservado en la MISMA transacción (mayorista: secuencia dedicada, nunca se reutiliza) y snapshot congelado.
  v_numero := public.siguiente_numero_contrato_para_tenant(p_tenant);
  insert into public.p63_aceptacion (oferta_id, cotizacion_id, tenant, numero_contrato, usuario_id, fecha_negocio, snapshot, trm_provisional,
                                     moneda_cobro, trm_cobro, total_cobro)
  values (v_o.id, v_o.cotizacion_id, p_tenant, v_numero, p_usuario, v_hoy, v_o.snapshot, v_trm_prov, v_mc, v_trm_c, v_total_c)
  returning id into v_id;
  update public.p63_oferta set estado = 'aceptada', actualizada_en = now() where id = v_o.id;

  return jsonb_build_object('estado', 'preparada', 'aceptacion_id', v_id, 'numero_contrato', v_numero, 'fecha_negocio', v_hoy,
                            'snapshot', v_o.snapshot, 'financiero', public.p63_financiero_derivado(v_id),
                            'cobro', jsonb_build_object('moneda', v_mc, 'trm', v_trm_c, 'total', v_total_c));
end;
$$;

comment on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) is
  '227/234/235 (#63 #90): acepta de forma atómica una oferta cotizada (revalida AHORA bajo candado, reserva el número y congela el snapshot). 234: la TRM provisional INGRESADA es obligatoria en una oferta USD sin TRM. 235: p_moneda_cobro/p_trm_cobro eligen la moneda de COBRO; distinta de la oferta ⇒ TRM de cobro obligatoria y total convertido UNA vez y congelado con el intento; un reintento con otra elección se rechaza (p63_cobro_cambio). Solo service_role.';
revoke all on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.aceptar_oferta_63(bigint, text, uuid, text, text, numeric, text, numeric) to service_role;

-- ═══ 5. La cabecera lleva lo congelado ════════════════════════════════════
create or replace function public.trg_ventas_aceptacion_63_ins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_a      public.p63_aceptacion;
  v_c      jsonb;
  v_precio numeric;
  v_b2b    jsonb;
  v_dif    text := '';
begin
  select * into v_a from public.p63_aceptacion a where a.numero_contrato = new.numero_contrato for update;
  if not found then
    if new.aceptacion_63_id is not null then
      raise exception 'p63_cabecera: la aceptación % no existe', new.aceptacion_63_id;
    end if;
    return new;
  end if;
  if new.aceptacion_63_id is distinct from v_a.id then
    raise exception 'p63_cabecera: el número % está reservado por una aceptación #63; solo ese intento puede crear su cabecera', new.numero_contrato;
  end if;
  if v_a.estado <> 'preparada' then
    raise exception 'p63_cabecera: el intento de % no está vigente (estado %); no se crea otra cabecera', new.numero_contrato, v_a.estado;
  end if;
  if v_a.tenant is distinct from new.tenant then
    raise exception 'p63_cabecera: la agencia de la cabecera no es la de la aceptación';
  end if;

  v_c := v_a.snapshot -> 'cabecera';
  v_precio := (v_c ->> 'precio_venta')::numeric;
  v_b2b := v_a.snapshot -> 'b2b';
  if new.estado is distinct from 'pendiente' or new.financiero_estado is distinct from 'pendiente' then v_dif := v_dif || 'estado '; end if;
  if new.tipo_paquete is distinct from (v_c ->> 'tipo_paquete') then v_dif := v_dif || 'tipo_paquete '; end if;
  if new.moneda is distinct from (v_c ->> 'moneda') then v_dif := v_dif || 'moneda '; end if;
  if new.fecha_salida is distinct from nullif(v_c ->> 'fecha_salida', '')::date then v_dif := v_dif || 'fecha_salida '; end if;
  if new.fecha_regreso is distinct from nullif(v_c ->> 'fecha_regreso', '')::date then v_dif := v_dif || 'fecha_regreso '; end if;
  if new.pax is distinct from (v_c ->> 'pax')::int then v_dif := v_dif || 'pax '; end if;
  if new.destino is distinct from (v_c ->> 'destino') then v_dif := v_dif || 'destino '; end if;
  if new.hotel is distinct from (v_c ->> 'hotel') then v_dif := v_dif || 'hotel '; end if;
  if new.plan_nombre is distinct from (v_c ->> 'plan_nombre') then v_dif := v_dif || 'plan '; end if;
  if new.aerolinea is distinct from (v_c ->> 'aerolinea') then v_dif := v_dif || 'aerolinea '; end if;
  if new.paquete_armado_id is distinct from nullif(v_c ->> 'paquete_armado_id', '')::bigint then v_dif := v_dif || 'paquete '; end if;
  if coalesce(new.impuesto, 0) is distinct from coalesce((v_c ->> 'impuesto')::numeric, 0) then v_dif := v_dif || 'impuesto '; end if;
  if coalesce(new.costo_aereo, 0) is distinct from coalesce((v_c ->> 'costo_aereo')::numeric, 0) then v_dif := v_dif || 'costo_aereo '; end if;
  -- Plan B2B ACEPTADO (snapshot.b2b: aliado, % , modo de compra, comisión, estado y precio final). La cabecera se contrasta contra ESE valor, no se
  -- recalcula: si el % del aliado cambió después de aceptar, la cabecera aceptada ya no coincide con lo vivo y la comisión de la base se niega.
  if new.tipo_asesor is distinct from (v_c ->> 'tipo_asesor') then v_dif := v_dif || 'tipo_asesor '; end if;
  if new.canal is distinct from (v_c ->> 'canal') then v_dif := v_dif || 'canal '; end if;
  if jsonb_typeof(v_b2b) = 'object' then
    if new.aliado_id is distinct from (v_b2b ->> 'aliado_id')::bigint then v_dif := v_dif || 'aliado '; end if;
    if new.modo_compra is distinct from nullif(v_b2b ->> 'modo_compra', '') then v_dif := v_dif || 'modo_compra '; end if;
    if new.comision_b2b is distinct from nullif(v_b2b ->> 'comision', '')::numeric then v_dif := v_dif || 'comision_b2b '; end if;
    if new.comision_estado is distinct from nullif(v_b2b ->> 'comision_estado', '') then v_dif := v_dif || 'comision_estado '; end if;
    if new.precio_venta is distinct from (v_b2b ->> 'precio_final')::numeric then v_dif := v_dif || 'precio_venta '; end if;
  else
    if new.aliado_id is not null or new.modo_compra is not null or new.comision_b2b is not null or new.comision_estado is not null then
      v_dif := v_dif || 'b2b ';
    end if;
    if new.precio_venta is distinct from v_precio then v_dif := v_dif || 'precio_venta '; end if;
  end if;
  -- 235: la moneda de cobro, su TRM y el total convertido son los CONGELADOS en el intento (una aceptación anterior a la 235 no los tiene: cabecera sin ellos).
  if new.moneda_cobro is distinct from v_a.moneda_cobro then v_dif := v_dif || 'moneda_cobro '; end if;
  if new.trm_cobro is distinct from v_a.trm_cobro then v_dif := v_dif || 'trm_cobro '; end if;
  if new.total_cobro is distinct from v_a.total_cobro then v_dif := v_dif || 'total_cobro '; end if;
  if v_dif <> '' then
    raise exception 'p63_cabecera: la cabecera no coincide con lo aceptado (%)', btrim(v_dif);
  end if;

  update public.p63_aceptacion set estado = 'materializando', actualizada_en = now() where id = v_a.id;
  return new;
end;
$$;

revoke all on function public.trg_ventas_aceptacion_63_ins() from public, anon, authenticated;

-- ═══ 6. Cobro congelado en el contrato ════════════════════════════════════
create or replace function public.trg_ventas_cobro_congelado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.moneda_cobro is not null then
    if new.moneda_cobro is distinct from old.moneda_cobro or new.trm_cobro is distinct from old.trm_cobro or new.total_cobro is distinct from old.total_cobro then
      raise exception 'p63_cobro_congelado: la moneda de cobro, su TRM y el total convertido de un contrato no se cambian';
    end if;
    if old.moneda_cobro <> coalesce(old.moneda, 'COP')
       and (new.moneda is distinct from old.moneda or new.precio_venta is distinct from old.precio_venta) then
      raise exception 'p63_cobro_congelado: este contrato se cobra en % con una conversión congelada (TRM %); no se edita su moneda ni su precio de venta', old.moneda_cobro, old.trm_cobro;
    end if;
  elsif new.moneda_cobro is not null then
    raise exception 'p63_cobro_congelado: la moneda de cobro se fija al crear el contrato, no después';
  end if;
  return new;
end;
$fn$;
revoke all on function public.trg_ventas_cobro_congelado() from public, anon, authenticated;
create trigger trg_ventas_cobro_congelado
  before update on public.ventas
  for each row execute function public.trg_ventas_cobro_congelado();

-- ═══ 7. La vista básica (rol venta) expone la moneda de cobro ══════════════
-- CREATE OR REPLACE con las tres columnas AL FINAL: el resto de la definición es IDÉNTICO al de la 156 (enmascarado, rol y agencia incluidos).
create or replace view public.ventas_basica as
  select
    v.numero_contrato, v.fecha_venta, v.asesor, v.canal, v.tipo_cliente,
    v.cliente,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_documento
      when v.cliente_documento is null then null
      when length(v.cliente_documento) <= 4 then '••••'
      else '••••' || right(v.cliente_documento, 4)
    end as cliente_documento,
    v.cliente_telefono, v.cliente_email,
    v.destino, v.tipo_paquete, v.fecha_salida, v.fecha_regreso, v.fecha_emision,
    v.pax, v.hotel, v.aerolinea, v.receptivo, v.asistencia, v.otros_proveedores,
    v.precio_venta, v.moneda, v.estado, v.facturado, v.numero_documento,
    v.plan_nombre, v.tours_traslados, v.asistencia_medica, v.plazo,
    v.tipo_asesor, v.agencia_nombre, v.agencia_asesor, v.freelance_nombre, v.aliado_id,
    v.asesor_firma_nombre, v.asesor_firma_cargo, v.asesor_firma_tel,
    v.paquete_armado_id, v.bloqueo_ref_id, v.empaquetado_ref_id, v.tenant,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.cliente_direccion
      else null
    end as cliente_direccion,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.asesor_firma_cc
      else null
    end as asesor_firma_cc,
    case
      when public.mi_rol() <> 'venta' or public.soy_asesor_del_contrato(v.numero_contrato)
        then v.share_token
      else null
    end as share_token,
    v.created_at, v.updated_at,
    -- 235: moneda y total de COBRO (datos comerciales como precio_venta, no financieros): el asesor ve cuánto cobrar y en qué moneda.
    v.moneda_cobro, v.trm_cobro, v.total_cobro
  from public.ventas v
  where
    public.mi_rol() in ('superadmin','gerencia')
    or (public.mi_rol() in ('administracion','operaciones','venta')
        and public.puede_ver_tenant(v.tenant));
grant select on public.ventas_basica to authenticated;

-- ═══ 8. Cartera del dashboard en la MONEDA DE COBRO ═════════════════════════
-- fn_dashboard_cartera_por_moneda (186) restaba los abonos (que viven en la moneda de COBRO) de precio_venta (moneda de la OFERTA) y agrupaba por
-- ventas.moneda. Con cobro en otra moneda eso mezclaba dos monedas. Ahora, si el contrato se cobra en una moneda distinta con conversión congelada
-- (mismo criterio que lib/finanzas/cobro.ts › cobroDeVenta: moneda_cobro distinta de la de la oferta Y total_cobro > 0 Y trm_cobro > 0), la moneda es
-- la de cobro y el total es total_cobro. En cualquier otro caso (moneda_cobro NULL = contrato histórico, o igual a la de la oferta) es EXACTAMENTE lo
-- de siempre: ventas.moneda y precio_venta. Misma firma, SECURITY INVOKER y ACL (CREATE OR REPLACE conserva los permisos).
create or replace function public.fn_dashboard_cartera_por_moneda(p_tenant text, p_hoy date)
returns table(moneda text, al_dia numeric, vencida numeric, sin_fecha numeric, sin_fecha_count bigint)
language sql
security invoker
stable
set search_path = public
as $fn$
  with abonos_por_contrato as (
    select a.numero_contrato, sum(a.valor_abono) as suma
    from public.abonos a
    where a.tenant = p_tenant
    group by a.numero_contrato
  ),
  saldo as (
    select
      case when v.moneda_cobro is not null and v.moneda_cobro is distinct from coalesce(v.moneda, 'COP')
                and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0
           then v.moneda_cobro else coalesce(v.moneda, 'COP') end as moneda,
      (case when v.moneda_cobro is not null and v.moneda_cobro is distinct from coalesce(v.moneda, 'COP')
                 and coalesce(v.total_cobro, 0) > 0 and coalesce(v.trm_cobro, 0) > 0
            then v.total_cobro else coalesce(v.precio_venta, 0) end - coalesce(ap.suma, 0)) as saldo,
      v.fecha_salida
    from public.ventas v
    left join abonos_por_contrato ap on ap.numero_contrato = v.numero_contrato
    where v.tenant = p_tenant and v.estado in ('confirmado', 'activo')
  )
  select
    moneda,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy <= (fecha_salida - 30)), 0) as al_dia,
    coalesce(sum(saldo) filter (where fecha_salida is not null and p_hoy > (fecha_salida - 30)), 0) as vencida,
    coalesce(sum(saldo) filter (where fecha_salida is null), 0) as sin_fecha,
    coalesce(count(*) filter (where fecha_salida is null), 0)::bigint as sin_fecha_count
  from saldo
  where saldo > 0
  group by moneda;
$fn$;

-- ═══ 9. Facturación: no se emite con un importe calculado en otra moneda ═════
-- La facturación (208) calcula el PVP desde ventas.precio_venta (moneda de la OFERTA) y la TRM del contrato. Si el contrato se cobra en OTRA moneda,
-- ese importe NO es lo que se cobró y el tratamiento contable (diferencia de cambio, devengo en la moneda de cobro) está pendiente (fase C). Hasta
-- que se decida, NO se emite factura de esos contratos: no se inventan asientos ni diferencias de cambio. Nada de lo aplicado se modifica:
--   · f208_priv.importes_factura (208) se reemplaza AÑADIENDO el rechazo al principio; el resto del cuerpo es idéntico. Es la ÚNICA fuente de los
--     importes de public.facturar_factura (la única ruta que emite o cambia una factura; solo service_role), así que cualquier llamada directa a la
--     RPC, con cualquier parámetro, se rechaza antes de tocar el libro diario (error F4451).
--   · Segunda barrera: trigger sobre contrato_facturacion (insertar, o cambiar importes/vínculos de la factura) para un contrato con cobro en otra
--     moneda. Cubre cualquier escritura que no pase por importes_factura.
-- Quedan RESTRINGIDOS: public.facturar_factura (y, por tanto, el flujo Contabilidad → Facturación → guardar/emitir, acción guardarFacturacion).
-- NO cambian: quitar_factura, marcar_dian_factura (sin factura vigente no hacen nada; un contrato así no puede tener una), consultar_factura_fuera_libros
-- y postear_asiento_abono (los abonos siguen contabilizándose como en la 208).
create or replace function f208_priv.importes_factura(p_numero text, out pvp numeric, out irt numeric, out tenant text)
language plpgsql stable set search_path = '' as $fn$
declare v record; v_factor numeric;
begin
  select v2.tenant, coalesce(v2.moneda, 'COP') as moneda, v2.precio_venta, v2.trm_contrato, v2.moneda_cobro into v
    from public.ventas v2 where v2.numero_contrato = p_numero;
  if v.moneda_cobro is not null and v.moneda_cobro is distinct from v.moneda then
    raise exception 'FIN_COBRO_OTRA_MONEDA: el contrato % se cobra en % y su oferta está en %; la facturación de contratos cuya moneda de cobro difiere de la de la oferta está en revisión contable y por ahora no se emite desde el sistema.', p_numero, v.moneda_cobro, v.moneda using errcode = 'F4451';
  end if;
  tenant := v.tenant;
  if v.moneda = 'USD' then
    v_factor := coalesce(nullif(v.trm_contrato, 0), (select nullif(valor, 0)::numeric from public.parametros_tributarios where parametro = 'trm_referencia'));
    if v_factor is null or v_factor <= 0 then
      raise exception 'FIN_SIN_TRM: el contrato es en USD y no tiene TRM para convertir a pesos.' using errcode = 'F4413';
    end if;
  else
    v_factor := 1;
  end if;
  pvp := coalesce(v.precio_venta, 0) * v_factor;
  select coalesce(sum(c.valor_total), 0) * v_factor into irt
    from public.cuentas_por_pagar c
   where c.numero_contrato = p_numero and c.tenant = v.tenant and coalesce(c.clasificacion, 'costo') = 'irt';
end $fn$;

create or replace function public.p235_cf_cobro_guarda() returns trigger language plpgsql security definer set search_path = '' as $fn$
declare v_mc text; v_m text;
begin
  select v.moneda_cobro, coalesce(v.moneda, 'COP') into v_mc, v_m from public.ventas v where v.numero_contrato = new.numero_contrato;
  if v_mc is not null and v_mc is distinct from v_m then
    if tg_op = 'INSERT' or (new.numero_contrato, new.irt, new.ingreso_propio, new.lleva_iva, new.ingreso_exento, new.tipo_exento,
                            new.observacion, new.asiento_factura_id, new.revision_id)
       is distinct from (old.numero_contrato, old.irt, old.ingreso_propio, old.lleva_iva, old.ingreso_exento, old.tipo_exento,
                         old.observacion, old.asiento_factura_id, old.revision_id) then
      raise exception 'FIN_COBRO_OTRA_MONEDA: el contrato % se cobra en % y su oferta está en %; la facturación de contratos cuya moneda de cobro difiere de la de la oferta está en revisión contable y por ahora no se emite desde el sistema.', new.numero_contrato, v_mc, v_m using errcode = 'F4451';
    end if;
  end if;
  return new;
end $fn$;
revoke all on function public.p235_cf_cobro_guarda() from public, anon, authenticated;
create trigger trg_p235_cf_cobro_guarda before insert or update on public.contrato_facturacion
  for each row execute function public.p235_cf_cobro_guarda();

commit;
