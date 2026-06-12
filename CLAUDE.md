# CLAUDE.md — Sistema Integral D'spacios Travel

> Este documento es el **cerebro del proyecto**. Resume todo lo diseñado antes de abrir
> Claude Code. Léelo completo antes de escribir o modificar código. Si algo cambia,
> actualiza este archivo: es la fuente de verdad.

---

## 0. Resumen en una frase

Construir **una sola aplicación web** para la agencia mayorista de turismo **D'spacios Travel**
que unifique cinco módulos (tarifario, generador de contratos, gestión/ventas, inventario de
vuelos y finanzas), reemplazando un conjunto de hojas de cálculo y apps sueltas por un sistema
multiusuario con base de datos real.

---

## 1. Visión

Hoy la operación vive repartida en Google Sheets y una app de finanzas en Vercel. La meta es
**consolidar todo** en una app moderna, con base de datos real, login por roles y un flujo
completo: consultar tarifa → armar paquete → generar contrato → gestionar venta, pagos,
proveedores y rentabilidad.

La pieza central que **no existe todavía** es el **tarifario** y el **generador de contratos**.
Los demás módulos ya tienen su lógica y su modelo de datos definidos (ver sección 6).

---

## 2. Marca — D'spacios Travel

- **Nombre oficial:** D'spacios Travel (con apóstrofe). Bajante: "Mayorista de Turismo".
- **Logo:** lettering con avión + espiral en la "O". Hay versiones full color y monocromáticas
  (el usuario provee los archivos `.png`/`.svg`). En web, el logo va como **imagen**, no como fuente.

### Paleta oficial (tokens) — usar parejo en toda la app

| Token | Nombre | HEX | Rol en la UI |
|---|---|---|---|
| `--brand-primary` | Jelly Bean Blue | `#1D7C9A` | Primario: barra, títulos, precios, botones principales |
| `--brand-accent` | Scooter | `#26BBD9` | Acento/interacción: links, pestaña activa, CTA |
| `--brand-success` | Piper | `#66B596` | Estados positivos: disponible, confirmado, pagado |
| `--brand-highlight` | Lima | `#AEF44A` | Realce puntual: badges, highlights (con moderación) |

Pantone de referencia: Scooter 319C, Piper 2241C, Jelly Bean Blue 2235C, Lima 367C.

### Tipografías

- Marca original: **Dolce Vita** (display/logo) y **Century Gothic** (texto). No son fuentes web libres.
- En web: el logo va como imagen; para textos usar una geométrica libre equivalente a Century Gothic,
  p. ej. **Jost** o **Questrial** (Google Fonts). Mantener look limpio y geométrico.

---

## 3. Stack y decisiones técnicas

- **Framework:** Next.js (React + TypeScript). Permite SSR para el tarifario público, rutas de API
  y generación de PDF en servidor.
- **Base de datos + Auth + Storage:** **Supabase** (Postgres). Auth con roles (RLS por filas),
  Storage para los PDF de contratos.
- **Despliegue:** Vercel (frontend/SSR) + Supabase (datos).
- **Reutilización:** la app de finanzas actual (`apps-web`, React + Vite) ya trae la lógica pura
  (`calcCostos`, `calcComision`) y constantes colombianas; se porta a componentes Next.js casi sin tocar.
- **PDF de contratos:** generación en servidor a partir de plantilla (replicar el formato del contrato
  actual de la agencia — ver sección 10).

---

## 4. Roles y accesos

Internos:
- `superadmin` — control total y configuración (rol del dueño).
- `gerencia`, `administracion`, `operaciones`, `venta` — visibilidad por módulo según función.

Externos:
- `publico` (sin login) — solo consulta del **tarifario público**.
- `agencia` / `freelance` (con login) — ve **tarifa neta** y puede reservar / generar contrato.
- `cliente_final` — recibe/consulta su contrato.

Por ahora: **sin carrito ni pasarela de pagos**. Una reserva genera un contrato; pagos se suman después.
El inventario de vuelos ya define roles `admin` y `control_vuelo` (Javier es `control_vuelo`).

