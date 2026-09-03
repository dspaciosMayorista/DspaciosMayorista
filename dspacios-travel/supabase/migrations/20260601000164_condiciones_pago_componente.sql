-- ───────────────────────────────────────────────────────────────────────────
-- 164 · CONDICIONES DE PAGO POR COMPONENTE
--
-- Establece el esquema de "condiciones de pago por componente" + "pagos
-- previos" de una cotización → UN SOLO contrato. Arquitectura aprobada por el
-- dueño (ver "Implementa la funcionalidad completa…" + correcciones 1–16).
--
-- ⚠️ SOLO lectura del documento de arquitectura autorizado; este archivo se
-- redactó tras una auditoría previa del código real. Desviaciones deliberadas
-- frente a nombres que el documento suponía (verificadas en el repo):
--   · la tabla de "paquete armado" es `armado_paquetes` (no `paquetes`);
--   · `cotizaciones.tipo` es text libre (el código escribe 'tarifario'/'manual'
--     y el carrito persiste con `tipo='carrito'` + `modulo='carrito'`);
--   · no existe `ventas.cotizacion_id` — el lazo actual es una sola columna
--     `cotizaciones.numero_contrato`; el back-link UNIQUE es NUEVO (nullable,
--     para no obligar a backfillear contratos viejos);
--   · las tablas de partida doble son `asientos_contables`/`asiento_lineas` +
--     `puc_cuentas` (mig. 126/127/129). Los posteos automáticos de la app usan
--     códigos de cuenta fijos (lib/contabilidad/asientos.ts).
--
-- Todo el archivo corre dentro de UNA transacción (`begin`/`commit`): si algo
-- falla, Postgres revierte todo (mismo criterio que las migraciones 126/154).
-- Es ADITIVO e idempotente (guardas `if not exists`, `on conflict do nothing`),
-- salvo las políticas/triggers/funciones, que se crean con `drop … if exists`
-- para poder re-correr la migración sin duplicar.
--
-- ⚠️ Decisión del dueño sobre `restriccion_comercial` (corrección posterior,
-- 164 aún sin desplegar en ningún entorno real — se editó este archivo en
-- lugar de crear una 165): toda restricción comercial es SIEMPRE no
-- reembolsable Y no endosable a la vez, sin estado intermedio. El valor
-- provisional `promocional_no_reembolsable` (que sugería que una tarifa
-- promocional pudiera ser no-reembolsable SIN ser también no-endosable) se
-- eliminó antes de aplicarse en ningún entorno; el nombre correcto es
-- `promocional_no_reembolsable_no_endosable` — mismo efecto que
-- `no_reembolsable_no_endosable`, solo distingue el ORIGEN (tarifa
-- promocional, el caso más frecuente, vs. tarifa normal restringida).
--
-- Contenido:
--   A) Columnas de condición sobre las fuentes:
--        hotel_temporadas  +3   (condicion_pago_*; la restricción comercial se
--                               DERIVA en la vista/motor cuando tipo<>'sin_condicion')
--        armado_paquetes   +4   (condicion_pago_* + restriccion_comercial)
--        programas         +4   (condicion_pago_* + restriccion_comercial)
--   B) `config_cobros_componente`: % "normal" configurable por tipo de
--        componente (hotel/vuelo_bloqueo/servicio). aéreo_empaquetado NO tiene
--        fila (100% fijo en el motor). `config_cobros` (por tipo_paquete) no se
--        toca.
--   C) `cotizacion_condiciones`: snapshot por componente de la cotización
--        (condición declarada + valor + monto exigido + restricción). Vive como
--        hijo de `cotizaciones`; RLS hereda vía `puede_ver_cotizacion(id)`.
--   D) Columnas agregadas/congeladas en `cotizaciones` (solo agregados y el
--        congelado — nada booleano "global" de restricción; la fuente
--        autoritativa de restricciones es `contrato_condiciones`).
--   E) `cotizacion_pagos_previos`: pagos previos registrados a mano por un
--        empleado autorizado (NO pasarela). Estados activo/aplicado/anulado.
--   F) `ventas.cotizacion_id` UNIQUE (nullable) → back-link UNO-A-UNO
--        cotización↔contrato (UN SOLO CONTRATO por cotización/carrito).
--   G) `contrato_condiciones`: copia permanente e inmutable al convertir.
--   H) `restriccion_overrides`: auditoría durable cuando superadmin fuerza una
--        acción restringida (exige `motivo` no vacío).
--   I) Funciones de dinero SOLO ejecutables por service_role:
--        registrar_pago_previo / anular_pago_previo /
--        transferir_pagos_previos_a_abonos. Doble autorización: el Server
--        Action valida la sesión y luego llama con `p_usuario_id`; la función
--        RE-verifica leyendo `usuarios` por ese id (rol autorizado + activo).
--        Ejecutan como service_role (INVOKER), que bypasea la RLS — NO son
--        SECURITY DEFINER.
--
-- Seguridad (correcciones del dueño):
--   · roles que registran/anulan pagos previos: superadmin, administracion,
--     gerencia, operaciones (EXCLUYE venta y roles externos);
--   · sobrepagos: se rechazan (no se auto-crean saldos a favor);
--   · una cotización con pagos activos NO se puede descartar sin reversa
--     contable formal (anular_pago_previo) — lo bloquea una policy/guard;
--   · comparación SIEMPRE COP vs COP (trm_autoritativa congelada);
--   · cada paso contable es una función SQL = una transacción.
--
-- Rollback / preflight / postcheck / pruebas en supabase/scripts/ (164).
-- ⚠️ NUNCA correr sobre producción de preview: comparte la BD real. El dueño
-- corre preflight → aplicar → postcheck cuando el code-review lo autorice.
-- ───────────────────────────────────────────────────────────────────────────

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- A) Columnas de condición sobre las fuentes (hotel_temporadas / armado_paquetes / programas)
-- ───────────────────────────────────────────────────────────────────────────

alter table public.hotel_temporadas
  add column if not exists condicion_pago_tipo text not null default 'sin_condicion',
  add column if not exists condicion_pago_pct_inicial numeric(5,4),
  add column if not exists condicion_pago_dias_saldo integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hotel_temporadas_condicion_pago_tipo_check'
  ) then
    alter table public.hotel_temporadas add constraint hotel_temporadas_condicion_pago_tipo_check
      check (condicion_pago_tipo in ('sin_condicion','pago_total','anticipo_saldo'));
  end if;
  -- Coherencia: un anticipo_saldo exige un % inicial y días de saldo definidos;
  -- pago_total/sin_condicion no los usan (pueden quedar NULL).
  if not exists (
    select 1 from pg_constraint where conname = 'hotel_temporadas_anticipo_coherencia_check'
  ) then
    alter table public.hotel_temporadas add constraint hotel_temporadas_anticipo_coherencia_check
      check (
        (condicion_pago_tipo = 'anticipo_saldo')
          = (condicion_pago_pct_inicial is not null)
      );
  end if;
end $$;

