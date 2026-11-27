-- Preflight 329 (solo lectura, UNA consulta). Esperado: todo OK antes de aplicar.
select n, control, actual, esperado, case when ok then 'OK' else 'FALLA' end as estado from (
  select 1 as n, 'cxp_pagos existe (130)' as control, (to_regclass('public.cxp_pagos') is not null)::text as actual, 'true' as esperado, (to_regclass('public.cxp_pagos') is not null) as ok
  union all select 2, 'la 328 está aplicada (solicitudes_proveedor.tipo)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitudes_proveedor' and column_name = 'tipo')::text, 'true',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'solicitudes_proveedor' and column_name = 'tipo')
  union all select 3, 'tablas 329 aún no existen (0 = primera vez; 2 = reaplicación)', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('cxp_pago_soportes', 'solicitud_proveedor_pagos'))::text, '0 o 2',
         (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('cxp_pago_soportes', 'solicitud_proveedor_pagos')) in (0, 2)
) q order by n;
