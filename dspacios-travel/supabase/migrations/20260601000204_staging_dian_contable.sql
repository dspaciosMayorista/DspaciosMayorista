-- ============================================================================
-- 204 — Staging de importacion DIAN contable (7 tablas + bitacora, sin
--       contabilizacion y sin UI)
--       Diseno: docs/tecnico/contabilidad-dian-staging.md
-- ============================================================================
--
-- ESTA MIGRACION NO ESTA APLICADA. Esto es una PROPUESTA para revision.
-- Probada SOLO en base local desechable con el esquema de main 8987932e
-- (001-213, incluida la 211): aplica, es idempotente y su rollback la retira
-- (2026-10-17). Ningun ambiente remoto la tiene.
--
-- Que hace:
--   1. Agrega tres valores al enum `rol_usuario`: `contador`, `revisor_fiscal`
--      y `admin_contable`. NO se toca `lib/constants.ts` ni ningun rol en
--      codigo; esto es solo el lado de la base (fuera de la transaccion, ver
--      "Enum" mas abajo).
--   2. Crea 7 tablas de staging + `documento_dian_resolucion` (bitacora).
--   3. RLS DEDICADA con 7 helpers `dian_staging_puede_*`. NO se amplía
--      `puede_ver_tenant` (migracion 107): ampliarlo abriria al contador
--      tablas operativas que no le corresponden. Tampoco se DELEGA en el:
--      ver el staging queda limitado al area contable y la administracion
--      (decision del dueno 2026-10-17, §10).
--   4. Indices de deduplicado/idempotencia segun §4.6, incluido el indice
--      UNICO de identidad, que es el que hace determinista el clasificado
--      cuando hay dos importaciones simultaneas (§4.3).
--   5. `documento_dian_resolucion` queda APPEND-ONLY por trigger, no solo por
--      privilegios: el mismo criterio que aplico la migracion 200 a
--      `historial_vuelos_inmutable`.
--   6. `trg_auditoria` se adjunta a las 8 tablas a mano. El DO loop de la
--      migracion 087 solo corrio una vez; una tabla nueva nace sin el (ver
--      §11.1 del diseno).
--   7. `dian_registrar_documento(...)`: la funcion de registro por documento
--      de §4.5. Sin ella los indices no ejercitan nada, porque el "intentar
--      insertar y, si viola, registrar el duplicado" necesita el manejador de
--      excepcion que aporta la subtransaccion (§4.4).
--   8. Lectura de catalogos para PREPARAR (§16): policies NUEVAS de solo
--      SELECT para los tres roles contables sobre `proveedores`,
--      `proveedores_datos_sensibles` (datos bancarios incluidos: riesgo
--      aceptado por el dueno) y `puc_cuentas`, de su propia agencia. No
--      modifica ninguna policy existente.
--
-- Que NO hace, y es deliberado:
--   - NO escribe en `asientos_contables`, `asiento_lineas`, `cuentas_por_pagar`,
--     `abonos`, `cxp_pagos` ni `retenciones_cxp`.
--   - NO llama al motor de asientos.
--   - NO hace backfill de nada.
--   - NO crea el XML completo: solo `xml_hash` (D10, §9.6).
--   - NO inserta jamas en `proveedores` (D4/D5, §8.2): el staging propone y
--     la persona confirma.
--   - NO crea columnas de contabilizacion: `asiento_id`, `contabilizado_por`
--     y `contabilizado_en` NO se crean (§3.3 "Futuro, hoy siempre null").
--
-- NUMERACION:
--   El 204 esta reservado a este frente (#43) en WORKSTREAMS.md. Al escribirla,
--   main llegaba a la 198; hoy (2026-10-17, main 8987932e) main integra hasta
--   la 213 y varias de 205-213 ya estan aplicadas en Produccion. La 204 queda
--   FUERA DE ORDEN respecto de la historia remota: aplicarla a mano con el procedimiento
--   acordado con el usuario (preflight -> migracion -> postcheck), nunca con
--   `supabase db push` ni `migration repair` por inferencia. Renumerar o no es
--   decision del Coordinador; el contenido no depende del numero.
--
-- Enum:
--   `ALTER TYPE ... ADD VALUE` NO admite uso del valor nuevo dentro de la misma
--   transaccion en que se agrega. Por eso los tres `alter type` van FUERA del
--   `begin`/`commit` (en autocommit), y las funciones comparan con
--   `mi_rol()::text` en vez de castear a enum. Asi el orden es correcto en
--   cualquier version de Postgres sin depender de ese matiz.
--
-- Idempotente. Rollback: supabase/scripts/rollback_204_staging_dian.sql
-- Postcheck (solo lectura): supabase/scripts/postcheck_204_staging_dian_lectura.sql
-- Preflight (solo lectura): supabase/scripts/preflight_204_staging_dian_lectura.sql
-- Pruebas: supabase/scripts/test_204_staging_dian_dedupe.sql
--           supabase/scripts/test_204_staging_dian_rls.sql

-- === Enum: los tres roles contables (FUERA de la transaccion) ==============
-- Idempotente. No toca ningun rol en codigo: solo agrega valores al enum para
-- que `usuarios.rol` pueda contenerlos.
alter type public.rol_usuario add value if not exists 'contador';
alter type public.rol_usuario add value if not exists 'revisor_fiscal';
alter type public.rol_usuario add value if not exists 'admin_contable';

begin;

-- === 1. lote_importacion_dian — una fila por importacion ====================
-- El periodo NO tiene default: lo elige el usuario al abrir el proceso (D8).
create table if not exists public.lote_importacion_dian (
  id                     bigserial primary key,
  tenant                 text not null default 'mayorista'
                           check (tenant in ('mayorista', 'minorista')),
  fuente                 text not null
                           check (fuente in ('xml_directo', 'attached_document',
                                             'excel_ventas', 'excel_compras')),
  nombre_archivo         text,
  -- sha256 del contenido recibido. Es lo que detecta la reimportacion (D6).
  hash_contenido         text not null,
  periodo_desde          text not null check (periodo_desde ~ '^\d{4}-\d{2}$'),
  periodo_hasta          text not null check (periodo_hasta ~ '^\d{4}-\d{2}$'),
  motivo                 text not null check (length(btrim(motivo)) > 0),
  total_filas            integer not null default 0 check (total_filas >= 0),
  documentos_ok          integer not null default 0 check (documentos_ok >= 0),
  documentos_rechazados  integer not null default 0 check (documentos_rechazados >= 0),
  problemas              jsonb not null default '[]'::jsonb,
  cabeceras_originales   jsonb,
  columnas_detectadas    jsonb,
  estado                 text not null default 'en_proceso'
                           check (estado in ('en_proceso', 'procesado',
                                             'con_error', 'descartado')),
  mensaje_error          text,
  importado_por          uuid references public.usuarios(id) on delete set null,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  -- D6: el rango va en el indice, no en el contenido. El mismo archivo
  -- cargado para un corte NUEVO si se puede volver a subir.
  constraint uq_lote_dian_reimportacion
    unique (tenant, fuente, periodo_desde, hash_contenido),
  -- Soporte de la FK compuesta de §3.3: hace que el tenant del documento sea
  -- estructuralmente igual al del lote, no "confiable por codigo".
  constraint uq_lote_dian_id_tenant unique (id, tenant),
  constraint ck_lote_dian_periodo_rango check (periodo_desde <= periodo_hasta)
);

comment on table public.lote_importacion_dian is
  'Staging DIAN: una fila por importacion. No escribe en el motor contable.';

-- === 2. documento_dian_identidad — una fila por documento logico ===========
-- Es la tabla que hace determinista el clasificado de duplicado vs
-- discrepante cuando hay dos importaciones simultaneas (§4.3). El indice
-- unico (tenant, clave) es el que serializa a los importadores.
create table if not exists public.documento_dian_identidad (
  id               bigserial primary key,
  tenant           text not null check (tenant in ('mayorista', 'minorista')),
  clave            text not null,
  clave_base       text not null
                     check (clave_base in ('cufecude',
                                           'proveedor_tipo_numero_fecha')),
  -- El PRIMER total declarado que se vio. Es contra este, no contra el
  -- ultimo, que se decide si un reenvio es duplicado o discrepante.
  total_referencia numeric(15,2) not null,
  ocurrencias      integer not null default 0 check (ocurrencias >= 0),
  primera_vez_en   timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint uq_dian_identidad_clave unique (tenant, clave),
  -- Soporte de la FK compuesta de §3.3 (coherencia de tenant).
  constraint uq_dian_identidad_id_tenant unique (id, tenant)
);

comment on table public.documento_dian_identidad is
  'Identidad logica del documento (tenant + clave). Una fila por clave, con el total de referencia.';

-- === 3. documento_dian_staging — una fila por documento importado =========
create table if not exists public.documento_dian_staging (
  id                       bigserial primary key,
  lote_id                  bigint not null,
  documento_dian_identidad_id bigint not null,
  tenant                   text not null check (tenant in ('mayorista', 'minorista')),
  periodo                  text not null check (periodo ~ '^\d{4}-\d{2}$'),
  fuente                   text not null,

  -- Identidad y clave (§4.1). La clave la calcula el parser y entra como
  -- parametro: la funcion NO la recalcula.
  clave                    text not null,
  clave_base               text not null
                             check (clave_base in ('cufecude',
                                                   'proveedor_tipo_numero_fecha')),
  cufe                     text,
  cude                     text,
  -- `otro` existe porque el parser iguala a `factura` cualquier tipo que no
  -- reconozca (excel.ts:228) y el texto crudo vive en la columna siguiente (D12).
  tipo_documento           text not null
                             check (tipo_documento in ('factura', 'nota_credito',
                                                      'nota_debito', 'otro')),
  tipo_documento_original  text,
  numero                   text,
  fecha                    date not null,

  -- Emisor, tal como lo declara el documento.
  proveedor_nit            text,
  proveedor_dv             text,
  proveedor_identificacion text,
  proveedor_tipo_ident     text,
  proveedor_nombre         text,
  sujeto_nit               text,
  sujeto_identificacion    text,
  sujeto_nombre            text,
  moneda                   text not null,
  trm                      numeric(18,6),
  divisa_origen            text,
  divisa_destino           text,
  divisa_fecha             date,
  divisa_tasa              numeric(18,6),

  -- Importes. `total_calculado` NO lleva retenciones (D2, §7.4): las
  -- retenciones se INFORMAN, no se restan. Ver aviso RETENCION_NO_APLICADA.
  subtotal                 numeric(15,2) not null default 0,
  base_gravable            numeric(15,2),
  descuentos               numeric(15,2) not null default 0,
  cargos                   numeric(15,2) not null default 0,
  anticipos                numeric(15,2) not null default 0,
  redondeo                 numeric(15,2) not null default 0,
  impuestos_total          numeric(15,2) not null default 0,
  retenciones_total        numeric(15,2) not null default 0,
  total_declarado          numeric(15,2) not null,
  total_calculado          numeric(15,2) not null,
  diferencia               numeric(15,2) not null default 0,
  diferencia_tolerada      boolean not null default true,

  -- Fuente. NO hay columna de XML completo (D10, §9.6): solo el hash.
  xml_hash                 text,
  fila_origen              integer,
  celdas_origen            jsonb,
  originales               jsonb,
  software_emisor          text,

  -- Revision (§5.2).
  estado                   text not null default 'importado'
                             check (estado in ('importado', 'pendiente_revision',
                                               'preparado', 'devuelto',
                                               'coincidente', 'aprobado',
                                               'cerrado', 'duplicado',
                                               'discrepante', 'rechazado',
                                               'contabilizado')),
  -- Motivos por los que NO se puede avanzar solo. Cada uno es un motivo
  -- visible, no una bandera muda: la bandeja agrupa por estos valores.
  motivo_pendiente         text,
  fuera_de_corte           boolean not null default false,

  -- Cruce del emisor (D4/D5). El staging nunca inserta en `proveedores`.
  proveedor_id             bigint references public.proveedores(id)
                             on delete set null,
  proveedor_cruce_estado   text
                             check (proveedor_cruce_estado in
                               ('coincide', 'sin_nit', 'nit_no_cruzable',
                                'varios_candidatos', 'no_resuelto')),
  cuenta_puc               bigint references public.puc_cuentas(id)
                             on delete restrict,
  cuenta_puc_origen        text check (cuenta_puc_origen in
                               ('global', 'excepcion_tenant')),
  tipo_gasto               text,
  periodo_asignado         text check (periodo_asignado ~ '^\d{4}-\d{2}$'),
  documento_relacionado_id bigint references public.documento_dian_staging(id)
                             on delete restrict,
  duplicado_de             bigint references public.documento_dian_staging(id)
                             on delete restrict,
  discrepante_de           bigint references public.documento_dian_staging(id)
                             on delete restrict,

  -- Los cuatro actos (§5.1). *_rol va SIEMPRE: es lo que prueba que la
  -- excepcion de politica del `contador` se aplico (§5.4).
  preparado_por            uuid references public.usuarios(id) on delete set null,
  preparado_rol            text,
  preparado_en             timestamptz,
  aprobado_por             uuid references public.usuarios(id) on delete set null,
  aprobado_rol             text,
  aprobado_en              timestamptz,
  devuelto_por             uuid references public.usuarios(id) on delete set null,
  devuelto_rol             text,
  devuelto_en              timestamptz,
  cerrado_por              uuid references public.usuarios(id) on delete set null,
  cerrado_rol              text,
  cerrado_en               timestamptz,

  creado_por               uuid references public.usuarios(id) on delete set null,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),

  -- §4.6: el unico parcial de dedupe. `total_declarado` entra a proposito:
  -- con unico (tenant, clave) un documento corregido por el emisor seria
  -- rechazado por la base, que es justo el caso que debe quedar discrepante.
  --
  -- Este indice es el UNICO que hace falta para el dedupe, y los tres casos
  -- se resuelven solos:
  --   - reenvio exacto (misma clave, mismo total): la fila nueva va con
  --     estado='duplicado', que el predicado EXCLUYE, asi que no colisiona.
  --   - misma clave, otro total: es otra fila del indice, no colisiona, y el
  --     documento queda discrepante conviviendo con el original.
  --   - dos importaciones simultaneas del mismo documento nuevo: la segunda
  --     viola el indice, que es exactamente lo que se quiere.
  --
  -- NO hay un indice aparte por identidad: un unico (identidad_id) filtrando
  -- estado <> 'duplicado' HARIA IMPOSIBLE guardar el discrepante, porque el
  -- original ya ocupa esa fila del indice. El dedupe lo hace la clave, no la
  -- identidad.
  -- Este indice se crea FUERA de la tabla, abajo, porque un indice PARCIAL
  -- necesita `where` y un `constraint unique` dentro de `create table` no lo
  -- admite: Postgres no acepta `where` dentro de una definicion de constraint.
  -- Ver seccion 9.
  -- Un duplicado SIEMPRE apunta a su original, y un discrepante tambien.
  constraint ck_dian_staging_duplicado_de
    check (estado <> 'duplicado' or duplicado_de is not null),
  constraint ck_dian_staging_discrepante_de
    check (estado <> 'discrepante' or discrepante_de is not null),
  -- Para aprobar hacen falta proveedor y cuenta (§5.4).
  constraint ck_dian_staging_aprobado_completo
    check (estado <> 'aprobado' or (proveedor_id is not null and cuenta_puc is not null)),
  -- Devolver siempre con motivo (§5.4).
  constraint ck_dian_staging_devuelto_motivo
    check (estado <> 'devuelto' or motivo_pendiente is not null),
  -- Coherencia de tenant POR FK COMPUESTA, no por un CHECK con subconsulta.
  -- Un CHECK con subconsulta NO se reevalua cuando cambia la fila referenciada,
  -- asi que daria una garantia que en realidad no existe. Con la FK compuesta
  -- es imposible que un documento diga un tenant y su lote otro.
  constraint fk_dian_staging_lote_tenant
    foreign key (lote_id, tenant)
    references public.lote_importacion_dian(id, tenant) on delete restrict,
  constraint fk_dian_staging_identidad_tenant
    foreign key (documento_dian_identidad_id, tenant)
    references public.documento_dian_identidad(id, tenant) on delete restrict
);

