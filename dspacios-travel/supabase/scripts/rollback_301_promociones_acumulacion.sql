-- ROLLBACK 301 (#43/#60 entrega 5). Separado y PROTEGIDO: aborta sin tocar nada si hay algo que la 301 sostiene y que cambiaría
-- precios al quitarla: combinaciones CONFIGURADAS (volverían a acumular), promociones PENDIENTES (empezarían a venderse) o reglas
-- RETENIDAS (empezarían a venderse sin configurar) o cambios de promoción PENDIENTES (se perderían). Para llegar a 0: descartar las retenidas y quitar/eliminar lo configurado.
-- ANTES de correrlo: revertir el código que lee o escribe lo de la 301.
begin;
set local lock_timeout = '8s';
set local statement_timeout = '60s';

do $$
declare v_conf bigint; v_pend bigint; v_ret bigint; v_camb bigint;
begin
  select count(*) filter (where estado = 'configurada'), count(*) filter (where estado = 'pendiente') into v_conf, v_pend from public.hotel_promocion_combinacion;
  select count(*) into v_ret from public.hotel_reglas_descuento where not autorizada or propuesta is not null;
  select count(*) into v_camb from public.hotel_promocion_cambio_pendiente;
  if v_conf > 0 or v_pend > 0 or v_ret > 0 or v_camb > 0 then
    raise exception 'ROLLBACK 301 ABORTADO (REVISAR): % combinación(es) configurada(s), % promoción(es) pendiente(s), % regla(s) retenida(s) y % cambio(s) de promoción pendiente(s).', v_conf, v_pend, v_ret, v_camb;
  end if;
end $$;

drop trigger if exists trg_e5_revisar on public.hotel_temporadas;
drop trigger if exists trg_e5_revisar on public.hotel_reglas_descuento;
drop trigger if exists trg_e5_revisar on public.hotel_promocion_reglas;
drop function if exists public.promociones_combinacion_estado(bigint);
drop function if exists public.promocion_cambio_descartar(bigint);
drop function if exists public.promocion_cambio_activar(bigint, jsonb);
drop function if exists public.promocion_cambio_proponer(bigint, jsonb);
drop table if exists public.hotel_promocion_cambio_pendiente;
drop function if exists public.regla_descuento_descartar(bigint);
drop function if exists public.regla_descuento_aplicar(bigint);
drop function if exists public.regla_descuento_guardar(bigint, bigint, text, int, numeric, boolean);
drop function if exists public._e5_sin_resolver(bigint, jsonb);
drop function if exists public.promocion_guardar_combinacion(bigint, jsonb, jsonb);
drop function if exists public._e5_aplicar_cambios(bigint, jsonb);
drop function if exists public._e5_autorizar();
drop function if exists public._e5_misma_config(public.hotel_promocion_combinacion, public.hotel_promocion_combinacion);
drop function if exists public._e5_texto_diferencia(public.hotel_promocion_combinacion, public.hotel_promocion_combinacion, text, text);
drop function if exists public._e5_ejemplo_estadia(bigint, bigint);
drop function if exists public._e5_texto_alt(text);
drop table if exists public.hotel_promocion_combinacion;  -- con su disparador
drop function if exists public.tg_e5_revisar();
drop function if exists public._e5_revisar(bigint, bigint);
drop function if exists public._e5_texto_familias(text[]);
drop function if exists public._e5_coinciden_promos(bigint, bigint);
drop function if exists public._e5_reglas(bigint, boolean);
drop function if exists public._e5_requeridas(bigint, jsonb);
drop function if exists public._e5_rango(bigint);
drop function if exists public._e5_max_noches();
drop function if exists public._e5_sin_repetidos(text[]);
alter table public.hotel_reglas_descuento drop constraint if exists hotel_reglas_descuento_propuesta_301;
alter table public.hotel_reglas_descuento drop column if exists propuesta, drop column if exists autorizada;

commit;
