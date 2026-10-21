-- ═════════════════════════════════════════════════════════════════════════
-- 223 · #50 (B, CIERRE) — la modalidad PVP/NETO pasa a ser OBLIGATORIA.
--
-- Número reservado por el Coordinador (bitácora de #50, 2026-10-20). Scripts:
-- supabase/scripts/{postcheck,rollback}_223_neto_hija_manual_cierre.sql y
-- test_223_*.sql (SOLO bases desechables).
--
-- Orden de despliegue: ... → 222 → postcheck 222 → APP NUEVA desplegada →
-- 223 → postcheck 223. La app vieja no manda modalidad: aplicar la 223 antes de
-- desplegar la app nueva dejaría sin poder elegir opción (en una venta B2B de
-- una comparativa manual) a quien siga con la app vieja.
--
-- Qué cambia: nada de código. Enciende el interruptor `p50_priv.config` que ya
-- leen `elegir_opcion_comparativa_sesion` y `resolver_solicitud_comparativa`
-- (222): desde ahora, la hija manual de una venta B2B (agencia/freelance) que
-- se cree SIN modalidad se rechaza antes de crearse. Las hijas ya existentes
-- (legadas, sin sello) no cambian: siguen en PVP; su aliado se propaga al
-- convertir, solo hacia adelante. Carrito, público y B2C no se tocan.
-- ═════════════════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '10s';

do $$
begin
  if to_regclass('p50_priv.config') is null or to_regclass('public.cotizacion_neto') is null
     or to_regprocedure('public.registrar_validacion_comparativa_n50(bigint,text,text,integer,text,uuid,numeric,text,boolean,jsonb,text,boolean,boolean)') is null
     or to_regprocedure('public.resolver_solicitud_comparativa_n50(bigint,text,text,text,text,boolean,boolean)') is null then
    raise exception '223: falta la 222. No se aplicó nada.';
  end if;
  if p50_priv.exigir_modalidad() then
    raise exception '223: la modalidad ya es obligatoria. No se aplicó nada.';
  end if;
  if not p39_priv.frontera_activa() then
    raise exception '223: la frontera de #39 no está activa. No se aplicó nada.';
  end if;
end $$;

update p50_priv.config set exigir_modalidad = true, actualizado_en = now() where id;

do $$
begin
  if not p50_priv.exigir_modalidad() then
    raise exception '223: el interruptor no quedó encendido.';
  end if;
end $$;

commit;