comment on table public.documento_dian_staging is
  'Staging DIAN: una fila por documento importado. Append-only: sin DELETE. No contabiliza.';
comment on column public.documento_dian_staging.motivo_pendiente is
  'Por que el documento no puede avanzar. Se muestra en la bandeja; no es una bandera muda.';
comment on column public.documento_dian_staging.fuera_de_corte is
  'true si fecha < periodo_desde del lote (D8a). Se importa igual: nada se descarta.';

-- === 4-7. Tablas hijas: detalle importado, inmutable tras el insert =======
create table if not exists public.documento_dian_linea_staging (
  id                       bigserial primary key,
  documento_id             bigint not null
                             references public.documento_dian_staging(id)
                             on delete cascade,
  numero                   integer,
  descripcion              text,
  cantidad                 numeric(18,6),
  precio_unitario          numeric(18,6),
  base                     numeric(15,2),
  descuento                numeric(15,2),
  -- La cuenta que declara el PROVEEDOR, no el PUC de D'spacios (§7.3).
  cuenta_contable_emisor   text,
  impuestos                jsonb
);

comment on table public.documento_dian_linea_staging is
  'Lineas del documento. Solo desde XML: el Excel de la DIAN no trae detalle.';

create table if not exists public.documento_dian_impuesto_staging (
  id           bigserial primary key,
  documento_id bigint not null
                 references public.documento_dian_staging(id)
                 on delete cascade,
  codigo       text,
  nombre       text,
  tasa         numeric(7,4),
  base         numeric(15,2),
  valor        numeric(15,2),
  -- De que bloque se leyó. En los documentos reales todos vienen de
  -- `TaxSubtotal`, pero un segundo bloque "04" (INC) también suma al total.
  origen       text check (origen in ('tax_subtotal', 'tax_total_plano'))
);

