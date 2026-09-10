-- ───────────────────────────────────────────────────────────────────────────
-- 173 · TARIFAS DE ALOJAMIENTO POR UNIDAD DE COBRO (persistencia, fase 1 Bernalo)
--
-- QUÉ RESUELVE
-- El motor puro `lib/calc/unidadAlojamiento.ts` (PR 1 del análisis Bernalo)
-- ya modela cómo se cobra UNA noche de alojamiento cuando la unidad de cobro
-- NO es "por persona": por pareja, por habitación o por apartamento. Ese
-- motor no tiene dónde guardar sus tarifas.
--
-- `tarifa_hotel` NO sirve para esto y NO se toca: su modelo es una fila por
-- (categoría × régimen × temporada) con columnas fijas por acomodación
-- (`neto_sencilla`, `neto_doble`, `neto_triple`, `neto_multiple`, `neto_nino`,
-- `neto_nino2`, `neto_infante`) — es decir, asume implícitamente que el cobro
-- es POR PERSONA y que las acomodaciones son siempre las mismas cuatro. No
-- puede expresar "una pareja paga $550.000 por la unidad", ni varios
-- suplementos configurables, ni una política de menores de tres tramos con
-- una periodicidad explícita para el infante. `hotel_calculadora` tampoco:
-- guarda los parámetros de entrada de una calculadora, no la tarifa ya
-- resultante.
--
-- Por eso esta migración crea una tabla SEPARADA. Un mismo hotel puede tener
-- varias modalidades vigentes a la vez (p. ej. unas habitaciones cobradas por
-- habitación y otras por persona) — de ahí que la fila sea por TARIFA, no por
-- hotel. `tarifa_id` es globalmente estable: junto con `version_tarifario`
-- identifica sin ambiguedad la fila que viaja en un snapshot historico.
--
-- QUÉ GUARDA
--   Identidad:   hotel_id, tarifa_id (estable global), version_tarifario
--   Clasificación (espejo de columnas del payload, para poder listar/filtrar
--   sin abrir el JSON): temporada, categoria, alimentacion
--   Calendario:  lo resuelve `hotel_temporadas`, que ya soporta varios rangos,
--                blackouts y prioridad por hotel. Esta tabla no lo duplica.
--   Ciclo de vida: estado (borrador | publicada | inactiva)
--   Trazabilidad:  fuente_documento / fuente_pagina
--   Contenido:   payload jsonb = el `TarifaAlojamiento` COMPLETO del motor
--                (id, versionTarifario, unidadCobro, valores, capacidad,
--                suplementos, reglaMenores, temporada, categoria,
--                alimentacion, fuente)
--
-- POR QUÉ EL PAYLOAD ES jsonb Y NO COLUMNAS
-- `TarifaAlojamiento` es una unión discriminada por `unidadCobro` con
-- suplementos heterogéneos (adulto_adicional | persona_sola |
-- menor_adicional{categoriaMenor}) y un arreglo de reglas de edad de largo
-- variable. Aplanarlo en columnas exigiría o bien columnas que solo aplican a
-- una de las cuatro unidades (y quedan NULL en las otras tres, sin ninguna
-- garantía de coherencia), o bien tablas hijas por suplemento/regla. El motor
-- ya valida el objeto completo (forma + coherencia por unidad + numérica), así
-- que la columna guarda EXACTAMENTE lo que el motor consume — sin traducción
-- intermedia que pueda divergir. Las tres columnas de clasificación son
-- espejo deliberado del payload, y el adaptador (`lib/calc/
-- tarifaAlojamientoPersistida.ts`) comprueba que coincidan: una columna que
-- dijera algo distinto del payload sería una mentira silenciosa.
--
-- QUÉ **NO** HACE ESTA MIGRACIÓN (alcance explícito de la fase 1)
--   · No toca ninguna tabla existente.
--   · No crea RPC, ni función SECURITY DEFINER, ni trigger.
--   · No hace seed ni backfill: no hay datos Bernalo cargados todavía y no se
--     inventa ninguno.
--   · No expone nada al público (`anon`): la tarifa pública sigue saliendo de
--     los módulos actuales. Esta tabla es de administración de producto.
--   · No hay integración con reservar / tarifario / cotizaciones / contratos.
--
-- ⚠️ FRONTERA DE PRODUCTO — ESTA TABLA NO ES EL TARIFARIO BERNALO COMPLETO
-- Guarda ÚNICAMENTE tarifas REGULARES de alojamiento por noche: las que el
-- motor puede expresar con `unidadCobro` = persona | pareja | habitación |
-- apartamento. NO cubre —y no debe usarse para representar— los demás
-- productos del tarifario Bernalo, porque NO son un caso particular de la
-- tarifa nocturna sino OTRO modelo que REEMPLAZA el cálculo por noche:
--   · día de sol (uso de instalaciones sin pernoctar);
--   · temporadas de Navidad y Año Nuevo (noches mínimas, suplementos y
--     condiciones de cancelación propias);
--   · tarifa especial de una noche (precio único de una fecha puntual: no se
--     multiplica por noches);
--   · paquetes de 2 noches / 3 días (el precio es del paquete, no de la
--     noche; dividirlo daría un valor por noche que nadie cotizó);
--   · reglas de comisión (son del canal de venta, no de la tarifa);
--   · condiciones generales (texto contractual, no aritmética).
-- Los anteriores requieren un modelo posterior. Guardarlos acá —aunque fuera
-- "aproximando" un valor por noche— los haría cotizar como tarifa regular,
-- que es exactamente lo que esta entrega NO debe permitir.
--
-- Esta frontera no queda solo escrita: el adaptador
-- (`lib/calc/tarifaAlojamientoPersistida.ts`) exige que `payload` sea
-- EXACTAMENTE un `TarifaAlojamiento`, así que un payload que se anuncie como
-- otro producto (por ejemplo `tipoProducto` o `paquete2Noches` entre sus
-- claves) se rechaza con el código `payload_con_campos_desconocidos` en vez
-- de adaptarse como tarifa nocturna regular.
--
-- ADITIVA, IDEMPOTENTE y TRANSACCIONAL (`begin`/`commit`, mismo criterio que
-- 126/154/164/169). El `create table if not exists` con sus constraints
-- inline hace que re-correrla sobre una base ya migrada sea un no-op.
--
-- Preflight / postcheck / prueba de comportamiento / rollback en
-- `supabase/scripts/` (173). Deben verificarse contra una base Postgres local
-- desechable antes de aplicar la migración fuera de desarrollo.
-- ───────────────────────────────────────────────────────────────────────────

