-- #49 · RNT por agencia: observado (Producción) frente a esperado (semilla 109 / constante EMPRESA). SOLO LECTURA (un único SELECT).
-- Se pega completa en el editor SQL de Supabase. No escribe, no crea objetos, no necesita transacción.
--
-- Cómo leer la columna `estado`:
--   RNT_VACIO                        → Mayorista sin RNT: el código de #49 queda bloqueado hasta cargarlo en «Datos de la agencia».
--   RNT_IGUAL_AL_DE_MINORISTA        → Mayorista imprimiría el RNT de Minorista (147090): dato errado, corregir antes del código.
--   RNT_REPETIDO_ENTRE_AGENCIAS      → dos agencias con el mismo RNT: revisar cuál es el real.
--   NIT_DISTINTO_A_LA_SEMILLA        → el NIT fue editado desde la 109: confirmar que es el vigente.
--   RNT_DISTINTO_A_LA_SEMILLA        → editado desde la 109 (Minorista): confirmar.
--   RNT_PRESENTE_CONFIRMAR_CON_DUENO → Mayorista tiene un RNT cargado: el repositorio no lo conoce; solo el dueño lo valida.
--   COINCIDE_CON_SEMILLA             → no cambió desde la 109 (no prueba que sea legalmente correcto).
-- No se propone ningún RNT ni texto sustituto para Mayorista: lo informa el dueño.
with esperado(tenant, nit_esperado, rnt_esperado, origen_esperado) as (
  values
    ('mayorista', '902076052', null::text, 'Semilla 109: RNT vacío; el repositorio no tiene el RNT real de Mayorista (lo informa el dueño)'),
    ('minorista', '901654224', '147090',   'Semilla 109 y constante EMPRESA de lib/contrato/plantilla.ts')
),
observado as (
  select tenant::text as tenant, razon_social, nit, rnt from public.agencias
),
rnt_repetido as (
  select btrim(rnt) as rnt from public.agencias
  where coalesce(btrim(rnt), '') <> ''
  group by btrim(rnt) having count(*) > 1
)
select
  coalesce(e.tenant, o.tenant)                       as agencia,
  o.razon_social                                     as razon_social_observada,
  o.nit                                              as nit_observado,
  e.nit_esperado,
  o.rnt                                              as rnt_observado,
  coalesce(e.rnt_esperado, '(sin dato en el repositorio)') as rnt_esperado,
  e.origen_esperado,
  case
    when e.tenant is null                                                     then 'TENANT_NO_ESPERADO'
    when o.tenant is null                                                     then 'FALTA_FILA'
    when regexp_replace(coalesce(o.nit, ''), '\D', '', 'g') <> e.nit_esperado then 'NIT_DISTINTO_A_LA_SEMILLA'
    when coalesce(btrim(o.rnt), '') = ''                                      then 'RNT_VACIO'
    when e.tenant = 'mayorista' and btrim(o.rnt) = '147090'                   then 'RNT_IGUAL_AL_DE_MINORISTA'
    when btrim(o.rnt) in (select rnt from rnt_repetido)                       then 'RNT_REPETIDO_ENTRE_AGENCIAS'
    when e.rnt_esperado is not null and btrim(o.rnt) <> e.rnt_esperado        then 'RNT_DISTINTO_A_LA_SEMILLA'
    when e.rnt_esperado is null                                               then 'RNT_PRESENTE_CONFIRMAR_CON_DUENO'
    else 'COINCIDE_CON_SEMILLA'
  end                                                as estado
from esperado e
full join observado o on o.tenant = e.tenant
order by 1;