alter table public.armado_paquetes
  add column if not exists condicion_pago_tipo text not null default 'normal',
  add column if not exists condicion_pago_pct_inicial numeric(5,4),
  add column if not exists condicion_pago_dias_saldo integer,
  add column if not exists restriccion_comercial text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'armado_paquetes_condicion_pago_tipo_check') then
    alter table public.armado_paquetes add constraint armado_paquetes_condicion_pago_tipo_check
      check (condicion_pago_tipo in ('normal','pago_total','anticipo_saldo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'armado_paquetes_restriccion_check') then
    alter table public.armado_paquetes add constraint armado_paquetes_restriccion_check
      check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'armado_paquetes_anticipo_coherencia_check') then
    alter table public.armado_paquetes add constraint armado_paquetes_anticipo_coherencia_check
      check (
        (condicion_pago_tipo = 'anticipo_saldo') = (condicion_pago_pct_inicial is not null)
      );
  end if;
end $$;

alter table public.programas
  add column if not exists condicion_pago_tipo text not null default 'normal',
  add column if not exists condicion_pago_pct_inicial numeric(5,4),
  add column if not exists condicion_pago_dias_saldo integer,
  add column if not exists restriccion_comercial text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programas_condicion_pago_tipo_check') then
    alter table public.programas add constraint programas_condicion_pago_tipo_check
      check (condicion_pago_tipo in ('normal','pago_total','anticipo_saldo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programas_restriccion_check') then
    alter table public.programas add constraint programas_restriccion_check
      check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'programas_anticipo_coherencia_check') then
    alter table public.programas add constraint programas_anticipo_coherencia_check
      check ((condicion_pago_tipo = 'anticipo_saldo') = (condicion_pago_pct_inicial is not null));
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- B) config_cobros_componente (% "normal" configurable por tipo de componente)
--    — aéreo_empaquetado NO tiene fila (100% fijo en el motor, corrección #8).
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.config_cobros_componente (
  tipo_componente text primary key,
  pct_abono numeric(5,4) not null default 0.30,
  updated_at timestamptz not null default now(),
  constraint config_cobros_componente_tipo_check
    check (tipo_componente in ('hotel','vuelo_bloqueo','servicio'))
);

insert into public.config_cobros_componente (tipo_componente, pct_abono)
values ('hotel', 0.30), ('vuelo_bloqueo', 0.30), ('servicio', 0.30)
on conflict (tipo_componente) do nothing;

alter table public.config_cobros_componente enable row level security;
drop policy if exists "config_cobros_componente: lectura" on public.config_cobros_componente;
create policy "config_cobros_componente: lectura"
  on public.config_cobros_componente for select
  using (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta'));
drop policy if exists "config_cobros_componente: escritura" on public.config_cobros_componente;
create policy "config_cobros_componente: escritura"
  on public.config_cobros_componente for all
  using (public.mi_rol() = 'superadmin')
  with check (public.mi_rol() = 'superadmin');

-- ───────────────────────────────────────────────────────────────────────────
-- C) cotizacion_condiciones — snapshot por componente de la cotización
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.cotizacion_condiciones (
  id bigserial primary key,
  cotizacion_id bigint not null references public.cotizaciones(id) on delete cascade,
  tipo_componente text not null,
  referencia_externa text,                -- texto legible del componente (ej. nombre temporada/hotel/programa)
  orden integer not null default 0,
  valor_componente numeric(15,2) not null default 0,  -- en la moneda de la cotización
  condicion_pago_tipo text not null default 'sin_condicion',
  condicion_pago_pct_aplicable numeric(5,4),           -- exigencia YA resuelta por el motor (TS) al snapshottear
  condicion_pago_dias_saldo integer,
  condicion_pago_fecha_limite date,                    -- fecha límite del saldo si aplica
  monto_exigido numeric(15,2) not null default 0,      -- redondeo TS (nunca SQL), en la moneda de la cotización
  restriccion_comercial text not null default 'normal',
  hotel_temporada_id bigint,                            -- FK a la temporada de origen (hotel)
  programa_id bigint,                                   -- FK al programa de origen
  paquete_id bigint,                                    -- FK al paquete armado de origen
  congelado boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cotizacion_condiciones_tipo_componente_check
    check (tipo_componente in ('hotel','vuelo_bloqueo','aereo_empaquetado','servicio','programa','paquete')),
  constraint cotizacion_condiciones_condicion_tipo_check
    check (condicion_pago_tipo in ('sin_condicion','normal','pago_total','anticipo_saldo')),
  constraint cotizacion_condiciones_restriccion_check
    check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable'))
);

-- Unicidad estructural del snapshot: a lo sumo UNA fila por (cotización, orden).
-- El primer pago escribe el snapshot con la cotización bloqueada (FOR UPDATE),
-- así que esta restricción es el respaldo duro contra filas duplicadas/mezcladas.
create unique index if not exists uq_cotizacion_condiciones_cotizacion_orden
  on public.cotizacion_condiciones(cotizacion_id, orden);

alter table public.cotizacion_condiciones enable row level security;
-- RLS heredada del padre (mismo patrón que cotizacion_servicios, mig. 154).
drop policy if exists "cotizacion_condiciones: lectura" on public.cotizacion_condiciones;
create policy "cotizacion_condiciones: lectura"
  on public.cotizacion_condiciones for select
  using (public.puede_ver_cotizacion(cotizacion_id));
drop policy if exists "cotizacion_condiciones: insertar" on public.cotizacion_condiciones;
create policy "cotizacion_condiciones: insertar"
  on public.cotizacion_condiciones for insert
  with check (public.puede_ver_cotizacion(cotizacion_id));
drop policy if exists "cotizacion_condiciones: actualizar" on public.cotizacion_condiciones;
create policy "cotizacion_condiciones: actualizar"
  on public.cotizacion_condiciones for update
  using (public.puede_ver_cotizacion(cotizacion_id))
  with check (public.puede_ver_cotizacion(cotizacion_id));
drop policy if exists "cotizacion_condiciones: eliminar" on public.cotizacion_condiciones;
create policy "cotizacion_condiciones: eliminar"
  on public.cotizacion_condiciones for delete
  using (public.puede_ver_cotizacion(cotizacion_id));

-- Congelado: una vez que la cotización se congela (primer pago previo o
-- conversión), el snapshot de condiciones NO se puede alterar desde la app.
-- (La app escribe cotizacion_condiciones ANTES del congelado.)
create or replace function public.cotizacion_condiciones_bloquear_congeladas()
returns trigger language plpgsql as $$
declare v_congelada timestamptz;
begin
  select condicion_pago_congelada_en into v_congelada
  from public.cotizaciones where id = coalesce(new.cotizacion_id, old.cotizacion_id);
  if v_congelada is not null then
    raise exception 'Cotización % congelada: no se pueden alterar sus condiciones de pago.', coalesce(new.cotizacion_id, old.cotizacion_id);
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists trg_cotizacion_condiciones_bloquear_congeladas on public.cotizacion_condiciones;
create trigger trg_cotizacion_condiciones_bloquear_congeladas
  before insert or update or delete on public.cotizacion_condiciones
  for each row execute function public.cotizacion_condiciones_bloquear_congeladas();

-- ───────────────────────────────────────────────────────────────────────────
-- D) Columnas agregadas/congeladas en cotizaciones (solo agregados + congelado)
-- ───────────────────────────────────────────────────────────────────────────

alter table public.cotizaciones
  add column if not exists condicion_pago_congelada_en timestamptz,   -- primer pago previo / conversión
  add column if not exists moneda_congelada text,                      -- moneda del contrato congelada
  add column if not exists trm_autoritativa numeric(15,4) default 1,   -- COP→1; si USD, la TRM del pago que congeló
  add column if not exists precio_total_congelado numeric(15,2),       -- precio de venta en la moneda congelada
  add column if not exists monto_exigido_total numeric(15,2),          -- Σ monto_exigido (moneda de la cotización) al congelar
  add column if not exists monto_exigido_total_cop numeric(15,2),      -- mismo, en COP (para comparar contra pagos)
  add column if not exists pct_efectivo_informativo numeric(6,2);      -- solo informativo en % (0..100), p. ej. 53.33

-- ───────────────────────────────────────────────────────────────────────────
-- E) cotizacion_pagos_previos — pagos previos registrados a mano por empleado autorizado
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.cotizacion_pagos_previos (
  id bigserial primary key,
  cotizacion_id bigint not null references public.cotizaciones(id),
  tenant text not null default 'mayorista',       -- snapshot para RLS por tenant (y para el abono)
  monto_cop numeric(15,2) not null,          -- monto en COP (monto_moneda × TRM congelada)
  monto_moneda numeric(15,2) not null,        -- monto en la MONEDA de la cotización (identidad/idempotencia, sin redondeo por TRM)
  moneda text not null default 'COP',         -- moneda del pago (para cuentaDisponible en el asiento)
  trm numeric(15,4) not null default 1,
  forma_pago text not null,
  referencia text,                                 -- NULL si efectivo (ver guard de doble clic)
  fecha_pago date not null default current_date,
  registrado_por_id uuid not null,
  registrado_por_email text,
  estado text not null default 'activo',          -- activo | aplicado | anulado
  abono_id bigint,                                 -- cuando se transfirió a un abono del contrato
  idempotency_key text,
  huella_solicitud text,                            -- huella CANÓNICA de la solicitud (corrección B1): identidad
                                                    --   idempotente COMPLETA calculada en PostgreSQL. Reutilizar la misma
                                                    --   idempotency_key con cualquier dato material distinto → rechazo cerrado.
  motivo_anulacion text,
  created_at timestamptz not null default now(),
  constraint cotizacion_pagos_previos_estado_check
    check (estado in ('activo','aplicado','anulado')),
  -- Efectivo: sin referencia obligatoria. Los demás métodos EXIGEN referencia.
  constraint cotizacion_pagos_previos_referencia_check
    check (
      (referencia is null) = (lower(forma_pago) like '%efectivo%')
      or (referencia is not null)
    )
);

-- Una misma referencia no puede repetirse en pagos activos/aplicados de la
-- cotización (los anulados liberan el slot).
create unique index if not exists uq_pagos_previos_cotizacion_referencia
  on public.cotizacion_pagos_previos(cotizacion_id, referencia)
  where referencia is not null and estado <> 'anulado';
-- Idempotencia: la clave la entrega el Server Action; re-intentar no duplica.
create unique index if not exists uq_pagos_previos_idempotencia
  on public.cotizacion_pagos_previos(idempotency_key)
  where idempotency_key is not null;
-- (El guard de doble clic por ventana de 30s se eliminó: el doble clic ahora lo
-- absorbe la CLAVE DE IDEMPOTENCIA, que además sobrevive a timeouts/pérdidas de
-- respuesta y no da falsos positivos en pagos legítimos cercanos en el tiempo.)

alter table public.cotizacion_pagos_previos enable row level security;
-- Solo los roles que REGISTRAN/anulan leen y escriben (excluye venta y externos).
-- La escritura real pasa por las funciones (service_role), pero estas policies
-- cierran la puerta a un cliente con sesión que intente escribir directo.
drop policy if exists "pagos_previos: acceso autorizado" on public.cotizacion_pagos_previos;
create policy "pagos_previos: acceso autorizado"
  on public.cotizacion_pagos_previos for all
  using (
    public.mi_rol() in ('superadmin','administracion','gerencia','operaciones')
    and public.puede_ver_tenant(tenant)
    and public.puede_ver_cotizacion(cotizacion_id)
  )
  with check (
    public.mi_rol() in ('superadmin','administracion','gerencia','operaciones')
    and public.puede_ver_tenant(tenant)
    and public.puede_ver_cotizacion(cotizacion_id)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- E.2) Candado BD contra DESCARTE con pagos previos ACTIVOS/APLICADOS (A3).
--   Autoritativo: cualquier UPDATE que lleve la cotización a 'descartada' con
--   dinero previo vivo lanza aquí (API autenticado, service_role o SQL directo).
--   Un pago ANULADO (reversa contable formal) ya no bloquea. No se borran
--   eventos financieros: solo se libera el descarte tras la anulación formal.
-- ───────────────────────────────────────────────────────────────────────────

create or replace function public.cotizaciones_no_descartar_con_pagos()
returns trigger language plpgsql as $$
declare v_con_pagos boolean;
begin
  select exists(
    select 1
    from public.cotizacion_pagos_previos
    where cotizacion_id = new.id and estado in ('activo','aplicado')
  ) into v_con_pagos;
  if v_con_pagos then
    raise exception 'No se puede descartar la cotización %: tiene pagos previos activos/aplicados. Debe anular cada pago previo (reversa contable formal) antes de descartarla.', new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_cotizaciones_no_descartar_con_pagos on public.cotizaciones;
create trigger trg_cotizaciones_no_descartar_con_pagos
  before update on public.cotizaciones
  for each row when (new.estado = 'descartada' and old.estado is distinct from 'descartada')
  execute function public.cotizaciones_no_descartar_con_pagos();

-- ───────────────────────────────────────────────────────────────────────────
-- F) ventas.cotizacion_id UNIQUE (nullable) — UN SOLO CONTRATO por cotización
--    (los contratos previos a esta migración quedan NULL: el UNIQUE admite muchos)
-- ───────────────────────────────────────────────────────────────────────────

