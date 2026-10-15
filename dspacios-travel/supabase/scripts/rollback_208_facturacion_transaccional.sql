-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK 208 · RETIRADA PARCIAL (D-RET, decisión del dueño 2026-10-13)
--
-- Retira SOLO las RPC que emiten, cambian o retiran facturas
-- (facturar_factura, quitar_factura). Con ellas fuera, la facturación queda
-- CONGELADA: las guardas permanentes rechazan con F4440 cualquier emisión,
-- cambio de importes o retiro por los caminos viejos (Guardar/Quitar de main o
-- de B, upsert/DELETE directos) en su PRIMERA escritura, sin interbloqueo y
-- sin reversas huérfanas. Sigue permitido marcar DIAN (false → true) solo
-- sobre una factura vigente, por la RPC marcar_dian_factura o por el upsert
-- viejo.
--
-- SE CONSERVA a propósito (no reabrir los flujos no atómicos de RACE-1 /
-- COMP-1): guardas y disparadores, f208_priv, la tabla de constancias y sus
-- filas, las columnas nuevas, marcar_dian_factura, postear_asiento_abono (M1),
-- consultar_factura_fuera_libros y f208_discrepancias_fuera_libros.
-- Volver a facturar exige una corrección hacia delante (nueva migración), no
-- revertir esta.
--
-- Uso: psql -1 -v ON_ERROR_STOP=1 -f rollback_208_facturacion_transaccional.sql
-- (sin BEGIN/COMMIT propios: las pruebas lo aplican dentro de su transacción).
-- ───────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.factura_revision_fuera_libros') is null then
    raise exception 'rollback 208: la 208 no está aplicada en esta base.';
  end if;
end $$;

drop function if exists public.facturar_factura(text, uuid, text, numeric, numeric, numeric, text, text, text, text);
drop function if exists public.quitar_factura(text, uuid, text);

-- Verificación: la retirada no puede dejar la facturación abierta.
do $$
declare v_guardas int;
begin
  select count(*) into v_guardas from pg_trigger where tgname like 'trg_f208_%' and not tgisinternal;
  if v_guardas < 15 then
    raise exception 'rollback 208: faltan guardas (% de 15); la retirada no debe reabrir la facturación.', v_guardas;
  end if;
  if to_regprocedure('public.marcar_dian_factura(text,uuid,text,boolean)') is null then
    raise exception 'rollback 208: falta marcar_dian_factura (debe seguir disponible).';
  end if;
  if to_regprocedure('public.facturar_factura(text,uuid,text,numeric,numeric,numeric,text,text,text,text)') is not null
     or to_regprocedure('public.quitar_factura(text,uuid,text)') is not null then
    raise exception 'rollback 208: las RPC de emitir/quitar siguen presentes.';
  end if;
end $$;

-- PostgREST deja de anunciar las RPC retiradas.
notify pgrst, 'reload schema';
