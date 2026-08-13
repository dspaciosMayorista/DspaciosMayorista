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
--   · superadmin, gerencia, administracion, operaciones → leen costos
--     (correcto: son los roles con acceso financiero legítimo).
--   · venta → filas_financieras = 0  Y  filas_vista_basica > 0
--     Las DOS cosas importan. Solo con el 0 no se prueba nada: un `venta` sin
--     contratos en su agencia también da 0. Que la vista le devuelva filas es
--     lo que demuestra que SÍ alcanza los contratos y aun así no ve los costos.
--   · agencia/freelance/cliente_final → 0
--   · cualquier usuario inactivo      → 0
--
-- También mide los costos escondidos en TABLAS HIJAS: `contrato_servicios.costo`
-- (el neto del proveedor) y `cuentas_por_pagar.valor_total`. Ver migración 146.
--
-- Antes de la 144, `venta` leía costos de toda su agencia: esa era la falla.
-- ─────────────────────────────────────────────────────────────────────────

begin;

-- ── Preparación: poner a todos en la agencia que SÍ tiene contratos ───────
-- Sin esto la prueba no prueba nada. Si los contratos son de minorista y los
-- usuarios internos son de mayorista, `venta` da 0 filas por FALTA DE
-- CONTRATOS DE SU AGENCIA, no porque la seguridad lo bloquee: los dos caminos
-- dan el mismo 0 y no se distinguen.
--
-- Se les cambia el tenant al de la agencia con más contratos SOLO dentro de
-- esta transacción, que termina en ROLLBACK. La base queda como estaba: es un
-- escenario de prueba, no un cambio de configuración.
do $$
declare t_obj text;
begin
  select tenant into t_obj from public.ventas group by tenant order by count(*) desc limit 1;
  if t_obj is null then
    raise exception 'No hay contratos en `ventas`: la prueba no puede concluir nada.';
  end if;
  update public.usuarios
     set tenant = t_obj
   where rol in ('venta','operaciones','administracion','gerencia');
  raise notice 'Escenario de prueba: usuarios internos puestos en tenant "%s" (se revierte al final).', t_obj;
end $$;

create temp table _fin_out (
  usuario   text,
  rol       text,
  activo    boolean,
  filas_financieras bigint,
  filas_vista_basica bigint,
  costos_en_hijas bigint,
  veredicto text
) on commit drop;

do $$
declare
  u        record;
  n_fin    bigint;
  n_vista  bigint;
  n_hijas  bigint;
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

    -- Costos escondidos en tablas hijas (migración 146): `contrato_servicios`
    -- guarda el neto que se le paga al proveedor. `cuentas_por_pagar` ya
    -- excluía a `venta` desde la 116, pero se mide igual por si eso cambia.
    begin
      select count(*) into n_hijas from public.contrato_servicios where costo is not null;
    exception when others then
      n_hijas := 0;
    end;
    begin
      select n_hijas + count(*) into n_hijas from public.cuentas_por_pagar where valor_total is not null;
    exception when others then
      null;  -- sin permiso: se queda con lo que ya traía
    end;

    reset role;
    perform set_config('request.jwt.claims', null, true);

    insert into _fin_out values (
      u.email, u.rol, u.activo, n_fin, n_vista, n_hijas,
      case
        when u.rol in ('superadmin','gerencia','administracion','operaciones')
          then 'OK (acceso financiero legítimo)'
        when n_fin = 0 and n_hijas = 0 then 'OK'
        when n_fin > 0 then 'EXPUESTO (' || n_fin || ' contratos con costos legibles)'
        else 'EXPUESTO (' || n_hijas || ' costos legibles en tablas hijas)'
      end
    );
  end loop;
end $$;

-- Los EXPUESTO salen de primeras.
select usuario, rol, activo, filas_financieras, filas_vista_basica, costos_en_hijas, veredicto
from _fin_out
order by (veredicto like 'EXPUESTO%') desc, rol, usuario;

-- Comprobación dura: si algún rol que NO debe ver finanzas puede leerlas, esto
-- corta con un error en vez de dejarlo pasar como una fila más del listado.
do $$
declare n_fuga int; n_util int;
begin
  -- 1. Nadie sin acceso financiero puede leer costos.
  select count(*) into n_fuga from _fin_out
   where (filas_financieras > 0 or costos_en_hijas > 0)
     and rol not in ('superadmin','gerencia','administracion','operaciones');
  if n_fuga > 0 then
    raise exception 'FALLA DE SEGURIDAD: % usuario(s) sin acceso financiero pueden leer costos (en `ventas` o en sus tablas hijas).', n_fuga;
  end if;

  -- 2. Y la prueba fue CONCLUYENTE: al menos un `venta` alcanzó contratos por
  --    la vista. Sin esto, el punto 1 lo cumple trivialmente quien no ve nada,
  --    y estaríamos dando por buena una protección que no se ejercitó.
  select count(*) into n_util from _fin_out
   where rol = 'venta' and filas_vista_basica > 0;
  if n_util = 0 then
    raise exception 'PRUEBA NO CONCLUYENTE: ningún usuario `venta` alcanzó contratos por `ventas_basica`. El 0 en costos puede deberse a que no ve NADA, no a la protección. Revisa que exista al menos un usuario con rol `venta`.';
  end if;

  raise notice 'OK: ningún rol sin acceso financiero lee costos, y `venta` sí alcanza los contratos por la vista segura.';
end $$;

rollback;
