-- ─────────────────────────────────────────────────────────────────────────────
-- 267 · La línea de RECOBRO de una conversión de cotización debe acreditar su beneficiario (#65)   ⚠️ SIN CORRER
--
-- NUMERACIÓN: 267 es el primer número libre tras la 266 de main (ninguna rama remota visible usa 267; la 261 tampoco existe). No depende del
-- contenido de las 255-266 (solo de 198/205/222). Es aditiva e idempotente. Antes llevaba el número provisional 257, que ya no se usa en ningún archivo.
-- ALCANCE: EVITA nuevas atribuciones erróneas; NO corrige filas históricas (eso es otra operación, no incluida aquí).
-- Preflight/postcheck: supabase/scripts/preflight_267.sql y postcheck_267.sql.
--
-- ORIGEN DEL ERROR. `convertir_cotizacion_a_contrato` (198) inserta la línea de recobro en `aliados_b2b` SOLO con el nombre del aliado
-- (`agenciaNombre`/`freelanceNombre` del payload) y, si ese nombre viene vacío, con `ventas.asesor` (el asesor INTERNO); sin `aliado_id`.
-- Solo la ruta sellada de la 222 (comparativa/NETO/PVP) la enlaza después. Una comisión cargada a mano con otra ficha convive luego con ella.
--
-- CORRECCIÓN SIN REEMPLAZAR LA FUNCIÓN (la 222 verifica por md5 el cuerpo de la 198). Un trigger de restricción DIFERIDO, evaluado al
-- final de la transacción de la conversión, sobre las filas con la FORMA de la línea de recobro de la 198 (sin ficha, recobro > 0, sin
-- base_explicita, sin % ni valor fijo). El beneficiario se acredita así:
--   1. COTIZACIÓN DE ORIGEN = `ventas.cotizacion_id` (única, la fija la 198 al crear la venta). NUNCA «la última cotización con ese número».
--      Se exige que esa cotización exista, que su `numero_contrato` sea el del contrato y que esté 'convertida'.
--      Si trae `aliado_id`, esa ficha debe (a) existir, (b) ser del MISMO TIPO que `ventas.tipo_asesor`, (c) no contradecir a
--      `ventas.aliado_id` si la venta ya lo tiene, y (d) coincidir con el nombre que la venta escribió (si lo escribió). Ante cualquier
--      discrepancia la transacción FALLA con `RECOBRO_ALIADO_DISCREPANTE` (no se elige otra ficha en silencio).
--   2. Si la cotización no trae aliado: el nombre escrito en la venta (`agencia_nombre`/`freelance_nombre` según el tipo), solo si
--      identifica EXACTAMENTE UNA ficha del mismo tipo.
--   3. Si nada lo acredita: `RECOBRO_SIN_BENEFICIARIO` y la conversión no se guarda.
-- `ventas.asesor` (asesor interno) NUNCA acredita un beneficiario.
--
-- QUÉ NO HACE. No toca importes, abonos, `ventas.aliado_id` ni filas existentes; no prohíbe varios beneficiarios en un contrato cuando se
-- cargan a propósito (comisión manual de la 205 u otras filas con otra forma); no cambia comisiones internas (liquidación).
-- Las filas ya mal atribuidas se corrigen con el plan de datos (supabase/scripts/correccion_asesor_comision_65_plan.sql), bloqueado
-- hasta que contabilidad concilie los abonos.
-- Prueba: supabase/scripts/test_267_recobro_beneficiario.sh · Rollback: supabase/scripts/rollback_267_recobro_beneficiario.sql
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.fn_recobro_beneficiario_explicito()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.aliados_b2b;
  v public.ventas;
  c public.cotizaciones;
  v_ficha public.aliados;
  v_tipo text;
  v_nombre_venta text;
  v_n integer;
begin
  -- Fila actual: la 222 pudo enlazarla (aliado_id) en la misma transacción, dejando el texto del nombre como lo escribió la 198.
  select * into b from public.aliados_b2b where id = new.id;
  if not found then
    return null;
  end if;
  select * into v from public.ventas where numero_contrato = b.numero_contrato;
  if not found then
    return null;
  end if;

  -- 1. Cotización de ORIGEN: la que la venta referencia (ventas.cotizacion_id, única), no cualquiera con el mismo número.
  if v.cotizacion_id is not null then
    select * into c from public.cotizaciones where id = v.cotizacion_id;
    if not found then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: la venta % apunta a la cotización % y esa cotización no existe; no se puede acreditar el aliado del recobro (fila %).',
        b.numero_contrato, v.cotizacion_id, b.id using errcode = 'P0001';
    end if;
    if c.numero_contrato is distinct from b.numero_contrato or c.estado is distinct from 'convertida' then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: la cotización % de la venta % está en estado % con contrato %; no coincide con el contrato convertido. No se asigna el recobro (fila %).',
        c.id, b.numero_contrato, coalesce(c.estado, '?'), coalesce(c.numero_contrato, 'sin contrato'), b.id using errcode = 'P0001';
    end if;
  end if;

  -- Tipo de asesor y nombre escrito. La 198 NO guarda tipo_asesor ni los nombres en `ventas` (solo la 222 los completa en su ruta sellada):
  -- salen de la venta si ya están y, si no, del payload de la cotización de origen (lo mismo que leyó la 198 para crear la línea).
  v_tipo := lower(coalesce(nullif(v.tipo_asesor, ''), nullif(c.payload ->> 'tipoAsesor', ''), ''));
  if nullif(v.tipo_asesor, '') is not null and nullif(c.payload ->> 'tipoAsesor', '') is not null
     and lower(v.tipo_asesor) <> lower(c.payload ->> 'tipoAsesor') then
    raise exception 'RECOBRO_ALIADO_DISCREPANTE: la venta % es de tipo «%» pero su cotización % es de tipo «%». No se asigna el recobro (fila %).',
      b.numero_contrato, v.tipo_asesor, c.id, c.payload ->> 'tipoAsesor', b.id using errcode = 'P0001';
  end if;
  -- El nombre TECLEADO (payload) manda sobre el de la venta: la 222 sobrescribe `ventas.*_nombre` con el de la ficha, lo que taparía una discrepancia.
  v_nombre_venta := nullif(lower(btrim(coalesce(
      case when v_tipo = 'agencia' then coalesce(nullif(c.payload ->> 'agenciaNombre', ''), v.agencia_nombre)
           else coalesce(nullif(c.payload ->> 'freelanceNombre', ''), v.freelance_nombre) end, ''))), '');

  if v_tipo in ('agencia', 'freelance') and c.aliado_id is not null then
    -- 1a. Aliado explícito de la cotización de origen: debe ser coherente con la venta o se rechaza (nunca se elige otra ficha).
    --     Se valida AUNQUE la 222 ya haya enlazado la fila: que esté enlazada no prueba que la ficha sea la correcta.
    select * into v_ficha from public.aliados where id = c.aliado_id;
    if not found then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: el aliado % de la cotización % ya no existe en el catálogo (contrato %, fila %).',
        c.aliado_id, c.id, b.numero_contrato, b.id using errcode = 'P0001';
    end if;
    if lower(coalesce(v_ficha.tipo, '')) <> v_tipo then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: el aliado % «%» de la cotización % es de tipo «%», pero la venta % es de tipo «%». No se asigna el recobro (fila %).',
        v_ficha.id, v_ficha.nombre, c.id, coalesce(v_ficha.tipo, '?'), b.numero_contrato, v_tipo, b.id using errcode = 'P0001';
    end if;
    if v.aliado_id is not null and v.aliado_id <> v_ficha.id then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: la cotización % trae el aliado % pero la venta % ya está a nombre del aliado %. No se asigna el recobro (fila %).',
        c.id, v_ficha.id, b.numero_contrato, v.aliado_id, b.id using errcode = 'P0001';
    end if;
    if v_nombre_venta is not null and lower(btrim(v_ficha.nombre)) <> v_nombre_venta then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: la cotización % trae el aliado % «%» pero la venta % escribió «%». No se asigna el recobro (fila %).',
        c.id, v_ficha.id, v_ficha.nombre, b.numero_contrato, v_nombre_venta, b.id using errcode = 'P0001';
    end if;
    if b.aliado_id is not null and b.aliado_id <> v_ficha.id then
      raise exception 'RECOBRO_ALIADO_DISCREPANTE: la línea de recobro % del contrato % quedó en el aliado % pero la cotización de origen % trae el aliado %.',
        b.id, b.numero_contrato, b.aliado_id, c.id, v_ficha.id using errcode = 'P0001';
    end if;
  elsif b.aliado_id is not null then
    -- Ya enlazada por la 222 y la cotización no trae aliado: solo se normaliza el texto con la ficha enlazada (más abajo).
    select * into v_ficha from public.aliados where id = b.aliado_id;
  elsif v_tipo in ('agencia', 'freelance') and v_nombre_venta is not null then
    -- 2. Sin aliado en la cotización: el nombre escrito, solo si identifica UNA ficha del mismo tipo.
    select count(*) into v_n from public.aliados a
     where lower(btrim(a.nombre)) = v_nombre_venta and lower(coalesce(a.tipo, '')) = v_tipo;
    if v_n = 1 then
      select * into v_ficha from public.aliados a
       where lower(btrim(a.nombre)) = v_nombre_venta and lower(coalesce(a.tipo, '')) = v_tipo;
    end if;
  end if;

  -- 3. Nada lo acredita: falla (el asesor interno nunca vale).
  if v_ficha.id is null then
    raise exception 'RECOBRO_SIN_BENEFICIARIO: no se pudo acreditar a quién pertenece el recobro del contrato % (fila %, «%»). La cotización no tiene aliado del catálogo y el nombre escrito («%») no identifica una sola ficha del tipo «%». Elige el aliado del catálogo y vuelve a convertir.',
      b.numero_contrato, b.id, coalesce(b.aliado, ''), coalesce(v_nombre_venta, ''), coalesce(nullif(v_tipo, ''), '?')
      using errcode = 'P0001';
  end if;

  -- Deja en la línea la identidad de la ficha acreditada (también si la 222 solo puso el id y el texto era el del asesor interno).
  update public.aliados_b2b
     set aliado_id = v_ficha.id,
         aliado = v_ficha.nombre,
         nit = coalesce(v_ficha.nit, nit),
         tipo_aliado = coalesce(v_ficha.tipo, tipo_aliado)
   where id = b.id
     and (aliado_id is distinct from v_ficha.id or aliado is distinct from v_ficha.nombre
          or nit is distinct from coalesce(v_ficha.nit, nit) or tipo_aliado is distinct from coalesce(v_ficha.tipo, tipo_aliado));
  return null;
end;
$$;

revoke all on function public.fn_recobro_beneficiario_explicito() from public, anon, authenticated;

-- La línea de recobro de la 198 se reconoce por su FORMA: sin ficha, recobro > 0, sin base_explicita, sin valor fijo y sin % (la columna
-- nace en 0, no en NULL). Una comisión manual (205) trae base_explicita = true y no entra.
drop trigger if exists trg_recobro_beneficiario_explicito on public.aliados_b2b;
create constraint trigger trg_recobro_beneficiario_explicito
  after insert on public.aliados_b2b
  deferrable initially deferred
  for each row
  when (new.aliado_id is null and coalesce(new.recobro_total, 0) > 0
        and new.base_explicita is null and coalesce(new.pct_comision, 0) = 0 and new.comision_valor is null)
  execute function public.fn_recobro_beneficiario_explicito();
