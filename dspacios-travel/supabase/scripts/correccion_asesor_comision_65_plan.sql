-- ─────────────────────────────────────────────────────────────────────────────
-- #65 · PLAN DE CORRECCIÓN DE DATOS: asignar al asesor confirmado las líneas de comisión/recobro   ⚠️ NO EJECUTADO · BLOQUEADO
--
-- Tres bloques independientes, para pegarse de a uno en el editor SQL y en este orden:
--   A. PRECHECK   (SELECT, solo lectura, una sola consulta con columna `estado`)
--   B. CORRECCIÓN (una transacción con un UPDATE acotado; termina en ROLLBACK y NO hace nada mientras la puerta de contabilidad esté en false)
--   C. POSTCHECK  (SELECT, solo lectura, una sola consulta con columna `estado`)
--
-- REGLA DE LA LÍNEA 1 (dueño, 1-nov-2026, supera a la anterior de «mismo asesor» donde choquen): en estos contratos la comisión se paga a la
-- persona de la LÍNEA 1 (la fila de menor id del contrato). Javier figura en la línea 2 porque ASISTIÓ, no como segundo comisionista.
-- Consecuencias: (a) la línea 2 a nombre de Javier NO es una comisión suya → pertenece a la persona de la línea 1 (80→3, 81→33, 82→1, 83→1, 85→24, 89→28, 107→7, 137→37);
-- (b) en MIN-00-0462 la línea 1 es Tatiana (#79, ficha 3): #79 NO se cambia a Javier (la asignación anterior 79→8 se RETIRÓ);
-- (c) en 0476 y 0498 la línea 1 ya es Javier: no hay segundo comisionista; sus dos líneas son comisión y recobro del mismo asesor (el dueño: «una línea es comisión y la otra recobro
-- del mismo asesor»), no un duplicado. (d) #80 (línea 2 de 0462, a nombre de Javier; total $142.494 y abono registrado $142.494) → ficha 3 (Tatiana): asignación CONFIRMADA por el dueño,
-- pero EXCLUIDA del UPDATE hasta que Contabilidad concilie a quién se pagó ese abono (el destinatario sigue desconocido).
--
-- ASIGNACIÓN CONFIRMADA POR EL DUEÑO (fila → ficha; no se vuelve a pedir):
--   81→33 · 82→1 · 83→1 · 85→24 · 89→28 · 107→7 · fila 1 de MIN-00-0498→8.
--   EXCLUIDAS POR CONCILIACIÓN (asignación confirmada, abono registrado, destinatario del pago sin conciliar; ninguna entra al bloque B ni al postcheck):
--     · fila 80 (MIN-00-0462, hoy ficha 8 «JAVIER A VIEIRA P» → ficha 3 Tatiana): total $142.494 y abono registrado $142.494. Asignación 80→3 CONFIRMADA por el dueño (la comisión es de la línea 1).
--     · fila 137 (MIN-00-0519 → ficha 37): total $139.000 y abono registrado $139.000 (antes decía $39.000: dato desactualizado).
--     · fila 135 (MIN-00-0519, hoy ficha NULL «YAQUELINE USUGA» → ficha 37): total $351.852,16 y abono registrado $351.852,16. Asignación 135→37 CONFIRMADA por el dueño («ambos siempre al asesor,
--       es decir el de Yaqueline ambos son de ella»); sigue EXCLUIDA porque el destinatario de ese abono no está conciliado. Solo lectura/documentación.
--   Se reincorporan solo con conciliación contable + confirmación escrita del dueño. Las dos filas de MIN-00-0476 (100 y 101) ya corresponden a Javier (ficha 8): no cambian y el precheck las confirma.
--
-- TRES COSAS QUE NO SON LO MISMO (aquí y en el doc):
--   1. ASIGNACIÓN: a qué ficha DEBE pertenecer la fila (decisión del dueño). Cambia solo el registro de la fila.
--   2. ABONO REGISTRADO: lo que consta en `comision_b2b_pagos` (fecha y valor). Es un hecho del sistema.
--   3. DESTINATARIO DEL PAGO: a quién se le consignó. `comision_b2b_pagos` NO lo guarda → DESCONOCIDO hasta que Contabilidad concilie.
--   Un abono registrado (2) NO prueba que el pago llegó a quien hoy figura ni a quien debería figurar (3).
--
-- PUERTA DE CONTABILIDAD. Ninguna corrección corre hasta que contabilidad concilie los abonos de las filas afectadas
-- (`comision_b2b_pagos` no guarda beneficiario, forma de pago ni referencia: no se puede probar a quién se pagó). La puerta es
-- `contabilidad_concilio` (false). Una fila con abonos además solo entra si contabilidad la lista en `revision_contable_aprobada`.
-- Cambiar un beneficiario no corrige un pago ya hecho: solo deja el registro coherente con quien debió recibirlo.
--
-- QUÉ CAMBIA. Solo `aliados_b2b.aliado_id`, `aliado`, `nit` y `tipo_aliado` de las filas listadas, tomados de la ficha destino.
-- NO cambia importes (base, %, valor fijo, recobro), retención, estado, abonos (`comision_b2b_pagos`), `ventas.aliado_id` ni la
-- propiedad del contrato. El trigger de auditoría (087) deja el antes/después de cada UPDATE. Para revertir: repetir el bloque B con
-- la ficha de `auditoria.antes` de cada fila.
--
-- El primer nombre de la ficha destino se compara con el del asesor confirmado SOLO para avisar (AVISO); no bloquea, porque la
-- asignación es del dueño y un apodo no debe frenar la corrección.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════ A. PRECHECK (solo lectura) ═════════════════════════
with
esperado(numero_contrato, asesor, primer_nombre) as (
  values ('MIN-00-0422','Paola','paola'), ('MIN-00-0432','Katherine Colorado','katherine'), ('MIN-00-0433','Katherine Colorado','katherine'),
         ('MIN-00-0439','Juliana','juliana'), ('MIN-00-0462','Tatiana','tatiana'), ('MIN-00-0463','Marcela','marcela'),
         ('MIN-00-0476','Javier','javier'), ('MIN-00-0484','Sebastián','sebastian'), ('MIN-00-0498','Javier','javier'),
         ('MIN-00-0519','Yaqueline','yaqueline')
),
correccion(fila_id, ficha_destino) as (
  values (79::bigint, 3::bigint), (80, 3), (81, 33), (82, 1), (83, 1), (85, 24), (89, 28), (107, 7), (137, 37), (135, 37), (1, 8),
         (100, 8), (101, 8)   -- 0476: ya en Javier; se listan para confirmarlo (el UPDATE no las toca si ya están en la ficha)
),
-- 79: línea 1 de 0462 (Tatiana, ficha 3): SIN_CAMBIO. 80, 135 y 137: asignación confirmada, EXCLUIDAS del UPDATE hasta conciliar el destinatario del abono.
-- Solo lectura: 80, 137 y 135 se reportan EXCLUIDAS por conciliación; NO están en el bloque B.
excluidas(fila_id, motivo) as (
  values (80::bigint, 'asignación 80→3 (Tatiana) confirmada por el dueño; total $142.494 y abono registrado $142.494; destinatario del pago sin conciliar por contabilidad'),
         (137::bigint, 'asignación 137→37 confirmada; total $139.000 y abono registrado $139.000; destinatario del pago sin conciliar por contabilidad'),
         (135::bigint, 'asignación 135→37 confirmada por el dueño; total $351.852,16 y abono registrado $351.852,16; destinatario del pago sin conciliar por contabilidad')
),
revision_contable_aprobada(fila_id) as (select null::bigint where false),   -- contabilidad agrega aquí las filas con abonos ya verificadas
chequeo as (
  select c.fila_id, c.ficha_destino,
         b.numero_contrato, b.aliado, b.aliado_id as ficha_en_bd, b.estado as estado_fila,
         d.nombre as destino_nombre, e.asesor, e.primer_nombre,
         public.comision_b2b_total(b) as total_antes,
         (select count(*) from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id) as n_abonos,
         (select coalesce(sum(g.valor), 0) from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id) as abonado_antes,
         (select string_agg(x.id || ':' || coalesce(x.aliado_id::text, 'NULL'), ', ' order by x.id)
            from public.aliados_b2b x where x.numero_contrato = b.numero_contrato and x.id <> b.id) as otras_filas_del_contrato,
         exists (select 1 from revision_contable_aprobada r where r.fila_id = c.fila_id) as aprobada_contabilidad,
         (select x.motivo from excluidas x where x.fila_id = c.fila_id) as excluida_motivo
    from correccion c
    left join public.aliados_b2b b on b.id = c.fila_id
    left join public.aliados d on d.id = c.ficha_destino
    left join esperado e on e.numero_contrato = b.numero_contrato
)
select fila_id, numero_contrato,
       case
         when numero_contrato is null                                  then 'BLOQUEA: la fila no existe'
         when asesor is null                                           then 'BLOQUEA: el contrato no es uno de los 10 confirmados'
         when excluida_motivo is not null                              then 'EXCLUIDA: ' || excluida_motivo || '; fuera de toda corrección ejecutable'
         when destino_nombre is null                                   then 'BLOQUEA: la ficha destino no existe'
         when ficha_en_bd is not distinct from ficha_destino           then 'SIN_CAMBIO: ya está en la ficha destino'
         when n_abonos > 0 and not aprobada_contabilidad               then 'REVISION_CONTABLE: tiene abonos registrados; no se corrige hasta que contabilidad confirme el destinatario del pago'
         when translate(lower(split_part(btrim(destino_nombre), ' ', 1)), 'áéíóúñ', 'aeioun') <> primer_nombre
                                                                       then 'AVISO: la ficha destino «' || destino_nombre || '» no empieza por el nombre del asesor (' || asesor || '); confirmar antes de aplicar'
         else 'OK'
       end as estado,
       'asesor confirmado=' || coalesce(asesor, '?') || ' · fila: «' || coalesce(aliado, '?') || '» ficha ' || coalesce(ficha_en_bd::text, 'NULL')
         || ' → ficha ' || ficha_destino || ' «' || coalesce(destino_nombre, '?') || '»'
         || ' · total_antes=' || round(coalesce(total_antes, 0), 2) || ' · abonos=' || coalesce(n_abonos, 0) || ' por ' || round(coalesce(abonado_antes, 0), 2)
         || ' · otras filas del contrato (id:ficha)=' || coalesce(otras_filas_del_contrato, 'ninguna')
         || ' · estado fila=' || coalesce(estado_fila, 'NULL') as detalle
  from chequeo
union all
-- Toda otra fila de los diez contratos que tenga abonos y NO figure en la lista de correcciones: no se toca, pero contabilidad debe conciliarla.
select b.id, b.numero_contrato,
       'REVISION_CONTABLE: tiene abonos aunque no se corrige' as estado,
       'fila: «' || coalesce(b.aliado, '?') || '» ficha ' || coalesce(b.aliado_id::text, 'NULL')
         || ' · abonos=' || count(g.id) || ' por ' || round(coalesce(sum(g.valor), 0), 2) as detalle
  from public.aliados_b2b b
  join esperado e on e.numero_contrato = b.numero_contrato
  join public.comision_b2b_pagos g on g.aliado_b2b_id = b.id
 where b.id not in (select fila_id from correccion)
 group by b.id, b.numero_contrato, b.aliado, b.aliado_id
order by 1;


-- ═════════════════════════ B. CORRECCIÓN (transacción · bloqueada) ═════════════════════════
-- Pegar SOLO cuando (1) A no muestre BLOQUEA, (2) contabilidad haya conciliado los abonos y (3) se hayan copiado total_antes/abonado_antes.
-- Con `contabilidad_concilio` en false el UPDATE no toca nada. Para aplicar: ponerlo en true Y cambiar ROLLBACK por COMMIT tras revisar el RETURNING.
begin;
with
contabilidad_concilio(ok) as (values (false)),
-- Deliberadamente SIN las filas 80, 137 y 135 (EXCLUIDAS por conciliación: asignación confirmada, destinatario del abono sin conciliar) y SIN la 79 (Tatiana, línea 1: no cambia): el UPDATE nunca las nombra.
correccion(fila_id, ficha_destino) as (
  values (81::bigint, 33::bigint), (82, 1), (83, 1), (85, 24), (89, 28), (107, 7), (1, 8)
),
revision_contable_aprobada(fila_id) as (select null::bigint where false)
update public.aliados_b2b b
   set aliado_id   = d.id,
       aliado      = d.nombre,
       nit         = coalesce(d.nit, b.nit),
       tipo_aliado = coalesce(d.tipo, b.tipo_aliado)
  from correccion c
  join public.aliados d on d.id = c.ficha_destino
 where b.id = c.fila_id
   and (select ok from contabilidad_concilio)                                         -- puerta: abonos conciliados con contabilidad
   and b.aliado_id is distinct from c.ficha_destino                                    -- idempotente
   and (not exists (select 1 from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id)
        or exists (select 1 from revision_contable_aprobada r where r.fila_id = b.id)) -- sin abonos, o aprobada por contabilidad
returning b.id, b.numero_contrato, b.aliado, b.aliado_id, public.comision_b2b_total(b) as total_despues;
rollback;   -- ← cambiar a COMMIT solo tras revisar el RETURNING


-- ═════════════════════════ C. POSTCHECK (solo lectura) ═════════════════════════
with
esperado(numero_contrato, asesor, primer_nombre) as (
  values ('MIN-00-0422','Paola','paola'), ('MIN-00-0432','Katherine Colorado','katherine'), ('MIN-00-0433','Katherine Colorado','katherine'),
         ('MIN-00-0439','Juliana','juliana'), ('MIN-00-0462','Tatiana','tatiana'), ('MIN-00-0463','Marcela','marcela'),
         ('MIN-00-0476','Javier','javier'), ('MIN-00-0484','Sebastián','sebastian'), ('MIN-00-0498','Javier','javier'),
         ('MIN-00-0519','Yaqueline','yaqueline')
),
-- Pegar aquí lo que imprimió el precheck: total_antes y abonado_antes de cada fila (sustituir los 0).
-- 80, 135 y 137 no están (excluidas por conciliación). Tras corregir SOLO las siete filas del bloque B, la sección `contrato` seguirá mostrando 0462 (#80 sigue en la
-- ficha 8 frente a #79 en la 3) y 0519 (#135 sin ficha y #137 en la 8) como PENDIENTE: es lo esperado, no una falla. Los otros ocho contratos deben salir OK.
antes(fila_id, ficha_destino, total_antes, abonado_antes) as (
  values (81::bigint, 33::bigint, 0::numeric, 0::numeric), (82, 1, 0, 0), (83, 1, 0, 0), (85, 24, 0, 0),
         (89, 28, 0, 0), (107, 7, 0, 0), (1, 8, 0, 0)
),
positivas as (
  select b.*, public.comision_b2b_total(b) as total
    from public.aliados_b2b b where b.numero_contrato in (select numero_contrato from esperado)
)
select 'fila'::text as seccion, a.fila_id::text as clave,
       case
         when b.id is null then 'FALLA: la fila desapareció'
         when b.aliado_id is distinct from a.ficha_destino then 'FALLA: la fila no quedó en la ficha destino'
         when round(public.comision_b2b_total(b), 2) <> round(a.total_antes, 2) then 'FALLA: cambió el importe de la fila'
         when (select coalesce(sum(g.valor), 0) from public.comision_b2b_pagos g where g.aliado_b2b_id = b.id) <> a.abonado_antes then 'FALLA: cambió el historial de abonos'
         else 'OK'
       end as estado,
       'ficha=' || coalesce(b.aliado_id::text, 'NULL') || ' «' || coalesce(b.aliado, '?') || '» total=' || round(coalesce(public.comision_b2b_total(b), 0), 2) as detalle
  from antes a left join public.aliados_b2b b on b.id = a.fila_id
union all
select 'contrato', p.numero_contrato,
       case
         when count(distinct p.aliado_id) filter (where p.total > 0) > 1 or bool_or(p.aliado_id is null and p.total > 0) then 'PENDIENTE: el contrato aún tiene filas positivas de más de una ficha o sin ficha'
         else 'OK'
       end,
       'asesor=' || max(e.asesor) || ' · fichas de filas positivas=' || coalesce(string_agg(distinct p.aliado_id::text, ',') filter (where p.total > 0), '-')
  from positivas p join esperado e using (numero_contrato) group by p.numero_contrato
union all
select 'auditoria', a.fila_id::text,
       case when exists (select 1 from public.auditoria au where au.tabla = 'aliados_b2b' and au.accion = 'UPDATE' and au.despues ->> 'id' = a.fila_id::text)
            then 'OK' else 'AVISO: sin rastro de UPDATE en auditoría' end,
       'quedó registro del antes/después'
  from antes a
order by 1, 2;