comment on table public.documento_dian_impuesto_staging is
  'Impuestos del documento. `origen` permite revisar sin volver al XML.';

create table if not exists public.documento_dian_retencion_staging (
  id           bigserial primary key,
  documento_id bigint not null
                 references public.documento_dian_staging(id)
                 on delete cascade,
  codigo       text,
  nombre       text,
  campo_origen text,
  estructura   text check (estructura in ('ubl', 'totales_cop', 'custom_field')),
  base         numeric(15,2),
  valor        numeric(15,2)
);

comment on table public.documento_dian_retencion_staging is
  'Retenciones declaradas. Se crean aunque hoy ningun documento real traiga importe distinto de cero (D2).';

create table if not exists public.documento_dian_forma_pago_staging (
  id           bigserial primary key,
  documento_id bigint not null
                 references public.documento_dian_staging(id)
                 on delete cascade,
  codigo       text,
  fecha        date,
  monto        numeric(15,2)
);

comment on table public.documento_dian_forma_pago_staging is
  'Medios de pago. En compras, "Medios De Pago" decide el beneficio del 1%, que es dato de retencion.';

-- === 8. documento_dian_resolucion — bitacora APPEND-ONLY ==================
-- Sin esta tabla, "¿quien aprobo esto y por que?" no tiene respuesta, y eso es
-- justamente lo que el modulo promete (§3.8).
create table if not exists public.documento_dian_resolucion (
  id              bigserial primary key,
  documento_id    bigint not null
                    references public.documento_dian_staging(id)
                    on delete restrict,
  estado_anterior text,
  estado_nuevo    text,
  actor_id        uuid references public.usuarios(id) on delete set null,
  actor_email     text,
  actor_rol       text,
  campo           text not null,
  valor_anterior  jsonb,
  valor_nuevo     jsonb,
  motivo          text,
  creado_en       timestamptz not null default now()
);

comment on table public.documento_dian_resolucion is
  'Bitacora de revision. APPEND-ONLY por trigger, no solo por privilegio.';

-- === 9. Indices ============================================================
-- El indice de dedupe va PRIMERO y aparte, no como constraint dentro de
-- `create table`: un indice parcial necesita `where`, y Postgres no acepta
-- `where` dentro de la definicion de un constraint. Este es el indice que
-- decide los tres casos de §4.4:
--   - reenvio exacto: la fila nueva va con estado='duplicado', que el predicado
--     EXCLUYE, asi que no colisiona.
--   - misma clave, otro total: es otra entrada del indice, no colisiona, y el
--     documento queda discrepante conviviendo con el original.
--   - dos importaciones simultaneas del mismo documento nuevo: la segunda
--     viola el indice, que es justo lo que se quiere.
create unique index if not exists uq_dian_staging_dedupe
  on public.documento_dian_staging (tenant, clave, total_declarado)
  where estado <> 'duplicado';

create index if not exists idx_dian_lote_tenant_estado
  on public.lote_importacion_dian (tenant, estado);
create index if not exists idx_dian_lote_periodo
  on public.lote_importacion_dian (tenant, periodo_desde, periodo_hasta);
create index if not exists idx_dian_identidad_base
  on public.documento_dian_identidad (tenant, clave_base);
-- La vista principal de la bandeja.
create index if not exists idx_dian_staging_bandeja
  on public.documento_dian_staging (tenant, periodo, estado);
create index if not exists idx_dian_staging_lote
  on public.documento_dian_staging (lote_id);
create index if not exists idx_dian_staging_identidad
  on public.documento_dian_staging (documento_dian_identidad_id);
create index if not exists idx_dian_staging_proveedor_nit
  on public.documento_dian_staging (tenant, proveedor_nit);
create index if not exists idx_dian_staging_proveedor
  on public.documento_dian_staging (proveedor_id);
-- La cola de discrepancias por resolver (D7: el riesgo se detecta y se muestra).
create index if not exists idx_dian_staging_discrepantes
  on public.documento_dian_staging (estado, discrepante_de)
  where estado = 'discrepante';
-- D4/D5: los documentos que el cruce no pudo resolver, en un solo filtro.
create index if not exists idx_dian_staging_cruce_pendiente
  on public.documento_dian_staging (tenant, proveedor_cruce_estado)
  where proveedor_cruce_estado is not null
    and proveedor_cruce_estado <> 'coincide';
-- D11: cuanto se dedupe por CUFE y cuanto por identificacion.
create index if not exists idx_dian_staging_clave_base
  on public.documento_dian_staging (tenant, clave_base, tipo_documento);
create index if not exists idx_dian_staging_xml_hash
  on public.documento_dian_staging (tenant, xml_hash)
  where xml_hash is not null;
create index if not exists idx_dian_resolucion_documento
  on public.documento_dian_resolucion (documento_id, creado_en desc);

-- === 10. Helpers de RLS DEDICADOS (§6.2) ================================
-- Patron de la migracion 202 del CRM: security definer, stable, search_path
-- fijo, revoke a public/anon/authenticated/service_role y grant execute a
-- authenticated. NO se amplia `puede_ver_tenant`.
-- NOTA CRITICA (bug corregido en la auditoria local del 2026-10-03):
-- `mi_rol()` devuelve NULL cuando no hay usuario activo para `auth.uid()`, y
-- `NULL in (...)` es NULL, no false. Con un predicado que devuelva NULL, el
-- guard `if not public.dian_staging_puede_importar(...)` NO se dispara, porque
-- `not NULL` tambien es NULL: un llamador sin sesion pasaba el control.
-- Se verifico ejecutando (D14 del test de dedupe fallo con ese motivo).
-- Por eso TODOS estos helpers envuelven el predicado en coalesce(..., false) y
-- devuelven un booleano definitivo. En las policies un NULL ya deny, pero en
-- codigo plpgsql un NULL se abre.

-- CORRECCION DE AUDITORIA (2026-10-03, bug confirmado ejecutando):
-- El diseno (§6.2) dice que `admin_contable` se rige por
-- `puede_ver_tenant(p_tenant)`, y ese helper SOLO da acceso a todos los
-- tenants a `superadmin`/`gerencia`. La primera version de estos helpers
-- ponia a `admin_contable` junto a `superadmin`, o sea con lectura
-- cross-tenant: un admin contable de mayorista podia leer los documentos de
-- minorista. El test R08 lo detecto. Ahora `admin_contable` esta acotado a su
-- tenant, igual que `contador` y `revisor_fiscal`; la unica excepcion es
-- `superadmin`.

-- ===========================================================================
-- Helpers de RLS, y la separacion de funciones que sostienen
-- ===========================================================================
--
-- REPARTO DE ACTOS (D1 y D3, §5.1). Cada rol tiene UN oficio:
--
--   preparar  -> contador          clasifica proveedor, cuenta PUC y periodo
--   aprobar   -> revisor_fiscal    revisa y aprueba
--   devolver  -> revisor_fiscal    devuelve con motivo
--   cerrar    -> admin_contable    cierra el documento
--   administra-> admin_contable    reglas, PUC comun, excepciones y permisos
--
-- CORRECCION DE AUDITORIA (2026-10-04): antes `dian_staging_puede_preparar`
-- incluía a `revisor_fiscal`, porque una versión anterior de §5.1 decía que
-- el revisor podía preparar. Eso era una contradicción con la segregación de
-- funciones: quien prepara es quien propone la clasificación, así que si
-- también revisa, la revisión no es de segunda persona. El test R15 lo
-- detectó ("el revisor pudo preparar y clasificar"). Ahora preparar es solo del
-- `contador`, y `admin_contable` queda fuera de los actos de documento: su
-- oficio son las reglas.
--
-- CORRECCION DE AUDITORIA (2026-10-04): `ver` ahora delega en
-- `puede_ver_tenant` en vez de reimplementar la regla. La version anterior
-- ponia a `admin_contable` junto a `superadmin` (leia el otro tenant, mal) y
-- de paso le quitaba a `gerencia` la lectura cross-tenant que sí tiene en el
-- resto de la app. Delegar deja una sola fuente de verdad para "¿qué es ser
-- interno?", que es la que ya define la migración 107.
--
-- `mi_rol()` devuelve NULL si no hay usuario activo, y `NULL in (...)` es NULL.
-- Por eso TODOS devuelven `coalesce(..., false)`: un NULL en una policy deniega,
-- pero en plpgsql un NULL se abre. Verificado ejecutando (el guard de la RPC
-- no se disparaba y un llamador sin sesión pasaba).

