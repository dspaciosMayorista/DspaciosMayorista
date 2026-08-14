-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA DE AISLAMIENTO POR ROL  ·  correr en el editor SQL de Supabase
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ COMPRUEBA
-- Se hace pasar por CADA usuario real de la tabla `usuarios` (uno por uno) y
-- verifica un invariante que debe cumplirse para todos, sin importar el rol:
--
--     filas visibles de una tabla hija
--       <=
--     filas visibles de esa tabla hija QUE ADEMÁS tienen su contrato visible
--
-- Si un usuario ve MÁS filas hijas que contratos padres visibles, está viendo
-- pasajeros, precios o vouchers de contratos que no le corresponden: FUGA.
-- Ver MENOS no es fuga: es una restricción deliberada encima de la herencia.
--
-- La gracia es que el invariante no depende del rol, así que la misma prueba
-- sirve para superadmin, gerencia, administración, operaciones, venta, los
-- roles B2B y los usuarios desactivados — sin escribir un caso por cada uno.
--
-- CÓMO SE LEE EL RESULTADO
--   OK           → ve exactamente lo que le corresponde
--   FUGA (n)     → ve n filas hijas de contratos que no puede ver ← REVISAR
--   RESTRINGIDO  → ve MENOS de lo que su contrato le permitiría. Es lo
--                  esperado SOLO en `contrato_pasajeros` y `contrato_adjuntos`
--                  con rol `venta`: desde la migración 142 un asesor consulta
--                  cualquier contrato de su agencia, pero no los datos
--                  personales ni los adjuntos de los contratos ajenos.
--                  En cualquier otra combinación, mirarlo.
--
-- HISTORIA
--   · Antes de la 141: todo rol interno (incluido `venta`) daba FUGA en todas.
--   · Con la 141: OK en todas, pero `venta` solo veía sus propios contratos.
--   · Con la 142: `venta` ve todos los de su agencia (OK), salvo pasajeros y
--     adjuntos ajenos (RESTRINGIDO).
--
-- CÓMO SE CORRE
-- Copiar y pegar TODO este archivo en el editor SQL de Supabase y ejecutar.
-- Es de solo lectura: no escribe ni modifica datos (termina en ROLLBACK).
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _rls_out (
  usuario   text,
  rol       text,
  activo    boolean,
  tabla     text,
  visibles  bigint,
  con_padre bigint,
  veredicto text
) on commit drop;

do $$
declare
  u            record;
  t            text;
  n_visibles   bigint;
  n_con_padre  bigint;
  tablas       text[] := array[
    'contrato_pasajeros', 'contrato_hoteles', 'contrato_vuelos',
    'contrato_items', 'contrato_servicios', 'contrato_adjuntos',
    'vouchers', 'cuotas'
  ];
begin
  -- La lista de usuarios se arma ANTES de cambiar de rol: una vez dentro de
  -- `authenticated` la RLS de `usuarios` solo deja ver la fila propia.
  for u in select id, email, rol::text as rol, activo from public.usuarios order by rol, email loop
    foreach t in array tablas loop

      -- Hacerse pasar por el usuario. `set local role authenticated` es
      -- imprescindible: en el editor SQL se corre como superusuario, y un
      -- superusuario SE SALTA la RLS, así que sin esto la prueba daría
      -- siempre OK y no probaría nada.
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',
                         json_build_object('sub', u.id, 'role', 'authenticated')::text,
                         true);

      -- Filas hijas visibles.
      execute format('select count(*) from public.%I', t) into n_visibles;

      -- Filas hijas visibles cuyo contrato padre TAMBIÉN es visible. Como la
      -- RLS se aplica a las dos tablas del join, esto es exactamente "lo que
      -- debería ver". Si es menor que el conteo de arriba, hay filas
      -- huérfanas visibles = fuga.
      execute format(
        'select count(*) from public.%I h join public.ventas v on v.numero_contrato = h.numero_contrato', t
      ) into n_con_padre;

      -- Volver a superusuario para poder escribir el resultado.
      reset role;
      perform set_config('request.jwt.claims', null, true);

      insert into _rls_out values (
        u.email, u.rol, u.activo, t, n_visibles, n_con_padre,
        case when n_visibles = n_con_padre then 'OK'
             when n_visibles > n_con_padre then 'FUGA (' || (n_visibles - n_con_padre) || ')'
             else 'RESTRINGIDO' end
      );

    end loop;
  end loop;
end $$;

-- ── Segunda comprobación: que el invariante no pase "por vacío" ───────────
-- El chequeo de arriba lo cumple trivialmente quien no ve NADA (0 = 0). Falta
-- confirmar que cada quien sí ve lo que le toca:
--   · superadmin / gerencia      → todos los contratos
--   · administracion/operaciones → todos los de SU agencia (tenant)
--   · venta                      → 0 sobre la TABLA `ventas` (la migración 144
--                                  le quitó esa policy) y todos los de SU
--                                  agencia sobre la VISTA `ventas_basica`, que
--                                  es por donde entra la app. Por eso se miden
--                                  las dos: un 0 en la tabla es lo correcto
--                                  para este rol, y sería un 0 alarmante para
--                                  cualquier otro.
--   · agencia / freelance / cliente_final → 0 (su acceso va por el portal B2B,
--                                            que resuelve por pertenencia, no
--                                            por esta RLS)
--   · cualquier usuario con activo = false → 0 (migración 140)