---

## 5. Arquitectura — los 5 módulos

1. **Tarifario** *(a construir)* — hoteles, temporadas, planes, precios por acomodación. Consulta
   pública sin login + tarifa neta con login. Es el corazón que alimenta todo.
2. **Generador de contratos** *(a construir)* — captura pasajeros, arma el paquete desde el tarifario,
   descuenta sillas del inventario, crea la venta y genera el PDF.
3. **Gestión / ventas / finanzas tributaria** *(modelo listo)* — ventas, abonos, cuentas por pagar,
   comisiones, facturación, rentabilidad con provisiones colombianas.
4. **Inventario de vuelos** *(modelo listo)* — bloqueos, sillas, pasajeros, estados, cambios entre
   records, plazos de devolución.
5. **Finanzas laborales / punto de equilibrio / comisiones** *(código existe)* — la app `apps-web`.

**Dos llaves cosen todo:** `numero_contrato` (formato `00-0451`) y `record`/PNR del vuelo (ej. `L93FYZ`).

---

## 6. Modelo de datos

> Origen: esquema ya diseñado en las hojas "BD Sistema de Gestión V2" e "INVENTARIO APPWEB".
> Al migrar a Postgres: `id` como `uuid` o `bigserial`; fechas `date`/`timestamptz`; montos `numeric`.
> Normalizar catálogos (asesores, proveedores, hoteles) con claves foráneas.

### 6.1 Llaves de unión
- `numero_contrato` une: `ventas` ↔ `abonos` ↔ `cuentas_por_pagar` ↔ `sillas` ↔ `rentabilidad` ↔ `facturacion`.
- `record` (PNR) une: `bloqueos_vuelo` ↔ `sillas`.

### 6.2 Gestión / ventas / finanzas

- **ventas:** `numero_contrato`, fecha_venta, asesor, canal, tipo_cliente, cliente, destino,
  tipo_paquete, fecha_salida, fecha_regreso, pax, hotel, aerolinea, receptivo, asistencia,
  otros_proveedores, precio_venta, costo_hotel, costo_aereo, costo_receptivo, costo_asistencia,
  otros_costos, estado, observaciones, facturado, numero_documento.
- **abonos:** numero_contrato, cliente, fecha_abono, valor_abono, forma_pago, referencia,
  recibido_por, comprobante, observacion.
- **cuentas_por_pagar:** numero_contrato, proveedor, tipo_proveedor, servicio, fecha_obligacion,
  fecha_vencimiento, valor_total, aplica_retencion, pct_retencion, abono1..3 (+fechas),
  observaciones, tipo_facturacion, base_gravable, iva_proveedor, valor_irt.
- **aliados_b2b:** numero_contrato, aliado, nit, tipo_aliado, contacto, precio_venta, base_comision,
  pct_comision, recobro_total, pct_recobro_aliado, aplica_retencion, pct_retencion, estado.
- **liquidacion_comisiones:** numero_contrato, asesor, mes_liquidacion, precio_venta, costo_total,
  com_b2b_pagada, fecha_liquidacion, fecha_pago, estado.
- **facturacion:** numero_contrato, numero_factura, fecha_factura, cliente, nit_cliente, descripcion,
  tipo_documento, naturaleza_ingreso, base_gravable, iva_descontable, base_tercero, comision_fee,
  factura_todo, estado_dian, obs_tributaria.
- **rentabilidad:** numero_contrato, asesor, destino, canal, pax, precio_venta, costo_directo,
  iva_generado, iva_descontable, com_b2b, com_asesor, util_bruta, prov_ica, prov_bomberil,
  prov_fontur, prov_renta, total_provisiones, util_neta, margen_neto, clasificacion, mes, fecha_calculo.
