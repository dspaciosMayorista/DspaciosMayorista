-- Comprobación del rollback de la 148: ¿quedó la base como la dejó la 147?
-- Solo lectura. Correr DESPUÉS de `rollback_148.sql`.
--
-- No comprueba "no hay errores": comprueba el ESTADO concreto, objeto por
-- objeto. Un rollback que corre sin fallar pero deja una vista de más no sirve.

with esperado(n, caso, valor_esperado, valor_real) as (
  select 1, 'Las vistas nuevas de la 148 ya no existen', '0',
         (select count(*)::text from information_schema.views
           where table_schema = 'public'
             and table_name in ('abonos_resumen','contrato_vuelos_basica'))
  union all
  select 2, 'La policy de lectura de abonos para `venta` ya no existe', '0',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'abonos'
             and policyname = 'abonos: venta consulta')
  union all
  select 3, 'Las 4 policies de Storage de la 148 ya no existen', '0',
         (select count(*)::text from pg_policies
           where schemaname = 'storage'
             and policyname in ('contratos files: lectura','contratos files: subir',
                                'contratos files: reemplazar','contratos files: eliminar'))
  union all
  select 4, 'Volvió la policy única de Storage de la 046', '1',
         (select count(*)::text from pg_policies
           where schemaname = 'storage' and policyname = 'contratos files: acceso')
  union all
  select 5, '`ventas_basica` ya no trae cliente_direccion ni asesor_firma_cc', '0',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'ventas_basica'
             and column_name in ('cliente_direccion','asesor_firma_cc'))
  union all
  select 6, '`ventas_basica` sigue existiendo y trae cliente_documento', '1',
         (select count(*)::text from information_schema.columns
           where table_schema = 'public' and table_name = 'ventas_basica'
             and column_name = 'cliente_documento')
  union all
  -- La lectura de vouchers vuelve a ser por agencia (sin la condición de
  -- propiedad que agregó la 148).
  select 7, 'La lectura de `vouchers` volvió a ser por agencia', '0',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'vouchers'
             and policyname = 'vouchers: lectura'
             and qual like '%soy_asesor_del_contrato%')
  union all
  -- Y `venta` vuelve a leer la tabla base de vuelos (estado de la 147).
  select 8, '`venta` vuelve a leer la tabla base `contrato_vuelos`', '1',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'contrato_vuelos'
             and policyname = 'contrato_vuelos: lectura'
             and qual like '%venta%')
)
select n as "#", caso, valor_esperado as esperado, valor_real as obtenido,
       case when valor_esperado = valor_real then 'OK' else 'FALLA' end as resultado
from esperado order by (valor_esperado = valor_real), n;
