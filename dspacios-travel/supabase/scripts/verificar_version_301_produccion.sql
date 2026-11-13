-- SOLO LECTURA. ¿Qué versión de la 301 quedó aplicada en Producción? Una sola consulta con columna de estado.
-- Hay dos textos de `20260601000301_promociones_acumulacion.sql` en local:
--   · ORIGINAL (worktree 43-vigencias-dia): aviso de contradicción «tienen acumulación u orden distintos»; sin funciones de texto.
--   · COMBINADO (worktree 43-lote-combinado, ajuste del 2026-11-13): aviso que nombra la decisión que difiere y una estadía de ejemplo;
--     agrega `_e5_texto_alt`, `_e5_texto_diferencia` y `_e5_ejemplo_estadia`.
-- La regla comercial es la misma en las dos; solo cambia el texto del aviso. El repositorio debe guardar EXACTAMENTE la que corrió.
with f as (
  select
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_e5_texto_alt', '_e5_texto_diferencia', '_e5_ejemplo_estadia')) as funciones_texto,
    (select position('deciden distinto frente a EBB / Long Stay' in p.prosrc) > 0 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = '_e5_revisar') as aviso_nuevo,
    (select position('tienen acumulación u orden distintos' in p.prosrc) > 0 from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = '_e5_revisar') as aviso_original
)
select 'V301' as control,
  case
    when funciones_texto = 3 and aviso_nuevo and not aviso_original then 'COMBINADO — coincide con el repo del cierre: continuar'
    when funciones_texto = 0 and aviso_original and not aviso_nuevo then 'ORIGINAL — el repo del cierre NO coincide: detenerse y avisar'
    else 'MIXTO — revisar antes de continuar'
  end as estado,
  funciones_texto, aviso_nuevo, aviso_original
from f;
