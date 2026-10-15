-- ───────────────────────────────────────────────────────────────────────────
-- ATRIBUCIÓN B2C → MAYORISTA · contactos históricos del checkout público
-- (hotfix de acceso a `crm_contactos`, migración 207)
--
-- ⛔ ESCRIBE DATOS. Arranca APAGADO: tal como está en el repo solo VERIFICA
--    (bloquea, cuenta, compara con lo esperado) y aborta sin escribir nada.
--    Requiere autorización explícita del dueño para habilitarlo.
-- ⛔ Correr DESPUÉS de la 207 (necesita la columna `tenant`) y nunca como
--    parte automática del despliegue.
--
-- QUÉ ATRIBUYE (y nada más)
--   Solo filas que cumplen TODO esto, y solo a `mayorista` (el checkout
--   público del tarifario es exclusivo de mayorista: checkout/actions.ts
--   estampa tenant='mayorista' en su cotización):
--     · tenant IS NULL
--     · origen   = 'Cotización tarifario (B2C)'   (exacto)
--     · categoria = 'cliente_final'               (exacto)
--     · tipo_doc = 'CC' y documento no vacío — patrón observado del lote.
--       CC es una GUARDA del lote, NO una identidad documental validada.
--   y además una de estas dos evidencias:
--     E2  exactamente UN INSERT auditado para la fila, con actor nulo
--         (service_role, sin sesión) y origen B2C en el snapshot `despues`.
--         Auditoría CONTRADICTORIA (→ no es candidata): un segundo INSERT,
--         un INSERT con actor o con otro origen, un DELETE, o un UPDATE que
--         haya cambiado `origen`, `categoria` o `tenant`. Otras ediciones
--         (p. ej. teléfono) no cambian la procedencia y no la descalifican.
--     E4  NINGÚN evento de auditoría para la fila; creada ANTES del primer
--         evento global registrado en `auditoria` (desde ahí, cualquier
--         edición habría quedado auditada); y sin señal de edición
--         (`updated_at = created_at`). Límite conocido: la app no mantiene
--         `updated_at`, así que una edición anterior al inicio de la
--         auditoría no es detectable — el dueño lo aceptó para este lote.
--   NO usa E1/E3/E5, ni asesor, comisión, ni coincidencias de documento o
--   correo con otras tablas para inferir agencia.
--
-- LOTE APROBADO (verificado por Auditorías en Producción con SELECT
-- agregados sin PII): E2 = 24, E4 = 7, total = 31. Si los conteos FRESCOS no
-- son exactamente esos, aborta: el lote cambió y hay que volver a revisarlo.
-- No exige "31 filas en toda la tabla": puede haber contactos ajenos nuevos,
-- y esos deben quedar intactos (se verifica).
--
-- CÓMO SE EJECUTA (todo en UNA transacción; ante cualquier diferencia,
-- aborta y no queda nada escrito):
--   1. LOCK de `crm_contactos` en modo SHARE ROW EXCLUSIVE: bloquea INSERT/
--      UPDATE/DELETE concurrentes (y otra ejecución de este script) hasta el
--      final; las lecturas siguen.
--   2. Cuenta candidatos E2/E4 frescos y exige 24/7/31.
--   3. Si está APAGADO, aborta aquí con los conteos (simulacro sin escritura).
--   4. Toma una huella de todas las filas que NO son candidatas.
--   5. UPDATE por el conjunto EXACTO de ids candidatos (y tenant IS NULL);
--      exige 31 filas afectadas.
--   6. Verifica: los 31 quedaron en mayorista, en ellos solo cambió `tenant`,
--      y la huella de las filas ajenas es idéntica (ninguna cambió).
--
-- HABILITAR (solo con autorización del dueño): quitar el `--` de la línea
-- [CONFIRMAR] que está justo después del `begin;`. Vale solo dentro de esta
-- transacción (lleva el id de la transacción), igual que el rollback 207.
--
-- Re-ejecutarlo después de un éxito aborta sin cambios (ya no hay
-- candidatos con tenant NULL). Deshacer una atribución confirmada NO es una
-- operación de la app: el trigger de la 207 impide cambiar un tenant ya
-- asignado; requiere una intervención manual aparte, con su propia
-- autorización.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- [CONFIRMAR] quitar el `--` de la línea siguiente para ESCRIBIR (solo esta transacción):
-- select set_config('app.atribuir_crm_b2c', 'ATRIBUIR_B2C_MAYORISTA:' || txid_current(), true);

lock table public.crm_contactos in share row exclusive mode;

do $$
declare
  -- Lote aprobado. Cambiarlos exige una nueva revisión del dueño.
  c_esperado_e2  constant int := 24;
  c_esperado_e4  constant int := 7;
  c_origen       constant text := 'Cotización tarifario (B2C)';
  v_habilitado   boolean := coalesce(current_setting('app.atribuir_crm_b2c', true), '')
                            = 'ATRIBUIR_B2C_MAYORISTA:' || txid_current();
  v_primer_evento timestamptz;
  v_e2 int; v_e4 int; v_total int;
  v_ajenas_antes text; v_ajenas_despues text;
  v_cand_antes text;   v_cand_despues text;
  v_n_ajenas_antes bigint; v_n_ajenas_despues bigint;
  v_afectadas int;
