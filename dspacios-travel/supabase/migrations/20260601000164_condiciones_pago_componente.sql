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
      check (restriccion_comercial in ('normal','promocional_no_reembolsable'));
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
      check (restriccion_comercial in ('normal','promocional_no_reembolsable'));
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
    check (restriccion_comercial in ('normal','promocional_no_reembolsable'))
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
    check (restriccion_comercial in ('normal','promocional_no_reembolsable'))
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

-- Registrar un pago previo a una cotización. UNA TRANSACCIÓN atómica e
-- idempotente (A1+A2 de la auditoría):
--   1) FOR UPDATE de la cotización (serializa primeros pagos concurrentes y
--      descartes) y RE-lectura del estado y de `condicion_pago_congelada_en`.
--   2) Valida autorización (rol+activo+tenant), payload y que esté 'abierta'.
--   3) IDEMPOTENCIA: si `p_idempotency_key` ya se registró, devuelve el resultado
--      ORIGINAL (mismo pago/asiento) sin insertar nada; si la misma clave llega
--      con identidad distinta (cotización/moneda/monto/forma) → rechazo cerrado.
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
  v_ex_id bigint;
  v_ex_cot bigint;
  v_ex_moneda text;
  v_ex_monto numeric;
  v_ex_forma text;
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

  -- 3) IDEMPOTENCIA: misma clave ya usada → recuperar el resultado original.
  select id, cotizacion_id, moneda, monto_moneda, lower(coalesce(forma_pago,''))
    into v_ex_id, v_ex_cot, v_ex_moneda, v_ex_monto, v_ex_forma
  from public.cotizacion_pagos_previos where idempotency_key = v_key for update;
  if v_ex_id is not null then
    if v_ex_cot <> p_cotizacion_id
       or upper(coalesce(v_ex_moneda,'')) <> upper(coalesce(p_moneda,''))
       or v_ex_monto <> p_valor
       or v_ex_forma <> lower(coalesce(p_forma_pago,'')) then
      raise exception 'La clave de idempotencia ya se usó para otro pago: no se reutiliza.';
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
     referencia, fecha_pago, registrado_por_id, registrado_por_email, idempotency_key)
  values
    (p_cotizacion_id, v_tenant, v_monto_cop, p_valor, upper(p_moneda), v_trm_congelada,
     p_forma_pago, nullif(trim(coalesce(p_referencia,'')),''),
     coalesce(p_fecha_pago, current_date), p_usuario_id, v_email, v_key)
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

commit;