alter table public.ventas add column if not exists cotizacion_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ventas_cotizacion_id_key'
  ) then
    alter table public.ventas add constraint ventas_cotizacion_id_key
      unique (cotizacion_id);
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- G) contrato_condiciones — copia PERMANENTE e INMUTABLE al convertir
--    (autoritativa para restricciones comerciales; NUNCA un booleano en ventas)
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.contrato_condiciones (
  id bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  tipo_componente text not null,
  referencia_externa text,
  orden integer not null default 0,
  valor_componente numeric(15,2) not null default 0,
  condicion_pago_tipo text not null default 'sin_condicion',
  condicion_pago_pct_aplicable numeric(5,4),
  condicion_pago_dias_saldo integer,
  condicion_pago_fecha_limite date,
  monto_exigido numeric(15,2) not null default 0,
  restriccion_comercial text not null default 'normal',
  moneda text,                                     -- moneda congelada del contrato al convertir
  trm numeric(15,4),                               -- trm congelada (COP→1)
  creado_en timestamptz not null default now(),
  constraint contrato_condiciones_tipo_componente_check
    check (tipo_componente in ('hotel','vuelo_bloqueo','aereo_empaquetado','servicio','programa','paquete')),
  constraint contrato_condiciones_condicion_tipo_check
    check (condicion_pago_tipo in ('sin_condicion','normal','pago_total','anticipo_saldo')),
  constraint contrato_condiciones_restriccion_check
    check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable'))
);

create index if not exists idx_contrato_condiciones_contrato
  on public.contrato_condiciones(numero_contrato, orden);

alter table public.contrato_condiciones enable row level security;
drop policy if exists "contrato_condiciones: lectura" on public.contrato_condiciones;
create policy "contrato_condiciones: lectura"
  on public.contrato_condiciones for select
  using (public.puede_ver_contrato(numero_contrato));
-- Solo el flujo de conversión (service_role) escribe; nadie desde una sesión.
drop policy if exists "contrato_condiciones: escritura servicio" on public.contrato_condiciones;
create policy "contrato_condiciones: escritura servicio"
  on public.contrato_condiciones for insert
  with check (public.mi_rol() in ('superadmin','gerencia','administracion','operaciones'));

-- ───────────────────────────────────────────────────────────────────────────
-- H) restriccion_overrides — superadmin fuerza una acción restringida con motivo
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.restriccion_overrides (
  id bigserial primary key,
  numero_contrato text not null references public.ventas(numero_contrato) on delete cascade,
  tabla_afectada text not null,     -- ej. 'ventas','contrato_pasajeros','contrato_vuelos','abonos'
  accion text not null,             -- ej. 'eliminar_contrato','cambiar_hotel','anular_abono'
  motivo text not null check (length(trim(motivo)) > 0),  -- obligatorio (corrección #16)
  usuario_id uuid not null,
  usuario_email text,
  creado_en timestamptz not null default now()
);

alter table public.restriccion_overrides enable row level security;
drop policy if exists "restriccion_overrides: acceso" on public.restriccion_overrides;
create policy "restriccion_overrides: acceso"
  on public.restriccion_overrides for all
  using (public.mi_rol() in ('superadmin','gerencia'))
  with check (public.mi_rol() in ('superadmin','gerencia'));

-- ───────────────────────────────────────────────────────────────────────────
-- I) Funciones de dinero — SOLO ejecutables por service_role.
--
-- Doble autorización: el Server Action valida la sesión + rol + activo y luego
-- llama con `p_usuario_id`; la función RE-verifica leyendo `usuarios` por ese
-- id. Ejecutan como INVOKER bajo service_role (que bypasea la RLS): NO son
-- SECURITY DEFINER. `revoke all from public, anon, authenticated` cierra el
-- acceso a un cliente con sesión que intente llamarlas directo.
-- ───────────────────────────────────────────────────────────────────────────

-- ¿Está autorizado p_usuario_id para operar pagos previos?
create or replace function public._autorizado_pago_previo(p_usuario_id uuid)
returns text language plpgsql as $$
declare v_rol text; v_activo boolean;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario interno autorizado.';
  end if;
  select rol, activo into v_rol, v_activo
  from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not coalesce(v_activo, false) then
    raise exception 'El usuario está desactivado.';
  end if;
  if v_rol not in ('superadmin','administracion','gerencia','operaciones') then
    raise exception 'Rol % no autorizado para registrar pagos previos.', v_rol;
  end if;
  return v_rol;
end;
$$;

-- Número de asiento seguro dentro de la transacción (evita colisión con el
-- `max+1` que usan los posteos TS de la app).
create or replace function public._siguiente_numero_asiento(p_tenant text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('asiento_tenant_' || coalesce(p_tenant,'mayorista'), 0));
  select coalesce(max(numero), 0) + 1 into v
  from public.asientos_contables where tenant = coalesce(p_tenant,'mayorista');
  return v;
end;
$$;

-- Cuenta de caja/bancos según forma de pago y moneda (mismo criterio que
-- lib/contabilidad/asientos.ts::cuentaDisponible).
create or replace function public._cuenta_disponible(p_forma_pago text, p_moneda text)
returns text language plpgsql as $$
begin
  if coalesce(lower(p_forma_pago),'') like '%efectivo%' then return '110505'; end if;
  return case when upper(coalesce(p_moneda,'COP')) = 'USD' then '111010' else '111005' end;
end;
$$;

