-- ═════════════════════════════════════════════════════════════════════════
-- ROLLBACK 224 · retirar la vista `empaquetados_basica` (fase 1, aditiva). Restaura el estado EXACTO anterior.
--
-- La 224 solo agregó la vista y sus grants: el rollback la retira. No toca policies ni datos.
--
-- ⚠️ Orden: si la 225 sigue aplicada, `venta` solo alcanza los empaquetados por esta vista; retirarla lo dejaría
-- sin lectura alguna. El script se NIEGA (sin tocar nada) mientras exista la policy "empaquetados: lectura con costos" de la 225: corre
-- antes rollback_225_neto_empaquetados_cierre.sql. Y si el código nuevo (computo.ts leyendo la vista) ya está
-- desplegado, retirar la vista lo rompe: desplegar antes el código anterior. Idempotente.
-- ═════════════════════════════════════════════════════════════════════════
begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.empaquetados') is null then
    raise exception 'ROLLBACK 224 ABORTADO: public.empaquetados no existe.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'empaquetados' and policyname = 'empaquetados: lectura con costos') then
    raise exception 'ROLLBACK 224 ABORTADO: la 225 sigue aplicada (venta solo lee por la vista). Corre primero rollback_225_neto_empaquetados_cierre.sql.';
  end if;
end $$;

drop view if exists public.empaquetados_basica;

notify pgrst, 'reload schema';

commit;
