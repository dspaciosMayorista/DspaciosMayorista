-- ─────────────────────────────────────────────────────────────────────────
-- PRUEBA: ¿puede el rol `venta` leer columnas financieras?
-- Correr en el editor SQL de Supabase. Solo lectura (termina en ROLLBACK).
-- ─────────────────────────────────────────────────────────────────────────
--
-- QUÉ PRUEBA
-- RLS filtra FILAS, no COLUMNAS: si un rol puede ver la fila, puede pedir
-- TODAS sus columnas por la API REST, sin pasar por la app. Que la interfaz
-- oculte los costos (helper `verFinanzas`) NO es un control de seguridad.
--
-- Esta prueba se hace pasar por cada usuario y ejecuta el equivalente exacto de
--     GET /rest/v1/ventas?select=costo_hotel,costo_aereo,...
-- contando cuántas filas le devuelve la base.
--
-- CÓMO SE LEE
--   filas_financieras = 0   → OK. No puede leer costos por ningún camino.
--   filas_financieras > 0   → EXPUESTO. Ese usuario puede sacar los costos de
--                             esas N filas con su token, aunque la app no se
--                             los muestre.
--
-- QUÉ SE ESPERA DESPUÉS DE LA MIGRACIÓN 144
--   · superadmin, gerencia, administracion, operaciones → EXPUESTO (correcto:
--     son los roles con acceso financiero legítimo).
--   · venta                        → 0  ← si da > 0, la 144 no quedó aplicada
--   · agencia/freelance/cliente_final → 0
--   · cualquier usuario inactivo   → 0
--
-- Antes de la 144, `venta` daba > 0: esa era la vulnerabilidad.
-- ─────────────────────────────────────────────────────────────────────────

begin;

create temp table _fin_out (
  usuario   text,
  rol       text,
  activo    boolean,
  filas_financieras bigint,
  filas_vista_basica bigint,
  veredicto text
) on commit drop;

do $$
declare
  u        record;
  n_fin    bigint;
  n_vista  bigint;
begin
  for u in select id, email, rol::text as rol, activo from public.usuarios order by rol, email loop

    -- `set local role authenticated` es imprescindible: en el editor SQL se
    -- corre como superusuario, y un superusuario SE SALTA la RLS.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',
                       json_build_object('sub', u.id, 'role', 'authenticated')::text, true);

    -- El equivalente exacto de pedir las columnas de costo por la API REST.
    begin
      select count(*) into n_fin
        from public.ventas
       where costo_hotel is not null
          or costo_aereo is not null
          or costo_receptivo is not null
          or otros_costos is not null;
    exception when others then
      n_fin := 0;   -- sin permiso ni sobre la tabla: también es 0 expuesto
    end;

    -- Lo que SÍ debería poder leer un asesor: la vista sin columnas de costo.
    begin
      select count(*) into n_vista from public.ventas_basica;
    exception when others then
      n_vista := -1;  -- la vista no existe todavía (migración 144 sin correr)
    end;

    reset role;
    perform set_config('request.jwt.claims', null, true);

    insert into _fin_out values (
      u.email, u.rol, u.activo, n_fin, n_vista,
      case
        when u.rol in ('superadmin','gerencia','administracion','operaciones')
          then 'OK (acceso financiero legítimo)'
        when n_fin = 0 then 'OK'
        else 'EXPUESTO (' || n_fin || ' contratos con costos legibles)'
      end
    );
  end loop;
end $$;

-- Los EXPUESTO salen de primeras.
select usuario, rol, activo, filas_financieras, filas_vista_basica, veredicto
from _fin_out
order by (veredicto like 'EXPUESTO%') desc, rol, usuario;

-- Comprobación dura: si algún rol que NO debe ver finanzas puede leerlas, esto
-- corta con un error en vez de dejarlo pasar como una fila más del listado.
do $$
declare n int;
begin
  select count(*) into n from _fin_out
   where filas_financieras > 0
     and rol not in ('superadmin','gerencia','administracion','operaciones');
  if n > 0 then
    raise exception 'FALLA DE SEGURIDAD: % usuario(s) sin acceso financiero pueden leer columnas de costo de `ventas`.', n;
  end if;
  raise notice 'OK: ningún rol sin acceso financiero puede leer columnas de costo.';
end $$;

rollback;
