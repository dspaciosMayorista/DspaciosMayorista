-- ─────────────────────────────────────────────────────────────────────
-- 339 · SOPORTES DE PAGO: UN SOPORTE ADICIONAL POR CONTRATO (corrección aprobada por el dueño)
--
-- ANTES (281): soportes VIGENTES de un contrato <= abonos registrados  → con 0 abonos no cabía ninguno, y el aliado no podía adjuntar la evidencia
--   de un pago que el equipo todavía no había registrado.
-- AHORA:       soportes VIGENTES de un contrato <= abonos registrados + 1.
--   0 abonos → cabe 1 · 1 abono → caben 2 · ocupado el cupo adicional, otro soporte se rechaza hasta que se registre un abono o se retire un soporte vigente.
--
-- QUÉ NO CAMBIA (y por qué es seguro):
--   · Subir evidencia sigue sin crear ni aprobar un pago, sin reducir el saldo y sin confirmar el contrato: soporte_registrar solo inserta el soporte y sus avisos; esta
--     migración NO toca esa función, ni abonos, ni ventas, ni asientos. Los avisos internos (soporte_pago_nuevo / soporte_pago_reemplazado) siguen idénticos.
--   · NO hay vínculo soporte↔abono ni se infiere uno: el cupo adicional es del CONTRATO, no de un pago concreto. Se sigue contando por contrato.
--   · Reemplazar y retirar siguen sin depender del límite (no suben el conteo); un contrato «excedido» (más vigentes que el máximo, p. ej. tras anular un abono)
--     sigue pudiendo reemplazar y retirar. Duplicados, propiedad, tenant, identidad del contrato y serialización (ventas FOR UPDATE primero) no se tocan.
--   · La evidencia previa de COTIZACIONES (migración 325, tope de 5) es otra tabla y otra regla: no se modifica.
--
-- AUTORIDAD. El límite vive en UN solo lugar de la base: el trigger BEFORE INSERT `trg_f281_soportes_insert` (función `f281_soportes_insert`). La 339 la REEMPLAZA con
-- `create or replace` (mismo propietario, mismos permisos, mismo trigger) cambiando únicamente la condición del conteo y el texto del error (mismo código F4515 / SOPORTE_LIMITE).
-- Solo se aplica sobre la definición EXACTA de la 281 (md5): una versión distinta ABORTA la migración (se admite también la ya reemplazada por esta misma migración: re-aplicar es inocuo).
--
-- Código y base van JUNTOS: el servidor (precomprobación), la interfaz (cupos y mensajes) y esta función usan la misma regla (lib/soportes/archivo.ts: maximoSoportes = abonos + 1).
-- Orden: preflight_339 → 339 → postcheck_339 → despliegue del código. Si el código se despliega ANTES, la precomprobación del servidor deja pasar el soporte adicional y la base
-- (todavía con la regla vieja) lo rechaza con SOPORTE_LIMITE: sin corrupción, solo un mensaje de «máximo» hasta aplicar la 339.
-- Rollback: supabase/scripts/rollback_339_soportes_cupo_adicional.sql (restaura la función de la 281; NO borra ni retira ningún soporte, y avisa si el rollback deja contratos excedidos).
-- ─────────────────────────────────────────────────────────────────────

do $$
declare v_md5 text;
begin
  if to_regclass('public.contrato_soportes_pago') is null or to_regclass('public.abonos') is null or to_regclass('public.ventas') is null then
    raise exception '339: faltan contrato_soportes_pago, abonos o ventas (migración 281 no aplicada).';
  end if;
  if to_regprocedure('public.f281_soportes_insert()') is null then
    raise exception '339: falta f281_soportes_insert() (migración 281).';
  end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.contrato_soportes_pago'::regclass and tgname = 'trg_f281_soportes_insert' and not tgisinternal) <> 1 then
    raise exception '339: falta el trigger trg_f281_soportes_insert sobre contrato_soportes_pago.';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_md5 from pg_proc p where p.oid = to_regprocedure('public.f281_soportes_insert()');
  if v_md5 is distinct from 'b0ca477d9cd9917c888a93ff0cb208a4' and v_md5 is distinct from '9f00935a6536eabed5bdff9c496c45a8' then
    raise exception '339: la definición de f281_soportes_insert en esta base NO es la de la migración 281 (md5 b0ca477d9cd9917c888a93ff0cb208a4; actual %). No se reemplaza una versión distinta: revisa qué cambió.', v_md5;
  end if;
end $$;

create or replace function public.f281_soportes_insert() returns trigger language plpgsql set search_path = '' as $$
declare
  v_tenant text; v_abonos bigint; v_vigentes bigint; o public.contrato_soportes_pago;
  c_adicionales constant int := 1;   -- cupo adicional por contrato (339): evidencia de un pago que el equipo aún no registra. NO está ligado a ningún pago.
begin
  select v.tenant into v_tenant from public.ventas v where v.numero_contrato = new.numero_contrato;
  if not found then
    raise exception 'SOPORTE_CONTRATO_INEXISTENTE: el contrato % no existe.', new.numero_contrato using errcode = 'F4510';
  end if;
  if new.tenant is distinct from v_tenant then
    raise exception 'SOPORTE_TENANT: el soporte declara la agencia % y el contrato % es de %.', new.tenant, new.numero_contrato, v_tenant using errcode = 'F4514';
  end if;
  if new.archivado_en is not null then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo no nace archivado.' using errcode = 'F4516';
  end if;
  if not new.vigente then
    raise exception 'SOPORTE_NACE_VIGENTE: un soporte nuevo nace vigente.' using errcode = 'F4516';
  end if;

  if new.reemplaza_id is null then
    select count(*) into v_abonos from public.abonos a where a.numero_contrato = new.numero_contrato;
    select count(*) into v_vigentes from public.contrato_soportes_pago s where s.numero_contrato = new.numero_contrato and s.vigente and s.archivado_en is null;
    if v_vigentes + 1 > v_abonos + c_adicionales then
      raise exception 'SOPORTE_LIMITE: el contrato % tiene % abono(s) y % soporte(s) vigente(s); el máximo es abonos + % = %. Reemplaza o retira uno, o registra el pago.', new.numero_contrato, v_abonos, v_vigentes, c_adicionales, v_abonos + c_adicionales using errcode = 'F4515';
    end if;
  else
    -- Sustitución: NO crece el conteo vigente. Se verifica por estructura, sin banderas.
    select * into o from public.contrato_soportes_pago s where s.id = new.reemplaza_id;
    if o.id is null or o.numero_contrato <> new.numero_contrato or o.vigente or o.archivado_en is not null
       or o.motivo_retiro is distinct from 'reemplazo' or o.retirado_en is distinct from now() then
      raise exception 'SOPORTE_SUSTITUCION: la fila % no está retirada por reemplazo en esta transacción para el contrato %.', new.reemplaza_id, new.numero_contrato using errcode = 'F4516';
    end if;
  end if;
  return new;
end $$;
