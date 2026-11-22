-- #126-A · contrato USD DTM-12601 (cobro en USD, pendiente): ejercita el formulario «Registrar abono» con la TRM de cada pago.
-- SOLO COPIA DESECHABLE (#126). Rehúsa correr fuera de una base cuyo nombre empiece por «rev_verif» y nunca toca la base de revisión del dueño ni producción.
-- Orden de preparación de la copia (ver docs/tecnico/followup-126-acceptance-matrix-2026-11-18.md §9): crear la copia desde rev_verif_corr → aplicar las migraciones 312 y 313 → seed126.sql, seed126b.sql, seed126c.sql, seed126d.sql.
-- Requisito: existe el contrato DTM-10608 en la copia (se clona su fila de ventas como molde); si no existe, falla sin cambiar nada.

do $$
begin
  if current_database() !~ '^rev_verif' then
    raise exception 'seed126: solo en copias desechables rev_verif_*; base actual: %. No se cambió nada.', current_database();
  end if;
end $$;
do $$ begin if not exists (select 1 from public.ventas where numero_contrato = 'DTM-10608') then raise exception 'seed126: falta el contrato molde DTM-10608 en esta copia.'; end if; end $$;
begin;
create temp table t on commit drop as select * from public.ventas where numero_contrato = 'DTM-10608';
update t set numero_contrato = 'DTM-12601', contrato_uid = gen_random_uuid(), share_token = gen_random_uuid(), reserva_token = null, estado = 'pendiente', cliente = 'Cliente 126 USD por pago', precio_venta = 1000, moneda = 'USD',
  moneda_cobro = 'USD', trm_cobro = null, total_cobro = null, trm_contrato = null, nacio_de_reuso = false, cotizacion_id = null, cotizacion_origen_id = null, grupo_conversion = null, fecha_salida = '2030-03-01', fecha_regreso = '2030-03-04', obligaciones_materializadas_en = null;
insert into public.ventas select * from t;
commit;
select numero_contrato, estado, moneda, moneda_cobro, precio_venta from public.ventas where numero_contrato = 'DTM-12601';