- **asesores:** nombre, email, rol, pct_comision_base, pct_sobre_meta, meta_mensual, activo.
- **proveedores (catálogo):** nombre, nit, tipo, ciudad, contacto, aplica_retencion, pct_retencion.
- **aliados (catálogo):** nombre, nit, contacto, email, telefono, aplica_retencion, pct_retencion.
- **parametros_tributarios:** parametro, valor, base_calculo, descripcion.
  Valores actuales: ICA 0.01 (ingresos brutos), Bomberil 0.01 (% del ICA), Fontur 0.025 (utilidad bruta),
  Retención Renta 0.035, IVA 0.19, Retención Honorarios 0.11.
- **usuarios:** email, nombre, rol, activo, fecha_registro.

### 6.3 Inventario de vuelos / sillas

- **bloqueos_vuelo:** record (PNR, único), aerolinea, ruta, vuelo_ida, fecha_ida, hora_salida_ida,
  hora_llegada_ida, vuelo_regreso, fecha_regreso, hora_salida_reg, hora_llegada_reg, cupos_total,
  tarifa_para_empaquetar, fecha_devolucion (plazo para devolver sillas), fecha_emision, notas.
- **sillas:** bloqueo_id (FK), numero_silla, estado, numero_contrato (FK, nullable),
  pasajero_nombres, pasajero_apellidos, tipo_doc, numero_doc, nacimiento, asesor, agencia, hotel,
  acomodacion, plazo, inf_nombres, inf_apellidos, inf_tipo_doc, inf_numero, inf_nacimiento,
  responsable_menor.
  - Estados de silla: `disponible`, `en_plazo`, `confirmada`, `devuelta`, `no_vendida`,
    `cambio` / `cambio_entrante` (transferencia de sillas entre records).
- **movimientos_silla** *(sugerido)*: registrar transferencias entre records (origen→destino, cantidad, fecha).
- Nota: los **pasajeros de paquetes con vuelo viven aquí** (en la silla). Para paquetes sin vuelo
  (porción terrestre), los pasajeros van asociados directamente al contrato/venta.

### 6.4 Tarifario *(a construir — modelo nuevo)*

- **destinos:** nombre, codigo_iata.
- **hoteles:** destino_id (FK), nombre, zona, notas.
- **habitaciones:** hotel_id (FK), nombre (ej. "Estándar vista al mar").
- **planes_alimentacion (catálogo):** codigo, nombre (PC, PAM, PAE, PA, FULL, etc. — ver sección 7).
- **temporadas:** destino_id (FK), nombre (ALTA / MEDIA / BAJA).
- **temporada_fechas:** temporada_id (FK), fecha_inicio, fecha_fin (las "salidas" por rango).
- **tarifas:** hotel_id, habitacion_id, plan_id, temporada_id, noches (base 3), comisionable (bool),
  impuesto_no_comisionable (ej. San Andrés $599.000/pax), notas.
- **tarifa_precios:** tarifa_id (FK), acomodacion (`sencilla`/`doble`/`triple`/`multiple`/`nino`), precio.
  (Modelar precios como filas, no columnas: un "NO APLICA" simplemente no existe como fila.)
- **itinerarios:** destino_id (FK), ruta, fecha_ida, fecha_regreso, cupos. (Enlazar con `bloqueos_vuelo`.)
- **inclusiones:** destino_id (FK), tipo (`incluye`/`no_incluye`), texto.

---

## 7. Reglas de negocio clave

### Tipos de paquete
- **Bloqueo:** vuelo negociado (silla de un `record`) + hotel negociado. Tarifa comisionable.
- **Empaquetado:** ticket por sistema + hotel negociado del tarifario.
- **Dinámico:** vuelo y hotel tomados por sistema (no negociados).
- **Porción terrestre:** sin vuelo (solo hotel + traslados/tours). Puede ser negociada o dinámica.

### Planes de alimentación (catálogo, confirmar significados — sección 10)
PC, PAM, PAE, PA, PA+OPEN BAR, FULL, FULL TROPICAL, FULL PREMIUM.

### Tarifas
- En el tarifario actual la tarifa es **por persona / 3 noches**, comisionable al 100% salvo
  impuestos marcados como no comisionables (ej. San Andrés).
