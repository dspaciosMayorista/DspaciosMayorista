-- ──────────────────────────────────────────────────────────────────────────────
-- VALIDACIÓN DE SOLO LECTURA · Portal B2B (#65) · para pegar en el SQL editor de Supabase (producción)
--
-- UNA sola consulta (SELECT), sin escrituras, sin funciones con efectos, sin DDL. Devuelve una fila por comprobación
-- con una columna `estado`:
--   OK        la condición que el código del portal necesita se cumple.
--   REVISAR   algo no cuadra: el portal puede ocultar datos o avisar «histórico incompleto»; ver `detalle`.
--   INFO      cifra para el criterio del dueño (no es un fallo).
-- No imprime datos personales: solo conteos y nombres de objetos del esquema.
--
-- Qué NO se puede comprobar desde SQL (manual, en el panel/UI):
--   · «Max rows» de la API (Settings → API). El portal pagina de 1.000 en 1.000 con conteo exacto; con cualquier valor ≥ 1.000
--     o ilimitado funciona. Si fuera < 1.000 el portal avisará «histórico incompleto» en vez de truncar en silencio.
--   · Que un aliado real vea solo lo suyo: ver el guion manual al final de este archivo.
-- Esta consulta NO depende de la migración 255 ni de ninguna migración nueva: #65 no agrega migraciones.
-- ──────────────────────────────────────────────────────────────────────────────
with
cols(tabla, columna) as (values
  ('ventas','aliado_id'), ('ventas','b2b_usuario_id'), ('ventas','share_token'), ('ventas','tenant'), ('ventas','moneda_cobro'),
  ('usuarios','aliado_id'), ('usuarios','acceso_legacy_nombre'), ('usuarios','activo'), ('usuarios','tenant'),
  ('aliados_b2b','aliado_id'), ('aliados_b2b','numero_contrato'),
  ('cotizaciones','propietario_id'), ('cotizaciones','aliado_id'), ('cotizaciones','payload'), ('cotizaciones','creado_por'), ('cotizaciones','modo'),
  ('vouchers','share_token'), ('vouchers','contenido'), ('vouchers','numero_contrato'),
  ('abonos','numero_contrato'), ('abonos','valor_abono')
),
c1 as (
  select 'estructura' as grupo, 'columna ' || c.tabla || '.' || c.columna as comprobacion,
         case when exists (select 1 from information_schema.columns i where i.table_schema = 'public' and i.table_name = c.tabla and i.column_name = c.columna)
              then 'OK' else 'REVISAR' end as estado,
         'el portal la lee' as detalle
    from cols c
),
c2 as (
  select 'rpc', 'comparativas_b2b_visibles(): existe, SECURITY DEFINER, sin acceso anon',
         case when p.oid is not null and p.prosecdef
                   and has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
              then 'OK' else 'REVISAR' end,
         case when p.oid is null then 'no existe (migración 211)' else 'secdef=' || p.prosecdef::text end
    from (select to_regprocedure('public.comparativas_b2b_visibles()')::oid as oid) r
    left join pg_proc p on p.oid = r.oid
),
c3 as (
  -- Las lecturas del portal usan service-role: ninguna política de estas tablas debe abrirlas a los roles B2B por la API.
  select 'rls', 'ninguna política de ' || t || ' menciona agencia/freelance',
         case when n = 0 then 'OK' else 'REVISAR' end, n::text || ' política(s) mencionan agencia/freelance'
    from (
      select t, (select count(*) from pg_policies p
                  where p.schemaname = 'public' and p.tablename = t
                    and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~* '(agencia|freelance)') as n
        from unnest(array['ventas','abonos','cotizaciones','vouchers','aliados_b2b']) as t
    ) x
),
c4 as (
  select 'rls', 'RLS activa en ' || relname, case when relrowsecurity then 'OK' else 'REVISAR' end, ''
    from pg_class where relnamespace = 'public'::regnamespace and relname in ('ventas','abonos','cotizaciones','vouchers','aliados_b2b','usuarios')
),
c5 as (
  select 'datos', 'aliados B2B activos sin ficha enlazada (usuarios.aliado_id nulo)',
         'INFO', count(*)::text || ' de ' || (select count(*) from public.usuarios where rol in ('agencia','freelance') and activo)::text || ' activos; solo verán lo que compraron ellos mismos'
    from public.usuarios where rol in ('agencia','freelance') and activo and aliado_id is null
),
c6 as (
  select 'datos', 'usuarios B2B con acceso_legacy_nombre = true (respaldo por nombre vigente)', 'INFO', count(*)::text
    from public.usuarios where rol in ('agencia','freelance') and acceso_legacy_nombre is true
),
c7 as (
  select 'datos', 'dos usuarios B2B activos con la MISMA ficha de aliado', case when count(*) = 0 then 'OK' else 'REVISAR' end,
         count(*)::text || ' ficha(s) compartidas (verán los mismos contratos; confirmar que es intencional)'
    from (select aliado_id from public.usuarios where rol in ('agencia','freelance') and activo and aliado_id is not null group by 1 having count(*) > 1) d
),
c8 as (
  select 'participacion', 'contratos con ventas.aliado_id vacío y comisión en aliados_b2b con aliado_id (participación histórica)', 'INFO',
         count(distinct v.numero_contrato)::text || ' contrato(s); el portal los muestra como «participación por comisión»'
    from public.ventas v join public.aliados_b2b b on b.numero_contrato = v.numero_contrato
   where v.aliado_id is null and b.aliado_id is not null
),
c9 as (
  select 'participacion', 'contratos con comisiones de MÁS de un aliado con ficha', 'INFO',
         count(*)::text || ' contrato(s); ninguno se atribuye por comisión al dueño'
    from (select numero_contrato from public.aliados_b2b where aliado_id is not null group by 1 having count(distinct aliado_id) > 1) m
),
c10 as (
  select 'participacion', 'comisiones con aliado_id que apunta a una ficha inexistente', case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text
    from public.aliados_b2b b where b.aliado_id is not null and not exists (select 1 from public.aliados a where a.id = b.aliado_id)
),
c11 as (
  select 'documentos', 'contratos sin share_token (el enlace «Contrato» saldría como No disponible)',
         case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text
    from public.ventas where share_token is null
),
c12 as (
  select 'documentos', 'vouchers sin share_token o sin contenido (no se enlazan)', 'INFO', count(*)::text
    from public.vouchers where share_token is null or contenido is null
),
c13 as (
  select 'cotizaciones', 'cotizaciones con plan B2B asistido cuyo aliado_id no existe en el catálogo',
         case when count(*) = 0 then 'OK' else 'REVISAR' end, count(*)::text
    from public.cotizaciones c
   where (c.payload -> 'b2bAsistido' ->> 'aliado_id') ~ '^[0-9]+$'
     and not exists (select 1 from public.aliados a where a.id = (c.payload -> 'b2bAsistido' ->> 'aliado_id')::bigint)
),
c14 as (
  select 'cotizaciones', 'cotizaciones con plan B2B asistido (se muestran en «Asistidas» del aliado, en ambas agencias)', 'INFO', count(*)::text
    from public.cotizaciones where payload ? 'b2bAsistido'
),
c15 as (
  select 'cotizaciones', 'comparativas con aliado_id y propietario_id a la vez (clasificación por IDs)', 'INFO', count(*)::text
    from public.cotizaciones where modo = 'comparativa' and aliado_id is not null and propietario_id is not null
),
c16 as (
  select 'cotizaciones', 'comparativas SIN propietario ni aliado (nadie B2B las verá)', 'INFO', count(*)::text
    from public.cotizaciones where modo = 'comparativa' and aliado_id is null and propietario_id is null
),
c17 as (
  select 'tenants', 'comparativas fuera de Mayorista (la RPC las filtra por el tenant del usuario)', 'INFO', count(*)::text
    from public.cotizaciones where modo = 'comparativa' and tenant <> 'mayorista'
),
c18 as (
  select 'volumen', 'aliado B2B con más contratos propios (referencia para el tope de filas)', 'INFO',
         coalesce(max(n), 0)::text || ' contratos (el portal pagina de 1.000 en 1.000)'
    from (select count(*) n from public.ventas where aliado_id is not null or b2b_usuario_id is not null group by coalesce(aliado_id::text, b2b_usuario_id::text)) q
)
select grupo, comprobacion, estado, detalle from (
  select * from c1 union all select * from c2 union all select * from c3 union all select * from c4 union all select * from c5
  union all select * from c6 union all select * from c7 union all select * from c8 union all select * from c9 union all select * from c10
  union all select * from c11 union all select * from c12 union all select * from c13 union all select * from c14 union all select * from c15
  union all select * from c16 union all select * from c17 union all select * from c18
) t
order by case estado when 'REVISAR' then 0 when 'INFO' then 1 else 2 end, grupo, comprobacion;

-- ──────────────────────────────────────────────────────────────────────────────
-- GUION MANUAL (solo lectura, con cuentas reales; no ejecutar nada de escritura):
--  1. Entrar a /portal/b2b con un aliado A (agencia) y con un aliado B distinto. Anotar, en cada pestaña, el conteo de
--     Cotizaciones (Directas/Asistidas), Mis ventas (Directas/Asistidas), Cartera (Con saldo/Pagos) y Documentos.
--  2. Verificar que ningún código de contrato/cotización/comparativa de A aparece en B y viceversa (usar «buscar en página»).
--  3. Un contrato donde A solo cobra comisión (consulta c8) debe verse en A como «Participación por comisión», sin cliente,
--     sin cartera y sin documentos.
--  4. Abrir un enlace de «Documentos» de A (estado de cuenta, recibo, voucher, contrato) y confirmar que abre; probar el
--     mismo enlace logueado como B: estado de cuenta y recibo deben dar 404.
--  5. Con una cuenta B2B desactivada: /portal/b2b debe mostrar «Registro en revisión» y ningún dato.
-- ──────────────────────────────────────────────────────────────────────────────