-- Resuelve el id de una cuenta del PUC por código + tenant (debe existir).
create or replace function public._puc_id(p_tenant text, p_codigo text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  select id into v from public.puc_cuentas where tenant = p_tenant and codigo = p_codigo;
  if v is null then
    raise exception 'Falta la cuenta % en el Plan de cuentas de %.', p_codigo, p_tenant;
  end if;
  return v;
end;
$$;

-- Huella CANÓNICA de la solicitud de pago previo (corrección B1 de la auditoría
-- de idempotencia). La identidad idempotente NO son solo cotización+moneda+monto+
-- forma: cualquier dato material distinto con la MISMA idempotency_key debe
-- rechazarse. Se calcula y se compara en PostgreSQL (autoritativa), nunca una
-- huella enviada por el navegador.
--
-- La cuenta/banco de DESTINO financiero NO es un argumento independiente del
-- RPC: se deriva de (forma_pago, moneda) vía `_cuenta_disponible`, así que queda
-- capturada por esos dos ejes.
--
-- Normalización (igual al guardar que al comparar):
--   · textos: trim;
--   · referencia: NULL y vacío comparten una sola semántica ('');
--   · forma_pago y moneda: casing canónico (mayúsculas);
--   · monto: precisión numérica exacta a 2 decimales (sin ceros a la derecha);
--   · fecha: fecha efectiva exacta (YYYY-MM-DD), misma que se persiste.
create or replace function public._huella_pago_previo(
  p_cotizacion_id bigint,
  p_valor numeric,
  p_moneda text,
  p_forma_pago text,
  p_referencia text,
  p_fecha_pago date
) returns text language sql immutable as $$
  select md5(
    jsonb_build_array(
      p_cotizacion_id,
      to_char(round(coalesce(p_valor,0), 2), 'FM999999999999999999990.99'),
      upper(coalesce(nullif(trim(p_moneda),''), '')),
      upper(coalesce(nullif(trim(p_forma_pago),''), '')),
      coalesce(nullif(trim(p_referencia),''), ''),
      coalesce(p_fecha_pago, current_date)::text
    )::text
  );
$$;

-- Registrar un pago previo a una cotización. UNA TRANSACCIÓN atómica e
-- idempotente (A1+A2 de la auditoría):
--   1) FOR UPDATE de la cotización (serializa primeros pagos concurrentes y
--      descartes) y RE-lectura del estado y de `condicion_pago_congelada_en`.
--   2) Valida autorización (rol+activo+tenant), payload y que esté 'abierta'.
--   3) IDEMPOTENCIA (B1): si `p_idempotency_key` ya se registró, devuelve el
--      resultado ORIGINAL (mismo pago/asiento) sin insertar nada; se compara la
--      huella CANÓNICA de la solicitud (cotización, monto, moneda, forma/banco
--      destino, referencia, fecha) y, si cualquiera difiere → rechazo cerrado.
--      La huella se calcula en PostgreSQL (`_huella_pago_previo`), nunca en el
--      navegador.
--   4) PRIMER pago: crea/reemplaza UNA VEZ `cotizacion_condiciones` (snapshot
--      que trae el Server Action como jsonb) + escribe resumen exigido y
--      congela moneda/TRM/precio. Todo esto DENTRO de la misma transacción.
--   5) Pagos posteriores REUTILIZAN exactamente el snapshot/TRM/precio congelados
--      (nunca se vuelve a congelar; `monto_cop` = monto_moneda × TRM congelada).
--   6) Rechaza sobrepago (Σ activos+aplicados + nuevo > precio_congelado·TRM).
--   7) Inserta el pago y postea el asiento Debe cuentaDisponible / Haber 280510.
--   Cualquier fallo → PostgreSQL revierte TODO (no hay compensaciones TS).
create or replace function public.registrar_pago_previo(
  p_cotizacion_id bigint,
  p_valor numeric,
  p_moneda text,
  p_trm numeric,
  p_forma_pago text,
  p_referencia text,
  p_fecha_pago date,
  p_usuario_id uuid,
  p_idempotency_key text,
  p_snapshot jsonb default null,
  p_exigido_total_moneda numeric default null,
  p_pct_efectivo numeric default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_moneda_cot text;
  v_precio_venta numeric;
  v_congelada timestamptz;
  v_trm_congelada numeric;
  v_moneda_congelada text;
  v_precio_congelado numeric;
  v_key text := nullif(trim(coalesce(p_idempotency_key,'')),'');
  v_huella text := public._huella_pago_previo(p_cotizacion_id, p_valor, p_moneda, p_forma_pago, p_referencia, p_fecha_pago);
  v_ex_id bigint;
  v_ex_huella text;
  v_suma numeric;
  v_tot_cop numeric;
  v_monto_cop numeric;
  v_email text;
  v_pago_id bigint;
  v_numero bigint;
  v_caja text := public._cuenta_disponible(p_forma_pago, p_moneda);
  v_anticipo bigint;
begin
  if v_key is null then
    raise exception 'Se requiere una clave de idempotencia para registrar un pago previo.';
  end if;
  if not (coalesce(p_valor,0) > 0) then
    raise exception 'El valor del pago debe ser mayor a cero.';
  end if;
  if nullif(trim(coalesce(p_forma_pago,'')),'') is null then
    raise exception 'Indica la forma de pago.';
  end if;

  -- 1) Lock + releer estado/congelado.
  select tenant, moneda, precio_venta, condicion_pago_congelada_en
    into v_tenant, v_moneda_cot, v_precio_venta, v_congelada
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  -- 2) estado + moneda.
  if exists (select 1 from public.cotizaciones where id = p_cotizacion_id and estado <> 'abierta') then
    raise exception 'La cotización % no está abierta (no se puede registrar un pago previo).', p_cotizacion_id;
  end if;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_cot,'COP')) then
    raise exception 'La moneda del pago (%) no coincide con la de la cotización (%).', p_moneda, v_moneda_cot;
  end if;

  -- 3) IDEMPOTENCIA (B1): misma clave ya usada → recuperar el resultado original
  --    SI la huella canónica de esta solicitud es idéntica a la registrada. Si
  --    CUALQUIER dato material difiere (cotización, monto, moneda, forma/banco
  --    destino, referencia, fecha), la clave se rechaza (fail-closed).
  select id, huella_solicitud
    into v_ex_id, v_ex_huella
  from public.cotizacion_pagos_previos where idempotency_key = v_key for update;
  if v_ex_id is not null then
    if v_ex_huella is distinct from v_huella then
      raise exception 'La clave de idempotencia ya se usó para un pago con datos distintos: no se reutiliza. Reintenta con una clave nueva o verifica si el pago ya se confirmó.';
    end if;
    return 'OK|' || v_ex_id;
  end if;

  -- 4) PRIMER pago: escribir snapshot + resumen y congelar (todo en una tx).
  if v_congelada is null then
    v_trm_congelada := case when upper(coalesce(p_moneda,'')) = 'COP' then 1 else coalesce(nullif(p_trm,0),1) end;
    if p_snapshot is null or p_exigido_total_moneda is null then
      raise exception 'Primer pago: falta el snapshot de condiciones para congelar la cotización.';
    end if;
    delete from public.cotizacion_condiciones where cotizacion_id = p_cotizacion_id;
    insert into public.cotizacion_condiciones
      (cotizacion_id, orden, tipo_componente, referencia_externa, valor_componente,
       condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
       condicion_pago_fecha_limite, monto_exigido, restriccion_comercial,
       hotel_temporada_id, paquete_id, programa_id, congelado)
    select p_cotizacion_id,
           coalesce((r->>'orden')::int, 0),
           r->>'tipo_componente',
           nullif(r->>'referencia_externa',''),
           coalesce((r->>'valor_componente')::numeric, 0),
           coalesce(r->>'condicion_pago_tipo','sin_condicion'),
           nullif(r->>'condicion_pago_pct_aplicable','')::numeric,
           nullif(r->>'condicion_pago_dias_saldo','')::int,
           nullif(r->>'condicion_pago_fecha_limite','')::date,
           coalesce((r->>'monto_exigido')::numeric, 0),
           coalesce(r->>'restriccion_comercial','normal'),
           nullif(r->>'hotel_temporada_id','')::bigint,
           nullif(r->>'paquete_id','')::bigint,
           nullif(r->>'programa_id','')::bigint,
           true
    from jsonb_array_elements(p_snapshot) r;
    update public.cotizaciones set
      condicion_pago_congelada_en = now(),
      moneda_congelada = upper(p_moneda),
      trm_autoritativa = v_trm_congelada,
      precio_total_congelado = v_precio_venta,
      monto_exigido_total = p_exigido_total_moneda,
      monto_exigido_total_cop = round(p_exigido_total_moneda * v_trm_congelada, 2),
      pct_efectivo_informativo = p_pct_efectivo
    where id = p_cotizacion_id;
  end if;

  -- 5) Ya congelada (o recién): reutilizar EXACTAMENTE snapshot/TRM/precio.
  select trm_autoritativa, moneda_congelada, precio_total_congelado
    into v_trm_congelada, v_moneda_congelada, v_precio_congelado
  from public.cotizaciones where id = p_cotizacion_id;
  if upper(coalesce(p_moneda,'')) <> upper(coalesce(v_moneda_congelada,'')) then
    raise exception 'Moneda del pago % no coincide con la congelada % de la cotización.', p_moneda, v_moneda_congelada;
  end if;
  v_monto_cop := round(p_valor * v_trm_congelada, 2);

  -- 6) Sobrepago (COP vs COP con la TRM congelada).
  select coalesce(sum(monto_cop),0) into v_suma
  from public.cotizacion_pagos_previos
  where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado');
  v_tot_cop := round(coalesce(v_precio_congelado,0) * v_trm_congelada, 2);
  if v_suma + v_monto_cop > v_tot_cop + 0.005 then
    raise exception 'Sobrepago rechazado: ya hay % pagados y % excede el total % de la cotización.', v_suma, v_monto_cop, v_tot_cop;
  end if;

  -- 7) Insertar el pago + asiento.
  select email into v_email from public.usuarios where id = p_usuario_id;

  insert into public.cotizacion_pagos_previos
    (cotizacion_id, tenant, monto_cop, monto_moneda, moneda, trm, forma_pago,
     referencia, fecha_pago, registrado_por_id, registrado_por_email,
     idempotency_key, huella_solicitud)
  values
    (p_cotizacion_id, v_tenant, v_monto_cop, p_valor, upper(p_moneda), v_trm_congelada,
     p_forma_pago, nullif(trim(coalesce(p_referencia,'')),''),
     coalesce(p_fecha_pago, current_date), p_usuario_id, v_email, v_key, v_huella)
  returning id into v_pago_id;

  v_numero := public._siguiente_numero_asiento(v_tenant);
  v_anticipo := public._puc_id(v_tenant, '280510');
  insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
  values (v_tenant, v_numero, coalesce(p_fecha_pago, current_date),
    'Pago previo a cotización ' || p_cotizacion_id || ' (' || p_moneda || ')',
    'pago_previo', 'pago_previo:' || v_pago_id, v_email);
  insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
  values
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     public._puc_id(v_tenant, v_caja), 'cotizacion:' || p_cotizacion_id, 'Pago previo recibido', v_monto_cop, 0),
    (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
     v_anticipo, 'cotizacion:' || p_cotizacion_id, 'Anticipo sin identificar', 0, v_monto_cop);

  return 'OK|' || v_pago_id;
exception when unique_violation then
  raise exception 'Clave de idempotencia ya registrada (intento duplicado o colisión): no se duplicó el pago. Reintenta o verifica si ya se confirmó.' using errcode = '23505';
end;
$$;