begin;

create table if not exists public.hotel_tarifas_unidad (
  id                bigserial primary key,
  hotel_id          bigint not null references public.hoteles(id) on delete cascade,

  -- Identidad estable global de la tarifa. `tarifa_id` NO es la PK:
  -- es el identificador de negocio que el motor exige (`TarifaAlojamiento.id`)
  -- y que viaja al snapshot; la PK es interna. `version_tarifario` permite
  -- conservar una revisión anterior sin sobrescribirla (el motor exige
  -- `versionTarifario` justamente para que un snapshot viejo siga siendo
  -- explicable).
  tarifa_id         text not null,
  version_tarifario text not null,

  -- Espejo de clasificación del payload (ver adaptador: se verifica que
  -- coincidan). Nullable porque una tarifa puede no estar atada a temporada,
  -- categoría ni alimentación — NO significa "sin definir".
  temporada         text,
  categoria         text,
  alimentacion      text,

  -- Ciclo de vida editorial. `borrador` por default: nada nace publicado.
  estado            text not null default 'borrador',

  -- Trazabilidad al documento de origen (el PDF del proveedor). La página es
  -- opcional porque no todo origen está paginado.
  fuente_documento  text,
  fuente_pagina     integer,

  -- El TarifaAlojamiento COMPLETO. NOT NULL: una fila sin payload no tiene
  -- nada que cotizar y no debe existir.
  payload           jsonb not null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint hotel_tarifas_unidad_estado_check
    check (estado in ('borrador', 'publicada', 'inactiva')),

  constraint hotel_tarifas_unidad_pagina_check
    check (fuente_pagina is null or fuente_pagina > 0),

  -- El payload debe ser un OBJETO JSON, nunca `null`, arreglo, número ni
  -- texto. `jsonb_typeof` es la comprobación real en la base: el motor ya
  -- rechaza una tarifa mal formada, pero un jsonb escalar no debería llegar
  -- siquiera a guardarse.
  constraint hotel_tarifas_unidad_payload_objeto_check
    check (jsonb_typeof(payload) = 'object'),

  -- La identidad que persiste en columnas y la que consume el motor deben
  -- coincidir tambien en la base. `payload ? ...` evita que CHECK acepte NULL
  -- cuando falta una de las claves JSON.
  constraint hotel_tarifas_unidad_payload_id_check
    check (payload ? 'id' and tarifa_id = payload ->> 'id'),
  constraint hotel_tarifas_unidad_payload_version_check
    check (payload ? 'versionTarifario' and version_tarifario = payload ->> 'versionTarifario'),

  -- Identidad no vacía: `tarifa_id` y `version_tarifario` son obligatorios
  -- para el motor (string no vacío) y para el snapshot. Se exige en la base
  -- para que no entre una fila que el motor rechazará al leerla.
  constraint hotel_tarifas_unidad_tarifa_id_check
    check (btrim(tarifa_id) <> ''),
  constraint hotel_tarifas_unidad_version_check
    check (btrim(version_tarifario) <> ''),

  -- La pareja que guarda el snapshot debe resolver a una sola fila aun sin
  -- conocer el hotel. Dos VERSIONES distintas de la misma tarifa sí conviven.
  constraint hotel_tarifas_unidad_tarifa_version_key
    unique (tarifa_id, version_tarifario)
);

