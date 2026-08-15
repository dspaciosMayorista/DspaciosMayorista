-- ─────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO de contratos con vínculo B2B  ·  SOLO LECTURA
-- Se pega en el editor SQL de Supabase. No modifica nada: ni un update.
-- ─────────────────────────────────────────────────────────────────────────
--
-- PARA QUÉ
--   Responder, con datos y no con suposiciones, dos preguntas sobre un
--   contrato de minorista relacionado con un freelance:
--
--     1. ¿`ventas.asesor` trae el nombre del FREELANCE cuando debería traer al
--        responsable INTERNO que gestiona el contrato?
--     2. ¿La pertenencia B2B está expresada por `aliado_id`, o depende de que
--        el nombre coincida como texto?
--
--   La diferencia importa: emparejar por nombre es lo que la migración 143
--   vino a reemplazar, y es lo que hace que una persona "aparezca como asesora"
--   de contratos que no gestiona.
--
-- CÓMO SE LEE EL RESULTADO
--   Cada bloque dice qué esperar. El bloque 6 resume el veredicto.
--
-- ⚠️ LOS CONTRATOS A REVISAR VAN INLINE EN CADA BLOQUE
--   Un `with` (CTE) solo vive durante el statement que lo declara: si se
--   escribiera una sola vez arriba, los bloques 2 en adelante fallarían con
--   «relation "objetivo" does not exist». Por eso la lista se repite en cada
--   consulta. **Si cambias los números, cámbialos en LOS SEIS bloques**
--   (busca y reemplaza 'MIN-00-0460' y 'MIN-00-0461').
--
-- ⚠️ Y EL CORREO DE LA PERSONA
--   El bloque 5 lleva 'CAMBIAR@ejemplo.com'. Sin ese cambio devuelve 0 filas
--   (no es un error: es que no hay usuario con ese correo).

-- ══ 1. La cabecera de la venta, campo por campo ═════════════════════════════
select
  v.numero_contrato,
  v.tenant,
  v.canal,
  v.tipo_asesor,
  v.asesor                as "asesor (¿interno o freelance?)",
  v.freelance_nombre,
  v.agencia_nombre,
  v.aliado_id,
  al.nombre               as "aliado del catálogo (por aliado_id)",
  al.tipo                 as "tipo del aliado",
  v.b2b_usuario_id,
  ub.nombre               as "usuario B2B (compró desde el portal)",
  v.fecha_venta,
  v.created_at,
  v.updated_at
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
left join public.aliados  al on al.id = v.aliado_id
left join public.usuarios ub on ub.id = v.b2b_usuario_id
order by v.numero_contrato;

-- ══ 2. ¿El nombre de `asesor` corresponde a alguien INTERNO? ════════════════
-- Si `asesor` cruza con un usuario interno (venta/operaciones/administracion/
-- gerencia/superadmin) del MISMO tenant, el campo está bien usado.
-- Si cruza con un ALIADO del catálogo, o no cruza con nadie interno, es la
-- señal de que ahí quedó el nombre del freelance.
--
-- La comparación se normaliza (minúsculas + sin espacios sobrantes) porque el
-- importador de minorista escribe los nombres tal como vienen de la hoja, a
-- menudo en MAYÚSCULAS.
select
  v.numero_contrato,
  v.asesor,
  ui.nombre                         as "coincide con usuario interno",
  ui.rol                            as "rol de ese usuario",
  ui.tenant                         as "tenant de ese usuario",
  ali.nombre                        as "coincide con un ALIADO del catálogo",
  ali.tipo                          as "tipo del aliado",
  case
    when ui.id is not null and ui.tenant = v.tenant
      then 'OK — apunta a un interno de la misma agencia'
    when ui.id is not null and ui.tenant <> v.tenant
      then 'REVISAR — el interno que coincide es de OTRA agencia'
    when ali.id is not null
      then 'PROBLEMA — `asesor` trae el nombre de un ALIADO, no de un interno'
    else 'REVISAR — no cruza con ningún interno ni con el catálogo de aliados'
  end as veredicto
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
left join public.usuarios ui
       on lower(btrim(ui.nombre)) = lower(btrim(v.asesor))
      and ui.rol in ('superadmin','gerencia','administracion','operaciones','venta')
left join public.aliados ali
       on lower(btrim(ali.nombre)) = lower(btrim(v.asesor))
order by v.numero_contrato;

