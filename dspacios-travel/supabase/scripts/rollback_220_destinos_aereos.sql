-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK 220 · retirar la migración aditiva de #67 (destinos aéreos alternativos).
--
-- Solo procede si NO hubo uso real: ningún paquete con el check encendido y ninguna fila en
-- armado_paquete_destinos_aereos. Una vez que existe configuración, la 220 es FORWARD-ONLY: retirarla
-- dejaría vuelos vinculados a destinos que el paquete ya no declara, y el código anterior los ofrecería
-- sin la guarda. El script aborta sin tocar nada.
--
-- ⚠️ El código nuevo llama a guardar_destinos_aereos_67 y lee la columna/tabla: retirar la 220 exige
-- volver a desplegar el código anterior ANTES. No se borra ningún vínculo de vuelos ni ningún destino.
-- ═════════════════════════════════════════════════════════════════════════
begin;

set local lock_timeout = '10s';

do $$
declare v_on bigint := 0; v_alt bigint := 0;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'destinos_aereos_alternativos')
     and to_regclass('public.armado_paquete_destinos_aereos') is null then
    raise exception 'ROLLBACK 220 ABORTADO: la 220 no está aplicada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'armado_paquetes' and column_name = 'destinos_aereos_alternativos') then
    execute 'select count(*) from public.armado_paquetes where destinos_aereos_alternativos' into v_on;
  end if;
  if to_regclass('public.armado_paquete_destinos_aereos') is not null then
    execute 'select count(*) from public.armado_paquete_destinos_aereos' into v_alt;
  end if;
  if v_on + v_alt > 0 then
    raise exception 'ROLLBACK 220 ABORTADO: hay configuración en uso (% paquete(s) con el check encendido, % alternativa(s)). Es forward-only; no se toca nada.', v_on, v_alt;
  end if;
end $$;

-- Triggers primero (dependen de las funciones).
drop trigger if exists tr_vinculo_aereo_67 on public.armado_vuelos;
drop trigger if exists tr_vinculo_aereo_67 on public.armado_empaquetados;
drop trigger if exists tr_config_paquete_aereo_67_ins on public.armado_paquetes;
drop trigger if exists tr_config_paquete_aereo_67_upd on public.armado_paquetes;
drop trigger if exists tr_inv_check_aereo_67 on public.armado_paquetes;
drop trigger if exists tr_inv_destino_bloqueo_67 on public.bloqueos_vuelo;
drop trigger if exists tr_inv_destino_empaquetado_67 on public.empaquetados;
drop trigger if exists tr_inv_destino_pais_67 on public.destinos;
drop table if exists public.armado_paquete_destinos_aereos;   -- arrastra sus triggers y su policy

drop function if exists public.guardar_destinos_aereos_67(bigint, bigint, boolean, bigint[]);
drop function if exists public.trg_vinculo_aereo_67();
drop function if exists public.trg_config_paquete_aereo_67();
drop function if exists public.trg_config_alternativa_aerea_67();
drop function if exists public.trg_invalidar_config_aerea_67();
drop function if exists public.trg_invalidar_origen_aereo_67();
drop function if exists public.validar_vinculo_aereo_67(bigint, text, bigint);
drop function if exists public.validar_config_destinos_aereos_67(bigint);
drop function if exists public.destinos_aereos_efectivos_67(bigint, boolean, bigint[]);
drop function if exists public.pais_comparable_67(text);

alter table public.armado_paquetes drop column if exists destinos_aereos_alternativos;

commit;
