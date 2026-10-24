-- ───────────────────────────────────────────────────────────────────────────
-- 232 · #109 D1 · Retirar la escritura de `anon` en cxp_pagos y retenciones_cxp
--
-- POR QUÉ. Las dos tablas nacieron (125, 130) con RLS y una policy `for all`
-- basada en `mi_rol()`. Esa policy ya niega a `anon` (sin sesión, `mi_rol()` es
-- null), y la 228 hizo que los intentos de `anon` respondan todos igual. Pero el
-- PRIVILEGIO de tabla sigue ahí: Supabase otorga por `ALTER DEFAULT PRIVILEGES`
-- de proyecto INSERT/UPDATE/DELETE (y más) a `anon` sobre toda tabla nueva de
-- `public`. Dejarlo significa que la Data API directa de un anónimo llega hasta
-- la policy y el trigger de la 228 en vez de ser rechazada en la puerta, y que
-- la seguridad de dos tablas de dinero depende de UNA sola capa (la RLS).
-- Esta migración quita la puerta; la RLS queda como segunda capa.
--
-- QUÉ HACE. `revoke insert, update, delete, truncate ... from anon` en ambas
-- tablas. TRUNCATE se incluye a propósito: no pasa por RLS ni por triggers de
-- fila, así que si `anon` lo conserva es la vía de escritura más fuerte.
-- No toca `authenticated` ni `service_role` (los únicos que escriben: ver abajo).
--
-- QUIÉN ESCRIBE HOY (auditado): Pagos (`pagos/actions.ts`), Conciliaciones
-- (`conciliaciones/actions.ts`) y Retenciones (`retenciones/actions.ts`) usan el
-- cliente de SESIÓN (`createClient`, rol de BD `authenticated`); las funciones
-- SECURITY DEFINER de 171/186/196/198/210/227 corren como su dueño. Ninguna ruta
-- escribe como `anon`, por eso retirarle el privilegio no corta a nadie.
--
-- QUÉ NO HACE. No edita la 228, no toca datos ni policies, no cambia SELECT de
-- `anon` (lo niega la RLS; fuera del alcance de #109) ni los DEFAULT PRIVILEGES
-- del proyecto (las tablas futuras seguirán naciendo con el mismo problema:
-- cada migración de tabla nueva debe revocar a `anon` lo que no use).
--
-- AUTOVERIFICACIÓN. Si tras el revoke `anon` conserva algún privilegio de
-- escritura (p. ej. heredado de PUBLIC, o a nivel de columna), o si
-- `authenticated`/`service_role` perdieran lo que necesitan, la migración
-- ABORTA entera (una transacción) y no deja nada a medias.
-- Rollback: supabase/scripts/rollback_232_revocar_escritura_anon_cxp.sql
-- ───────────────────────────────────────────────────────────────────────────

set local lock_timeout = '5s';

revoke insert, update, delete, truncate on table public.cxp_pagos       from anon;
revoke insert, update, delete, truncate on table public.retenciones_cxp from anon;

do $$
declare
  v_t text;
  v_p text;
begin
  foreach v_t in array array['public.cxp_pagos', 'public.retenciones_cxp'] loop
    -- anon: ningún privilegio de escritura efectivo (tabla, columna o heredado de PUBLIC).
    foreach v_p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if (v_p in ('INSERT', 'UPDATE') and has_any_column_privilege('anon', v_t, v_p))
         or (v_p in ('DELETE', 'TRUNCATE') and has_table_privilege('anon', v_t, v_p)) then
        raise exception '232: anon conserva % sobre % (revisar grants heredados de PUBLIC o a nivel de columna)', v_p, v_t;
      end if;
    end loop;
    -- Los roles que sí escriben conservan SELECT/INSERT/UPDATE/DELETE.
    foreach v_p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('authenticated', v_t, v_p) then
        raise exception '232: authenticated no tiene % sobre % (cortaría Pagos/Conciliaciones/Retenciones)', v_p, v_t;
      end if;
      if not has_table_privilege('service_role', v_t, v_p) then
        raise exception '232: service_role no tiene % sobre %', v_p, v_t;
      end if;
    end loop;
  end loop;
end $$;