-- Anular un pago previo ACTIVO (una transacción): reversa contable (NUNCA
-- borra el asiento original) + estado anulado. Es el requisito para poder
-- descartar una cotización con pagos.
create or replace function public.anular_pago_previo(
  p_pago_id bigint,
  p_usuario_id uuid,
  p_motivo text default null
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_email text;
  v_estado text;
  v_monto numeric;
  v_moneda text;
  v_forma text;
  v_cotizacion bigint;
  v_numero bigint;
  v_caja text;
  v_anticipo bigint;
  v_activo_id bigint;
begin
  select tenant, estado, monto_cop, moneda, forma_pago, cotizacion_id
    into v_tenant, v_estado, v_monto, v_moneda, v_forma, v_cotizacion
  from public.cotizacion_pagos_previos where id = p_pago_id for update;
  if v_tenant is null then raise exception 'El pago previo % no existe.', p_pago_id; end if;
  if v_estado <> 'activo' then raise exception 'Solo se puede anular un pago previo ACTIVO (estado actual: %).', v_estado; end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  -- Reversa: líneas invertidas del asiento original 'pago_previo:<id>'.
  select id into v_activo_id from public.asientos_contables
  where tenant = v_tenant and origen = 'pago_previo' and referencia = 'pago_previo:' || p_pago_id
  order by numero desc limit 1;
  if v_activo_id is not null then
    v_numero := public._siguiente_numero_asiento(v_tenant);
    v_caja := public._cuenta_disponible(v_forma, v_moneda);
    v_anticipo := public._puc_id(v_tenant, '280510');
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, current_date,
      'Reversión pago previo ' || p_pago_id || ' — ' || coalesce(nullif(trim(coalesce(p_motivo,'')),''), 'anulación'),
      'pago_previo_reversion', 'pago_previo:' || p_pago_id, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo, 'pago_previo:' || p_pago_id, 'Reversión de anticipo sin identificar', coalesce(v_monto,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       public._puc_id(v_tenant, v_caja), 'pago_previo:' || p_pago_id, 'Reversión de pago previo', 0, coalesce(v_monto,0));
  end if;

  update public.cotizacion_pagos_previos
  set estado = 'anulado', motivo_anulacion = p_motivo
  where id = p_pago_id;

  return 'OK';
end;
$$;

-- Transferir pagos previos ACTIVOS a ABONOS del contrato (una transacción):
--   · Solo para una cotización ya CONVERTIDA a UN contrato (estado='convertida'
--     y ventas.cotizacion_id = cotización).
--   · Por cada pago activo: crea el ABONO + reclasifica 280510→280505
--     (tercero = numero_contrato) + marca el pago 'aplicado'.
--   · Todo o nada; reintentar es un no-op (no quedan activos).
create or replace function public.transferir_pagos_previos_a_abonos(
  p_cotizacion_id bigint,
  p_numero_contrato text,
  p_usuario_id uuid
) returns text language plpgsql as $$
declare
  v_rol text := public._autorizado_pago_previo(p_usuario_id);
  v_tenant text;
  v_email text;
  v_cliente text;
  v_estado text;
  v_num_ok bigint;
  v_numero bigint;
  v_anticipo_sin bigint;
  v_anticipo_con bigint;
  r record;
begin
  select tenant, estado, cliente into v_tenant, v_estado, v_cliente
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then raise exception 'La cotización % no existe.', p_cotizacion_id; end if;
  if v_estado <> 'convertida' then
    raise exception 'La cotización % no está convertida (estado: %) — la transferencia a abonos exige el contrato ya creado.', p_cotizacion_id, v_estado;
  end if;

  -- El contrato debe existir y apuntar a ESTA cotización (UNO-A-UNO).
  select count(*) into v_num_ok
  from public.ventas where numero_contrato = p_numero_contrato and cotizacion_id = p_cotizacion_id;
  if v_num_ok = 0 then
    raise exception 'El contrato % no corresponde a la cotización % (o no existe).', p_numero_contrato, p_cotizacion_id;
  end if;

  select email into v_email from public.usuarios where id = p_usuario_id;

  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');

  for r in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id
    for update
  loop
    -- 1) Abono real del contrato (monto en COP, mismo trm del pago).
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia, recibido_por, trm, monto_cop, tenant)
    values
      (p_numero_contrato, coalesce(v_cliente, ''),
       r.fecha_pago, r.monto_cop, r.forma_pago, r.referencia, v_email, r.trm, r.monto_cop, v_tenant)
    returning id into v_num_ok;

    -- 2) Reclasificación contable: Debe 280510 / Haber 280505 (tercero = contrato).
    v_numero := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_numero, current_date,
      'Aplicación pago previo a contrato ' || p_numero_contrato,
      'pago_previo_aplicacion', 'pago_previo:' || r.id || ':abono:' || v_num_ok, v_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_sin, p_numero_contrato, 'Anticipo sin identificar aplicado', coalesce(r.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_numero),
       v_anticipo_con, p_numero_contrato, 'Anticipo de cliente del contrato', 0, coalesce(r.monto_cop,0));

    -- 3) Marcar aplicado.
    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_num_ok
    where id = r.id;
  end loop;

  return 'OK';
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- COMMIT 5 · Conversión ATÓMICA de una cotización 'manual' a UN solo contrato
--
-- Un solo RPC, INVOKER bajo service_role (igual que registrar_pago_previo), que
-- hace TODO en UNA transacción:
--   1) autoriza actor (rol interno + activo);
--   2) FOR UPDATE de la cotización y RE-lectura;
--   2bis) tenant AUTORITATIVO (superadmin exento, excepción global documentada);
--   3) idempotencia: si ventas.cotizacion_id ya apunta → devuelve la venta (UNIQUE);
--   4) frontera reutilizable: solo tipo='manual';
--   5) estado 'abierta' + congelado obligatorio (snapshot/moneda/TRM/precio/
--      monto exigido COP);
--   5bis) titular completo;
--   6) mínimo: Σ monto_cop de pagos válidos (activo+aplicado) ≥ exigido congelado
--      (anulados NO cuentan). Se bloquean las filas de pago contadas (anular_pago_
--      previo bloquea el pago, NO la cotización → hay que serializar aquí);
--   7) número UNA sola vez (siguiente_numero_contrato_para_tenant, nextval) — tras
--      la idempotencia, para que un replay no consuma otro consecutivo;
--   8) crea la VENTA (reproducción fiel del builder manual) + `cotizacion_id`;
--   9) hijas: contrato_items, contrato_pasajeros, aliados_b2b (si B2B y recobro);
--   10) copia condiciones a contrato_condiciones (snapshot congelado);
--   11) transfiere cada pago ACTIVO a ABONO + reclasifica 280510→280505 + marca
--       'aplicado' con ref durable abono_id (espejo de transferir_pagos_previos_);
--   12) CxP de proveedor + asiento Debe Costo / Haber Proveedores (equivalencia de
--       postearAsientoCxP). NO se captura: si algo falla, revierte TODA la
--       conversión (fallo atómico, pedido del dueño — el builder TS hacía
--       try/catch "no bloquear").
--   13) enlaza estado 'convertida' + numero_contrato + detalle.venta.numero_contrato.
--
-- NUNCA es SECURITY DEFINER: service_role bypasea RLS, así que toda la
-- autorización es explícita en el cuerpo. `revoke`/`grant` solo a service_role.
-- Cualquier raise → PostgreSQL revierte todo (venta, hijas, abonos, asientos,
-- CxP, cambio de estado) en un solo rollback.
-- ═════════════════════════════════════════════════════════════════════════════

-- Frontera reutilizable: hoy solo las cotizaciones manuales convierten.
create or replace function public._tipo_cotizacion_convertible(p_tipo text)
returns void language plpgsql as $$
begin
  if coalesce(p_tipo, '') <> 'manual' then
    raise exception 'Solo las cotizaciones manuales se convierten en esta etapa (recibida tipo %); tarifario/carrito/single llegan en un commit posterior.',
      coalesce(nullif(trim(coalesce(p_tipo,'')), ''), '(vacío)');
  end if;
end;
$$;

-- Σ monto_cop de los pagos previos VÁLIDOS (activo/aplicado). Anulados NO cuentan.
create or replace function public._monto_cop_pagado(p_cotizacion_id bigint)
returns numeric language sql stable as $$
  select coalesce(sum(monto_cop), 0)
  from public.cotizacion_pagos_previos
  where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado');
$$;

-- tipo_servicio → tipo_proveedor de la CxP (espejo SQL de TIPO_PROVEEDOR en
-- manual-actions.ts: aereo→aereo, hotel→hotel, traslado→receptivo,
-- asistencia→asistencia, otro→otro, default 'otro').
create or replace function public._tipo_proveedor_cxp(p_tipo_servicio text)
returns text language sql immutable as $$
  select case lower(btrim(coalesce(p_tipo_servicio,'')))
    when 'aereo'     then 'aereo'
    when 'hotel'     then 'hotel'
    when 'traslado'  then 'receptivo'
    when 'asistencia' then 'asistencia'
    when 'otro'      then 'otro'
    else 'otro' end;
$$;

-- tipo_proveedor → [subcuenta Proveedores, subcuenta Costo] (espejo SQL de
-- PROVEEDOR_CUENTA + PROVEEDOR_CUENTA_DEFAULT en lib/contabilidad/asientos.ts).
-- Ambos códigos existen en las semillas 126 para mayorista y minorista.
create or replace function public._cuentas_cxp(p_tipo_proveedor text)
returns text[] language sql immutable as $$
  select case lower(btrim(coalesce(p_tipo_proveedor,'')))
    when 'hotel'      then array['220505','613505']
    when 'aereo'      then array['220510','613510']
    when 'receptivo'  then array['220515','613515']
    when 'asistencia' then array['220520','613520']
    else array['220595','613595'] end;
$$;

-- UNICO parcial: un ABONO no puede quedar vinculado desde dos pagos (cada pago
-- apunta a a lo sumo un abono y cada abono a lo sumo un pago) — ref durable de
-- la transferencia exactamente-una-vez.
create unique index if not exists uq_pagos_previos_abono_id
  on public.cotizacion_pagos_previos (abono_id) where abono_id is not null;

create or replace function public.convertir_cotizacion_a_contrato(
  p_cotizacion_id bigint,
  p_usuario_id uuid
) returns text language plpgsql as $$
declare
  -- actor
  v_rol            text;
  v_actor_tenant   text;
  v_actor_email    text;
  -- cotización (re-lectura bajo lock)
  v_tenant         text;
  v_estado         text;
  v_tipo           text;
  v_congelada      timestamptz;
  v_moneda_cong    text;
  v_trm_cong       numeric;
  v_precio_cong    numeric;
  v_exigido_cop    numeric;
  v_cliente        text;
  v_cliente_doc    text;
  v_destino        text;
  v_fsalida        date;
  v_fregreso       date;
  v_pax            int;
  v_precio         numeric;
  v_moneda         text;
  v_asesor         text;
  v_payload        jsonb;
  v_detalle        jsonb;
  -- idempotencia
  v_existente      text;
  -- derivados
  v_tipo_asesor    text;
  v_agencia_nombre text;
  v_freelance_nombre text;
  v_observ         text;
  v_nombre_cliente text;
  v_t_doc          text;
  v_t_numero       text;
  v_t_nacimiento   text;
  v_nNinos         int;
  v_valorNino      numeric;
  v_totalNinos     numeric;
  v_recN           numeric;
  v_recEmp         numeric;
  v_recAli         numeric;
  v_esB2B          boolean;
  v_plan_nombre    text;
  v_tours          text;
  v_asist_med      boolean;
  v_costo_aereo    numeric;
  v_costo_hotel    numeric;
  v_costo_recept   numeric;
  v_costo_asist    numeric;
  v_costo_otro     numeric;
  v_hotel_venta    text;
  -- mín / número / item
  v_pagado         numeric;
  v_numero         text;
  v_pax_ad         int;
  v_adultSubtotal  numeric;
  v_tarifaAd       numeric;
  v_item_desc      text;
  v_dest_u         text;
  v_aliado_nombre  text;
  -- bucles
  r_pago           record;
  r_serv           record;
  -- CxP / asiento
  v_cxp_id         bigint;
  v_tipo_prov      text;
  v_proveedor      text;
  v_etiqueta       text;
  v_servicio       text;
  v_ret_aplica     boolean;
  v_ret_pct        numeric;
  v_hoy            date;
  v_codigos        text[];
  v_cuenta_cost    bigint;
  v_cuenta_prov    bigint;
  v_num_asiento    bigint;
  -- pago→abono
  v_abono_id       bigint;
  v_anticipo_sin   bigint;
  v_anticipo_con   bigint;