- **Pendiente confirmar** si el motor debe calcular otras duraciones (4/5/7 noches, noche adicional).
- Validación en el montaje: no permitir guardar tarifas en `0` / `#VALUE!` / incompletas.

### Flujo del generador de contratos
tarifario (arma paquete + precio) → captura pasajeros → si lleva vuelo, asigna sillas de un `record`
(descuenta cupos) → crea la `venta` (genera `numero_contrato`) → genera PDF → queda enlazado a
abonos, proveedores y rentabilidad.

---

## 8. Plan por fases

- **Fase 0 — Cimientos:** proyecto Next.js + Supabase, login con roles, migración del esquema
  (ventas, sillas/bloqueos, proveedores, parámetros tributarios, usuarios) a Postgres + RLS.
- **Fase 1 — Tarifario:** tablas + módulo de montaje + consulta pública + tarifa neta con login.
- **Fase 2 — Generador de contratos:** pasajeros + armado de paquete + asignación de sillas +
  creación de venta + PDF.
- **Fase 3 — Operaciones:** control de vuelos/sillas completo sobre el nuevo modelo (estados, cambios, plazos).
- **Fase 4 — Finanzas:** portar la app de costos laborales/breakeven/comisiones y conectar la
  rentabilidad por contrato.
- **Fase 5 — Portal de agencias/clientes y pulido.**

Empezar por **Fase 0**.

---

## 9. Fuentes de datos actuales (referencia, Google Drive)

Carpeta "BETA SISTEMA NUEVO V1.1":
- **BD Sistema de Gestión V2** (Sheet) — esquema de gestión/ventas/finanzas.
- **INVENTARIO APPWEB** (Sheet) — bloqueos, sillas, pasajeros.
- **Sistema de Gestión** (Sheet) — auxiliar.

Otros:
- **Tarifario D'spacios Travel 2026** (Sheet) — datos de tarifas (hoteles, temporadas, precios).
- **INVENTARIO SMR / INVENTARIO CTG** (Sheets) — inventario por destino.
- Contratos/vouchers en PDF (ej. "VOUCHERS VUELO CONTRATO 00-0451") — referencia de formato.

Para migrar datos reales: exportar cada hoja a CSV e importar a Supabase (no es prioridad en Fase 0).

---

## 10. Decisiones pendientes (resolver con el dueño)

1. **Tarifa por noches:** ¿siempre por persona/3 noches, o calcular otras duraciones?
2. **Planes de alimentación:** confirmar significado exacto de PC, PAM, PAE, PA, FULL, FULL TROPICAL,
   FULL PREMIUM, PA+OPEN BAR. Dejar como catálogo editable.
3. **Plantilla de contrato:** leer un contrato actual (ej. 00-0451) para replicar el formato/texto legal.
4. **Pagos:** quedan para una fase posterior (hoy reserva → contrato → envío).

---

## 11. Convenciones de código

- TypeScript estricto. Componentes y lógica de negocio separados.
- Lógica de cálculo como **funciones puras** y testeables (heredar el patrón de `calcCostos`/`calcComision`).
- Tokens de marca como variables CSS (sección 2). Nada de colores sueltos hardcodeados.
- Montos en `numeric`; formatear en UI con separador de miles colombiano.
- Constantes legales (SMMLV 1.750.905; subsidio transporte 249.095 — Decretos dic-2025) en un solo
  archivo de constantes; actualizar cada diciembre con el nuevo salario mínimo.
- Migraciones de base versionadas (carpeta de migraciones de Supabase).

---

## 12. Seguridad

- **Rotar las llaves de Supabase** que estuvieron en el `.env` compartido (Supabase → Settings → API).
- Claves y tokens solo en variables de entorno (`VITE_*` / `NEXT_PUBLIC_*` según corresponda), nunca en el repo.
- RLS activado en todas las tablas: cada cliente/agencia ve solo lo suyo; tarifarios y finanzas, restringidos.