comment on table public.hotel_tarifas_unidad is
  'Tarifas regulares de alojamiento por persona, pareja, habitación o apartamento, una fila por tarifa. Complementa —no reemplaza— tarifa_hotel y preserva modalidades que sus columnas fijas no pueden expresar. El calendario autoritativo sigue en hotel_temporadas (rangos múltiples, blackouts y prioridad); esta tabla no duplica fechas. El payload jsonb es el TarifaAlojamiento completo que consume el motor puro lib/calc/unidadAlojamiento.ts; las columnas temporada/categoria/alimentacion/fuente_* son espejo de clasificación y el adaptador verifica que coincidan con el payload. Sin RPC, sin SECURITY DEFINER, sin acceso anónimo y sin integración con flujos comerciales en esta fase. ALCANCE: cubre SOLO tarifas regulares por noche (persona/pareja/habitación/apartamento); NO cubre día de sol, Navidad/Año Nuevo, tarifa especial de una noche, paquetes de 2 noches/3 días, reglas de comisión ni condiciones generales — esos productos reemplazan el cálculo nocturno y necesitan un modelo aparte. NO es el tarifario Bernalo completo.';
comment on column public.hotel_tarifas_unidad.tarifa_id is
  'Identificador ESTABLE global de la tarifa (identificador de negocio del motor, TarifaAlojamiento.id). Junto con version_tarifario identifica de forma única el snapshot histórico; no es la PK. Los futuros editores deben generar ids sin colisiones entre hoteles.';
comment on column public.hotel_tarifas_unidad.version_tarifario is
  'Versión del tarifario a la que pertenece esta tarifa (ej. "bernalo-2026"). Exigida por el motor porque sin ella no hay snapshot persistible que siga siendo explicable.';
comment on column public.hotel_tarifas_unidad.estado is
  'Ciclo de vida editorial: borrador (default) | publicada | inactiva. No es un filtro que aplique el adaptador: la fila se adapta igual y es el llamador quien decide qué estados usa.';
comment on column public.hotel_tarifas_unidad.updated_at is
  'Fecha de la última edición. No tiene trigger automático en esta fase: todo futuro editor o importador debe asignar now() explícitamente al actualizar la fila.';
comment on column public.hotel_tarifas_unidad.payload is
  'TarifaAlojamiento COMPLETO del motor (id, versionTarifario, unidadCobro, valores, capacidad, suplementos, reglaMenores, temporada, categoria, alimentacion, fuente). Debe ser un objeto JSON; el motor lo valida al adaptarlo. Debe contener EXACTAMENTE esas claves: el adaptador rechaza cualquier clave de primer nivel que no sea del tipo del motor, para que otro producto del tarifario (día de sol, paquete de varias noches, temporada especial) no se cuele y se cotice como tarifa nocturna regular.';

-- Listado por hotel y estado (pantallas de administración de producto). La
-- llave única de arriba cubre la resolución histórica por (tarifa_id, versión).
create index if not exists hotel_tarifas_unidad_hotel_estado_idx
  on public.hotel_tarifas_unidad (hotel_id, estado);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Mismo criterio que las tablas de catálogo/producto (migración 017 para las
-- de configuración de hotel, 137 para la alineación general de roles): el
-- conjunto de roles es el de ADMINISTRACIÓN DE PRODUCTO, idéntico en lectura
-- y en escritura. No se otorga `venta` (no administra tarifas) ni `anon`
-- (esta fase no expone nada al público).
--
-- Cuatro políticas separadas en vez de un solo `for all` para que quede
-- explícito qué operación concede cada una — y para que ampliar la lectura
-- más adelante (p. ej. si un rol de consulta necesitara ver las publicadas)
-- sea un cambio de una sola política, sin abrir la escritura por descuido.
alter table public.hotel_tarifas_unidad enable row level security;

drop policy if exists "hotel_tarifas_unidad: lectura producto" on public.hotel_tarifas_unidad;
create policy "hotel_tarifas_unidad: lectura producto"
  on public.hotel_tarifas_unidad for select
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

drop policy if exists "hotel_tarifas_unidad: alta producto" on public.hotel_tarifas_unidad;
create policy "hotel_tarifas_unidad: alta producto"
  on public.hotel_tarifas_unidad for insert
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

drop policy if exists "hotel_tarifas_unidad: modificacion producto" on public.hotel_tarifas_unidad;
create policy "hotel_tarifas_unidad: modificacion producto"
  on public.hotel_tarifas_unidad for update
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'))
  with check (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

drop policy if exists "hotel_tarifas_unidad: baja producto" on public.hotel_tarifas_unidad;
create policy "hotel_tarifas_unidad: baja producto"
  on public.hotel_tarifas_unidad for delete
  using (public.mi_rol() in ('superadmin', 'gerencia', 'administracion', 'operaciones'));

commit;