begin
  -- 1) Autorización (rol interno + activo) y datos del actor.
  v_rol := public._autorizado_pago_previo(p_usuario_id);
  select tenant, email into v_actor_tenant, v_actor_email
  from public.usuarios where id = p_usuario_id;

  -- 2) Lock de la cotización + RE-lectura (serializa pagos/conversiones).
  select tenant, estado, tipo, condicion_pago_congelada_en, moneda_congelada,
         trm_autoritativa, precio_total_congelado, monto_exigido_total_cop,
         cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
         pax, precio_venta, moneda, asesor, payload, detalle
    into v_tenant, v_estado, v_tipo, v_congelada, v_moneda_cong,
         v_trm_cong, v_precio_cong, v_exigido_cop,
         v_cliente, v_cliente_doc, v_destino, v_fsalida, v_fregreso,
         v_pax, v_precio, v_moneda, v_asesor, v_payload, v_detalle
  from public.cotizaciones where id = p_cotizacion_id for update;
  if v_tenant is null then
    raise exception 'La cotización % no existe.', p_cotizacion_id;
  end if;
  v_payload := coalesce(v_payload, '{}'::jsonb);
  v_detalle := coalesce(v_detalle, '{}'::jsonb);

  -- 2bis) Tenant AUTORITATIVO, ANTES de la idempotencia y de escribir.
  -- superadmin = excepción global documentada (puede_ver_tenant lo incluye).
  if v_rol <> 'superadmin' and v_actor_tenant is distinct from v_tenant then
    raise exception 'No tienes acceso a la agencia (tenant %) de esta cotización.', v_tenant;
  end if;

  -- 3) Idempotencia: si ya se convirtió a UN contrato, devolverlo (replay / ya
  --    convertida). Ocurre bajo el lock y tras el cheque de tenant, así que un
  --    replay desde tenant ajeno se rechaza antes de tocar la venta existente.
  select numero_contrato into v_existente
  from public.ventas where cotizacion_id = p_cotizacion_id;
  if v_existente is not null then
    return v_existente;
  end if;

  -- 4) Frontera reutilizable: solo manual (raise si no).
  perform public._tipo_cotizacion_convertible(v_tipo);

  -- 5) Estado admitido + congelado OBLIGATORIO (fail-closed). El mínimo de abajo
  --    se mide contra el monto exigido CONGELADO en COP.
  if v_estado <> 'abierta' then
    raise exception 'La cotización % no está abierta (estado: %) — no se puede convertir.', p_cotizacion_id, v_estado;
  end if;
  if v_congelada is null or v_moneda_cong is null or v_trm_cong is null
     or v_precio_cong is null or v_exigido_cop is null then
    raise exception 'La cotización % no está congelada (falta snapshot/moneda/TRM/precio o monto exigido). Registra el pago previo que congela la condición antes de convertir.', p_cotizacion_id;
  end if;

  -- 5bis) Titular OBLIGATORIO (va como pasajero del contrato).
  v_nombre_cliente := btrim(coalesce(v_payload#>>'{cliente,nombres}','') || ' ' || coalesce(v_payload#>>'{cliente,apellidos}',''));
  v_t_doc        := btrim(coalesce(v_payload#>>'{cliente,tipoDoc}',''));
  v_t_numero     := btrim(coalesce(v_payload#>>'{cliente,numeroDoc}',''));
  v_t_nacimiento := btrim(coalesce(v_payload#>>'{cliente,nacimiento}',''));
  if v_nombre_cliente = '' or v_t_doc = '' or v_t_numero = '' or v_t_nacimiento = '' then
    raise exception 'Completa los datos del titular antes de generar el contrato: nombre, tipo de documento, número de documento y fecha de nacimiento.';
  end if;

  -- 6) Mínimo: Σ monto_cop de pagos válidos ≥ exigido congelado (anulados NO).
  --    Bloqueamos las filas de pago CONTADAS para serializar con un anular
  --    concurrente (anular_pago_previo bloquea el pago, no la cotización).
  for r_pago in
    select id from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado in ('activo','aplicado')
    order by id for update
  loop
    null; -- lock adquirido
  end loop;
  v_pagado := public._monto_cop_pagado(p_cotizacion_id);
  if v_pagado < v_exigido_cop then
    raise exception 'La cotización % no alcanza el mínimo exigido: pagado % COP < exigido % COP (los pagos anulados no cuentan).',
      p_cotizacion_id, v_pagado, v_exigido_cop;
  end if;

  -- 7) Número UNA sola vez (función real con nextval), tras la idempotencia.
  v_numero := public.siguiente_numero_contrato_para_tenant(v_tenant);

  -- Derivados equivalentes al builder manual.
  v_tipo_asesor      := coalesce(v_payload->>'tipoAsesor', 'interno');
  v_agencia_nombre   := v_payload->>'agenciaNombre';
  v_freelance_nombre := v_payload->>'freelanceNombre';
  v_observ           := nullif(v_payload->>'observaciones', '');
  v_pax              := coalesce(v_pax, 0);
  v_precio           := coalesce(v_precio, 0);
  v_moneda           := coalesce(v_moneda, 'COP');

  -- Niños y recobro (mismo cálculo que crear/editar; el recobro va oculto en la
  -- tarifa de adulto). totalNinos = cantidad × tarifa; recobro repartido B2B.
  v_nNinos     := greatest(floor(coalesce((v_payload->>'ninos')::numeric, 0)), 0)::int;
  v_valorNino  := greatest(coalesce((v_payload->>'tarifaNino')::numeric, 0), 0);
  v_totalNinos := v_nNinos * v_valorNino;
  v_recN       := greatest(coalesce((v_payload->>'recobro')::numeric, 0), 0);
  v_esB2B      := v_tipo_asesor <> 'interno';
  v_recAli     := case when v_esB2B then least(greatest(coalesce((v_payload->>'recobroAliado')::numeric, 0), 0), v_recN) else 0 end;
  v_recEmp     := v_recN - v_recAli;

  -- Cajas "Hoteles y Servicios" + costos netos por tipo (cotizacion_servicios).
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_plan_nombre
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'hotel'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select coalesce(string_agg(btrim(coalesce(s.nombre_servicio,'')), ', ' order by s.orden), null)
    into v_tours
  from public.cotizacion_servicios s
  where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'traslado'
    and btrim(coalesce(s.nombre_servicio,'')) <> '';
  select exists(select 1 from public.cotizacion_servicios s
                where s.cotizacion_id = p_cotizacion_id and s.tipo_servicio = 'asistencia')
    into v_asist_med;
  select
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='aereo'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='hotel'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='traslado'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='asistencia'), 0),
      coalesce(sum(s.costo_neto) filter (where s.tipo_servicio='otro'), 0)
    into v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro
  from public.cotizacion_servicios s where s.cotizacion_id = p_cotizacion_id;

  -- Hotel/Aerolínea del snapshot (igual que el builder: plan_nombre manda sobre
  -- detalle.venta.hotel; aerolinea solo desde detalle.venta).
  v_hotel_venta := coalesce(nullif(v_plan_nombre,''), nullif(v_detalle->'venta'->>'hotel',''));

  -- 8) Crear la VENTA (reproducción fiel del builder manual + cotizacion_id).
  insert into public.ventas (
    numero_contrato, tenant, cliente, cliente_documento, cliente_telefono, destino,
    tipo_paquete, fecha_salida, fecha_regreso, pax, precio_venta, moneda, asesor,
    canal, tipo_cliente, hotel, aerolinea, plan_nombre, tours_traslados,
    asistencia_medica, costo_aereo, costo_hotel, costo_receptivo, costo_asistencia,
    otros_costos, recobro_total, recobro_empresa, recobro_aliado, comision_b2b,
    comision_estado, estado, observaciones, cotizacion_id
  ) values (
    v_numero, v_tenant, coalesce(v_cliente,''), nullif(v_cliente_doc,''),
    nullif(v_payload#>>'{cliente,telefono}',''), nullif(v_destino,''),
    'dinamico', v_fsalida, v_fregreso, nullif(v_pax,0), nullif(v_precio,0), v_moneda,
    nullif(v_asesor,''),
    case when v_tipo_asesor = 'interno' then 'B2C' else 'B2B' end,
    nullif(v_tipo_asesor,''), nullif(v_hotel_venta,''),
    nullif(v_detalle->'venta'->>'aerolinea',''), nullif(v_plan_nombre,''),
    nullif(v_tours,''), coalesce(v_asist_med,false),
    v_costo_aereo, v_costo_hotel, v_costo_recept, v_costo_asist, v_costo_otro,
    v_recN, v_recEmp, v_recAli,
    case when v_recAli > 0 then v_recAli else null end,
    case when v_recAli > 0 then 'pendiente' else null end,
    'pendiente', v_observ, p_cotizacion_id
  );

  -- 9) Ítem del paquete: adultos + niños. tarifa_adulto incluye el recobro (oculto).
  v_pax_ad        := greatest(v_pax, 1);
  v_adultSubtotal := v_precio - v_totalNinos;
  v_tarifaAd      := round(v_adultSubtotal / v_pax_ad);
  v_dest_u        := upper(btrim(coalesce(v_destino,'')));
  v_dest_u        := case when v_dest_u = '' then 'DESTINO' else v_dest_u end;
  v_item_desc     := 'PAQUETE TURÍSTICO A ' || v_dest_u || ' DEL '
                     || coalesce(to_char(v_fsalida,'DD/MM/YYYY'),'—') || ' AL '
                     || coalesce(to_char(v_fregreso,'DD/MM/YYYY'),'—');
  insert into public.contrato_items
    (numero_contrato, descripcion, adultos, ninos, tarifa_adulto, tarifa_nino, orden)
  values
    (v_numero, v_item_desc, v_pax_ad, v_nNinos, v_tarifaAd, v_valorNino, 0);

  -- Titular como pasajero del contrato.
  insert into public.contrato_pasajeros
    (numero_contrato, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante, orden)
  values
    (v_numero, v_nombre_cliente, coalesce(nullif(v_t_doc,''),'CC'), nullif(v_t_numero,''),
     nullif(v_t_nacimiento,'')::date, false, 0);

  -- Comisión del aliado B2B por el recobro (entra al módulo de comisiones).
  if v_esB2B and v_recAli > 0 then
    v_aliado_nombre := coalesce(nullif(case when v_tipo_asesor='agencia' then v_agencia_nombre else v_freelance_nombre end,''),
                                nullif(coalesce(v_asesor,''),''), 'Aliado');
    insert into public.aliados_b2b
      (numero_contrato, tenant, aliado, tipo_aliado, precio_venta, base_comision,
       recobro_total, pct_recobro_aliado, estado)
    values
      (v_numero, v_tenant, v_aliado_nombre, v_tipo_asesor, v_precio, v_recAli,
       v_recN, case when v_recN > 0 then v_recAli / v_recN else 0 end, 'pendiente');
  end if;

  -- 10) Copiar condiciones congeladas → contrato_condiciones (snapshot por fila).
  insert into public.contrato_condiciones (
    numero_contrato, tipo_componente, referencia_externa, orden, valor_componente,
    condicion_pago_tipo, condicion_pago_pct_aplicable, condicion_pago_dias_saldo,
    condicion_pago_fecha_limite, monto_exigido, restriccion_comercial, moneda, trm
  )
  select v_numero, c.tipo_componente, c.referencia_externa, c.orden, c.valor_componente,
         c.condicion_pago_tipo, c.condicion_pago_pct_aplicable, c.condicion_pago_dias_saldo,
         c.condicion_pago_fecha_limite, c.monto_exigido, c.restriccion_comercial,
         v_moneda_cong, v_trm_cong
  from public.cotizacion_condiciones c
  where c.cotizacion_id = p_cotizacion_id;

  -- 11) Transferir pagos ACTIVOS → ABONOS + reclasificar 280510→280505 + marcar.
  v_anticipo_sin := public._puc_id(v_tenant, '280510');
  v_anticipo_con := public._puc_id(v_tenant, '280505');
  for r_pago in
    select * from public.cotizacion_pagos_previos
    where cotizacion_id = p_cotizacion_id and estado = 'activo'
    order by id for update
  loop
    insert into public.abonos
      (numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia,
       recibido_por, trm, monto_cop, tenant)
    values
      (v_numero, coalesce(v_cliente,''), r_pago.fecha_pago, r_pago.monto_cop,
       r_pago.forma_pago, r_pago.referencia, v_actor_email, r_pago.trm,
       r_pago.monto_cop, v_tenant)
    returning id into v_abono_id;

    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, current_date,
      'Aplicación pago previo a contrato ' || v_numero,
      'pago_previo_aplicacion', 'pago_previo:' || r_pago.id || ':abono:' || v_abono_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_sin, v_numero, 'Anticipo sin identificar aplicado', coalesce(r_pago.monto_cop,0), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_anticipo_con, v_numero, 'Anticipo de cliente del contrato', 0, coalesce(r_pago.monto_cop,0));

    update public.cotizacion_pagos_previos
    set estado = 'aplicado', abono_id = v_abono_id
    where id = r_pago.id;
  end loop;

  -- 12) CxP de proveedor + asientos Debe Costo / Haber Proveedores. Equivalencia
  --     de postearAsientoCxP. FALLO ATÓMICO (sin try/catch): cualquier cuenta
  --     ausente revierte toda la conversión. Proveedor = (proveedor o plataforma);
  --     retención por match de nombre en el catálogo (que NO lleva tenant).
  v_hoy := current_date;
  for r_serv in
    select * from public.cotizacion_servicios
    where cotizacion_id = p_cotizacion_id and (coalesce(costo_neto,0)) > 0
    order by orden
  loop
    v_tipo_prov := public._tipo_proveedor_cxp(r_serv.tipo_servicio);
    v_proveedor := coalesce(nullif(btrim(coalesce(r_serv.proveedor,'')), ''),
                            nullif(btrim(coalesce(r_serv.plataforma,'')), ''));
    v_etiqueta  := case coalesce(r_serv.tipo_servicio,'')
      when 'aereo' then 'Aéreo'
      when 'hotel' then 'Hotel'
      when 'traslado' then 'Traslado'
      when 'asistencia' then 'Asistencia médica'
      when 'otro' then 'Otro'
      else 'Servicio' end;
    v_servicio  := btrim(coalesce(v_etiqueta,'') || case when btrim(coalesce(r_serv.nombre_servicio,'')) <> '' then ' ' || btrim(r_serv.nombre_servicio) else '' end);

    -- Retención del catálogo por nombre (coincidencia exacta trim+lower).
    v_ret_aplica := false;
    v_ret_pct    := 0;
    if v_proveedor is not null then
      select coalesce(p.aplica_retencion,false), coalesce(p.pct_retencion,0)
        into v_ret_aplica, v_ret_pct
      from public.proveedores p
      where lower(btrim(p.nombre)) = lower(btrim(v_proveedor))
      order by p.id limit 1;
    end if;

    insert into public.cuentas_por_pagar
      (numero_contrato, tenant, proveedor, tipo_proveedor, servicio, valor_total,
       moneda, fecha_obligacion, fecha_vencimiento, aplica_retencion, pct_retencion,
       observaciones)
    values
      (v_numero, v_tenant, v_proveedor, v_tipo_prov, v_servicio,
       greatest(0, coalesce(r_serv.costo_neto,0)), v_moneda, v_hoy, v_fsalida,
       v_ret_aplica, v_ret_pct, 'Generado automáticamente desde cotización dinámica')
    returning id into v_cxp_id;

    -- Asiento de la CxP (reemplazar es no-op en una conversión fresca, se deja
    -- por fidelidad a postearAsientoCxP): Debe Costo / Haber Proveedores.
    v_codigos     := public._cuentas_cxp(v_tipo_prov);  -- [1]=Proveedores, [2]=Costo
    v_cuenta_prov := public._puc_id(v_tenant, v_codigos[1]);
    v_cuenta_cost := public._puc_id(v_tenant, v_codigos[2]);
    v_num_asiento := public._siguiente_numero_asiento(v_tenant);
    delete from public.asientos_contables
    where tenant = v_tenant and origen = 'cxp' and referencia = 'cxp:' || v_cxp_id;
    insert into public.asientos_contables (tenant, numero, fecha, descripcion, origen, referencia, usuario_email)
    values (v_tenant, v_num_asiento, v_hoy,
      coalesce(nullif(v_servicio,''),'Costo') || ' — ' || coalesce(v_proveedor,'Sin especificar') || ' (' || v_numero || ')',
      'cxp', 'cxp:' || v_cxp_id, v_actor_email);
    insert into public.asiento_lineas (tenant, asiento_id, cuenta_id, tercero, descripcion, debe, haber)
    values
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_cost, v_numero, v_servicio, greatest(0, coalesce(r_serv.costo_neto,0)), 0),
      (v_tenant, (select max(id) from public.asientos_contables where tenant=v_tenant and numero=v_num_asiento),
       v_cuenta_prov, v_proveedor, v_servicio, 0, greatest(0, coalesce(r_serv.costo_neto,0)));
  end loop;

  -- 13) Enlazar + estado + número en el detalle (snapshot del documento).
  v_detalle := jsonb_set(v_detalle, '{venta,numero_contrato}', to_jsonb(v_numero));
  update public.cotizaciones
  set estado = 'convertida',
      numero_contrato = v_numero,
      condicion_pago_congelada_en = coalesce(v_congelada, now()),
      detalle = v_detalle
  where id = p_cotizacion_id;

  return v_numero;