---

## 13. Estado del proyecto (handoff) — actualizado en desarrollo

> Rama de trabajo: **`claude/dazzling-planck-MsBCZ`** (PR #1 hacia `main`). Producción
> = `main` (se mergeará al terminar). La **base de datos Supabase es única** y compartida
> entre `main` y la rama; las migraciones ya aplicadas afectan también a producción.
> App en `dspacios-travel/` (Next.js App Router + Supabase SSR).

> **Novedades rama `claude/laughing-goodall-e59PS`:**
> - **CxP automáticas:** al reservar desde el tarifario se crean solas las cuentas
>   por pagar de hotel, aéreo y servicios (con proveedor y retención del catálogo).
> - **Cartera** (`/dashboard/cartera`) y **Pagos a proveedores** (`/dashboard/pagos`):
>   módulos centrales tipo listado para el área contable (saldos por cobrar/pagar,
>   estado de cuenta, registrar abonos/pagos). Conscientes de moneda. Roles contables.
> - **Programas** (`/dashboard/producto/programas`): circuitos multi-ciudad de un
>   proveedor, **en USD**, con montaje por secciones (ruta, itinerario, matriz de
>   hoteles/precios por categoría/acomodación, incluye/no incluye, tours, blackouts).
>   Precio = neto + %markup. Publica al tarifario (tab Programas + vitrina pública
>   `/tarifario/programa/[id]`) y se reserva (`/dashboard/reservar/programa/[id]`) →
>   contrato (con `moneda`) + CxP al proveedor. Migración **031**. *Pendiente:* el
>   detalle tributario del contrato (rentabilidad/IVA/provisiones) sigue en COP;
>   las CxP guardan máx. 3 pagos.
> - Marca: logo oficial del manual aplicado; carpeta `docs/marca/` y `docs/programas/`.

### Marca / identidad (aplicada)
- Manual oficial en `dspacios-travel/docs/marca/Identidad DESPACIOS.pdf`.
- **Logo como imagen** (regla del manual, no como fuente) en `public/marca/`:
  `logo-full.png` (full color, fondos claros), `logo-white.png` (blanco, fondos de
  color/degradado), `logo-black.png` (negro). Componente reutilizable `components/Logo.tsx`
  (`variant="full|white|black"`, `height`). Ya en sidebar/topbar del dashboard, login y
  header del tarifario público.
- **Degradado de marca** `--brand-gradient` (azul→turquesa→verde) en `styles/globals.css`
  + clase `.bg-brand-gradient`; usado en el header del tarifario público.
- Paleta confirmada con el manual (mismos HEX): Conifer/Lima `#AEF44A`, Scooter `#26BBD9`,
  Piper `#66B596`, Jelly Bean Blue `#1D7C9A`. Tipografía web **Jost** = equivalente a
  Century Gothic. Íconos PWA/app (`icon-192/512`, `icon-maskable-512`, `apple-icon`) =
  logo blanco sobre el degradado.

### Programas (terceros) — manejo simplificado · rama `claude/modest-clarke-Ehftt`
> Los programas son circuitos de **terceros**; cada proveedor manda un Word/PDF con
> estructura distinta. En vez de re-tipear, el montaje ahora arranca pegando el texto.
- **Importador "pegar del proveedor"** (`lib/programasImport.ts` — parser PURO + pestaña
  *Importar ✨* en el editor del programa). Detecta del texto crudo: **días/noches, ruta
  (ciudades), itinerario día por día e incluye/no incluye** (con cierre de bloque por
  encabezados de precios/hoteles/notas para no tragar tablas). Vista previa + casillas por
  sección → `importarDesdeTexto` **reemplaza** solo las secciones marcadas. Probado contra
  los 4 ejemplos reales en `docs/programas/ejemplos/`.
- **Campos de vitrina** (migración **066**): `desde_precio` (titular "Desde" manual; manda
  sobre el mínimo de la matriz — útil cuando el proveedor solo da "Desde $X"), `incluye_aereo`
  (Solo terrestre / Con aéreo → badge en tarjeta y cabecera), `portada_url` (imagen).
- Modelo de precios **sin cambios**: por categoría × acomodación. Programas con precio por
  **periodo de salida** (ej. Sendero del Oeste) se montan usando cada "categoría" como
  temporada de precio. (Si más adelante se quiere matriz fecha×precio nativa, es el próximo paso.)

### Flujo de negocio implementado
**PRODUCTO** (costos netos) → **PAQUETES** (armas + margen) → **TARIFARIO** (resultado,
interno y público) → **RESERVAR** (genera contrato/venta).

### Módulos construidos
- **Producto:** Destinos (`/dashboard/producto/destinos`, MAYÚSCULAS + IATA), Proveedores,
  Configuración (categorías de habitación, regímenes), **Hoteles** (temporadas propias +
  tarifa neta por categoría/régimen/temporada con **Niño 1 y Niño 2**; editar tarifa; config
  de edades y rangos; **config de acomodaciones** — pax mín/máx del hotel y, por acomodación,
  `pax_tarifa` (multiplicador por habitación) + mín/máx de adt/niños/inf), **Servicios** (precio **por persona** y/o **por grupo con rangos de
  pax**; destino vacío = nacional). **Carga masiva CSV** en hoteles, tarifas, servicios y
  bloqueos (plantillas con `sep=;`, listas con `|`).
- **Paquetes (armado):** config inicial (nombre, **tipo** bloqueo/porción/servicios, **noches**
  para porción, destino, vigencia compra, rango viaje, **%mk**, impuesto tiquete/fijo). Adición
  de **vuelos** (solo bloqueo; check + mk o **TA** + "seleccionar todos"), **hoteles** (ventana
  para elegir categorías/regímenes), **servicios** (check + elegir **persona/grupo**). **Generar
  tarifario** → escribe `tarifario_resultado`. Editar config del paquete.
- **Tarifario interno** (`/dashboard/tarifario`): vista del resultado generado (solo lectura).
- **Tarifario público** (`/tarifario`): tabla **horizontal** (Hotel·Categoría·R.A.·Sencilla·
  Doble·Triple·Múltiple·**Chd1·Chd2**), "ver más opciones" por hotel; módulos
  **Bloqueos/Porción/Servicios**. Botón **Ingresar** + login con **Google (OAuth)**.
- **Reservar** (`/dashboard/reservar`): en **porción/dinámico** el asesor elige **fecha de ida/
  regreso** y se **re-liquida en vivo** (`cotizarPorFechas`, service-role); bloqueo usa fechas del
  record. Luego formulario **por habitaciones**
  (cantidad de habitaciones por tipo; valor = `pax_tarifa` × tarifa/persona) + **niños 1/2 e
  infantes por cantidad**, **cliente**, **pasajeros** con "copiar del cliente" + nacionalidad,
  tipo de venta interno/agencia/freelance → canal B2B/B2C, **plazo**) → crea **venta pendiente**
  + **sillas en_plazo** (descuenta cupos) + contrato + PDF.