-- Ver: SOLO el area contable y la administracion (decision del dueno,
-- 2026-10-17). superadmin y gerencia ven las dos agencias (la regla vigente de
-- `puede_ver_tenant`); administracion y los tres roles contables, solo la suya.
--
-- Antes delegaba en `puede_ver_tenant`, que deja ver el tenant a CUALQUIER rol
-- con fila en `usuarios`: venta, operaciones, control_vuelo y tambien los
-- externos (agencia, freelance, cliente_final) leian por la API facturas de
-- proveedores con NIT, razon social y totales, es decir costos que las
-- migraciones 144/146 ya le habian cerrado a `venta`. Comprobado con una sonda
-- local por rol y tenant; el test R17 lo cubre.
--
-- `mi_rol()` exige fila activa en `usuarios`, asi que un usuario con sesion
-- pero sin fila no ve nada aunque `mi_tenant()` caiga en 'mayorista' (R16).
create or replace function public.dian_staging_puede_ver(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text in ('superadmin', 'gerencia')
    or (public.mi_rol()::text in ('administracion', 'contador', 'revisor_fiscal', 'admin_contable')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Importar: los tres oficios contables y administracion de su agencia, mas
-- superadmin (decision del dueno, 2026-10-17: administracion carga mientras no
-- haya usuarios contables creados). Cargar no es ningun acto de revision, asi
-- que no rompe la separacion.
create or replace function public.dian_staging_puede_importar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('admin_contable', 'contador', 'revisor_fiscal', 'administracion')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Preparar: SOLO el contador, mas los roles administrativos. Ni revisor_fiscal
-- ni admin_contable.
create or replace function public.dian_staging_puede_preparar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('contador', 'gerencia', 'administracion')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Aprobar: el revisor fiscal, mas los roles administrativos.
--
-- El `contador` NO puede aprobar. Esa excepcion (D3a) tiene que existir como
-- politica por tenant/lote, y cuando exista este helper es el UNICO punto que
-- hay que tocar: la politica de la tabla no alcanza, porque las policies
-- permisivas se combinan con OR (§6.3.1).
create or replace function public.dian_staging_puede_aprobar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('revisor_fiscal', 'gerencia', 'administracion')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Devolver: los mismos que pueden aprobar. Quien devuelve es quien rechaza, y
-- rejects con el mismo poder que aprueba.
create or replace function public.dian_staging_puede_devolver(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('revisor_fiscal', 'gerencia', 'administracion')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Cerrar: admin_contable, mas los roles administrativos.
create or replace function public.dian_staging_puede_cerrar(p_tenant text)
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text = 'superadmin'
    or (public.mi_rol()::text in ('admin_contable', 'gerencia', 'administracion')
        and public.mi_tenant() = p_tenant), false);
$$;

-- Administrar reglas: admin_contable y los roles administrativos del resto de la
-- app (`ADMIN_ROLES` en lib/roles.ts). Un `revisor_fiscal` NO aparece aquí:
-- aprueba, revisa y devuelve, pero un cambio de politica contable no puede
-- depender de quien revisa.
create or replace function public.dian_staging_puede_administrar()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.mi_rol()::text in ('superadmin', 'gerencia', 'administracion', 'admin_contable'), false);
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'dian_staging_puede_ver', 'dian_staging_puede_importar',
    'dian_staging_puede_preparar', 'dian_staging_puede_aprobar',
    'dian_staging_puede_devolver', 'dian_staging_puede_cerrar'
  ] loop
    execute format('revoke all on function public.%s(text) from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s(text) to authenticated', f);
  end loop;

  -- El de administrar NO lleva argumento de tenant: decide por rol.
  revoke all on function public.dian_staging_puede_administrar() from public, anon, authenticated, service_role;
  grant execute on function public.dian_staging_puede_administrar() to authenticated;
end;
$$;

-- === 10b. Habilitar RLS ANTES de las policies ============================
-- `create policy` NO habilita RLS: sin este `alter`, las policies se crean
-- pero no se aplican, y la tabla queda abierta para cualquiera con privilegio.
-- Este bloque va antes de §11 a proposito, para que un fallo posterior no
-- deje policies sin aplicar.
do $$
declare
  t text;
begin
  foreach t in array array[
    'lote_importacion_dian', 'documento_dian_identidad',
    'documento_dian_staging', 'documento_dian_linea_staging',
    'documento_dian_impuesto_staging', 'documento_dian_retencion_staging',
    'documento_dian_forma_pago_staging', 'documento_dian_resolucion'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    -- FORCE hace que RLS aplique tambien al dueno de la tabla. Sin esto, un
    -- script de superusuario saltaria las policies. Los tests corre como dueno
    -- siguen funcionando porque el trigger de inmutabilidad no depende de RLS.
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- === 11. Politicas por tabla (§6.3) =======================================
-- lote: select = ver; insert = importar; update = solo el propio lote.
drop policy if exists "dian_lote: ver" on public.lote_importacion_dian;
create policy "dian_lote: ver" on public.lote_importacion_dian
  for select to authenticated using (public.dian_staging_puede_ver(tenant));
drop policy if exists "dian_lote: importar" on public.lote_importacion_dian;
create policy "dian_lote: importar" on public.lote_importacion_dian
  for insert to authenticated with check (public.dian_staging_puede_importar(tenant));
drop policy if exists "dian_lote: actualizar" on public.lote_importacion_dian;
create policy "dian_lote: actualizar" on public.lote_importacion_dian
  for update to authenticated
  using (public.dian_staging_puede_importar(tenant)
         and (importado_por = auth.uid() or public.dian_staging_puede_administrar()))
  with check (public.dian_staging_puede_importar(tenant));

-- identidad: lectura para quien ve el tenant. La escritura es EXCLUSIVA de
-- `dian_registrar_documento`, por eso no hay policy de insert ni de update:
-- no se puede escribir una identidad desde la API.
drop policy if exists "dian_identidad: ver" on public.documento_dian_identidad;
create policy "dian_identidad: ver" on public.documento_dian_identidad
  for select to authenticated using (public.dian_staging_puede_ver(tenant));

-- staging: select = ver; insert = importar (via la funcion, ver §12);
-- update = preparar / aprobar / devolver / cerrar. DELETE: ninguna policy.
drop policy if exists "dian_staging: ver" on public.documento_dian_staging;
create policy "dian_staging: ver" on public.documento_dian_staging
  for select to authenticated using (public.dian_staging_puede_ver(tenant));
drop policy if exists "dian_staging: importar" on public.documento_dian_staging;
create policy "dian_staging: importar" on public.documento_dian_staging
  for insert to authenticated with check (public.dian_staging_puede_importar(tenant));
-- Una sola policy de UPDATE, no una por acto. PostgreSQL combines las
-- policies PERMISIVAS del mismo comando con OR, asi que una policy "puede
-- revisar" habilita CUALQUIER cambio de estado: con cuatro policies, el
-- contador entraba por la de revisar y podia dejar el documento en 'aprobado'.
-- Verificado ejecutando. Quien decide el acto es el trigger
-- `_dian_staging_update_gate`, que ve el antes y el despues.
-- Esta policy solo marca quien puede llegar a la fila; el acto se valida alla.
--
-- Los `drop` de las cuatro policies por acto son necesarios para que la 204
-- sea REAPLICABLE sobre una base donde una version anterior ya las creo:
-- sin ellos, `create policy` falla con "policy already exists".
drop policy if exists "dian_staging: aprobar"  on public.documento_dian_staging;
drop policy if exists "dian_staging: devolver"  on public.documento_dian_staging;
drop policy if exists "dian_staging: cerrar"    on public.documento_dian_staging;
drop policy if exists "dian_staging: revisar"   on public.documento_dian_staging;
drop policy if exists "dian_staging: modificar" on public.documento_dian_staging;
create policy "dian_staging: modificar" on public.documento_dian_staging
  for update to authenticated
  using (public.dian_staging_puede_preparar(tenant)
         or public.dian_staging_puede_aprobar(tenant)
         or public.dian_staging_puede_devolver(tenant)
         or public.dian_staging_puede_cerrar(tenant))
  with check (public.dian_staging_puede_preparar(tenant)
              or public.dian_staging_puede_aprobar(tenant)
              or public.dian_staging_puede_devolver(tenant)
              or public.dian_staging_puede_cerrar(tenant));

-- Hijas: solo lectura y escritura inicial. Sin update.
drop policy if exists "dian_linea: ver" on public.documento_dian_linea_staging;
create policy "dian_linea: ver" on public.documento_dian_linea_staging
  for select to authenticated using (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_ver(d.tenant)));
drop policy if exists "dian_linea: importar" on public.documento_dian_linea_staging;
create policy "dian_linea: importar" on public.documento_dian_linea_staging
  for insert to authenticated with check (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_importar(d.tenant)));