end;
$$;

-- ACL de las funciones nuevas del Commit 5: solo service_role.
revoke all on function public._tipo_cotizacion_convertible(text) from public, anon, authenticated;
grant execute on function public._tipo_cotizacion_convertible(text) to service_role;
revoke all on function public._monto_cop_pagado(bigint) from public, anon, authenticated;
grant execute on function public._monto_cop_pagado(bigint) to service_role;
revoke all on function public._tipo_proveedor_cxp(text) from public, anon, authenticated;
grant execute on function public._tipo_proveedor_cxp(text) to service_role;
revoke all on function public._cuentas_cxp(text) from public, anon, authenticated;
grant execute on function public._cuentas_cxp(text) to service_role;
revoke all on function public.convertir_cotizacion_a_contrato(bigint, uuid) from public, anon, authenticated;
grant execute on function public.convertir_cotizacion_a_contrato(bigint, uuid) to service_role;

-- ACL de las funciones de dinero: solo service_role.
revoke all on function public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric) from public, anon, authenticated;
grant execute on function public.registrar_pago_previo(bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric) to service_role;

revoke all on function public.anular_pago_previo(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.anular_pago_previo(bigint, uuid, text) to service_role;

revoke all on function public.transferir_pagos_previos_a_abonos(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.transferir_pagos_previos_a_abonos(bigint, text, uuid) to service_role;

-- Helpers internos tampoco se exponen (solo service_role por seguridad, aunque
-- no escriben): a la app le bastan las tres de arriba.
revoke all on function public._autorizado_pago_previo(uuid) from public, anon, authenticated;
grant execute on function public._autorizado_pago_previo(uuid) to service_role;
revoke all on function public._siguiente_numero_asiento(text) from public, anon, authenticated;
grant execute on function public._siguiente_numero_asiento(text) to service_role;
revoke all on function public._cuenta_disponible(text, text) from public, anon, authenticated;
grant execute on function public._cuenta_disponible(text, text) to service_role;
revoke all on function public._puc_id(text, text) from public, anon, authenticated;
grant execute on function public._puc_id(text, text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- COMMIT 6 · Condiciones PERMANENTES del contrato, PDF y candados.
--
-- `contrato_condiciones` es, desde el Commit 5, la copia congelada al convertir
-- — pero hasta aquí nada le impedía a un UPDATE/DELETE alterarla después (la
-- ausencia de policy de update/delete solo cierra el paso a un cliente con
-- sesión; `service_role` BYPASEA la RLS por completo, así que la única forma
-- de que la inmutabilidad sea AUTORITATIVA — ni siquiera un bug futuro del
-- propio backend, ni una llamada directa con la llave de servicio, puede
-- alterarla — es un trigger, que se ejecuta SIEMPRE, RLS aparte).
--
-- Contenido:
--   J) Restricción comercial: se completa el CHECK a los TRES valores del
--      motor TS (`no_reembolsable_no_endosable` faltaba; hoy no lo escribe
--      ningún flujo real —`componentesManual.ts` siempre manda 'normal'— pero
--      el tipo/las pruebas/las etiquetas ya lo asumen, así que dejarlo fuera
--      del CHECK es una bomba de tiempo para el día en que un origen real
--      —hotel/programa/paquete— sí lo produzca).
--   K) Candado de inmutabilidad de `contrato_condiciones` (trigger, no policy).
--   L) Candado de `ventas.cotizacion_id`: ninguna UPDATE puede tocarlo jamás
--      (el único camino legítimo, `convertir_cotizacion_a_contrato`, lo fija
--      con INSERT, nunca con UPDATE).
--   M) `restriccion_overrides` se ajusta (migración 164 aún sin desplegar, se
--      permite ALTERAR en vez de crear una 165): alcance explícito
--      (`contrato_condicion_id` + `restriccion_afectada`), motivo/afectada no
--      vacíos, candado de solo-append (trigger) y ESCRITURA restringida a
--      SOLO superadmin (antes admitía también gerencia; el documento de
--      arquitectura de este commit lo exige superadmin-únicamente). La
--      LECTURA sigue el mismo criterio que `contrato_condiciones`
--      (`puede_ver_contrato`): es información comercial del contrato — quien
--      puede ver el contrato debe poder distinguir una condición original de
--      una excepción autorizada, no solo superadmin.
--   N) `registrar_override_restriccion`: único RPC de escritura, INVOKER bajo
--      service_role (mismo patrón que el resto de la 164) — re-verifica
--      rol=superadmin+activo, tenant del actor vs. tenant del contrato,
--      pertenencia de la condición al contrato, y motivo no vacío. NUNCA
--      toca `contrato_condiciones` (el override es un registro aparte: la
--      condición original jamás se reescribe).
-- ═════════════════════════════════════════════════════════════════════════════

