-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA DE AISLAMIENTO POR ROL  ·  correr en el editor SQL de Supabase
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ COMPRUEBA
-- Se hace pasar por CADA usuario real de la tabla `usuarios` (uno por uno) y
-- verifica un invariante que debe cumplirse para todos, sin importar el rol:
--
--     filas visibles de una tabla hija
--       ==
--     filas visibles de esa tabla hija QUE ADEMÁS tienen su contrato visible
--
-- Si un usuario ve MÁS filas hijas que contratos padres visibles, está viendo
-- pasajeros, precios o vouchers de contratos que no le corresponden: FUGA.
--
-- La gracia es que el invariante no depende del rol, así que la misma prueba
-- sirve para superadmin, gerencia, administración, operaciones, venta, los
-- roles B2B y los usuarios desactivados — sin escribir un caso por cada uno.
--
-- CÓMO SE LEE EL RESULTADO
--   OK        → sin fuga (lo esperado en todas las filas)
--   FUGA (n)  → ve n filas hijas de contratos que no puede ver ← hay que mirar
--
-- Antes de la migración 141, todo usuario con rol interno (incluido `venta`)
-- daba FUGA en todas las tablas. Después debe dar OK en todas.
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
             else 'FUGA (' || (n_visibles - n_con_padre) || ')' end
      );

    end loop;
  end loop;
end $$;

-- ── Segunda comprobación: que el invariante no pase "por vacío" ───────────
-- El chequeo de arriba lo cumple trivialmente quien no ve NADA (0 = 0). Falta
-- confirmar que cada quien sí ve lo que le toca:
--   · superadmin / gerencia      → todos los contratos
--   · administracion/operaciones → todos los de SU agencia (tenant)
--   · venta                      → solo aquellos donde figura como asesor
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
    select count(*) into n_suyos
      from public.ventas v
     where v.asesor = u.nombre or v.asesor = u.email;

    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
                       json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    select count(*) into n_vis from public.ventas;
    reset role;
    perform set_config('request.jwt.claims', null, true);

    insert into _rls_ventas values (u.email, u.rol, u.activo, n_vis, n_suyos, n_total);
  end loop;
end $$;

-- Resultado 1 — fugas en tablas hijas (lo que arregla la migración 141).
select
  usuario, rol, activo, tabla, visibles, con_padre, veredicto
from _rls_out
order by (veredicto <> 'OK') desc, rol, usuario, tabla;

-- Resultado 2 — alcance de cada usuario sobre `ventas`.
select
  usuario, rol, activo,
  visibles as contratos_visibles,
  suyos    as contratos_donde_es_asesor,
  total_bd as total_en_la_base
from _rls_ventas
order by rol, usuario;

rollback;