-- ══ 3. ¿La pertenencia B2B es por ID o por texto? ═══════════════════════════
-- El portal resuelve en este orden: b2b_usuario_id → aliado_id → nombre.
-- Si llega al tercero, la pertenencia depende de que dos cadenas coincidan.
select
  v.numero_contrato,
  case
    when v.b2b_usuario_id is not null then '1. b2b_usuario_id — vínculo fuerte (compró desde el portal)'
    when v.aliado_id      is not null then '2. aliado_id — vínculo fuerte (catálogo, migración 143)'
    when coalesce(v.freelance_nombre, v.agencia_nombre) is not null
      then '3. NOMBRE EN TEXTO — vínculo DÉBIL, es lo que la 143 vino a reemplazar'
    else 'sin vínculo B2B'
  end as "cómo se resuelve la pertenencia",
  v.tipo_asesor,
  -- Si va por texto: ¿existe una ficha en el catálogo con ese nombre? Si existe,
  -- el arreglo es enlazarla; si no, hay que crearla primero.
  (select count(*) from public.aliados a
    where lower(btrim(a.nombre)) = lower(btrim(coalesce(v.freelance_nombre, v.agencia_nombre))))
    as "fichas del catálogo con ese nombre",
  -- Y ¿hay más de una? Un homónimo hace ambiguo el emparejamiento por texto.
  (select string_agg(a.id::text || ':' || a.nombre, ' | ') from public.aliados a
    where lower(btrim(a.nombre)) = lower(btrim(coalesce(v.freelance_nombre, v.agencia_nombre))))
    as "cuáles"
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
order by v.numero_contrato;

-- ══ 4. ¿Quién creó y quién gestiona estos contratos? ════════════════════════
--
-- ⚠️ LÍMITE DE ESTE BLOQUE — LEER ANTES DE CONCLUIR
--   `auditoria` (migración 087) NO guarda de dónde vino una escritura. Sus
--   columnas son: actor (id/email/nombre/rol), `accion` —que es literalmente
--   `TG_OP`, o sea solo INSERT/UPDATE/DELETE—, `tabla`, `registro_id` y los
--   snapshots antes/después. **No hay columna de origen, módulo ni
--   descripción**, así que NADA en la auditoría identifica al importador de
--   forma inequívoca.
--
--   Actor vacío ("Sistema") solo significa que `auth.uid()` era null, y eso
--   pasa con CUALQUIER escritura hecha con la llave service_role o desde el
--   editor SQL de Supabase. En este código hay varias: los costos y sillas de
--   `reservar`, los asientos contables automáticos, los backfills. Es un
--   INDICIO, no una firma.
--
--   Lo que sí acota bastante: de los tres caminos que CREAN una venta, dos
--   (formulario manual y reservar) insertan con el cliente de sesión y por
--   tanto dejan actor; solo el importador inserta con service_role. Así que un
--   INSERT sobre `ventas` con actor vacío apunta al importador — pero seguiría
--   viéndose igual si alguien insertara a mano desde el editor SQL.
select
  a.registro_id  as numero_contrato,
  a.accion,
  a.creado_en,
  coalesce(a.actor_nombre, a.actor_email, '(Sistema / service-role o editor SQL)') as actor,
  a.actor_rol,
  a.tabla
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.auditoria a on a.registro_id = objetivo.numero
where a.tabla in ('ventas','contrato_adjuntos','abonos','cuentas_por_pagar')
order by a.registro_id, a.creado_en;

