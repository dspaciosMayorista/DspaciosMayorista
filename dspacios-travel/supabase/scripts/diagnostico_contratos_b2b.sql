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
--   Cada bloque dice qué esperar. Al final hay un veredicto por contrato.

-- Los contratos a revisar. Cambia esta lista si hace falta.
with objetivo as (
  select unnest(array['MIN-00-0460', 'MIN-00-0461']) as numero
)

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
from objetivo o
join public.ventas v on v.numero_contrato = o.numero
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
from objetivo o
join public.ventas v on v.numero_contrato = o.numero
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
from objetivo o
join public.ventas v on v.numero_contrato = o.numero
order by v.numero_contrato;

-- ══ 4. ¿Quién creó y quién gestiona estos contratos? ════════════════════════
-- La auditoría (migración 087) guarda el actor de cada escritura. Las hechas
-- con service-role salen como "Sistema" — el importador de minorista es una de
-- ellas, así que ver "Sistema" en el INSERT es la firma de un contrato
-- IMPORTADO, no creado a mano.
select
  a.registro_id  as numero_contrato,
  a.accion,
  a.fecha,
  coalesce(a.usuario_nombre, '(Sistema / service-role)') as actor,
  a.usuario_rol,
  a.tabla
from objetivo o
join public.auditoria a on a.registro_id = o.numero
where a.tabla in ('ventas','contrato_adjuntos','abonos','cuentas_por_pagar')
order by a.registro_id, a.fecha;

-- ══ 5. Y la persona concreta: ¿qué ve y por qué? ════════════════════════════
-- Cambia el correo por el de la persona del caso.
-- `soy_asesor_del_contrato` empareja por NOMBRE; `puede_ver_contrato` exige
-- además que el tenant coincida. Aparecer en la primera y no en la segunda es
-- exactamente el síntoma "figura como asesora pero no los ve".
select
  u.nombre,
  u.rol,
  u.tenant,
  u.aliado_id                       as "enlazada al catálogo de aliados",
  o.numero,
  v.tenant                          as "tenant del contrato",
  lower(btrim(v.asesor)) = lower(btrim(u.nombre)) as "su nombre está en ventas.asesor",
  (u.tenant = v.tenant)                           as "mismo tenant"
from public.usuarios u
cross join objetivo o
join public.ventas v on v.numero_contrato = o.numero
where u.email = 'CAMBIAR@ejemplo.com'     -- ← el correo de la persona
order by o.numero;