- **Contratos:** estado pendiente/confirmado; **Confirmar venta** (rol alto) o **abono** auto-
  confirma → sillas confirmada. Editar cabecera. **Cron diario** libera vencidas.
  Al generar valida **pasajeros ↔ acomodación** (edades vs habitaciones; bloquea si no cuadra).
- **Contrato (visual):** hotel "N hab Doble (M pax)"; **servicios** en tabla aparte (Servicio·Pax·
  Valor total); **vuelo** Origen/Destino derivados de la ruta IATA (`lib/iata.ts`, catálogo editable).
- **Vuelos:** **dashboard de control** (tarjetas Bloques/Disponibles/En plazo/Confirmadas/
  Devueltas + tabla de salidas con conteo por estado y % de ocupación; record → pasajeros del
  record); bloqueos con **destino** + rangos de edad; editar bloqueo; carga masiva. El tarifario
  y Reservar muestran cupos y **ocultan/bloquean** salidas sin cupos.
- **Configuración:** asesores, parámetros tributarios, **rangos de edad**, **formas de pago**.

### Motor de cálculo (`lib/calc/paquetes.ts`)
- Hotel: liquida **noche por noche** (mezcla temporadas), `costo/(1−%mk)`.
- Vuelo: por vuelo eliges `costo/(1−mk)` **o** `costo + TA`.
- PVP = hotel + servicios + vuelo. **Impuesto (BNC)** = tiquete neto o fijo. Base com. = PVP − imp.
- Niño 1 / Niño 2 = acomodaciones `nino` / `nino2` (0 = gratis, sí se publica).