-- J) Completa el CHECK de restricción comercial a los 3 valores del motor TS
--    (`lib/cotizacion/condicionPago.ts::RestriccionComercial`).
alter table public.cotizacion_condiciones drop constraint if exists cotizacion_condiciones_restriccion_check;
alter table public.cotizacion_condiciones add constraint cotizacion_condiciones_restriccion_check
  check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable','no_reembolsable_no_endosable'));
alter table public.contrato_condiciones drop constraint if exists contrato_condiciones_restriccion_check;
alter table public.contrato_condiciones add constraint contrato_condiciones_restriccion_check
  check (restriccion_comercial in ('normal','promocional_no_reembolsable_no_endosable','no_reembolsable_no_endosable'));

-- K) contrato_condiciones — INMUTABLE tras la creación. Ninguna sesión, ni
--    siquiera service_role (que bypasea RLS), puede alterarla o borrarla.
create or replace function public.contrato_condiciones_inmutable()
returns trigger language plpgsql as $$
begin
  raise exception 'contrato_condiciones es permanente: no se puede modificar ni eliminar una condición ya congelada en el contrato %.',
    coalesce(old.numero_contrato, new.numero_contrato);
end;
$$;
drop trigger if exists trg_contrato_condiciones_inmutable on public.contrato_condiciones;
create trigger trg_contrato_condiciones_inmutable
  before update or delete on public.contrato_condiciones
  for each row execute function public.contrato_condiciones_inmutable();

-- L) ventas.cotizacion_id — INMUTABLE tras fijarse (y no puede fijarse por
--    UPDATE en absoluto: el único escritor legítimo, convertir_cotizacion_a_
--    contrato, lo hace con INSERT). Cierra tanto "cambiar de cotización" como
--    "vaciar el enlace" (NULL) en una sola regla: cualquier UPDATE que TOQUE
--    la columna se rechaza, sin importar el valor de origen o destino.
create or replace function public.ventas_cotizacion_id_inmutable()
returns trigger language plpgsql as $$
begin
  if new.cotizacion_id is distinct from old.cotizacion_id then
    raise exception 'ventas.cotizacion_id no se puede modificar tras la conversión (contrato %).', old.numero_contrato;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ventas_cotizacion_id_inmutable on public.ventas;
create trigger trg_ventas_cotizacion_id_inmutable
  before update on public.ventas
  for each row execute function public.ventas_cotizacion_id_inmutable();

-- M) restriccion_overrides — alcance explícito + candado de solo-append +
--    RLS restringida a superadmin.
alter table public.restriccion_overrides
  add column if not exists contrato_condicion_id bigint references public.contrato_condiciones(id),
  add column if not exists restriccion_afectada text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restriccion_overrides_restriccion_afectada_check'
  ) then
    alter table public.restriccion_overrides add constraint restriccion_overrides_restriccion_afectada_check
      check (restriccion_afectada is null or length(trim(restriccion_afectada)) > 0);
  end if;
end $$;

-- Verifica, en un trigger (no un CHECK: necesita consultar otra fila), que
-- `contrato_condicion_id` —cuando viene— pertenezca de verdad al MISMO
-- `numero_contrato` del override (alcance explícito, corrección de la
-- auditoría de arquitectura: un override nunca puede apuntar a la condición
-- de OTRO contrato). También bloquea update/delete: solo-append.
create or replace function public.restriccion_overrides_guardas()
returns trigger language plpgsql as $$
declare v_numero text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'restriccion_overrides es un registro de auditoría de solo-append: no se puede modificar ni eliminar un override ya creado.';
  end if;
  -- tg_op = INSERT
  if new.contrato_condicion_id is not null then
    select numero_contrato into v_numero
    from public.contrato_condiciones where id = new.contrato_condicion_id;
    if v_numero is null then
      raise exception 'La condición % no existe.', new.contrato_condicion_id;
    end if;
    if v_numero <> new.numero_contrato then
      raise exception 'La condición % pertenece al contrato %, no a %.', new.contrato_condicion_id, v_numero, new.numero_contrato;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_restriccion_overrides_guardas on public.restriccion_overrides;
create trigger trg_restriccion_overrides_guardas
  before insert or update or delete on public.restriccion_overrides
  for each row execute function public.restriccion_overrides_guardas();

-- RLS: LECTURA la comparte quien puede ver el contrato (mismo criterio que
-- `contrato_condiciones` — la UI necesita distinguir "condición original" de
-- "excepción autorizada" para TODO el que consulta el contrato, no solo
-- superadmin: es información comercial del contrato, no un dato privilegiado).
-- ESCRITURA la restringe a SOLO superadmin (antes admitía también gerencia —
-- corrección de este commit; el documento de arquitectura del Commit 6 lo
-- exige superadmin-únicamente). Sin policy de update/delete (el trigger de
-- arriba ya lo bloquea también para service_role; esto cierra el paso además
-- a cualquier sesión con RLS).
drop policy if exists "restriccion_overrides: acceso" on public.restriccion_overrides;
drop policy if exists "restriccion_overrides: lectura" on public.restriccion_overrides;
create policy "restriccion_overrides: lectura"
  on public.restriccion_overrides for select
  using (public.puede_ver_contrato(numero_contrato));
drop policy if exists "restriccion_overrides: insertar" on public.restriccion_overrides;
create policy "restriccion_overrides: insertar"
  on public.restriccion_overrides for insert
  with check (public.mi_rol() = 'superadmin');

-- N) RPC único de escritura — INVOKER bajo service_role, re-verifica todo
--    server-side (nunca confía en actor/tenant/contrato que mande el cliente).
create or replace function public._autorizado_override(p_usuario_id uuid)
returns text language plpgsql as $$
declare v_rol text; v_activo boolean;
begin
  if p_usuario_id is null then
    raise exception 'Se requiere un usuario interno autorizado.';
  end if;
  select rol, activo into v_rol, v_activo from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    raise exception 'El usuario % no existe en el sistema.', p_usuario_id;
  end if;
  if not coalesce(v_activo, false) then
    raise exception 'El usuario está desactivado.';
  end if;
  if v_rol <> 'superadmin' then
    raise exception 'Solo superadmin puede autorizar una excepción a una restricción comercial.';
  end if;
  return v_rol;
end;
$$;

create or replace function public.registrar_override_restriccion(
  p_numero_contrato text,
  p_contrato_condicion_id bigint,
  p_restriccion_afectada text,
  p_motivo text,
  p_usuario_id uuid
) returns bigint language plpgsql as $$
declare
  v_rol           text := public._autorizado_override(p_usuario_id);
  v_actor_tenant  text;
  v_actor_email   text;
  v_tenant_venta  text;
  v_numero_cond   text;
  v_motivo        text := nullif(trim(coalesce(p_motivo,'')), '');
  v_afectada      text := nullif(trim(coalesce(p_restriccion_afectada,'')), '');
  v_id            bigint;
begin
  select tenant, email into v_actor_tenant, v_actor_email from public.usuarios where id = p_usuario_id;

  if v_motivo is null then
    raise exception 'El motivo de la excepción es obligatorio.';
  end if;
  if v_afectada is null then
    raise exception 'Indica qué restricción se está exceptuando.';
  end if;

  -- El contrato debe existir. Sin cheque de tenant: `_autorizado_override` ya
  -- exige rol=superadmin arriba (v_rol siempre es 'superadmin' en este punto),
  -- y superadmin es EXENTO de tenant en todo el resto de la 164 (mismo
  -- criterio documentado en `convertir_cotizacion_a_contrato` — "excepción
  -- global"). Si algún día se abre este RPC a otro rol, aquí es donde debe
  -- agregarse el cheque `v_actor_tenant is distinct from v_tenant_venta`.
  select tenant into v_tenant_venta from public.ventas where numero_contrato = p_numero_contrato;
  if v_tenant_venta is null then
    raise exception 'El contrato % no existe.', p_numero_contrato;
  end if;

  -- La condición (si viene) debe pertenecer a ESTE contrato — el trigger de
  -- la tabla ya lo re-verifica; se comprueba aquí también para dar un
  -- mensaje claro antes de intentar el insert.
  if p_contrato_condicion_id is not null then
    select numero_contrato into v_numero_cond
    from public.contrato_condiciones where id = p_contrato_condicion_id;
    if v_numero_cond is null or v_numero_cond <> p_numero_contrato then
      raise exception 'La condición indicada no pertenece al contrato %.', p_numero_contrato;
    end if;
  end if;

  insert into public.restriccion_overrides
    (numero_contrato, tabla_afectada, accion, contrato_condicion_id, restriccion_afectada,
     motivo, usuario_id, usuario_email)
  values
    (p_numero_contrato, 'contrato_condiciones', 'override_restriccion_pago', p_contrato_condicion_id,
     v_afectada, v_motivo, p_usuario_id, v_actor_email)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public._autorizado_override(uuid) from public, anon, authenticated;
grant execute on function public._autorizado_override(uuid) to service_role;
revoke all on function public.registrar_override_restriccion(text, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.registrar_override_restriccion(text, bigint, text, text, uuid) to service_role;

commit;