drop policy if exists "dian_impuesto: ver" on public.documento_dian_impuesto_staging;
create policy "dian_impuesto: ver" on public.documento_dian_impuesto_staging
  for select to authenticated using (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_ver(d.tenant)));
drop policy if exists "dian_impuesto: importar" on public.documento_dian_impuesto_staging;
create policy "dian_impuesto: importar" on public.documento_dian_impuesto_staging
  for insert to authenticated with check (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_importar(d.tenant)));

drop policy if exists "dian_retencion: ver" on public.documento_dian_retencion_staging;
create policy "dian_retencion: ver" on public.documento_dian_retencion_staging
  for select to authenticated using (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_ver(d.tenant)));
drop policy if exists "dian_retencion: importar" on public.documento_dian_retencion_staging;
create policy "dian_retencion: importar" on public.documento_dian_retencion_staging
  for insert to authenticated with check (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_importar(d.tenant)));

drop policy if exists "dian_forma_pago: ver" on public.documento_dian_forma_pago_staging;
create policy "dian_forma_pago: ver" on public.documento_dian_forma_pago_staging
  for select to authenticated using (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_ver(d.tenant)));
drop policy if exists "dian_forma_pago: importar" on public.documento_dian_forma_pago_staging;
create policy "dian_forma_pago: importar" on public.documento_dian_forma_pago_staging
  for insert to authenticated with check (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_importar(d.tenant)));

-- Bitacora: lectura para quien ve el tenant, escritura para quien revisa.
-- Sin update ni delete: ninguna policy los concede.
drop policy if exists "dian_resolucion: ver" on public.documento_dian_resolucion;
create policy "dian_resolucion: ver" on public.documento_dian_resolucion
  for select to authenticated using (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and public.dian_staging_puede_ver(d.tenant)));
drop policy if exists "dian_resolucion: registrar" on public.documento_dian_resolucion;
create policy "dian_resolucion: registrar" on public.documento_dian_resolucion
  for insert to authenticated with check (
    exists (select 1 from public.documento_dian_staging d
            where d.id = documento_id
              and (public.dian_staging_puede_preparar(d.tenant)
                   or public.dian_staging_puede_administrar())));

-- === 12. Privilegios: sin DELETE ni TRUNCATE para nadie ====================
revoke all on public.lote_importacion_dian from public, anon;
revoke all on public.documento_dian_identidad from public, anon;
revoke all on public.documento_dian_staging from public, anon;
revoke all on public.documento_dian_linea_staging from public, anon;
revoke all on public.documento_dian_impuesto_staging from public, anon;
revoke all on public.documento_dian_retencion_staging from public, anon;
revoke all on public.documento_dian_forma_pago_staging from public, anon;
revoke all on public.documento_dian_resolucion from public, anon;

grant select, insert, update on public.lote_importacion_dian to authenticated;
-- La identidad solo se lee desde la API: se escribe por la funcion.
grant select on public.documento_dian_identidad to authenticated;
grant select, insert, update on public.documento_dian_staging to authenticated;
grant select, insert on public.documento_dian_linea_staging to authenticated;
grant select, insert on public.documento_dian_impuesto_staging to authenticated;
grant select, insert on public.documento_dian_retencion_staging to authenticated;
grant select, insert on public.documento_dian_forma_pago_staging to authenticated;
grant select, insert on public.documento_dian_resolucion to authenticated;

-- Nunca delete ni truncate para los roles de la API. La ultima barrera es el
-- trigger, porque un privilege_READ-modification posterior lo dejaria pasar.
revoke delete, truncate on public.lote_importacion_dian from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_identidad from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_staging from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_linea_staging from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_impuesto_staging from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_retencion_staging from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_forma_pago_staging from authenticated, anon, service_role;
revoke delete, truncate on public.documento_dian_resolucion from authenticated, anon, service_role;

-- `usage` sobre las secuencias de los bigserial. Sin esto, el `insert` que se
-- acaba de conceder NO funciona: Postgres exige permiso de secuencia para
-- escribir en una columna serial. Se exceptua a proposito: la de
-- `documento_dian_identidad` NO se concede, porque esa tabla es de la RPC.
-- Verificado ejecutando: sin este bloque, un insert en la bitacora desde
-- `authenticated` falla con "permission denied for sequence".
do $$
declare
  t text;
begin
  foreach t in array array[
    'lote_importacion_dian', 'documento_dian_staging',
    'documento_dian_linea_staging', 'documento_dian_impuesto_staging',
    'documento_dian_retencion_staging', 'documento_dian_forma_pago_staging',
    'documento_dian_resolucion'
  ] loop
    execute format('grant usage, select on sequence public.%I_id_seq to authenticated', t);
  end loop;
end;
$$;

revoke all on sequence public.lote_importacion_dian_id_seq,
                    public.documento_dian_identidad_id_seq,
                    public.documento_dian_staging_id_seq,
                    public.documento_dian_linea_staging_id_seq,
                    public.documento_dian_impuesto_staging_id_seq,
                    public.documento_dian_retencion_staging_id_seq,
                    public.documento_dian_forma_pago_staging_id_seq,
                    public.documento_dian_resolucion_id_seq
  from public, anon;

-- Las tablas hijas tampoco se actualizan: el detalle importado es inmutable.
revoke update on public.documento_dian_linea_staging from authenticated, anon, service_role;
revoke update on public.documento_dian_impuesto_staging from authenticated, anon, service_role;
revoke update on public.documento_dian_retencion_staging from authenticated, anon, service_role;
revoke update on public.documento_dian_forma_pago_staging from authenticated, anon, service_role;
revoke update on public.documento_dian_identidad from authenticated, anon, service_role;

-- === 13. Triggers de inmutabilidad =======================================
-- Un `delete` sin `where` dispara el trigger en la primera fila y Postgres
-- revierte la sentencia entera: no se puede vaciar la bitacora por accidente.
create or replace function public._dian_staging_sin_borrar()
  returns trigger language plpgsql as $$
begin
  raise exception
    'DIAN_STAGING_APPEND_ONLY: % no admite % (operacion %).',
    tg_table_name, tg_op, tg_op
    using errcode = '42501';
end;
$$;

create or replace function public._dian_staging_sin_truncate()
  returns trigger language plpgsql as $$
begin
  raise exception 'DIAN_STAGING_APPEND_ONLY: % no admite TRUNCATE.', tg_table_name
    using errcode = '42501';
end;
$$;

-- La bitacora: ni UPDATE ni DELETE, para nadie, ni siquiera el dueno. Es la
-- unica de las 8 que es de solo-append en sentido estricto.
create or replace function public._dian_resolucion_inmutable()
  returns trigger language plpgsql as $$
begin
  raise exception
    'DIAN_RESOLUCION_APPEND_ONLY: % no admite % sobre una bitacora escrita.',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

-- El trigger que decide el acto. Va aqui porque necesita los helpers.
--
-- Por que un trigger y no solo RLS: las policies permisivas del mismo comando
-- se combinan con OR, asi que RLS no puede decir "el contador puede cambiar
-- el estado a 'preparado' pero no a 'aprobado'". Con cuatro policies de UPDATE
-- el contador entraba por la de revisar y podía dejar el documento en
-- 'aprobado' y falsificar 'aprobado_rol'. Verificado ejecutando.
--
-- Ademas estampa los `*_rol` desde el servidor: si el cliente los pudiera
-- escribir, la bitacora no probaria nada (§5.4).
-- Las columnas que el parser (o la carga) escriben al insert y que NO se
-- pueden cambiar despues. Se comparan con `is distinct from`, asi que un
-- UPDATE que las reescriba con el MISMO valor pasa: lo que se prohibe es
-- cambiarlas, no volver a escribirlas.
--
-- No usar un trigger por columna: 38 triggers sobre la misma tabla hacen
-- imposible razonar el orden de ejecucion. Un solo gate que compara la fila
-- entera contra esta lista.
create or replace function public.dian_staging_columnas_congeladas()
  returns text[] language sql immutable set search_path = public as $$
  select array[
    -- Identidad y procedencia: si esto cambia, el documento es otro.
    'tenant', 'lote_id', 'documento_dian_identidad_id',
    'periodo', 'fuente',
    'clave', 'clave_base', 'cufe', 'cude',
    'tipo_documento', 'tipo_documento_original',
    'numero', 'fecha',
    -- Emisor y sujeto, tal como los declara el documento.
    'proveedor_nit', 'proveedor_dv', 'proveedor_identificacion',
    'proveedor_tipo_ident', 'proveedor_nombre',
    'sujeto_nit', 'sujeto_identificacion', 'sujeto_nombre',
    -- Moneda. El trm NO se congela: se recalcula cuando se autoriza el
    -- documento, y por eso tiene su propia fila de bitacora.
    'moneda',
    'divisa_origen', 'divisa_destino', 'divisa_fecha', 'divisa_tasa',
    -- Aritmetica. `total_declarado` es la que el indice de dedupe usa: si
    -- alguien lo cambiara despues, la fila dejaria de coincidir con su
    -- identidad y el deduplicado dejaria de ser reproducible.
    'subtotal', 'base_gravable', 'descuentos', 'cargos', 'anticipos',
    'redondeo', 'impuestos_total', 'retenciones_total',
    'total_declarado', 'total_calculado', 'diferencia', 'diferencia_tolerada',
    -- Evidencia de la fuente (D10: hash, no el XML crudo).
    'xml_hash', 'fila_origen', 'celdas_origen', 'originales', 'software_emisor',
    -- Lo que decidio el sistema al importar: el fuera_de_corte se deriva del
    -- rango del lote. Si el rango estaba mal, se corrige el lote y se
    -- reimporta; no se edita la fila.
    'fuera_de_corte',
    -- Enlaces entre documentos, los pone el sistema.
    'duplicado_de', 'discrepante_de',
    -- Firma de creacion. `actualizado_en` NO va aqui: lo mantiene este gate.
    'creado_por', 'creado_en'
  ];