### Editar reserva pendiente
- **HECHO (servicios):** en un contrato `pendiente`, `ServiciosContratoEditor` +
  `actualizarServiciosContrato` permiten marcar/desmarcar los servicios del paquete; re-liquida
  servicios (× pax), actualiza ítems, `precio_venta` y (admin) `costo_receptivo` + casillas
  Tours/Asistencia. Cambiar hotel/fechas = por ahora anular + reservar.
- **PENDIENTE (opcional) — Editar "completa (mismo #)"** (cambiar hotel/fechas/habitaciones sin
  cambiar el número). Plan:
1. **Refactor del motor:** que `reservarDesdeTarifario` acepte `editarNumero?: string`. En modo
   edición: no genera número; verifica que la venta exista y esté `pendiente`; **libera** sus
   sillas `en_plazo` (vuelven a `disponible`) y **borra** `contrato_items`/`contrato_hoteles`/
   `contrato_vuelos`/`contrato_pasajeros`; hace `update` de `ventas` en vez de `insert`; recrea
   hijos y **reasigna sillas** con la nueva selección; recalcula costos (hotel/aéreo/receptivo).
   Reutiliza TODA la liquidación existente (incl. `liquidarHotelPaquete` para porción por fechas).
2. **UI:** botón "Editar reserva" en el contrato pendiente → reabre `/dashboard/reservar/nuevo`
   en modo edición con el formulario **precargado** (cliente, fechas, categoría/régimen,
   habitaciones por tipo, niños/infantes, servicios, tipo de venta, pasajeros). Cargar esos datos
   desde la venta + `contrato_*` y mapearlos al estado del `ReservaForm`.
3. Validar que solo `pendiente` se pueda editar; el server re-valida y re-liquida (autoritativo).
Riesgo: toca el core de reservar — probar create Y edit (bloqueo y porción) antes de mergear.

### Migraciones Supabase — correr en orden 016→031
016 producto · 017 config_hoteles · 018 armado_paquetes (+`tarifario_resultado`) ·
019 armado_hotel_filtros · 020 dos_ninos · 021 rangos_edad · 022 reserva_tarifario ·
023 paquete_tipo · 024 servicio_tarifas_pax · 025 porcion_noches_servicio_modo ·
026 servicio_incluido · 027 hotel_acomodaciones (reservar por habitaciones + config acomod.) ·
028 formas_pago (catálogo de formas de pago para abonos) ·
029 servicio_categoria (tour_traslado/asistencia/otro → ubica el servicio en el contrato) ·
030 contrato_vuelo_hotel_extra (record/horas/números de vuelo + categoría/proveedor de hotel) ·
031 programas (9 tablas de circuitos de proveedor + `moneda` en ventas y cuentas_por_pagar).
Scripts sueltos: `supabase/scripts/fusion_cartagena.sql` ·
`supabase/scripts/backfill_sillas_pasajeros.sql` (rellena datos de pasajero en sillas viejas).
Env en Vercel: `SUPABASE_SERVICE_ROLE_KEY` (sillas/costos), opcional `CRON_SECRET`.
Google OAuth: callback `/auth/callback`; Site URL = producción.