begin
  if to_regclass('public.crm_contactos') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'crm_contactos' and column_name = 'tenant') then
    raise exception 'Atribución B2C ABORTADA: falta crm_contactos.tenant (¿se aplicó la 207?).';
  end if;

  select min(creado_en) into v_primer_evento from public.auditoria;
  if v_primer_evento is null then
    raise exception 'Atribución B2C ABORTADA: la tabla auditoria está vacía; sin evidencia no se atribuye nada.';
  end if;

  -- Candidatos frescos (bajo el LOCK). Una fila no puede ser E2 y E4 a la vez:
  -- E2 exige su INSERT auditado; E4, ningún evento.
  create temp table _atr_b2c on commit drop as
  with lote as (
    select c.id, c.created_at, c.updated_at
      from public.crm_contactos c
     where c.tenant is null
       and c.origen = c_origen
       and c.categoria = 'cliente_final'
       and c.tipo_doc = 'CC'
       and nullif(btrim(c.documento), '') is not null
  ),
  ev as (
    select a.registro_id,
           count(*) filter (where a.accion = 'INSERT') as n_insert,
           bool_and(a.accion <> 'INSERT'
                    or (a.actor_id is null and a.despues->>'origen' = c_origen)) as insert_ok,
           count(*) filter (where a.accion = 'DELETE') as n_delete,
           count(*) filter (where a.accion = 'UPDATE'
                              and coalesce(a.cambios, '{}'::jsonb) ?| array['origen','categoria','tenant']) as n_update_contradice
      from public.auditoria a
     where a.tabla = 'crm_contactos'
       and a.registro_id in (select id::text from lote)
     group by a.registro_id
  )
  select l.id,
         case
           when e.n_insert = 1 and e.insert_ok and e.n_delete = 0 and e.n_update_contradice = 0 then 'E2'
           when e.registro_id is null
                and l.created_at < v_primer_evento
                and l.updated_at = l.created_at then 'E4'
         end as cat
    from lote l
    left join ev e on e.registro_id = l.id::text;

  delete from _atr_b2c where cat is null;   -- ni E2 ni E4: queda fuera, intacta

  select count(*) filter (where cat = 'E2'), count(*) filter (where cat = 'E4'), count(*)
    into v_e2, v_e4, v_total
    from _atr_b2c;

  if v_e2 <> c_esperado_e2 or v_e4 <> c_esperado_e4 or v_total <> c_esperado_e2 + c_esperado_e4 then
    raise exception 'Atribución B2C ABORTADA: candidatos frescos E2=% E4=% total=% (esperado E2=% E4=% total=%). El lote cambió: revisar antes de reintentar. No se escribió nada.',
      v_e2, v_e4, v_total, c_esperado_e2, c_esperado_e4, c_esperado_e2 + c_esperado_e4;
  end if;

  if not v_habilitado then
    raise exception 'Atribución B2C APAGADA (simulacro): candidatos frescos E2=% E4=% total=% coinciden con el lote aprobado. No se escribió nada. Para escribir, habilitar la línea [CONFIRMAR] con autorización del dueño.',
      v_e2, v_e4, v_total;
  end if;

  -- Huellas ANTES: filas ajenas completas; candidatas sin `tenant`.
  select count(*), coalesce(md5(string_agg(to_jsonb(c)::text, '|' order by c.id)), '')
    into v_n_ajenas_antes, v_ajenas_antes
    from public.crm_contactos c
   where c.id not in (select id from _atr_b2c);
  select coalesce(md5(string_agg((to_jsonb(c) - 'tenant')::text, '|' order by c.id)), '')
    into v_cand_antes
    from public.crm_contactos c
   where c.id in (select id from _atr_b2c);

  update public.crm_contactos c
     set tenant = 'mayorista'
   where c.id in (select id from _atr_b2c)
     and c.tenant is null;
  get diagnostics v_afectadas = row_count;

  if v_afectadas <> v_total then
    raise exception 'Atribución B2C ABORTADA: % filas afectadas, se esperaban %. Todo revertido.', v_afectadas, v_total;
  end if;

  -- Verificación DESPUÉS.
  if exists (select 1 from public.crm_contactos c
              where c.id in (select id from _atr_b2c) and c.tenant is distinct from 'mayorista') then
    raise exception 'Atribución B2C ABORTADA: algún candidato no quedó en mayorista. Todo revertido.';
  end if;
  select coalesce(md5(string_agg((to_jsonb(c) - 'tenant')::text, '|' order by c.id)), '')
    into v_cand_despues
    from public.crm_contactos c
   where c.id in (select id from _atr_b2c);
  if v_cand_despues <> v_cand_antes then
    raise exception 'Atribución B2C ABORTADA: en los candidatos cambió algo más que tenant. Todo revertido.';
  end if;
  select count(*), coalesce(md5(string_agg(to_jsonb(c)::text, '|' order by c.id)), '')
    into v_n_ajenas_despues, v_ajenas_despues
    from public.crm_contactos c
   where c.id not in (select id from _atr_b2c);
  if v_n_ajenas_despues <> v_n_ajenas_antes or v_ajenas_despues <> v_ajenas_antes then
    raise exception 'Atribución B2C ABORTADA: cambió algún contacto ajeno al lote. Todo revertido.';
  end if;

  raise notice 'Atribución B2C OK: % filas → mayorista (E2=%, E4=%); contactos ajenos intactos (%).',
    v_afectadas, v_e2, v_e4, v_n_ajenas_despues;
end $$;

-- Resultado (solo conteos). Si el bloque anterior abortó, esta consulta y el
-- COMMIT no se aplican: la transacción entera queda revertida.
select 'atribuidos a mayorista en esta transacción' as estado,
       (select count(*) from _atr_b2c) as filas;

commit;