create temp table _rls_ventas (
  usuario   text,
  rol       text,
  activo    boolean,
  visibles  bigint,
  visibles_vista bigint,
  suyos_mismo bigint,
  suyos_otro  bigint,
  total_bd  bigint
) on commit drop;

do $$
declare
  u             record;
  n_vis         bigint;
  n_vis_vista   bigint;
  n_suyos_mismo bigint;
  n_suyos_otro  bigint;
  n_total       bigint;
begin
  select count(*) into n_total from public.ventas;

  for u in select id, email, nombre, rol::text as rol, activo, tenant from public.usuarios order by rol, email loop
    -- Contratos donde figura como asesor (contado como superusuario, sin RLS).
    -- Normalizado igual que `soy_ese_asesor()` (migración 142): minúsculas y
    -- sin espacios sobrantes, para que crucen los contratos importados.
    --
    -- SEPARADO POR AGENCIA a propósito: `soy_asesor_del_contrato` empareja por
    -- nombre y NO mira el tenant, pero `puede_ver_contrato` sí. Una coincidencia
    -- en la OTRA agencia por tanto nunca puede ser una expectativa operativa —
    -- es ruido de datos (u homonimia) y hay que poder verla aparte, o se lee
    -- como si al usuario le faltara acceso.
    select
      count(*) filter (where v.tenant is not distinct from u.tenant),
      count(*) filter (where v.tenant is distinct from u.tenant)
      into n_suyos_mismo, n_suyos_otro
      from public.ventas v
     where lower(btrim(v.asesor)) in (lower(btrim(u.nombre)), lower(btrim(u.email)));

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
                       json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    select count(*) into n_vis from public.ventas;
    -- Desde la 144 el rol `venta` no lee la tabla: entra por esta vista.
    select count(*) into n_vis_vista from public.ventas_basica;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    insert into _rls_ventas values (u.email, u.rol, u.activo, n_vis, n_vis_vista, n_suyos_mismo, n_suyos_otro, n_total);
  end loop;
end $$;

-- Resultado 1 — fugas en tablas hijas. Las FUGA salen de primeras.
select
  usuario, rol, activo, tabla, visibles, con_padre, veredicto
from _rls_out
order by (veredicto like 'FUGA%') desc, (veredicto <> 'OK') desc, rol, usuario, tabla;

-- Resultado 2 — alcance de cada usuario sobre `ventas`.
--
-- ⚠️ CÓMO LEER LAS DOS COLUMNAS DE COINCIDENCIAS POR NOMBRE
--
-- Ambas cuentan filas donde `ventas.asesor` coincide con el nombre (o el
-- correo) del usuario. Eso es una COINCIDENCIA DE TEXTO, no un permiso. Van
-- separadas por agencia porque significan cosas distintas:
--
--   · `coincidencias_mismo_tenant` — contratos de SU propia agencia. Solo aquí
--     puede haber una expectativa operativa, y solo para el rol `venta`: es el
--     único caso donde la app usa esa coincidencia para decidir qué gestiona
--     (`soy_asesor_del_contrato`, migración 142).
--
--   · `coincidencias_otro_tenant` — contratos de la OTRA agencia. **Nunca es
--     una expectativa operativa, para ningún rol.** `soy_asesor_del_contrato`
--     empareja por nombre y no mira el tenant, pero `puede_ver_contrato` sí, y
--     por eso estos contratos no aparecen en `contratos_visibles`. Eso está
--     BIEN. Un número aquí no es una fuga ni una falta de acceso: es ruido de
--     datos, y hay que mirar el dato, no la RLS.
--
-- Que estuvieran sumadas en una sola columna es lo que llevó a un diagnóstico
-- equivocado, y por una causa concreta:
--
--   · `ventas.asesor` de los contratos IMPORTADOS de minorista trae el texto
--     de la hoja. Cuando la hoja traía un VENDEDOR —un freelance externo— ese
--     nombre quedó en `asesor` además de en `freelance_nombre`. Una persona
--     interna de mayorista que se llame igual aparece con contratos de
--     minorista que no gestiona y que no debe ver.
--
-- Regla: si `coincidencias_mismo_tenant > 0` pero esos contratos no están en
-- lo visible (para `venta`, la columna que manda es `ventas_basica`; para el
-- resto, la tabla), lo que hay que revisar es el DATO (quién debería estar en
-- `ventas.asesor`), no la RLS. Y si lo que hay es
-- `coincidencias_otro_tenant > 0`, no hay nada que revisar en la RLS en
-- absoluto: está haciendo justo lo que debe.
select
  usuario, rol, activo,
  visibles       as "visibles en la tabla ventas",
  visibles_vista as "visibles en ventas_basica",
  suyos_mismo as coincidencias_mismo_tenant,
  suyos_otro  as coincidencias_otro_tenant,
  case
    when rol = 'venta' and suyos_mismo > 0
      then 'expectativa operativa (solo la columna de su agencia)'
    when suyos_otro > 0
      then 'informativo — coincidencia de nombre con la OTRA agencia; no da acceso'
    else 'informativo — coincidencia textual, no es un permiso'
  end         as "cómo leer las coincidencias",
  total_bd    as total_en_la_base
from _rls_ventas
order by rol, usuario;

rollback;