### PENDIENTE / próximos pasos
- **Etapa 2 — Servicios como add-on al reservar:** dejar de hornear servicios en la tarifa del
  hotel; en Reservar mostrar los servicios del paquete y calcular por persona (× pax) o por
  grupo (rango que cubra los pax), sumándolos al contrato. *(HECHO; queda afinar.)*
- Afinar rentabilidad/costos del contrato (módulo de gestión).
- Reservar desde el módulo Servicios del tarifario. *(HECHO.)*
- Merge de la rama a `main` cuando todo esté validado.

### REDISEÑO DE RESERVAR (anotaciones del dueño — pendiente, prioridad alta)
1. **Motor de consulta por fechas:** *(HECHO para porción/dinámico — `cotizarPorFechas` +
   `liquidarHotelPaquete` en reservar/actions, reutiliza el motor del generador.)* En Reservar
   (no bloqueo) el asesor pone **Fecha de ida y regreso**; el sistema **liquida esas noches**
   (noche por noche, mezclando temporadas) con service-role y muestra las tarifas. Valida contra
   el rango de viaje del paquete. Al generar, el server **re-liquida** con esas fechas
   (autoritativo). Bloqueo mantiene las fechas fijas del record.
2. **Reservar por HABITACIONES, no por personas:** hoy se piden personas por acomodación, mal.
   Debe pedir **cantidad de habitaciones** por tipo: 1 hab Doble ⇒ tarifa_doble × 2 pax;
   1 Triple ⇒ tarifa_triple × 3; Sencilla ⇒ × 1; etc. **Niños e infantes** sí van por **cantidad**
   (de niños / de infantes), aparte. *(HECHO — migración 027 + `lib/acomodaciones.ts`. Reservar
   pide habitaciones por tipo; valor = pax_tarifa × tarifa/persona; niños/infantes por cantidad.
   El detalle del contrato y los ítems se guardan como "N hab Doble (M pax)".)*
3. **Config de acomodaciones por hotel** (se desprende del punto 2): *(HECHO — tabla
   `hotel_acomodaciones` + editor en el detalle del hotel. `pax_tarifa` = multiplicador de la
   tarifa por persona de 1 habitación; defaults 1/2/3/4 si no se configura.)*
   - A) Mínima y máxima acomodación (pax mín/máx del hotel). *(`hoteles.pax_min/pax_max`.)*
   - B) Por acomodación: pax máx + (mín/máx adultos, mín/máx niños, mín/máx infantes).
     Ej. Sencilla: máx 2 pax | adt 1–1 | chd 0–1 | inf 0–1. Doble: máx 4 | adt 2–2 | chd 0–2 | inf 0–2.
     *(Guardado en `hotel_acomodaciones`; alimenta la validación del punto 4.)*
4. **Validación pasajeros vs acomodación:** *(HECHO — `validarReservaHabitaciones` +
   `clasificarPorEdad` en `lib/acomodaciones.ts`.)* Clasifica pasajeros por fecha de nacimiento
   (umbrales del hotel `edad_infante_max`/`edad_nino_max`, referidos a la fecha de salida) y los
   compara con la acomodación: capacidad de niños/infantes/pax por habitación, pax mín/máx del
   hotel y edades reales vs declaradas. Muestra **alerta** (errores bloquean, avisos informan) y
   **no deja generar**; el server re-valida (autoritativo).
5. **Contrato pendiente:** *(PARCIAL)* — aéreo ✅ y ahora **costo del hotel negociado** ✅
   (liquidado noche por noche desde `tarifa_hotel`, admin/service-role, en `ventas.costo_hotel`).
   **Forma de pago como lista desplegable** ✅ (catálogo `formas_pago`, editable en Configuración;
   dropdown en el abono). *FALTA:* costos de **proveedores/servicios** netos
   (`costo_receptivo`/`otros_costos`).
6. **Visualización del contrato:** el hotel debe leerse como **"1 hab doble"** o **"2 pax en
   acomodación Doble"** (no "2 Doble" ambiguo). Aclarar habitaciones vs pax.


---

*Fin del documento. Mantener actualizado conforme avanza el proyecto.*
