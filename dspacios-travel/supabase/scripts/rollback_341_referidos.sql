-- ROLLBACK 341 (#76 referidos). Se NIEGA si ya hay datos (referidores, asignaciones o fotos de contratos): no se destruye historial de atribución en silencio.
-- Una sola transacción, con espera ACOTADA de candados (5 s) y candado exclusivo sobre las tablas ANTES de contar (mismo criterio que los rollbacks de la 323 y la 340).
begin;
set local lock_timeout = '5s';
lock table public.referidores, public.referidor_codigos, public.aliado_referidores, public.contrato_referidos in access exclusive mode;
do $$ begin
  if exists (select 1 from public.referidores) or exists (select 1 from public.referidor_codigos) or exists (select 1 from public.aliado_referidores) or exists (select 1 from public.contrato_referidos) then
    raise exception 'ROLLBACK 341 detenido: ya hay referidores, códigos, asignaciones o atribuciones de contratos. Revisar con el dueño antes de borrar historial.';
  end if;
end $$;
drop trigger if exists trg_f341_atribuir_ins on public.ventas;
drop trigger if exists trg_f341_atribuir_upd on public.ventas;
drop trigger if exists trg_f341_limpiar on public.ventas;
drop function if exists public.referidos_catalogo(uuid);
drop function if exists public.referidos_contratos(uuid, bigint, bigint, text, integer, bigint);
drop function if exists public.referido_quitar(uuid, bigint, text, text);
drop function if exists public.referido_aplicar_codigo(uuid, bigint, text);
drop function if exists public.referido_asignar(uuid, bigint, bigint, numeric, text);
drop function if exists public.referidor_codigo_definir(uuid, bigint, text, numeric, boolean);
drop function if exists public.referidor_guardar(uuid, bigint, text, text, text, text, text, text, text, boolean);
drop schema if exists f341_priv cascade;
drop table if exists public.contrato_referidos;
drop table if exists public.aliado_referidores;
drop table if exists public.referidor_codigos;
drop table if exists public.referidores;
commit;
