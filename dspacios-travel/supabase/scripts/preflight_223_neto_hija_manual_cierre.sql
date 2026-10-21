-- ───────────────────────────────────────────────────────────────────────────
-- PREFLIGHT 223 · cierre de #50 (la modalidad PVP/NETO pasa a ser obligatoria). SOLO LECTURA (read only + ROLLBACK).
-- Correr ANTES de aplicar la 223, con la 222 ya aplicada y la app nueva ya desplegada.
-- Devuelve UNA sola fila consolidada (mismo formato que preflight_222):
--   veredicto   BLOQUEANTE si alguna verificación lo es; si no, INFO.
--   bloqueantes / revisar   cuántas verificaciones tienen ese nivel; chequeos = 3 (Q1-Q3).
--   resumen     Q1=NIVEL/cantidad;Q2=...;Q3=...  (todas, en orden).
--   mensaje     qué hacer con este resultado.
--   detalle     jsonb con cada verificación: codigo, nivel, cantidad y su explicación.
-- Sin datos personales. Si falla con "relation p50_priv.config does not exist", la 222 no está aplicada (no aplicar la 223).
--
-- Q3 (INFO, Q-5): madres B2B abiertas SIN aliado del catálogo. La 223 NO las deja sin salida: para ellas la
-- modalidad no se exige y PVP se permite (comportamiento de hoy); solo NETO exige el aliado. El conteo es
-- para saber cuántas no podrían ir en NETO hasta enlazar el aliado en la comparativa.
-- ───────────────────────────────────────────────────────────────────────────
begin transaction read only;

with
chequeos(codigo, nivel, cantidad, detalle) as (
  select 'Q1',
         case when to_regclass('p50_priv.config') is null or to_regclass('public.cotizacion_neto') is null then 'BLOQUEANTE' else 'INFO' end,
         (to_regclass('p50_priv.config') is not null and to_regclass('public.cotizacion_neto') is not null)::int,
         'La 222 está aplicada (esquema p50_priv y tabla cotizacion_neto presentes). Sin ella la 223 no se puede aplicar'
  union all
  select 'Q2',
         case when to_regclass('p50_priv.config') is null then 'BLOQUEANTE'
              when (select c.exigir_modalidad from p50_priv.config c where c.id) then 'BLOQUEANTE'
              else 'INFO' end,
         case when to_regclass('p50_priv.config') is null then 0
              else (select c.exigir_modalidad::int from p50_priv.config c where c.id) end,
         'La modalidad todavía NO es obligatoria (cantidad 0). Si es 1, la 223 ya está aplicada: no repetir'
  union all
  select 'Q3',
         'INFO',
         (select count(*)::int
            from public.cotizaciones q
           where q.modo = 'comparativa' and q.tipo = 'comparativa_manual' and q.estado = 'abierta'
             and q.aliado_id is null
             and coalesce(nullif(q.payload->>'tipoAsesor', ''), 'interno') <> 'interno'),
         'Madres B2B (agencia/freelance) abiertas SIN aliado_id (informativo: con la 223 siguen pudiendo ir en PVP sin sello; solo NETO exige el aliado del catálogo)'
),
orden as (
  select c.codigo, c.nivel, c.cantidad, c.detalle, row_number() over (order by c.codigo) as n
    from chequeos c
)
select case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0 then 'BLOQUEANTE' else 'INFO' end as veredicto,
       count(*) filter (where o.nivel = 'BLOQUEANTE')::int as bloqueantes,
       count(*) filter (where o.nivel = 'REVISAR')::int as revisar,
       count(*)::int as chequeos,
       string_agg(o.codigo || '=' || o.nivel || '/' || o.cantidad, ';' order by o.n) as resumen,
       case when count(*) filter (where o.nivel = 'BLOQUEANTE') > 0
            then 'PREFLIGHT: hay BLOQUEANTES; no aplicar la 223.'
            else 'PREFLIGHT: sin bloqueantes; confirma que la app nueva ya está desplegada y aplica la 223.' end as mensaje,
       jsonb_agg(jsonb_build_object('codigo', o.codigo, 'nivel', o.nivel, 'cantidad', o.cantidad, 'detalle', o.detalle)
                 order by o.n) as detalle
  from orden o;

rollback;
