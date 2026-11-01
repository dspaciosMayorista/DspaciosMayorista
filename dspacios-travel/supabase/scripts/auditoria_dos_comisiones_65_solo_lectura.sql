-- ─────────────────────────────────────────────────────────────────────────────
-- #65 · AUDITORÍA DE SOLO LECTURA: ventas con dos (o más) filas de comisión POSITIVAS en aliados_b2b
--
-- Ni un INSERT/UPDATE/DELETE: una sola consulta SELECT con columna `estado`. No toca filas, importes, abonos ni propiedad.
-- Pegar tal cual en el editor SQL. Regla y evidencia: docs/tecnico/comisiones-aliado-vs-interna-65.md
--
-- QUÉ SEPARA (tres cosas distintas, que antes se confundían):
--   1. FILAS POSITIVAS       → importe económico > 0, con la MISMA fórmula del portal (public.comision_b2b_total) y
--                              DESGLOSADO: comisión base (valor fijo o base × %), recobro para el aliado, retención.
--                              Una fila puede ser positiva SOLO por el recobro aunque base y % estén en 0.
--   2. BENEFICIARIOS DISTINTOS → una persona puede tener varias filas (misma ficha, o una fila sin ficha que el dueño
--                              confirmó que es la misma persona). «2 filas» no es «2 beneficiarios».
--   3. PERSONAS DE DOBLE ROL  → alguien que cobra como aliado y a la vez actúa como interno. Lo que diga hoy el rol de su
--                              cuenta vinculada (p. ej. freelance) NO prueba lo contrario.
--
-- NADA SE CLASIFICA COMO «COMISIÓN INTERNA» AUTOMÁTICAMENTE: ni por coincidencia de nombre, ni por firmar la venta.
-- Esos datos se muestran como EVIDENCIA para quien clasifica. Las únicas clases que emite el script son:
--   CLASIFICAR_DOBLE_ROL      el beneficiario es una persona de doble rol (confirmada abajo, o con indicio en los datos):
--                             los datos NO dicen si ESTA fila es comisión B2B o segunda comisión interna → la decide el dueño.
--   CLASIFICAR_SIN_FICHA      fila sin ficha enlazada y sin confirmación: solo hay texto → no se sabe quién es.
--   SIN_INDICIO_DE_DOBLE_ROL  beneficiario con ficha, sin ningún indicio de doble rol. NO es una prueba de que sea B2B:
--                             solo que los datos no ofrecen motivo para dudarlo.
--
-- CONFIRMACIONES DEL DUEÑO (únicas entradas manuales; agregar una línea solo con confirmación expresa):
-- ─────────────────────────────────────────────────────────────────────────────
with
internos(rol) as (
  values ('superadmin'), ('gerencia'), ('administracion'), ('operaciones'), ('venta'), ('control_vuelo')
),
confirmado_doble_rol(aliado_id, nota) as (
  values (8::bigint, 'Dueño: Javier (ficha 8) también actúa como interno')
),
confirmado_misma_persona(fila_id, aliado_id, nota) as (
  values (1::bigint, 8::bigint, 'Dueño: «JAVIER VIEIRA» (fila 1, sin ficha) es la misma persona que la ficha 8')
),
filas as (
  select b.id, b.numero_contrato, b.aliado, b.nit, b.tipo_aliado, b.aliado_id, b.estado, b.descontada_en_precio,
         b.base_explicita, b.base_comision, b.pct_comision, b.comision_valor, b.recobro_total, b.pct_recobro_aliado,
         b.aplica_retencion, b.pct_retencion,
         coalesce(b.precio_venta, 0) as pvp,
         case when b.base_explicita then coalesce(b.base_comision, coalesce(b.precio_venta, 0))
              else coalesce(nullif(b.base_comision, 0), coalesce(b.precio_venta, 0)) end as base_usada,
         public.comision_b2b_total(b) as total
    from public.aliados_b2b b
),
componentes as (
  select f.*,
         coalesce(f.comision_valor, f.base_usada * coalesce(f.pct_comision, 0)) as comision_base,
         coalesce(f.recobro_total, 0) * coalesce(f.pct_recobro_aliado, 0.5)     as recobro_aliado,
         (coalesce(f.comision_valor, f.base_usada * coalesce(f.pct_comision, 0)) + coalesce(f.recobro_total, 0) * coalesce(f.pct_recobro_aliado, 0.5))
           * (case when f.aplica_retencion then coalesce(f.pct_retencion, 0) else 0 end) as retencion
    from filas f
),
positivas as (select * from componentes where total > 0),
multiples as (select numero_contrato from positivas group by 1 having count(*) >= 2),
detalle as (
  select p.*,
         coalesce(p.aliado_id, cm.aliado_id) as ficha_resuelta,
         case when p.aliado_id is not null then 'ficha de la fila'
              when cm.aliado_id is not null then 'confirmada por el dueño' else 'sin ficha' end as origen_beneficiario,
         v.aliado_id as venta_aliado_id, v.tipo_asesor, v.canal, v.asesor, v.asesor_firma_nombre, v.estado as venta_estado,
         v.fecha_venta, v.comision_estado, v.modo_compra, v.tenant,
         a.nombre as ficha_nombre, a.tipo as ficha_tipo,
         (select string_agg(u.rol::text || ':' || coalesce(u.nombre, '?'), ', ' order by u.nombre)
            from public.usuarios u where coalesce(p.aliado_id, cm.aliado_id) is not null and u.aliado_id = coalesce(p.aliado_id, cm.aliado_id)) as cuentas_con_esa_ficha,
         exists (select 1 from confirmado_doble_rol c where c.aliado_id = coalesce(p.aliado_id, cm.aliado_id)) as doble_rol_confirmado,
         exists (select 1 from public.usuarios u join internos i on i.rol = u.rol::text
                  where coalesce(p.aliado_id, cm.aliado_id) is not null and u.aliado_id = coalesce(p.aliado_id, cm.aliado_id)) as ficha_ligada_a_interno,
         -- EVIDENCIA, no clasificación: usuarios internos cuyo PRIMER nombre coincide con el del beneficiario.
         (select string_agg(u.rol::text || ':' || coalesce(u.nombre, '?') || case when u.escala_id is not null then ' (con escala)' else '' end, ', ' order by u.nombre)
            from public.usuarios u join internos i on i.rol = u.rol::text
           where split_part(lower(btrim(coalesce(p.aliado, ''))), ' ', 1) <> ''
             and split_part(lower(btrim(coalesce(p.aliado, ''))), ' ', 1) = split_part(lower(btrim(coalesce(u.nombre, ''))), ' ', 1)) as internos_mismo_primer_nombre,
         -- EVIDENCIA, no clasificación: ¿el firmante de la venta lleva el mismo primer nombre?
         (split_part(lower(btrim(coalesce(p.aliado, ''))), ' ', 1) <> ''
          and split_part(lower(btrim(coalesce(p.aliado, ''))), ' ', 1) = split_part(lower(btrim(coalesce(v.asesor_firma_nombre, ''))), ' ', 1)) as firmante_mismo_primer_nombre,
         (select count(*) from public.comision_b2b_pagos g where g.aliado_b2b_id = p.id) as abonos,
         (select coalesce(sum(g.valor), 0) from public.comision_b2b_pagos g where g.aliado_b2b_id = p.id) as abonado,
         (select au.actor_rol || ':' || coalesce(au.actor_nombre, 'Sistema') from public.auditoria au
           where au.tabla = 'aliados_b2b' and au.accion = 'INSERT' and au.despues ->> 'id' = p.id::text order by au.id limit 1) as creada_por
    from positivas p
    join multiples m on m.numero_contrato = p.numero_contrato
    join public.ventas v on v.numero_contrato = p.numero_contrato
    left join confirmado_misma_persona cm on cm.fila_id = p.id
    left join public.aliados a on a.id = coalesce(p.aliado_id, cm.aliado_id)
),
clasificada as (
  select d.*,
         case
           when d.ficha_resuelta is null then 'CLASIFICAR_SIN_FICHA'
           when d.doble_rol_confirmado or d.ficha_ligada_a_interno or d.internos_mismo_primer_nombre is not null then 'CLASIFICAR_DOBLE_ROL'
           else 'SIN_INDICIO_DE_DOBLE_ROL'
         end as clase,
         -- «Beneficiario»: la ficha resuelta; sin ficha, el texto normalizado (no se fusiona por nombre).
         coalesce(d.ficha_resuelta::text, 'texto:' || lower(btrim(regexp_replace(coalesce(d.aliado, ''), '\s+', ' ', 'g')))) as beneficiario_clave
    from detalle d
),
por_contrato as (
  select numero_contrato,
         count(*) as filas_positivas,
         count(distinct beneficiario_clave) as beneficiarios_distintos,
         bool_or(doble_rol_confirmado or ficha_ligada_a_interno) as hay_doble_rol,
         string_agg(id::text, ',' order by id) as filas
    from clasificada group by 1
)
select * from (
select 'resumen'::text as seccion,
       'INFO'::text as estado,
       null::text as numero_contrato, null::bigint as fila_id, null::text as beneficiario, null::numeric as total, null::text as clase,
       null::text as componentes,
       'ventas con ≥2 filas positivas: ' || (select count(*) from multiples)
         || ' · filas positivas: ' || (select count(*) from clasificada)
         || ' · para clasificar por el dueño: ' || (select count(*) from clasificada where clase <> 'SIN_INDICIO_DE_DOBLE_ROL')
         || ' → ' || coalesce((select string_agg(numero_contrato || '#' || id, ', ' order by numero_contrato, id) from clasificada where clase <> 'SIN_INDICIO_DE_DOBLE_ROL'), '(ninguna)') as evidencia
union all
select 'contrato',
       case when beneficiarios_distintos < filas_positivas then 'REVISAR' else 'INFO' end,
       numero_contrato, null, null, null, null, null,
       filas_positivas || ' filas positivas (' || filas || ') · ' || beneficiarios_distintos || ' beneficiario(s) distinto(s)'
         || case when beneficiarios_distintos < filas_positivas then ' → DOS O MÁS FILAS PARA LA MISMA PERSONA (¿duplicado o dos conceptos?)' else '' end
         || case when hay_doble_rol then ' · interviene una persona de DOBLE ROL' else '' end
  from por_contrato
union all
select 'fila',
       case clase when 'SIN_INDICIO_DE_DOBLE_ROL' then 'SIN_INDICIO' else 'CLASIFICAR' end,
       numero_contrato, id, coalesce(aliado, '(sin nombre)'), round(total, 2), clase,
       'pvp=' || pvp || ' · base_usada=' || round(base_usada, 2) || ' · pct=' || coalesce(pct_comision::text, 'NULL') || ' · valor_fijo=' || coalesce(comision_valor::text, 'NULL')
         || ' → comisión_base=' || round(comision_base, 2)
         || ' | recobro_total=' || coalesce(recobro_total::text, 'NULL') || ' × pct_recobro=' || coalesce(pct_recobro_aliado::text, 'NULL(0.5)') || ' → recobro_aliado=' || round(recobro_aliado, 2)
         || ' | retención=' || round(retencion, 2) || ' | total=' || round(total, 2)
         || ' | positiva por: ' || case when comision_base > 0 and recobro_aliado > 0 then 'comisión base Y recobro' when comision_base > 0 then 'comisión base' else 'SOLO el recobro' end,
       'beneficiario=' || origen_beneficiario || ' ficha=' || coalesce(ficha_resuelta::text, 'NULL') || ' (' || coalesce(ficha_nombre, 'sin ficha') || ', ' || coalesce(ficha_tipo, '-') || ')'
         || ' · venta.aliado_id=' || coalesce(venta_aliado_id::text, 'NULL') || case when ficha_resuelta is not distinct from venta_aliado_id then ' (ES el aliado del contrato)' else ' (otro beneficiario)' end
         || ' · cuentas con esa ficha=' || coalesce(cuentas_con_esa_ficha, 'ninguna')
         || ' · doble rol confirmado=' || doble_rol_confirmado
         || ' · internos con el mismo primer nombre (evidencia)=' || coalesce(internos_mismo_primer_nombre, 'ninguno')
         || ' · asesor_firma=' || coalesce(asesor_firma_nombre, 'NULL') || ' (mismo primer nombre: ' || firmante_mismo_primer_nombre || ')'
         || ' · tipo_asesor=' || coalesce(tipo_asesor, 'NULL') || '/' || coalesce(canal, 'NULL')
         || ' · abonos=' || abonos || ' por ' || round(abonado, 2) || ' (saldo ' || round(greatest(total - abonado, 0), 2) || ')'
         || ' · creada por=' || coalesce(creada_por, 'sin rastro en auditoría') || ' · tenant=' || tenant
  from clasificada
) x
order by case x.seccion when 'resumen' then 0 when 'contrato' then 1 else 2 end, x.numero_contrato nulls first, x.fila_id nulls first;
