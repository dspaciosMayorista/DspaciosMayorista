-- REVERSIÓN ACOTADA de la migración 205 (comisiones B2B) — solo para el caso
-- en que la PROPIA 205 tenga un defecto y todavía no exista ningún dato con la
-- semántica nueva. Runbook: docs/tecnico/comisiones-205-despliegue.md.
--
-- ⚠️ Lo primero NO es este script: la 205 es compatible con el código viejo,
-- así que volver atrás el CÓDIGO (Vercel) no exige tocar la base. Este
-- script solo hace falta si la base misma da problemas.
--
-- SE NIEGA (y no cambia nada) si ya hay comisiones con semántica 205:
--   · base_explicita no NULL  → con el código viejo, una base 0 explícita
--     volvería a leerse sobre el PVP (cambia el importe);
--   · comision_valor no NULL  → el código viejo ignoraría el valor escrito y
--     volvería a base × % redondeado (cambia el importe);
--   · descontada_en_precio    → una NETO nueva volvería a aparecer como saldo
--     por pagar y admitiría un segundo pago.
-- En ese escenario NO hay reversión segura: se mantiene la 205 (sus triggers
-- protegen abonos y NETO = contención) y se corrige HACIA ADELANTE. Ver el
-- runbook ("Después de crear datos nuevos").
--
-- Qué revierte: las funciones de alta (reservar y manual), los triggers y
-- funciones de la 205 y las policies de aliados_b2b (vuelve la de 116, que no
-- deja leer a `venta`).
-- Qué NO revierte, a propósito:
--   · La FK de comision_b2b_pagos queda en RESTRICT. Volver a ON DELETE
--     CASCADE haría que borrar una comisión (o eliminar_contrato) borrara sus
--     abonos sin rastro. Con RESTRICT, ese borrado falla y el abono se
--     conserva — también con el código viejo.
--   · Las columnas nuevas (convención del proyecto: no se borran columnas);
--     quedan sin uso y, por la guarda de abajo, sin datos.
begin;

-- Nadie escribe comisiones ni abonos mientras se decide y se revierte.
lock table public.aliados_b2b in share row exclusive mode;
lock table public.comision_b2b_pagos in share row exclusive mode;

do $$
declare
  v_explicita int;
  v_valor     int;
  v_neto      int;
begin
  if to_regprocedure('public.comision_b2b_total(public.aliados_b2b)') is null then
    raise exception 'ROLLBACK 205: la 205 no está aplicada (o ya se revirtió). Nada que hacer.';
  end if;

  select count(*) filter (where base_explicita is not null),
         count(*) filter (where comision_valor is not null),
         count(*) filter (where descontada_en_precio)
    into v_explicita, v_valor, v_neto
    from public.aliados_b2b;

  if v_explicita + v_valor + v_neto > 0 then
    raise exception 'ROLLBACK 205 NO SEGURO: ya hay comisiones con la semántica nueva (base explícita: %, por valor: %, NETO descontada: %). Con el código viejo cambiarían importes o estados y una NETO admitiría otro pago. No se revierte nada: mantén la 205 (contención) y corrige hacia adelante — ver docs/tecnico/comisiones-205-despliegue.md.',
      v_explicita, v_valor, v_neto;
  end if;
end $$;

drop function if exists public.registrar_comision_b2b_reserva(text, bigint);
drop function if exists public.registrar_comision_b2b_manual(text, text, text, text, bigint, numeric, numeric, numeric, boolean, numeric);

drop trigger if exists trg_aliados_b2b_proteger_abonos on public.aliados_b2b;
drop trigger if exists trg_comision_b2b_pagos_guardas on public.comision_b2b_pagos;
drop trigger if exists trg_aliados_b2b_neto_no_borrar on public.aliados_b2b;
drop trigger if exists trg_aliados_b2b_neto_sin_segunda on public.aliados_b2b;
drop function if exists public.tg_aliados_b2b_proteger_abonos();
drop function if exists public.tg_comision_b2b_pagos_guardas();
drop function if exists public.tg_aliados_b2b_neto_no_borrar();
drop function if exists public.tg_aliados_b2b_neto_sin_segunda();
drop function if exists public.comision_b2b_descontada(public.aliados_b2b);
drop function if exists public.comision_b2b_total(public.aliados_b2b);

drop policy if exists "aliados_b2b: lectura contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: alta contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: edicion contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: edicion asesor" on public.aliados_b2b;
drop policy if exists "aliados_b2b: borrado contable" on public.aliados_b2b;
drop policy if exists "aliados_b2b: acceso contable" on public.aliados_b2b;
create policy "aliados_b2b: acceso contable"
  on public.aliados_b2b for all
  using (
    public.mi_rol() in ('superadmin','gerencia','administracion','operaciones')
    and public.puede_ver_tenant(tenant)
  );

-- La FK se deja en RESTRICT (ver encabezado). Comprobación explícita:
do $$ begin
  if (select confdeltype from pg_constraint where conname = 'comision_b2b_pagos_aliado_b2b_id_fkey') <> 'r' then
    raise exception 'ROLLBACK 205: la FK de abonos no está en RESTRICT; no se confirma.';
  end if;
end $$;

commit;