$$;

comment on function public.dian_staging_columnas_congeladas() is
  'Columnas de documento_dian_staging que no se pueden cambiar despues del INSERT (§4, D10).';

-- El gate de UPDATE: una sola puerta, y en este orden.
--
--   1. Congeladas: si cambia una columna del parser, se rechaza antes de mirar
--      nada mas. Es el error mas grave porque descoloca el deduplicado.
--   2. Rol: el *_rol lo estampa el servidor, nunca el cliente.
--   3. Transicion: que acto puede hacer este rol (§6.3.1).
--
-- Un solo trigger y no varios a proposito: Postgres ejecuta los triggers
-- BEFORE del mismo evento en orden ALFABETICO, y depender de ese orden para
-- una garantia de seguridad es frágil.
create or replace function public._dian_staging_update_gate()
  returns trigger language plpgsql as $$
declare
  v_rol text := public.mi_rol()::text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_col text;
  v_cambiadas text := '';
begin
  -- (1) Columnas del parser: inmutables despues del INSERT.
  foreach v_col in array public.dian_staging_columnas_congeladas() loop
    if (v_old -> v_col) is distinct from (v_new -> v_col) then
      v_cambiadas := v_cambiadas || v_col || ' ';
    end if;
  end loop;

  if v_cambiadas <> '' then
    raise exception
      'DIAN_COLUMNA_CONGELADA: el documento % no admite cambios en: %. Las columnas que escribe el parser son inmutables despues del import; corregir el lote exige reimportar.',
      old.id, btrim(v_cambiadas)
      using errcode = '42501';
  end if;

  -- (2) El rol SIEMPRE lo pone el servidor, nunca el cliente.
  if new.preparado_por is distinct from old.preparado_por then
    new.preparado_rol := v_rol;
  end if;
  if new.aprobado_por is distinct from old.aprobado_por then
    new.aprobado_rol := v_rol;
  end if;
  if new.devuelto_por is distinct from old.devuelto_por then
    new.devuelto_rol := v_rol;
  end if;
  if new.cerrado_por is distinct from old.cerrado_por then
    new.cerrado_rol := v_rol;
  end if;

  -- (3) Que transicion puede hacer este rol. Solo si cambia el estado: cambiar
  --     la cuenta PUC sin cambiar el estado es trabajo de preparacion.
  if new.estado is distinct from old.estado then
    case new.estado
      when 'pendiente_revision', 'preparado', 'coincidente' then
        if not public.dian_staging_puede_preparar(new.tenant) then
          raise exception 'SIN_PERMISO: el rol % no puede dejar un documento en %',
            v_rol, new.estado using errcode = '42501';
        end if;

      when 'aprobado' then
        if not public.dian_staging_puede_aprobar(new.tenant) then
          raise exception 'SIN_PERMISO: el rol % no puede aprobar. La excepcion para el contador es la politica D3a, que todavia no existe.',
            v_rol using errcode = '42501';
        end if;
        -- Quien aprueba deja siempre su firma: sin esto, un 'aprobado' sin
        -- responsable no tendria sentido auditable.
        if new.aprobado_por is null then
          raise exception 'APROBADO_SIN_FIRMA: un documento aprobado necesita aprobado_por.'
            using errcode = '23514';
        end if;

      when 'devuelto', 'rechazado' then
        if not public.dian_staging_puede_devolver(new.tenant) then
          raise exception 'SIN_PERMISO: el rol % no puede devolver ni rechazar.', v_rol
            using errcode = '42501';
        end if;

      when 'cerrado' then
        if not public.dian_staging_puede_cerrar(new.tenant) then
          raise exception 'SIN_PERMISO: el rol % no puede cerrar.', v_rol
            using errcode = '42501';
        end if;

      else
        -- 'duplicado', 'discrepante' y 'contabilizado' los pone el sistema al
        -- insertar, no una persona. Dejarlos asignables a mano romperia el
        -- deduplicado y el conteo de ocurrencias.
        raise exception 'TRANSICION_INVALIDA: % no se asigna a mano; lo determina el sistema al importar.',
          new.estado using errcode = '42501';
    end case;
  end if;

  -- Sello de tiempo. Lo pone el gate, no un trigger aparte, para que no se
  -- pueda escribir a mano una fecha de actualizacion falsa.
  new.actualizado_en := now();

  return new;
end;
$$;

drop trigger if exists dian_staging_transicion on public.documento_dian_staging;
drop trigger if exists dian_staging_update_gate on public.documento_dian_staging;
create trigger dian_staging_update_gate
  before update on public.documento_dian_staging
  for each row execute function public._dian_staging_update_gate();

revoke all on function public.dian_staging_columnas_congeladas() from public, anon, authenticated, service_role;
grant execute on function public.dian_staging_columnas_congeladas() to authenticated;
revoke all on function public._dian_staging_update_gate() from public, anon, authenticated, service_role;

-- `documento_dian_staging`: sin DELETE. El UPDATE si se permite, porque los
-- cuatro actos se registran sobre la misma fila (§5.1).
drop trigger if exists dian_staging_sin_borrar on public.documento_dian_staging;
create trigger dian_staging_sin_borrar
  before delete on public.documento_dian_staging
  for each row execute function public._dian_staging_sin_borrar();
drop trigger if exists dian_staging_sin_truncate on public.documento_dian_staging;
create trigger dian_staging_sin_truncate
  before truncate on public.documento_dian_staging
  for each statement execute function public._dian_staging_sin_truncate();

drop trigger if exists dian_lote_sin_borrar on public.lote_importacion_dian;
create trigger dian_lote_sin_borrar
  before delete on public.lote_importacion_dian
  for each row execute function public._dian_staging_sin_borrar();
drop trigger if exists dian_lote_sin_truncate on public.lote_importacion_dian;
create trigger dian_lote_sin_truncate
  before truncate on public.lote_importacion_dian
  for each statement execute function public._dian_staging_sin_truncate();

-- Identidad y tablas hijas: nada se borra ni se actualiza.
drop trigger if exists dian_identidad_sin_borrar on public.documento_dian_identidad;
create trigger dian_identidad_sin_borrar
  before delete on public.documento_dian_identidad
  for each row execute function public._dian_staging_sin_borrar();
drop trigger if exists dian_identidad_sin_truncate on public.documento_dian_identidad;
create trigger dian_identidad_sin_truncate
  before truncate on public.documento_dian_identidad
  for each statement execute function public._dian_staging_sin_truncate();

do $$
declare
  t text;
