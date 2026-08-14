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
--   · venta                      → todos los de SU agencia (migración 142)
--   · agencia / freelance / cliente_final → 0 (su acceso va por el portal B2B,
--                                            que resuelve por pertenencia, no
--                                            por esta RLS)
--   · cualquier usuario con activo = false → 0 (migración 140)

create temp table _rls_ventas (
  usuario   text,
  rol       text,
  activo    boolean,
  visibles  bigint,
  suyos     bigint,
  total_bd  bigint
) on commit drop;

do $$
declare
  u          record;
  n_vis      bigint;
  n_suyos    bigint;
  n_total    bigint;
begin
  select count(*) into n_total from public.ventas;

  for u in select id, email, nombre, rol::text as rol, activo from public.usuarios order by rol, email loop
    -- Contratos donde figura como asesor (contado como superusuario, sin RLS).
    -- Normalizado igual que `soy_ese_asesor()` (migración 142): minúsculas y
    -- sin espacios sobrantes, para que crucen los contratos importados.
    select count(*) into n_suyos
      from public.ventas v
     where lower(btrim(v.asesor)) in (lower(btrim(u.nombre)), lower(btrim(u.email)));

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
                       json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    select count(*) into n_vis from public.ventas;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    insert into _rls_ventas values (u.email, u.rol, u.activo, n_vis, n_suyos, n_total);
  end loop;
end $$;

-- Resultado 1 — fugas en tablas hijas. Las FUGA salen de primeras.
select
  usuario, rol, activo, tabla, visibles, con_padre, veredicto
from _rls_out
order by (veredicto like 'FUGA%') desc, (veredicto <> 'OK') desc, rol, usuario, tabla;

-- Resultado 2 — alcance de cada usuario sobre `ventas`.
--
-- ⚠️ CÓMO LEER LA COLUMNA DE COINCIDENCIAS POR NOMBRE
--
-- Cuenta las filas donde `ventas.asesor` coincide con el nombre del usuario.
-- Eso es una COINCIDENCIA DE TEXTO, no un permiso, y solo significa algo para
-- el rol `venta` DENTRO DE SU PROPIA AGENCIA — que es el único caso donde la
-- app usa esa coincidencia para decidir qué puede gestionar
-- (`soy_asesor_del_contrato`, migración 142).
--
-- Para cualquier otro rol —o para contratos de otra agencia— la columna es
-- MERAMENTE INFORMATIVA. Un número ahí NO significa "debería poder ver estos
-- contratos". Interpretarlo así lleva a diagnósticos equivocados, y ya pasó:
--
--   · `ventas.asesor` de los contratos IMPORTADOS de minorista trae el texto
--     de la hoja. Cuando la hoja traía un VENDEDOR —un freelance externo— ese
--     nombre quedó en `asesor` además de en `freelance_nombre`. Si una persona
--     interna se llama igual que ese freelance, aparece aquí con contratos que
--     no gestiona y que no debe ver.
--   · Un usuario de mayorista puede coincidir por nombre con contratos de
--     minorista. Eso NO es una fuga: `puede_ver_contrato` filtra por tenant y
--     la columna `contratos_visibles` lo refleja correctamente.
--
-- Regla: si `coincidencias_por_nombre > 0` pero `contratos_visibles` no los
-- incluye, lo que hay que revisar es el DATO (quién debería estar en
-- `ventas.asesor`), no la RLS.
select
  usuario, rol, activo,
  visibles as contratos_visibles,
  suyos    as coincidencias_por_nombre,
  case
    when rol = 'venta' then 'expectativa operativa (dentro de su agencia)'
    else 'informativo — coincidencia textual, no es un permiso'
  end      as "cómo leer las coincidencias",
  total_bd as total_en_la_base
from _rls_ventas
order by rol, usuario;

rollback;