-- ══ 4.b Corroborar por la FORMA de la fila, no por el actor ════════════════
-- Esto sí es específico del importador, y no depende de la auditoría: es la
-- fila de `ventas` tal como está hoy. El importador es el único camino que
-- cumple LAS SEIS a la vez:
--   1. nunca escribe `destino`
--   2. nunca escribe `tipo_paquete`
--   3. nunca escribe `fecha_regreso`
--   4. deja `pax` en 1 fijo
--   5. nace en estado 'confirmado' (el manual nace 'activo', reservar 'pendiente')
--   6. pone EL MISMO texto en `asesor` y en `freelance_nombre`
-- Y además nunca escribe `aliado_id` ni `paquete_armado_id`.
--
-- ⚠️ EL VEREDICTO EXIGE LAS SEIS, NO UN SUBCONJUNTO.
--   Una versión anterior de este bloque solo comprobaba cuatro (le faltaban
--   `fecha_regreso` y `asesor == freelance_nombre`) mientras el texto afirmaba
--   que las miraba todas: un contrato manual sin destino ni tipo de paquete,
--   con 1 pax y ya confirmado, salía marcado como importado sin serlo. La
--   columna «señales que cumple» dice cuántas de las 8 se cumplen, para que un
--   caso a medias se vea como lo que es en vez de caer a un lado u otro.
--
--   `paquete_armado_id` NO entra en el veredicto a propósito: los contratos del
--   formulario manual tampoco lo llevan, así que no distingue nada. Se muestra
--   solo como dato.
select
  v.numero_contrato,
  (v.destino          is null) as "sin destino",
  (v.tipo_paquete     is null) as "sin tipo_paquete",
  (v.fecha_regreso    is null) as "sin fecha_regreso",
  (v.pax = 1)                  as "pax = 1",
  v.estado,
  (v.estado = 'confirmado')    as "nace confirmado",
  (v.asesor is not null and v.freelance_nombre is not null
     and lower(btrim(v.asesor)) = lower(btrim(v.freelance_nombre)))
                               as "asesor == freelance_nombre",
  (v.aliado_id        is null) as "sin aliado_id",
  (v.paquete_armado_id is null) as "sin paquete_armado_id (informativo)",
  -- Cuántas de las 8 señales cumple. 8 = encaja del todo; 0 = no se parece.
  ( (v.destino is null)::int
  + (v.tipo_paquete is null)::int
  + (v.fecha_regreso is null)::int
  + (v.pax = 1)::int
  + (v.estado = 'confirmado')::int
  + (v.asesor is not null and v.freelance_nombre is not null
       and lower(btrim(v.asesor)) = lower(btrim(v.freelance_nombre)))::int
  + (v.aliado_id is null)::int
  + (v.b2b_usuario_id is null)::int
  ) as "señales que cumple (de 8)",
  case
    when v.destino is null
     and v.tipo_paquete is null
     and v.fecha_regreso is null
     and v.pax = 1
     and v.estado = 'confirmado'
     and v.asesor is not null and v.freelance_nombre is not null
     and lower(btrim(v.asesor)) = lower(btrim(v.freelance_nombre))
     and v.aliado_id is null
     and v.b2b_usuario_id is null
      then 'COMPATIBLE con el importador de minorista — cumple las 8'
    when v.destino is null and v.tipo_paquete is null and v.pax = 1
      then 'PARCIAL — se parece pero NO cumple todas; revisar a mano'
    else 'NO encaja con el importador — revisar cómo se creó'
  end as "forma de la fila"
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
order by v.numero_contrato;

-- ══ 5. Y la persona concreta: ¿qué ve y por qué? ════════════════════════════
-- ⚠️ Cambia el correo por el de la persona del caso, o devuelve 0 filas.
-- `soy_asesor_del_contrato` empareja por NOMBRE; `puede_ver_contrato` exige
-- además que el tenant coincida. Aparecer en la primera y no en la segunda es
-- exactamente el síntoma "figura como asesora pero no los ve".
select
  u.nombre,
  u.rol,
  u.tenant,
  u.aliado_id                       as "enlazada al catálogo de aliados",
  objetivo.numero,
  v.tenant                          as "tenant del contrato",
  lower(btrim(v.asesor)) = lower(btrim(u.nombre)) as "su nombre está en ventas.asesor",
  (u.tenant = v.tenant)                           as "mismo tenant"
from public.usuarios u
cross join (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
where u.email = 'CAMBIAR@ejemplo.com'     -- ← el correo de la persona
order by objetivo.numero;

-- ══ 6. Veredicto por contrato, en una sola línea ═══════════════════════════
select
  v.numero_contrato,
  case
    when v.aliado_id is not null then 'OK — pertenencia B2B por aliado_id'
    when v.b2b_usuario_id is not null then 'OK — comprado desde el portal'
    when coalesce(v.freelance_nombre, v.agencia_nombre) is null
      then 'sin vínculo B2B — no aplica'
    else 'ARREGLAR — pertenencia por texto; falta enlazar aliado_id'
  end as "vínculo B2B",
  case
    when exists (
      select 1 from public.usuarios ui
      where lower(btrim(ui.nombre)) = lower(btrim(v.asesor))
        and ui.tenant = v.tenant
        and ui.rol in ('superadmin','gerencia','administracion','operaciones','venta')
    ) then 'OK — `asesor` apunta a un interno de la agencia'
    else 'ARREGLAR — `asesor` no apunta a ningún interno de esta agencia'
  end as "campo asesor"
from (values ('MIN-00-0460'), ('MIN-00-0461')) as objetivo(numero)
join public.ventas v on v.numero_contrato = objetivo.numero
order by v.numero_contrato;