begin
  foreach t in array array[
    'documento_dian_linea_staging', 'documento_dian_impuesto_staging',
    'documento_dian_retencion_staging', 'documento_dian_forma_pago_staging'
  ] loop
    execute format('drop trigger if exists dian_hija_sin_borrar on public.%I', t);
    execute format(
      'create trigger dian_hija_sin_borrar before delete on public.%I
         for each row execute function public._dian_staging_sin_borrar()', t);
    execute format('drop trigger if exists dian_hija_sin_truncate on public.%I', t);
    execute format(
      'create trigger dian_hija_sin_truncate before truncate on public.%I
         for each statement execute function public._dian_staging_sin_truncate()', t);
  end loop;
end;
$$;

drop trigger if exists dian_resolucion_inmutable on public.documento_dian_resolucion;
create trigger dian_resolucion_inmutable
  before update or delete on public.documento_dian_resolucion
  for each row execute function public._dian_resolucion_inmutable();
drop trigger if exists dian_resolucion_sin_truncate on public.documento_dian_resolucion;
create trigger dian_resolucion_sin_truncate
  before truncate on public.documento_dian_resolucion
  for each statement execute function public._dian_staging_sin_truncate();

revoke all on function public._dian_staging_sin_borrar() from public, anon, authenticated, service_role;
revoke all on function public._dian_staging_sin_truncate() from public, anon, authenticated, service_role;
revoke all on function public._dian_resolucion_inmutable() from public, anon, authenticated, service_role;

-- === 14. dian_registrar_documento: el registro con dedupe (§4.5) ============
-- Un punto de entrada POR DOCUMENTO, no un insert por lote, porque el
-- manejador de excepcion necesita su propio ambito: una violacion de
-- unicidad aborta la transaccion en curso, y sin el bloque la sentencia
-- fallida deja la transaccion muerta (§4.4).
--
-- El tenant se deriva del servidor, NUNCA del parametro: si viajara como
-- argumento, un llamador podria escribir en el tenant de otra agencia.
--
-- Devuelve el desenlace (nuevo | duplicado | discrepante), el id del documento
-- insertado y el id del original cuando aplica. La UI necesita los tres.
create or replace function public.dian_registrar_documento(
  p_lote_id              bigint,
  p_clave                text,
  p_clave_base           text,
  p_cufe                 text,
  p_cude                 text,
  p_tipo_documento       text,
  p_tipo_documento_original text,
  p_numero               text,
  p_fecha                date,
  p_proveedor_nit        text,
  p_proveedor_identificacion text,
  p_proveedor_nombre     text,
  p_moneda               text,
  p_trm                  numeric,
  p_subtotal             numeric(15,2),
  p_total_declarado      numeric(15,2),
  p_total_calculado      numeric(15,2),
  p_xml_hash             text default null,
  p_fila_origen          integer default null,
  p_motivo_pendiente     text default null,
  p_fuera_de_corte       boolean default false,
  -- OPCION A: los hijos entran por la MISMA llamada (§4.10). Son arrays de
  -- objetos jsonb con las claves de las tablas hijas. Todo o nada: si un solo
  -- hijo falla, la cabecera tampoco queda.
  p_lineas               jsonb default '[]'::jsonb,
  p_impuestos            jsonb default '[]'::jsonb,
  p_retenciones          jsonb default '[]'::jsonb,
  p_formas_pago          jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tenant     text := public.mi_tenant();
  v_identidad  public.documento_dian_identidad%rowtype;
  v_identidad_existe boolean := false;
  v_documento  public.documento_dian_staging%rowtype;
  v_original   bigint;
  v_estado     text;
  v_actor      uuid := auth.uid();
  v_rol        text := public.mi_rol()::text;
begin
  if not public.dian_staging_puede_importar(v_tenant) then
    raise exception 'SIN_PERMISO: el rol % no puede importar documentos DIAN.', v_rol
      using errcode = '42501';
  end if;

  -- El lote tiene que ser de este tenant y estar en proceso.
  if not exists (
    select 1 from public.lote_importacion_dian l
    where l.id = p_lote_id
      and l.tenant = v_tenant
      and l.estado = 'en_proceso'
  ) then
    raise exception 'LOTE_INVALIDO: el lote % no existe, no es de este tenant o no esta en proceso.', p_lote_id
      using errcode = '23503';
  end if;

  -- (1) Intento registrar la identidad. El indice unico (tenant, clave) es lo
  --     que serializa a las importaciones simultaneas (§4.3).
  begin
    insert into public.documento_dian_identidad (
      tenant, clave, clave_base, total_referencia, ocurrencias
    ) values (v_tenant, p_clave, p_clave_base, p_total_declarado, 0)
    returning * into v_identidad;
    v_identidad_existe := false;
  exception when unique_violation then
    select * into v_identidad
    from public.documento_dian_identidad
    where tenant = v_tenant and clave = p_clave
    for update;
    v_identidad_existe := true;
  end;

  -- (2) Si la identidad ya existia, el total decide el desenlace.
  if v_identidad_existe then
    if abs(v_identidad.total_referencia - p_total_declarado) <= 0.01 then
      v_estado := 'duplicado';
    else
      v_estado := 'discrepante';
    end if;

    select id into v_original
    from public.documento_dian_staging
    where documento_dian_identidad_id = v_identidad.id
      and estado <> 'duplicado'
    order by id
    limit 1;

    -- Una identidad sin documento vigente es un estado inconsistente que
    -- esta migracion no deberia poder dejar. Si aparece, se dice con un
    -- error claro en vez de insertar un duplicado sin origen.
    if v_original is null then
      raise exception
        'IDENTIDAD_SIN_ORIGINAL: la identidad % no tiene documento vigente; revise antes de reimportar.',
        v_identidad.id
        using errcode = '23514';
    end if;

    insert into public.documento_dian_staging (
      lote_id, documento_dian_identidad_id, tenant, periodo, fuente,
      clave, clave_base, cufe, cude, tipo_documento, tipo_documento_original,
      numero, fecha, proveedor_nit, proveedor_identificacion, proveedor_nombre,
      moneda, trm, subtotal, total_declarado, total_calculado,
      diferencia, diferencia_tolerada,
      xml_hash, fila_origen, estado, motivo_pendiente, fuera_de_corte,
      duplicado_de, discrepante_de, creado_por
    ) values (
      p_lote_id, v_identidad.id, v_tenant, to_char(p_fecha, 'YYYY-MM'),
      (select l.fuente from public.lote_importacion_dian l where l.id = p_lote_id),
      p_clave, p_clave_base, p_cufe, p_cude, p_tipo_documento,
      p_tipo_documento_original,
      p_numero, p_fecha, p_proveedor_nit, p_proveedor_identificacion,
      p_proveedor_nombre,
      coalesce(p_moneda, 'COP'), p_trm, p_subtotal, p_total_declarado, p_total_calculado,
      p_total_declarado - p_total_calculado,
      abs(p_total_declarado - p_total_calculado) <= 0.01,
      p_xml_hash, p_fila_origen, v_estado,
      coalesce(p_motivo_pendiente,
        case when v_estado = 'discrepante'
             then 'Mismo CUFE/clave con total distinto: ' || v_identidad.total_referencia
                  || ' vs ' || p_total_declarado
             else null end),
      p_fuera_de_corte,
      v_original, v_original,
      v_actor
    ) returning * into v_documento;

    update public.documento_dian_identidad
       set ocurrencias = ocurrencias + 1,
           actualizado_en = now()
     where id = v_identidad.id;

    insert into public.documento_dian_resolucion (
      documento_id, estado_anterior, estado_nuevo, actor_id, actor_rol,
      campo, valor_nuevo, motivo
    ) values (
      v_documento.id, 'nuevo', v_estado, v_actor, v_rol,
      'estado', to_jsonb(v_estado::text),
      case when v_estado = 'discrepante'
           then 'Mismo CUFE/clave con total distinto; se conserva para revision.'
           else 'Reenvio exacto del documento ' || coalesce(v_original::text, '?') || '.' end
    );

    -- Un DUPLICADO no guarda hijos (§4.7): la evidencia del reenvio es la fila
    -- misma, con su lote, su hash y su posicion. Un DISCREPANTE si los
    -- guarda: lo que hay que mirar es en que se diferencian.
    if v_estado = 'discrepante' then
      perform public._dian_staging_insertar_hijos(
        v_documento.id, p_lineas, p_impuestos, p_retenciones, p_formas_pago);
    end if;

    return jsonb_build_object(
      'resultado', v_estado,
      'documento_id', v_documento.id,
      'original_id', v_original,
      'identidad_id', v_identidad.id
    );
  end if;

  -- (3) Identidad nueva: documento normal, con sus hijos (todos o ninguno).
  insert into public.documento_dian_staging (
    lote_id, documento_dian_identidad_id, tenant, periodo, fuente,
    clave, clave_base, cufe, cude, tipo_documento, tipo_documento_original,
    numero, fecha, proveedor_nit, proveedor_identificacion, proveedor_nombre,
    moneda, trm, subtotal, total_declarado, total_calculado,
    diferencia, diferencia_tolerada,
    xml_hash, fila_origen, estado, motivo_pendiente, fuera_de_corte, creado_por
  ) values (
    p_lote_id, v_identidad.id, v_tenant, to_char(p_fecha, 'YYYY-MM'),
    (select l.fuente from public.lote_importacion_dian l where l.id = p_lote_id),
    p_clave, p_clave_base, p_cufe, p_cude, p_tipo_documento,
    p_tipo_documento_original,
    p_numero, p_fecha, p_proveedor_nit, p_proveedor_identificacion,
    p_proveedor_nombre,
    coalesce(p_moneda, 'COP'), p_trm, p_subtotal, p_total_declarado, p_total_calculado,
    p_total_declarado - p_total_calculado,
    abs(p_total_declarado - p_total_calculado) <= 0.01,
    p_xml_hash, p_fila_origen, 'importado',
    p_motivo_pendiente, p_fuera_de_corte, v_actor
  ) returning * into v_documento;

  update public.documento_dian_identidad
     set ocurrencias = 1, actualizado_en = now()
   where id = v_identidad.id;

  -- (4) Los hijos, en la MISMA transaccion que la cabecera. Si uno falla, la
  --     cabecera tampoco queda: por eso esta es la opción A y no "cabecera
  --     primero, hijos después", que dejaba documentos huérfanos (§4.10).
  perform public._dian_staging_insertar_hijos(
    v_documento.id, p_lineas, p_impuestos, p_retenciones, p_formas_pago);

  return jsonb_build_object(
    'resultado', 'nuevo',
    'documento_id', v_documento.id,
    'original_id', null,
    'identidad_id', v_identidad.id,
    'hijos', jsonb_build_object(
      'lineas', coalesce(jsonb_array_length(p_lineas), 0),
      'impuestos', coalesce(jsonb_array_length(p_impuestos), 0),
      'retenciones', coalesce(jsonb_array_length(p_retenciones), 0),
      'formas_pago', coalesce(jsonb_array_length(p_formas_pago), 0))
  );
end;
$$;

-- === 14a. Inserción de hijos en la misma transacción (§4.10, opción A) ===
--
-- Recibe arrays de objetos jsonb y los inserta con `jsonb_to_recordset`. Al
-- vivir dentro de la transacción de `dian_registrar_documento`, el "todo o
-- nada" es gratis: si el cast de un hijo falla, la excepción aborta la
-- transacción entera y la cabecera insertada hace rollback con ella.
--
-- Por qué hay que VALIDAR la forma antes de castear: `jsonb_to_recordset`
-- convierte el error en un 22P02 ("invalid input syntax for type numeric")
-- que no dice qué campo ni qué documento. Con la validación, el error dice qué
--.array va mal, y el cliente puede corregirlo sin leer el servidor.
--
-- Un hijo mal formado NO es un caso raro: los arrays vienen del cliente, y un
-- campo que llega como texto donde va un número es el error de forma más
-- habitual que va a aparecer en producción.
create or replace function public._dian_staging_validar_hijos(
  p_nombre text, p_hijos jsonb
) returns void language plpgsql immutable set search_path = public as $$
begin
  if p_hijos is null or jsonb_typeof(p_hijos) <> 'array' then
    raise exception 'HIJOS_INVALIDOS: % debe ser un array jsonb, no %',
      p_nombre, coalesce(jsonb_typeof(p_hijos), 'null')
      using errcode = '22P02';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_hijos) with ordinality as e(hijo, pos)
    where jsonb_typeof(e.hijo) <> 'object'
  ) then
    raise exception
      'HIJOS_INVALIDOS: % tiene al menos un elemento que no es un objeto jsonb (posicion %)',
      p_nombre, (
        select e.pos from jsonb_array_elements(p_hijos) with ordinality as e(hijo, pos)
         where jsonb_typeof(e.hijo) <> 'object' order by e.pos limit 1)
      using errcode = '22P02';
  end if;
end;
$$;

create or replace function public._dian_staging_insertar_hijos(
  p_documento_id       bigint,
  p_lineas              jsonb,
  p_impuestos           jsonb,
  p_retenciones         jsonb,
  p_formas_pago         jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._dian_staging_validar_hijos('p_lineas', p_lineas);
  perform public._dian_staging_validar_hijos('p_impuestos', p_impuestos);
  perform public._dian_staging_validar_hijos('p_retenciones', p_retenciones);
  perform public._dian_staging_validar_hijos('p_formas_pago', p_formas_pago);

  if jsonb_array_length(p_lineas) > 0 then
    insert into public.documento_dian_linea_staging (
      documento_id, numero, descripcion, cantidad, precio_unitario,
      base, descuento, cuenta_contable_emisor, impuestos)
    select p_documento_id, (h->>'numero')::integer, h->>'descripcion',
           (h->>'cantidad')::numeric, (h->>'precio_unitario')::numeric,
           (h->>'base')::numeric, (h->>'descuento')::numeric,
           h->>'cuenta_contable_emisor', h->'impuestos'
    from jsonb_array_elements(p_lineas) as e(h);
  end if;

  if jsonb_array_length(p_impuestos) > 0 then
    insert into public.documento_dian_impuesto_staging (
      documento_id, codigo, nombre, tasa, base, valor, origen)
    select p_documento_id, h->>'codigo', h->>'nombre',
           (h->>'tasa')::numeric(7,4), (h->>'base')::numeric, (h->>'valor')::numeric,
           h->>'origen'
    from jsonb_array_elements(p_impuestos) as e(h);
  end if;

  if jsonb_array_length(p_retenciones) > 0 then
    insert into public.documento_dian_retencion_staging (
      documento_id, codigo, nombre, campo_origen, estructura, base, valor)
    select p_documento_id, h->>'codigo', h->>'nombre', h->>'campo_origen',
           h->>'estructura', (h->>'base')::numeric, (h->>'valor')::numeric
    from jsonb_array_elements(p_retenciones) as e(h);
  end if;

  if jsonb_array_length(p_formas_pago) > 0 then
    insert into public.documento_dian_forma_pago_staging (
      documento_id, codigo, fecha, monto)
    select p_documento_id, h->>'codigo', (h->>'fecha')::date, (h->>'monto')::numeric
    from jsonb_array_elements(p_formas_pago) as e(h);
  end if;
end;
$$;

comment on function public._dian_staging_insertar_hijos is
  'Inserta los hijos del documento en la misma transaccion que la cabecera. Un fallo revierte todo (§4.10).';

revoke all on function public._dian_staging_validar_hijos(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._dian_staging_insertar_hijos(bigint, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;

comment on function public.dian_registrar_documento is
  'Registro de un documento DIAN con dedupe (§4.5). El tenant se deriva del servidor, nunca del parametro.';

-- `revoke`/`grant` SIN lista de argumentos: la funcion tiene 21 parametros y
-- escribir la firma a mano es una fuente de errores silenciosos (si la
-- assinatura no coincide exactamente, el revoke no aplica y la funcion queda
-- ejecutable por anon). Sin lista, Postgres aplica a todas las sobrecargas
-- con ese nombre, que hoy es una sola.
revoke all on function public.dian_registrar_documento
  from public, anon, service_role;
grant execute on function public.dian_registrar_documento
  to authenticated;

-- === 15. trg_auditoria en las 8 tablas (§11.1) ============================
-- El DO loop de la migracion 087 solo corrio una vez, sobre las tablas que
-- existian. Una tabla nueva nace SIN auditoria, asi que se adjunta a mano.
-- El postcheck verifica que quedo puesta, en vez de suponerlo.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'lote_importacion_dian', 'documento_dian_identidad',
        'documento_dian_staging', 'documento_dian_linea_staging',
        'documento_dian_impuesto_staging', 'documento_dian_retencion_staging',
        'documento_dian_forma_pago_staging', 'documento_dian_resolucion'
      )
  loop
    execute format('drop trigger if exists trg_auditoria on public.%I', r.relname);
    execute format(
      'create trigger trg_auditoria after insert or update or delete on public.%I
         for each row execute function public.fn_auditoria()', r.relname);
  end loop;
end;
$$;

-- === 16. Lectura de catalogos para PREPARAR (decision del dueno 2026-10-17) =
-- Preparar es asignar proveedor y cuenta PUC. Sin esto los tres roles
-- contables leen 0 filas de `proveedores`, `proveedores_datos_sensibles` y
-- `puc_cuentas` (sus policies no los nombran) y no podrian preparar nada.
--
-- Son policies NUEVAS y solo de SELECT, que se suman (OR) a las existentes de
-- 126 y 189 sin tocarlas: el rollback solo las borra y lo demas queda igual.
-- Ninguna da escritura sobre estos catalogos.
--
-- RIESGO ACEPTADO por el dueno: `proveedores_datos_sensibles` incluye datos
-- bancarios (banco, tipo y numero de cuenta, datos de pago), no solo el NIT.
-- La alternativa recomendada (busqueda por NIT que devolviera solo id, nombre y
-- NIT) se descarto. Cada rol contable ve solo las filas de SU agencia
-- (`mi_tenant_real()`, el mismo criterio de la 189).
drop policy if exists "dian: lectura contable de proveedores" on public.proveedores;
create policy "dian: lectura contable de proveedores" on public.proveedores
  for select to authenticated
  using (public.mi_rol()::text in ('contador', 'revisor_fiscal', 'admin_contable'));

drop policy if exists "dian: lectura contable de datos de proveedor" on public.proveedores_datos_sensibles;
create policy "dian: lectura contable de datos de proveedor" on public.proveedores_datos_sensibles
  for select to authenticated
  using (public.mi_rol()::text in ('contador', 'revisor_fiscal', 'admin_contable')
         and tenant = public.mi_tenant_real());

drop policy if exists "dian: lectura contable del PUC" on public.puc_cuentas;
create policy "dian: lectura contable del PUC" on public.puc_cuentas
  for select to authenticated
  using (public.mi_rol()::text in ('contador', 'revisor_fiscal', 'admin_contable')
         and tenant = public.mi_tenant_real());

commit;

notify pgrst, 'reload schema';