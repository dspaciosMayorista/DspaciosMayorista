-- ────────────────────────────────────────────────────────────────────────────
-- 290 · Comisión B2B manual: sin comisión exigible en un PENDIENTE y sin segunda comisión del MISMO aliado (#97)   ⚠️ SIN CORRER
--
-- NUMERACIÓN: 290 es el primer número libre tras la 289 de #75 (verificado 2026-11-10 en todos los worktrees y ramas locales, incluida
-- `claude/43-60-vigencias-por-dia`: nadie usa 282 ni 290+). Coordinado en `coordinacion-75-97-secuencia-despliegue.md` (#75) y
-- `coordinacion-migracion-286.md` (#97). Orden de despliegue: 288 → 286 → 289 → **290** → código. No depende de la 286 ni de la 288
-- (solo de la 205); se puede aplicar sin ellas.
--
-- ORIGEN (hallazgo del arnés integrado, PORT-1 y PORT-3 de pruebas/contratoManualNeto206.pg.ts):
--   1. `registrar_comision_b2b_manual` (205, YA APLICADA, no se edita) solo impedía duplicados en la rama del asesor `venta`. Un rol interno
--      podía registrar una comisión EXIGIBLE en un contrato PENDIENTE, saltándose el plan (286): pendiente = solo plan, se materializa al confirmar.
--   2. Con el registro automático de la comisión al crear el contrato (#97), el alta manual interna del MISMO aliado creaba una segunda
--      fila: el aliado veía el doble (200.000 + 200.000).
--
-- QUÉ HACE
--   A. Reemplaza `registrar_comision_b2b_manual` (copia íntegra de la 205 + dos reglas, misma firma, mismos permisos):
--      · contrato `pendiente` → se rechaza para TODO rol (`COMISION_PENDIENTE`), antes de escribir; NETO conserva su rechazo de la 205.
--      · la segunda comisión del MISMO aliado por el MISMO concepto la rechaza el trigger B (`COMISION_DUPLICADA`), también desde esta RPC.
--   B. Trigger `trg_aliados_b2b_sin_duplicado_aliado` (BEFORE INSERT) para TODAS las rutas (RPC manual, reserva, materialización, API directa):
--      bloquea la fila de `ventas` del contrato (FOR UPDATE: el mismo candado que ya toman la reserva, la 205 y `materializar`) y rechaza una
--      fila nueva del mismo `aliado_id` que COMPARTE CONCEPTO con una existente. Dos altas simultáneas se serializan en ese candado.
--   «Mismo concepto» = mismo contrato + mismo `aliado_id` + concepto en común: ORDINARIA (valor o % > 0; la NETO descontada cuenta como
--   ordinaria) o RECOBRO (recobro > 0 con participación del aliado). La fila acordada con ordinaria + recobro bloquea ambos. Una fila de
--   solo recobro junto a una de solo ordinaria del mismo aliado NO duplica nada (es la forma de la 198/267) y se admite.
--
-- QUÉ NO HACE
--   · No impone «una comisión por contrato»: aliados DISTINTOS siguen pudiendo tener cada uno su fila (#440, PORT-2).
--   · No valida ni toca filas existentes (rige hacia adelante): los duplicados históricos se DIAGNOSTICAN en el preflight
--     (`preflight_290_comision_manual.sql`); no se borran, consolidan ni se tocan sus pagos.
--   · UPDATE: solo se rechaza el cambio que INTRODUCE para (contrato, aliado) un concepto que OTRA fila suya ya tiene (dar ordinaria a una fila
--     sin concepto o de solo recobro, acreditar a un aliado un recobro que ya tiene, mover la fila a otro contrato/aliado). Editar sin añadir
--     concepto —también un histórico duplicado— no se rechaza. La 267 (acreditar el beneficiario del recobro), `p50_priv.completar_conversion`
--     (222) y `materializar` (completar la línea de la 198) siguen funcionando: solo fallarían si de verdad crearan un concepto repetido.
--     El trigger se dispara únicamente por columnas de identidad/concepto y toma el candado de `ventas` solo cuando hay algo que comprobar.
--   · Filas sin `aliado_id` (texto libre, históricas) no se comparan: sin ficha no hay identidad fiable.
--   · La regla de pendiente vive en la RPC y no en el trigger: la conversión de la 198 inserta su línea de recobro en un contrato que nace
--     pendiente y la 286 la retira en la misma transacción; un trigger por estado rompería esa conversión.
-- Rollback: supabase/scripts/rollback_290_comision_manual.sql (restaura el cuerpo exacto de la 205). Postcheck: postcheck_290_comision_manual.sql.
-- Prueba: supabase/scripts/test_290_comision_manual.sql (+ carrera: test_290_carrera.sh).
-- ────────────────────────────────────────────────────────────────────────────

-- ═══ A. RPC manual (205 + reglas de pendiente y de duplicado) ═══
create or replace function public.registrar_comision_b2b_manual(
  p_numero             text,
  p_aliado             text,
  p_nit                text,
  p_tipo_aliado        text,
  p_aliado_id          bigint,
  p_pct                numeric,
  p_recobro            numeric,
  p_pct_recobro        numeric,
  p_aplica_retencion   boolean,
  p_pct_retencion      numeric
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol      text := public.mi_rol()::text;
  v          public.ventas;
  a          public.aliados;
  v_nombre   text;
  v_nit      text;
  v_tipo     text;
  v_ret      boolean;
  v_pct_ret  numeric;
  v_id       bigint;
begin
  -- Usuario y rol (mi_rol() es NULL sin sesión o con el usuario inactivo).
  -- control_vuelo y los externos no registran comisiones.
  if v_rol is null or v_rol not in ('superadmin','gerencia','administracion','operaciones','venta') then
    raise exception 'No autorizado para registrar comisiones B2B.' using errcode = '42501';
  end if;

  -- Contrato y tenant (bloqueado: serializa altas concurrentes del mismo contrato).
  select * into v from public.ventas where numero_contrato = p_numero for update;
  if not found then
    raise exception 'El contrato % no existe.', p_numero using errcode = 'P0001';
  end if;
  if not public.puede_ver_tenant(v.tenant) then
    raise exception 'No autorizado para el contrato %.', p_numero using errcode = '42501';
  end if;
  -- NETO: la comisión ya se descontó del precio; registrarla la pagaría dos veces.
  if v.comision_estado = 'descontada' then
    raise exception 'El contrato % se vendió en modo neta: la comisión ya se descontó del precio.', p_numero using errcode = 'P0001';
  end if;
  -- 290: un contrato PENDIENTE solo tiene el PLAN de su comisión; la comisión exigible nace al confirmarse. Ningún rol la adelanta a mano.
  if v.estado = 'pendiente' then
    raise exception 'COMISION_PENDIENTE: el contrato % está pendiente; su comisión es un plan informativo y se vuelve cobrable al confirmarse. Regístrala o ajústala después de confirmar.', p_numero
      using errcode = 'P0001';
  end if;

  -- Importes (el % 0 es legítimo; NULL no).
  if p_pct is null or p_pct < 0 or p_pct > 1
     or coalesce(p_recobro, 0) < 0
     or coalesce(p_pct_recobro, 0) < 0 or coalesce(p_pct_recobro, 0) > 1
     or (p_aplica_retencion and (p_pct_retencion is null or p_pct_retencion < 0 or p_pct_retencion > 1)) then
    raise exception 'Valores de comisión inválidos.' using errcode = '22023';
  end if;

  v_nombre := nullif(btrim(coalesce(p_aliado, '')), '');
  v_nit := nullif(btrim(coalesce(p_nit, '')), '');
  v_tipo := nullif(btrim(coalesce(p_tipo_aliado, '')), '');
  v_ret := coalesce(p_aplica_retencion, false);
  v_pct_ret := case when v_ret then p_pct_retencion else 0 end;

  if v_rol = 'venta' then
    -- Solo SU contrato (misma regla que usan las policies del contrato).
    if not public.soy_asesor_del_contrato(p_numero) then
      raise exception 'Solo puedes registrar la comisión de tus propios contratos.' using errcode = '42501';
    end if;
    if v.tipo_asesor not in ('agencia','freelance') or v.aliado_id is null then
      raise exception 'El contrato % no es una venta B2B con aliado del catálogo.', p_numero using errcode = 'P0001';
    end if;
    if p_aliado_id is distinct from v.aliado_id then
      raise exception 'La comisión debe ser del aliado del contrato.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.aliados_b2b b where b.numero_contrato = p_numero) then
      raise exception 'El contrato % ya tiene comisión registrada; cualquier cambio lo hace administración.', p_numero using errcode = '23505';
    end if;
    -- Identidad y retención del aliado salen del catálogo, no del formulario.
    select * into a from public.aliados where id = v.aliado_id;
    if not found then
      raise exception 'El aliado del contrato no existe en el catálogo.' using errcode = 'P0001';
    end if;
    v_nombre := a.nombre;
    v_nit := a.nit;
    v_tipo := v.tipo_asesor;
    v_ret := coalesce(a.aplica_retencion, false);
    v_pct_ret := case when v_ret then coalesce(a.pct_retencion, 0) else 0 end;
  elsif p_aliado_id is not null then
    select * into a from public.aliados where id = p_aliado_id;
    if not found then
      raise exception 'El aliado % no existe.', p_aliado_id using errcode = 'P0001';
    end if;
    -- Enlazada al catálogo, el tipo es el del catálogo, no el del formulario:
    -- decide si hay cuenta de cobro (solo freelance; la agencia factura).
    v_tipo := coalesce(a.tipo, v_tipo);
  end if;

  if v_nombre is null then
    raise exception 'Indica el aliado de la comisión.' using errcode = '22023';
  end if;

  -- 290: el MISMO aliado no recibe una segunda comisión por el MISMO concepto (ordinaria o recobro). Lo exige, para esta y para toda ruta,
  -- el trigger trg_aliados_b2b_sin_duplicado_aliado (una sola definición de «concepto»; responde COMISION_DUPLICADA). Aliados distintos sí (#440).
  insert into public.aliados_b2b (
    numero_contrato, tenant, aliado, nit, tipo_aliado, aliado_id,
    precio_venta, base_comision, base_explicita, pct_comision,
    recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado
  ) values (
    v.numero_contrato, v.tenant, v_nombre, v_nit, v_tipo, p_aliado_id,
    coalesce(v.precio_venta, 0), greatest(0, coalesce(v.precio_venta, 0) - coalesce(v.impuesto, 0)), true, p_pct,
    coalesce(p_recobro, 0), coalesce(p_pct_recobro, 0), v_ret, v_pct_ret, 'pendiente'
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) from public, anon;
grant execute on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) to authenticated;
comment on function public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric) is
  'MANUAL_V290: 205 + rechazo en contrato pendiente (COMISION_PENDIENTE) y de segunda comisión del mismo aliado (COMISION_DUPLICADA).';

-- ═══ B. Ninguna ruta inserta una segunda fila del MISMO aliado en un contrato ═══
-- Conceptos de una fila: ORDINARIA (comision_valor o % de comisión > 0; una fila NETO descontada ES la ordinaria ya aplicada en el precio) y
-- RECOBRO (recobro_total > 0 con participación del aliado > 0; NULL se lee como 0,5, igual que comision_b2b_total). Mismas reglas en el preflight.
create or replace function public.tg_aliados_b2b_sin_duplicado_aliado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ord boolean := coalesce(new.comision_valor, 0) > 0 or coalesce(new.pct_comision, 0) > 0 or coalesce(new.descontada_en_precio, false);
  v_rec boolean := coalesce(new.recobro_total, 0) > 0 and coalesce(new.pct_recobro_aliado, 0.5) > 0;
  v_misma boolean := false;   -- UPDATE que conserva contrato y aliado
begin
  if new.aliado_id is null then
    return new;   -- sin ficha no hay identidad fiable (texto libre / recobro de la 198 antes de acreditar)
  end if;
  -- UPDATE: solo cuenta el concepto que este cambio INTRODUCE para (contrato, aliado). Editar un campo sin añadir concepto —incluso en una fila
  -- histórica duplicada— pasa sin comprobar nada; mover la fila a otro contrato/aliado introduce todos sus conceptos allí.
  if tg_op = 'UPDATE' then
    v_misma := new.numero_contrato is not distinct from old.numero_contrato and new.aliado_id is not distinct from old.aliado_id;
    if v_misma then
      v_ord := v_ord and not (coalesce(old.comision_valor, 0) > 0 or coalesce(old.pct_comision, 0) > 0 or coalesce(old.descontada_en_precio, false));
      v_rec := v_rec and not (coalesce(old.recobro_total, 0) > 0 and coalesce(old.pct_recobro_aliado, 0.5) > 0);
    end if;
  end if;
  if not (v_ord or v_rec) then
    return new;   -- nada nuevo que pueda duplicarse (sin concepto, o el cambio no añade ninguno)
  end if;
  -- Serializa con toda alta/edición del mismo contrato: la reserva, la 205/290 y materializar ya toman este candado; una escritura directa también.
  -- Solo se toma cuando hay un concepto nuevo que comprobar: una edición sin concepto nuevo no compite por él.
  perform 1 from public.ventas vt where vt.numero_contrato = new.numero_contrato for update;
  if exists (select 1 from public.aliados_b2b b
              where b.numero_contrato = new.numero_contrato and b.aliado_id = new.aliado_id
                and (tg_op = 'INSERT' or b.id <> new.id)
                and ((v_ord and (coalesce(b.comision_valor, 0) > 0 or coalesce(b.pct_comision, 0) > 0 or coalesce(b.descontada_en_precio, false)))
                  or (v_rec and coalesce(b.recobro_total, 0) > 0 and coalesce(b.pct_recobro_aliado, 0.5) > 0))) then
    raise exception 'COMISION_DUPLICADA: el aliado % ya tiene su comisión % en el contrato %; corrige la existente en vez de registrar otra.',
      new.aliado_id, case when v_ord and v_rec then 'ordinaria o su recobro' when v_ord then 'ordinaria' else 'de recobro' end, new.numero_contrato
      using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.tg_aliados_b2b_sin_duplicado_aliado() from public, anon, authenticated, service_role;

drop trigger if exists trg_aliados_b2b_sin_duplicado_aliado on public.aliados_b2b;
-- UPDATE solo de las columnas que definen identidad o concepto: el resto de ediciones (estado, retención, nombre, base) ni siquiera lo dispara.
create trigger trg_aliados_b2b_sin_duplicado_aliado
  before insert or update of numero_contrato, aliado_id, comision_valor, pct_comision, recobro_total, pct_recobro_aliado, descontada_en_precio
  on public.aliados_b2b
  for each row execute function public.tg_aliados_b2b_sin_duplicado_aliado();
comment on trigger trg_aliados_b2b_sin_duplicado_aliado on public.aliados_b2b is
  'V290: rechaza que un INSERT o UPDATE introduzca para un aliado_id un concepto (ordinaria/recobro) que otra fila suya del contrato ya tiene. Ediciones sin concepto nuevo pasan (históricos intactos).';
