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
- **ÍCONOS, NUNCA EMOJIS.** Toda la UI usa íconos **lucide-react** (ej. `Megaphone`,
  `ExternalLink`, `X`). Nada de emojis (📣, ✕, 👌, ⚙️…) en botones, menús, títulos ni
  estados. Regla permanente pedida por el dueño.
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

## 12.bis Convenciones técnicas críticas (NO romper el build)

- **⚠️ Middleware = `proxy.ts` (Next.js 16).** Este proyecto corre **Next 16**, que
  renombró el middleware a **`proxy.ts`** (raíz de `dspacios-travel/`, exporta
  `proxy` + `config`). **NO crear `middleware.ts`**: tener AMBOS rompe el build con
  *"Both middleware file and proxy file are detected. Please use ./proxy.ts only"*.
  Toda lógica de middleware (auth por sesión, redirecciones por rol) va DENTRO de
  `proxy.ts`. Ahí vive: protección de rutas no públicas (→ `/login`) y el **bloqueo
  de roles externos (B2B) al dashboard interno** (agencia/freelance/cliente_final →
  `/portal/b2b`, salvo `/dashboard/reservar` donde sí generan contrato).
- **Verificar siempre con `npm run build`** (no solo `tsc --noEmit`) antes de subir:
  errores de Next/Turbopack (archivos de convención duplicados, rutas, etc.) NO los
  detecta el typecheck y SÍ tumban el deploy en Vercel.
- **⚠️ NUNCA mezclar migraciones de D'spacios (`main`) con las de `saas-whitelabel`.**
  Este mismo repo tiene DOS líneas de producto que **divergen a partir de la
  migración 113**, cada una con su propia base de datos Supabase: `main` (D'spacios
  Travel, este documento) y la rama `saas-whitelabel` (el mismo código, pero
  genérico multi-organización para otros clientes). A partir de la **114 los
  números YA COLISIONAN con contenido distinto**: `main` tiene 114 `crm_difusion`,
  115 `fix_numeracion_y_servicios`, 116 `rls_tenant_isolation`, 117
  `eliminar_contrato_rol`, 118 `hotel_infante_cargo`… mientras que `saas-whitelabel`
  tiene 114 `saas_organizaciones`, 115 `saas_org_id_backfill`, 116
  `saas_org_default_mi_org`, 117 `saas_rls_org_isolation`, 118
  `saas_uniques_por_org`… **Mismo número, contenido totalmente distinto.** Reglas:
  - Antes de crear una migración nueva, confirmar en QUÉ rama se está trabajando
    y correr `ls supabase/migrations/ | sort | tail` **en esa rama** (no asumir
    el número libre de la otra).
  - Una migración pensada para D'spacios (hoteles, tarifario, contratos, CRM,
    etc.) **no aplica** a `saas-whitelabel` y viceversa (multi-org genérico).
    No copiar/portar una migración de una rama a la otra sin revisar a
    conciencia si el cambio tiene sentido para esa línea de producto.
  - Si algún día se vuelve a sincronizar `main` → `saas-whitelabel` (como ya se
    hizo una vez, ver changelog), hay que **renumerar** las migraciones que
    colisionen — nunca asumir que el mismo número significa lo mismo en las
    dos ramas.

---

## 13. Estado del proyecto (handoff) — actualizado en desarrollo

> Rama de trabajo actual: **`claude/peaceful-noether-713c7c`** (ya **mergeada a `main`**).
> Producción = `main` (Vercel despliega de `main`). La **base de datos Supabase de D'spacios
> es única** y compartida entre `main` y sus ramas de trabajo (`claude/*`); las migraciones
> ya aplicadas afectan también a producción. **⚠️ Esto NO incluye `saas-whitelabel`**: esa
> rama es otra línea de producto con su propia base de datos Supabase separada — ver el
> aviso de "NUNCA mezclar migraciones" en la sección 12.bis antes de tocar migraciones.
> App en `dspacios-travel/` (Next.js App Router + Supabase SSR).
> **Migraciones a la fecha en repo (línea D'spacios/`main`): hasta la 125** — todas
> confirmadas corridas por el dueño, incluida la **125** (`retenciones_cxp` — ver
> "Novedades recientes").

> **Novedades recientes (rama `claude/peaceful-noether-713c7c`, en `main`):**
> - **Auditoría de seguridad (jul-2026) — 4 hallazgos críticos/altos corregidos:**
>   1. **Escalación de privilegios**: `dashboard/usuarios/actions.ts` usaba el
>      cliente service-role (bypassa RLS) sin validar el rol de quien llamaba —
>      cualquier usuario interno autenticado podía volverse `superadmin`. Ahora
>      exige sesión + rol `superadmin`/`administracion` en la Server Action misma,
>      y **solo superadmin** puede asignar/crear el rol `superadmin`.
>   2. **Aislamiento por tenant en RLS**: `puede_ver_tenant()` (migr. 107) existía
>      pero ninguna policy la usaba — un `administracion`/`operaciones` de una
>      agencia podía leer/escribir ventas, abonos, CxP, comisiones y facturación de
>      la OTRA agencia (la separación era solo de UI). **Migración 116** (ya
>      corrida) agrega el filtro de tenant a esas policies — depende de que todo
>      usuario interno no-superadmin tenga `usuarios.tenant` correcto (supuesto
>      del que ya dependía `tenantContext()`/el selector de agencia).
>   3. **Suplantación en portal B2B**: la pertenencia de un contrato se resolvía
>      también por `agencia_nombre`/`freelance_nombre` en texto libre (sin
>      unicidad) — alguien podía registrarse con el mismo nombre que un aliado real
>      y ver sus contratos/comisiones. Ahora el registro (`portal/registro/actions.ts`)
>      y la creación interna de usuarios bloquean nombres de agencia/freelance
>      duplicados.
>   4. **Cron jobs sin `CRON_SECRET`**: `/api/cron/*` solo validaban el secreto
>      *si* la env var existía; si faltaba en Vercel quedaban abiertos a cualquiera
>      con la URL. Ahora fallan cerrado (503) si `CRON_SECRET` no está configurada
>      — **es obligatoria**, no opcional (Vercel la manda sola como Bearer en sus
>      cron jobs).
>   **Fase 2 (inyección/validación de inputs) — 3 hallazgos más corregidos:**
>   5. **`eliminar_contrato()` sin candado dentro de la función**: es
>      `SECURITY DEFINER` (bypassa RLS) pero no validaba `mi_rol()` — la Server
>      Action sí exigía superadmin, pero se podía saltar llamando el RPC directo
>      desde el navegador con el JWT propio. **Migración 117** agrega el mismo
>      candado que ya usan `fn_renumerar_contrato`/`fn_fusionar_destino`.
>   6. **Importador de histórico minorista sin candado de rol**: `importarHistorico`
>      (reescribe masivamente ventas/abonos) solo validaba el tenant, cualquier
>      usuario autenticado (incl. `venta`) podía invocarlo. Ahora exige
>      `superadmin`/`administracion`, en la Server Action y en el nav (`layout.tsx`).
>   7. **`crearContrato`**: las tarifas/cantidades de los ítems (vienen del
>      cliente) no se validaban como números finitos ≥ 0 antes de sumar el PVP;
>      y un paquete "negociado" sin tarifas configuradas en el catálogo caía en
>      silencio a aceptar la tarifa que mandara el cliente. Ahora valida los
>      ítems y falla si el paquete negociado no tiene tarifas configuradas.
>   Queda pendiente: headers de seguridad (CSP/X-Frame-Options) y la fase 3
>   (estructura de código/dependencias), no iniciada todavía.
> - **Cuenta de cobro B2B — solo freelance (persona natural):** las agencias
>   (persona jurídica) deben facturar electrónicamente, no generan cuenta de
>   cobro. `portal/b2b/page.tsx` ya no muestra el link "Cuenta de cobro" para
>   contratos con `tipo_asesor='agencia'` (muestra "Factura electrónica" en su
>   lugar); `portal/comision/[numero]/page.tsx` bloquea el acceso directo con un
>   mensaje explicativo. De paso, 3 bugs corregidos encontrados al revisar esto:
>   el membrete de la cuenta de cobro tenía fijo "Mayorista de Turismo" (ahora
>   usa `agencias.nombre_comercial`/`razon_social` del tenant real vía
>   `agenciaDe()`); el insert de `aliados_b2b` en `crearContrato` no estampaba
>   `tenant` (quedaba siempre 'mayorista' por default); y `dashboard/comisiones`
>   no filtraba `aliados_b2b` por tenant, así que superadmin/gerencia veían
>   comisiones de ambas agencias mezcladas sin indicarlo. **Nota:** minorista no
>   tiene tarifario/reservar (`minoristaOculto: true`), así que hoy no genera
>   comisiones B2B nuevas de todas formas — el importador de histórico tampoco
>   crea `aliados_b2b`.
> - **Mejoras portal minorista/mayorista (jul-2026), 6 pedidos del dueño:**
>   1. **CxP: botón pagado/pendiente.** `GestionTabs.tsx` (pestaña Proveedores)
>      solo tenía editar/eliminar; ahora cada cuenta muestra su estado
>      (Pagado/Pendiente · saldo) y un panel para registrar pagos (hasta 3,
>      con TRM si es USD) y deshacer el último — reutiliza la regla de
>      `dashboard/pagos/actions.ts`. Esas acciones ahora también revalidan la
>      página del contrato (antes solo `/dashboard/pagos`, quedaba desactualizada).
>   2. **Comisiones B2B: inputs incómodos.** Los campos de base comisionable/
>      recobro/% eran `type="number"` (spinners +/- nativos, tediosos para
>      montos grandes). Ahora son texto + `inputMode="numeric"` con
>      selección automática al enfocar — se puede escribir/pegar de una vez.
>   3. **Editar precio de venta y pasajeros de un contrato.** El panel
>      "Editar datos del contrato" no tenía `precio_venta` ni `pax` (solo
>      cliente/destino/fechas) — no había forma de corregirlos después de
>      creado. Se agregaron ambos campos a `EditarVentaForm`/`actualizarVenta`.
>   4. **Cartera: fecha de abono + corregir un abono mal digitado.**
>      `registrarAbono` no aceptaba fecha (siempre quedaba "hoy"); ahora
>      `AbonoForm`/Cartera tienen selector de fecha. Se agregaron
>      `actualizarAbono`/`eliminarAbono` (editar/eliminar un abono ya
>      registrado, en vez de tener que crear uno nuevo para "cuadrar" un
>      error) en el detalle del contrato y en `/dashboard/cartera`.
>   5. **Hotel "Adults Only".** Migración **119** (`hoteles.adults_only`):
>      toggle en `HotelConfigEditor` que bloquea la reserva si declaran
>      niños/infantes (`lib/reservar/computo.ts`) y muestra el aviso "Adults
>      Only" en el tarifario público.
>   6. **CRM Difusión: vigencia de la promoción.** Migración **120**
>      (`crm_difusion_plan.vigencia_hasta`): cada envío programado en el
>      Calendario puede llevar fecha de vencimiento; se ve como badge
>      (vigente/vence pronto/vencida) y ya se puede **editar** una
>      programación existente (antes solo cambiar estado o eliminar).
> - **Hoteles pet friendly.** Migración **121** (`hoteles.pet_friendly/
>   pet_costo_neto/pet_costo_desc/pet_nota`): checkbox "Acepta mascotas" en
>   `HotelConfigEditor.tsx`, tarifa (0 = gratis) + nota. El motor
>   (`lib/reservar/computo.ts`) bloquea declarar mascotas si el hotel no las
>   acepta y cobra el cargo × noches con el mismo % de markup, itemizado aparte
>   en el contrato. `ReservaForm.tsx` agrega "Cantidad de mascotas" solo si es
>   pet friendly; el tarifario público muestra el badge + aviso sin exponer el
>   costo neto.
> - **Tarifa de infante reorganizada — igual que Niño 1/Niño 2 (jul-2026).**
>   Migración **122** (ya corrida), reemplaza el mecanismo de la 118:
>   un hotel real (Virrey Cartagena) cobra la tarifa de infante distinto según
>   el plan/temporada, así que un valor plano por hotel no alcanzaba. Ahora
>   `infante` es una acomodación más (`tarifa_hotel.neto_infante`/`nota_infante`,
>   por categoría/régimen/temporada, agregada al enum `acomodacion_tipo` igual
>   que se hizo con `nino2` en la migración 020) y se edita en
>   `HotelDetalleClient.tsx` (pestaña Tarifa neta), no en la config del hotel.
>   `$0` = gratis, igual que niño. El PVP fluye por el motor de siempre
>   (`generarTarifario`/`lib/reservar/cotizar.ts`) hasta `computo.ts`/
>   `ReservaForm`/tarifario público sin mecanismo aparte. **Asimetría
>   deliberada:** a diferencia de niño, si el hotel no configuró tarifa de
>   infante para un combo, la reserva NO se bloquea (queda gratis) — para no
>   romper de un día para otro las reservas con infante de los hoteles que
>   aún no han cargado esta tarifa nueva. Detalle completo en "Motor de
>   cálculo". Los campos viejos de la 118 (`hoteles.infante_cargo_neto/
>   infante_cargo_desc/infante_nota`) no se borraron (no se borran columnas en
>   este proyecto) pero la app ya no los lee ni los escribe.
> - **Calculadora Dubai: promos por régimen + "N noches, 1 gratis" (jul-2026).**
>   Migración **123** (ya corrida), `hotel_temporadas.regimen_restringido`:
>   dos pedidos puntuales de la calculadora Dubai que terminaron siendo mecanismos
>   generales. (1) El % de descuento de una promo ahora solo se aplica a la
>   tarifa BASE, nunca al suplemento de régimen — la propia calculadora Dubai
>   genera la temporada promocional ya con la matemática correcta
>   (`DubaiParams.promos[]` en `lib/calc/calculadoras.ts`); (2) nuevo tipo de
>   vigencia `promo_noche_gratis` ("compra 3 noches, paga 2" — siempre se regala
>   exactamente 1 noche, sin importar si son 3, 4 o más), que a diferencia de
>   tarifa/descuento_pct/descuento_monto se resuelve a nivel de la ESTADÍA
>   completa, no noche por noche (`promoNocheGratisFactor` en
>   `lib/calc/paquetes.ts`). Ambas piezas pueden restringirse a **un solo
>   régimen** aunque el hotel tenga varios (`regimen_restringido`, null =
>   todos). Detalle completo en "Motor de cálculo".
> - **Retenciones a proveedores + Conciliaciones Cartera/Proveedores (jul-2026):**
>   (1) Nuevo módulo `Contabilidad → Retenciones a proveedores`: se busca
>   por número de contrato + **tipo de proveedor** (no el proveedor
>   puntual — funciona igual esté o no especificado con nombre) para
>   registrar la retefuente practicada: valor, fecha en que se practicó y
>   mes en que se declara a la DIAN. Migración **125** (`retenciones_cxp`,
>   log — puede haber más de una por cuenta) reemplaza el viejo
>   `aplica_retencion`/`pct_retencion` que era solo un % fijo informativo,
>   sin fecha y sin descontarse de nada. Ahora la retención SÍ se
>   descuenta del saldo pendiente del proveedor, igual que un abono
>   (`dashboard/pagos` y la pestaña Proveedores del contrato ya lo
>   reflejan; `lib/finanzas/retenciones.ts` centraliza la suma).
>   (2) Conciliaciones bancarias: se separó en dos pestañas — **Cartera**
>   (valores positivos: abonos/ingresos) y **Proveedores** (negativos:
>   pagos/egresos) — filtra ambos lados (extracto y sistema) a la vez.
>   En Proveedores se sugiere además el **saldo pendiente** de cada CxP
>   (valor_total − abonos − retenciones) como candidato de cruce, para el
>   caso de pagos hechos pero nunca registrados en el sistema. Al cruzar
>   un saldo sugerido se auto-registra el pago real sobre la cuenta (mismo
>   motor de `dashboard/pagos`) — si la cuenta es en USD o ya tiene los 3
>   pagos llenos, no bloquea la conciliación, solo avisa que se registre
>   manual.
> - **CMS del sitio: subir imagen directamente + fix imagen rota (jul-2026):**
>   `components/sitio/edicion/Editable.jsx` (botón "Cambiar imagen" del editor
>   in-situ) y `app/cms/editors/SubirArchivo.tsx` (panel ⚙ / Ajustes de página)
>   solo aceptaban pegar una URL — un link de Google Drive (la página visor,
>   no el archivo) dejaba la imagen rota, mostrando el `alt` (el título de la
>   sección) como texto plano sin estilo encima del título real, como si
>   estuviera duplicado. Ahora ambos suben el archivo directo al bucket
>   `web-cms` (`subirArchivoWeb`); si la imagen falla igual no se muestra el
>   alt roto (se oculta el `<img>`). De paso se encontró y corrigió que Next
>   limita a 1 MB el body de un Server Action — las fotos reales (2-8 MB)
>   nunca llegaban a la validación de 15 MB ya existente; se subió el límite
>   a 16 MB (`experimental.serverActions.bodySizeLimit` en `next.config.ts`).
> - **Vista Booking: "desde" tomaba la tarifa de infante (jul-2026):**
>   `minRoomPvp` excluía Niño 1/Niño 2 del cálculo de la tarifa mínima
>   ("desde") pero no Infante (agregado después, migración 122) — como
>   infante casi siempre es la más barata (a veces $0), el "desde" de las
>   tarjetas de hotel mostraba el precio de infante en vez del de adulto.
>   Ahora usa la lista positiva `ACOM_ROOMS` en vez de exclusión manual
>   (inmune a futuras acomodaciones). Mismo fix en `TarifarioPublic.tsx`
>   (un `neto_infante` en $0 se mostraba como "—" en vez de "$0").
> - **Conciliaciones bancarias — borrado en bloque, parser y sugerencias
>   (jul-2026):** (1) hasta ahora solo se podía borrar línea por línea del
>   extracto importado — se agregó "Seleccionar todo (visible)" + "Eliminar
>   seleccionadas" (combinado con el filtro de Mes, permite deshacer un lote
>   completo mal importado). (2) El parser (`lib/contabilidad/extracto.ts`)
>   tomaba como "monto" cualquier celda de puros dígitos — un número de
>   cuenta en su propia columna (sin separador decimal) se colaba como
>   valor/saldo si quedaba en las últimas posiciones de la fila. Ahora exige
>   punto decimal (el banco siempre exporta montos con 2 decimales), lo que
>   descarta cualquier columna extra de puros dígitos sin importar su
>   posición. (3) Sugerencia automática de cruce: al seleccionar ítems de un
>   solo lado, se busca en el lado contrario un ítem o par cuya suma cuadre
>   (`mejorCombo`, acotado a pares) — se resalta + botón "Usar sugerencia".
>   (4) Migración **124** (ya corrida) agrega
>   `conciliacion_sistema.numero_contrato` (snapshot al cruzar, desde el
>   abono/CxP de origen) — se ve como badge y como link a
>   `/dashboard/contratos/[numero]` en la sección de Conciliados.
> - **Fix sitio público — crash en secciones de tipo Texto (jul-2026):**
>   `components/sitio/secciones/Texto.jsx` era la única sección del CMS sin la
>   directiva `"use client"` pese a llamar `useEdicion()` (hook de Context,
>   solo cliente) — rompía en producción cualquier página con una sección
>   Texto (ej. `/sitio_web/san-andres`) con "Attempted to call useEdicion()
>   from the server but useEdicion is on the client". Corregido agregando la
>   directiva (PR #156), sin dependencia de migración.
> - **Multitenant — dos agencias en una sola app:** **Mayorista** (actual, completa) y
>   **Minorista** (agencia anterior, solo para terminar de gestionar + histórico; sin
>   tarifario/montaje). Misma BD + columna `tenant` ('mayorista'/'minorista', default
>   mayorista) en ventas/abonos/CxP/facturación/aliados/comisiones/pe_*/movimientos/
>   conciliación/usuarios/auditoría. Cookie de agencia activa + `lib/tenant.ts`
>   (compartido) y `lib/tenant.server.ts` (`tenantContext`, `getTenant`, `agenciaDe`).
>   **Solo superadmin alterna** agencias (`TenantSwitcher`, recarga completa al cambiar);
>   los demás usuarios se crean por agencia. **Numeración independiente**: la minorista usa
>   el MISMO formato `00-XXXX` que la mayorista, así que sus contratos se guardan con
>   **prefijo `MIN-`** (`numeroConTenant`/`numeroVisible`) para NO colisionar con la PK
>   global. `proxy.ts` redirige al dashboard si en minorista entras a un módulo oculto.
>   Migr. **107** (tenant), **108** (auditoría tenant), **109** (`agencias`: identidad
>   fiscal del RUT por agencia).
> - **Importador de histórico minorista** (`/dashboard/contratos/importar`): pegar de
>   Google Sheets → "Relación de utilidades" (ventas + costos) y "Resumen de pagos"
>   (titular/asesor/doc + abonos por cuota). Parser puro `lib/minorista/importMinorista.ts`
>   (COP/USD por fila, fechas dd/mm/yyyy y "05 SEP 2023", salta SALTO/ANULADO, anotaciones,
>   negativos). **Candado: solo corre en agencia minorista** (prefijo MIN-). Sin migración.
>   **Genera CxP (proveedores) automáticamente**: por cada costo > 0 (hotel/aéreo/
>   receptivo/asistencia/otros) crea su `cuentas_por_pagar`; toma el proveedor real
>   cuando la hoja lo trae (col. 9 = proveedor de hotel, col. 11 = proveedor de
>   traslados — antes se confundían, ya corregido) y usa **"Sin especificar"** cuando
>   no hay nombre (asistencia/otros no traen proveedor en la hoja). Editable después
>   en el contrato → pestaña **Proveedores** (texto libre o autocompletar del catálogo
>   `proveedores` vía `<datalist>`). **No duplica** (solo agrega los tipos que le
>   falten a cada contrato) → re-pegar/re-importar las mismas hojas también sirve
>   como *backfill* retroactivo para los contratos importados antes de este fix, sin
>   pisar ediciones manuales ya hechas. El botón genérico "Completar proveedores"
>   (`asegurarCuentasPorPagar`) ya no exige que exista `contrato_hoteles` para crear
>   la CxP de hotel, y también cae a "Sin especificar" en vez de dejar el proveedor
>   vacío.
> - **Contabilidad** (módulo nuevo): **Facturación** (IRT vs Ingreso propio/IP por contrato,
>   pestaña **DIAN**), **Movimientos de pagos**, **Conciliaciones bancarias** (pegar extracto
>   + cruce manual N:M con validador de sumas), **Estados financieros**, **Datos de la
>   agencia** (RUT). Provisiones sobre ingreso propio; IRT separado al pasivo (no costo);
>   **impuesto de renta 35% sobre renta líquida** (la retención 3.5% es otro concepto).
>   Migr. **098-106**.
> - **Punto de equilibrio** (2 pestañas: Dashboard con ventas mínimas del mes = breakeven
>   +15% dinámico; Configuración con empleados + costos fijos). Nómina con **exoneración
>   automática por empresa declarante** (no por empleado; solo ≥10 SMMLV no exonera).
>   Costos fijos alimentan flujo de caja; gastos variables desde Movimientos. Margen
>   consistente con Rentabilidad (helper `lib/finanzas/rentabilidad.ts`). Migr. **101**.
> - **Finanzas USD/TRM:** confirmación con abono ≥30% toma su TRM; CxP a proveedor en pesos
>   a la TRM del día de pago; rentabilidad/IVA con TRM promedio. Display **"USD $2.200"** en
>   todas las pantallas (`formatMoneda`/`formatUSD`). Migr. **095-097**.
> - **Servicios en USD** (migr. **110**) + **guard de cero-mezcla de monedas** en el
>   tarifario: un paquete es de UNA moneda; hoteles y servicios (incluidos u opcionales)
>   deben coincidir o no genera.
> - **Reservar en USD:** `liquidarHotelPaquete`/`cotizarPorFechas` pasan la moneda del hotel
>   a `componerTarifa` → redondeo a **dólar entero** (antes redondeaba al millar de pesos:
>   "$2.000"). `ReservaForm` muestra `USD $xxx`.
> - **Programas — documento comercial + piezas:** portada (imagen subible que es el FONDO del
>   encabezado, ajustada con object-cover), sellos en chips, Incluye/No incluye ítem por línea
>   con íconos, **highlights** (migr. **111**), **observaciones internas** (no salen en el
>   PDF), **marca blanca vs D'Spacios** (auto por rol agencia/freelance + toggle `?marca=`).
>   **Piezas SUBIDAS** (no generadas): el dueño sube flyer/historia/portada (bucket
>   `programas`, migr. **113**) y el cliente las descarga. **Bug corregido:** columna
>   fantasma (acomodación con neto 0 → PVP de solo asistencia) en `pvpPrograma`/montaje.
> - **Catálogo:** **fusionar/eliminar destinos duplicados** desde la UI (si tiene hoteles,
>   pregunta a qué destino moverlos → `fn_fusionar_destino`, migr. **112**, re-apunta toda
>   FK y borra). **Editar nombre y destino del hotel** desde su configuración.
> - Etiqueta **"Porción terrestre"** en vez de "Solo terrestre" (config/vitrina/doc/tarifario).

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
- Modelo de precios **sin cambios** en estructura: por categoría × acomodación. Programas con
  precio por **periodo de salida** (ej. Sendero del Oeste) se montan usando cada "categoría"
  como temporada de precio. (Si más adelante se quiere matriz fecha×precio nativa, es el próximo paso.)
- **Precio de venta (PVP)** — el montaje ahora calcula el PVP, no solo republica el neto
  (migración **067** + `pvpPrograma` en `lib/programas.ts`, fuente única usada por vitrina,
  resumen y `reservarPrograma`):
  `PVP = neto/(1−markup) + asistencia_medica_dia×días, todo /(1−fee_bancario)`.
  Campos en la cabecera: **Markup proveedor %** (`pct_mk`, convención margen del app),
  **Fee bancario %** (`pct_fee_tarjeta`) y **Asistencia médica/día** (`asistencia_medica_dia`,
  por pax y por día). La pestaña *Hoteles y precios* muestra el **PVP en vivo** bajo cada neto.
  *Nota:* los 4 ejemplos publicados traían el neto del proveedor **sin** recargo (eran
  reformateos); de ahí que el montaje deba definir el precio de venta. El markup es **margen**:
  `neto/(1−mk)` con `mk` en decimales (0,25 = 25%) — confirmado por el dueño.
- **⚠️ Programas ≠ Paquetes — NO mezclar las dos estructuras de PVP.** Son motores
  independientes en archivos distintos: el PVP de **paquetes** vive en `lib/calc/paquetes.ts`
  (`componerTarifa`/`liquidarHotelNoches`/`factorLiquidacion`, impuesto BNC, etc.) y **está
  bien, no se toca**; el PVP de **programas** vive en `lib/programas.ts` (`pvpPrograma`) y solo
  se usa en contexto de programas (vitrina, matriz, `reservarPrograma`). `pct_mk`/`pct_fee_tarjeta`
  son columnas de tablas distintas (`paquetes` vs `programas`). No compartir fórmula ni campos.

### Flujo de negocio implementado
**PRODUCTO** (costos netos) → **PAQUETES** (armas + margen) → **TARIFARIO** (resultado,
interno y público) → **RESERVAR** (genera contrato/venta).

### Cotización dinámica / manual — estado (rama `claude/modest-clarke-Ehftt`)
> Base: migración **084** (`cotizacion_manual`). El asesor arma una cotización a mano
> (servicios sueltos: aéreo/hotel/traslado/asistencia/otro con plataforma, proveedor, costo,
> markup/TA). Vive en `app/(dashboard)/dashboard/cotizaciones/` (`nueva/CotizacionManualForm.tsx`,
> `manual-actions.ts`, `[id]/` detalle + editores), documento al cliente en
> `components/contrato/CotizacionManualDocumento.tsx`, página imprimible `app/cotizacion/[id]/`.
> Convierte a contrato (`convertirCotizacionManualAContrato`): venta `dinamico` + contrato + CxP
> (proveedor = plataforma) + titular como pasajero.
- **Ítem agrupado**: el cliente ve **un solo** "PAQUETE TURÍSTICO A {destino} DEL {ida} AL {regreso}"
  (no se listan hoteles/proveedores; el detalle por servicio queda interno en `cotizacion_servicios`).
- **Titular obligatorio** para generar contrato: nombre, tipo y número de doc y **fecha de nacimiento**
  (campo nuevo en el form). Editable luego en el detalle (`TitularEditor`).
- **Incluye / No incluye**: texto libre editable (helper `lib/cotizacion/incluye.ts`: `sugerirIncluye`
  + `NO_INCLUYE_DEFAULT`); se ve en el documento. Editable luego (`IncluyeEditor`).
- **Tarifa de niño**: campos Niños + Tarifa por niño (suma al total; pax = adultos). El documento
  muestra desglose Adultos/Niños y `contrato_items` lleva `ninos`/`tarifa_nino`.
- **Recobro** (mayor valor cobrado, **NUNCA visible al cliente** — va oculto dentro de la tarifa de
  adulto): cliente final → 100% empresa; agencia/freelance → se reparte (parte al aliado), default
  desde parámetro `recobro_pct_aliado_b2b` ("Distribución B2B"). Al convertir guarda
  `recobro_total/empresa/aliado` en `ventas` y crea `aliados_b2b` + `comision_b2b`. **Migración 086.**
  Solo en cotización dinámica; **falta replicar en tarifario/reservar**. Recobro/niños hoy se editan
  solo al crear (no hay editor posterior aún).

### Módulos construidos
- **Producto:** Destinos (`/dashboard/producto/destinos`, MAYÚSCULAS + IATA), Proveedores,
  Configuración (categorías de habitación, regímenes), **Hoteles** (temporadas propias +
  tarifa neta por categoría/régimen/temporada con **Niño 1 y Niño 2**; editar tarifa; config
  de edades y rangos; **config de acomodaciones** — pax mín/máx del hotel y, por acomodación,
  `pax_tarifa` (multiplicador por habitación) + mín/máx de adt/niños/inf), **Servicios** (precio **por persona** y/o **por grupo con rangos de
  pax**; destino vacío = nacional; **descripción del tour** y **recargo individual** —
  costo neto del proveedor (tarifa de individual) que entra al costo/CxP y sube el PVP
  con markup cuando va 1 pax en cobro por persona, migr. 088;
  **temporadas por servicio** (migr. 089/090) — una temporada es una tarifa COMPLETA
  por fecha del viaje: **precio por persona + recargo individual + rangos por grupo**,
  con vigencia de compra y prioridad, igual que hoteles. La tarifa de siempre = temporada
  **GENERAL** (la base del form); las temporadas con fechas ganan cuando la fecha del viaje
  las cubre. El editor de temporadas aparece al **Editar** un servicio guardado (cada
  temporada cuelga del servicio por FK). Los rangos por grupo de una temporada viven en
  `servicio_tarifa_pax` con `temporada=<nombre>` (GENERAL = base). Se aplican en Reservar
  (venta = escala el PVP del snapshot por `neto_temporada/neto_general`, incl. recargo via
  factor de markup, y los rangos por grupo por su razón de netos; costo = usa neto+recargo+
  rangos de la temporada). El snapshot del tarifario y la edición de servicios del contrato
  usan SOLO la GENERAL. Motor: `temporadaVigenteParaFecha` en `lib/calc/paquetes.ts`.
  *(Se quitó el viejo campo "Temporada (opcional)" — era solo una etiqueta.)*
  **Carga masiva CSV** en hoteles, tarifas, servicios y
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
- **Auditoría** (`/dashboard/auditoria`, solo superadmin/gerencia): log de trazabilidad de
  todo el CRUD vía trigger de BD (migración 087). Tabla con filtros (tabla, acción,
  N° contrato/record/id, usuario, rango de fechas), paginada, con diff antes→después
  expandible por fila. Ítem de menú gateado con `rolesPermitidos` en el nav del dashboard.

### Motor de cálculo (`lib/calc/paquetes.ts`)
- Hotel: liquida **noche por noche** (mezcla temporadas), `costo/(1−%mk)`.
- Vuelo: por vuelo eliges `costo/(1−mk)` **o** `costo + TA`.
- PVP = hotel + servicios + vuelo. **Impuesto (BNC)** = tiquete neto o fijo. Base com. = PVP − imp.
- Niño 1 / Niño 2 = acomodaciones `nino` / `nino2` (0 = gratis, sí se publica).
- **Tarifa de infante = igual que Niño 1/Niño 2** (migración 122, reemplaza el
  mecanismo de la 118): un hotel real (Virrey Cartagena) cobra la tarifa de
  infante distinto según el plan/temporada ("0-2 años: solo seguro hotelero
  $19.000/noche"; "3-5 años: $79.000 PC / $99.000 PAM, comparte cama") — un
  valor plano por hotel no alcanzaba. Ahora `infante` es una **acomodación más**
  (`tarifa_hotel.neto_infante` + `nota_infante`, por categoría/régimen/
  temporada, igual que `neto_nino`/`neto_nino2` — se agregó al enum
  `acomodacion_tipo`, mismo patrón que `nino2` en la migración 020). Se edita
  en `HotelDetalleClient.tsx` (pestaña Tarifa neta), **no** en la config del
  hotel. `$0` = gratis (se publica igual, no es "no aplica"). El PVP se genera
  automático por el motor de siempre (`generarTarifario`/`regenerarTarifariosDeHotel`
  en `paquetes/actions.ts`, y `liquidarHotelPaquete` en `lib/reservar/cotizar.ts`
  para porción/dinámico por fechas) — `pvpPorAcom["infante"]` llega a
  `lib/reservar/computo.ts` y a `ReservaForm`/tarifario exactamente como
  `pvpPorAcom["nino"]`. **Única asimetría deliberada con niño:** si el hotel NO
  configuró `neto_infante` para un combo, la reserva **no se bloquea** (infante
  gratis, a diferencia de niño que si no tiene tarifa cargada para ese combo/
  temporada da error "tarifa vencida") — decisión tomada para no romper de un
  día para otro las reservas con infante de TODOS los hoteles que aún no han
  cargado esta tarifa nueva (niño ya llevaba tiempo en producción y se asume
  configurado; infante no). Se itemiza en `contrato_items`/`itemsSnap` como
  "Infante · categoría/régimen" (igual patrón que "Niño 1 ·"/"Niño 2 ·"). La
  nota (`nota_infante`, ej. "comparte cama con los padres") se ve en el
  tarifario público junto al rango de edades — se toma la primera nota que se
  encuentre entre las tarifas del hotel (representativa, no exacta por
  temporada), **sin exponer el costo neto**, con `hoteles.infante_cargo_neto/
  infante_cargo_desc/infante_nota` (118) ya sin uso (columnas viejas, no se
  borran por convención, simplemente no se leen/escriben más).
- **`nino_nota`** (hotel-level, sin cambios): nota general de niño, editable en
  `HotelConfigEditor.tsx`, independiente de la tarifa de infante.
- **Hoteles pet friendly** (migración 121, `hoteles.pet_friendly/pet_costo_neto/
  pet_costo_desc/pet_nota`, editable en `HotelConfigEditor.tsx` detrás de un
  checkbox "Acepta mascotas"): misma mecánica que el cargo de infante —
  `pet_costo_neto` en 0 = mascota gratis, > 0 se cobra por mascota × noches con
  el mismo % de markup del paquete (`cargoMascota` en `lib/reservar/computo.ts`,
  itemizado aparte en `contrato_items`/`itemsSnap` como "Mascota · <descripción>").
  Si el hotel NO es `pet_friendly`, reservar con mascotas declaradas falla
  (validado en el motor, junto al chequeo de Adults Only). `ReservaForm.tsx`
  agrega el campo "Cantidad de mascotas" solo si el hotel es pet friendly (si no,
  muestra el aviso "Este hotel no acepta mascotas" y no permite declararlas). El
  tarifario público muestra el badge "Pet friendly" + la nota/aviso de cargo
  (sin exponer el costo neto), igual criterio que Adults Only/infante.
- **Promociones restringidas a un régimen + promo "N noches, 1 gratis"**
  (migración 123, `hotel_temporadas.regimen_restringido` — pedido puntual para
  la calculadora Dubai, pero es un mecanismo general): cualquier vigencia
  (`tarifa`/`descuento_pct`/`descuento_monto`/la nueva `promo_noche_gratis`)
  puede restringirse a UN solo régimen (`regimen_restringido`, null = todos)
  aunque el hotel tenga varios — se filtra en `entradasNoche` (paquetes.ts),
  hay que pasar `regimen` a `liquidarHotelNoches`/`liquidarHotelMasBarato` en
  cada call site (cotizar.ts, computo.ts, paquetes/actions.ts, vigencia.ts).
  **`promo_noche_gratis`** es un tipo de vigencia nuevo y estructuralmente
  distinto a los demás: NO se resuelve noche por noche (se excluye de
  `entradasNoche` dentro de `netoNoche`/`minNochesAplicable`), sino a nivel de
  la ESTADÍA completa — `promoNocheGratisFactor()` revisa si hay una vigencia
  de ese tipo que cubra la noche de entrada, esté vigente para compra, coincida
  el régimen (si está restringida) y la estadía tenga al menos `min_noches`
  noches (aquí `min_noches` se reinterpreta como "noches mínimas de la
  estadía para la promo", no como mínimo de noches para vender). Si aplica,
  se regala **siempre exactamente 1 noche** sin importar si son 3, 4 o más
  (decisión del dueño): se descuenta 1/N del total ya liquidado (no depende de
  qué noche puntual "sale gratis", robusto aunque la estadía cruce temporadas).
  Aplicado en `liquidarHotelNoches`/`liquidarHotelMasBarato`
  (`lib/calc/paquetes.ts`). UI en `HotelDetalleClient.tsx` (`TemporadasBox`):
  nuevo tipo en el selector + selector de régimen (vacío = todos) + aviso
  explicando la mecánica cuando se elige "N noches, 1 gratis".
- **Calculadora Dubai: promociones con descuento SOLO sobre la base**
  (`lib/calc/calculadoras.ts`, `DubaiParams.promos[]`): antes, un `descuento_pct`
  genérico de `hotel_temporadas` aplicado sobre una tarifa Dubai ya generada
  descontaba TODO (base + suplemento de régimen), cuando el hotel real solo
  descuenta la base. Ahora la propia calculadora Dubai genera la temporada
  promocional: cada promo (`temporadaBase` → `temporadaPromo`, `regimen`,
  `descuentoPct`) aplica el % **antes** de derivar sencilla/triple/múltiple/niño
  y de sumar el suplemento de régimen — el suplemento nunca se descuenta.
  Solo aplica al **régimen elegido** (aunque el hotel tenga varios). La
  `temporadaPromo` debe existir como vigencia real en `hotel_temporadas` (con
  su propia fecha/vigencia de compra, creada en Temporadas como cualquier
  otra) — la calculadora solo calcula los números y los escribe ahí; toda la
  vigencia/prioridad/compra la maneja el mecanismo genérico de siempre. UI en
  `CalculadoraEditor.tsx` (`DubaiForm`): sección "Promociones" (lista
  repetible) + vista previa aparte (puede ser de otro régimen que el base).

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

### Migraciones Supabase — total en repo: **125** (todas corridas por el dueño)
> Las migraciones usan prefijo de timestamp `20260601000NNN_…`; el orden lo da el número NNN.
> Cada archivo se corre **una sola vez**; son idempotentes (`add column if not exists`,
> `on conflict do nothing`), así que re-correr una ya aplicada es seguro. **No editar una
> migración ya creada para "meter" cambios nuevos**: siempre crear el siguiente número.
> ⚠️ La numeración la da el repo, NO el handoff: antes de crear una nueva, hacer
> `ls supabase/migrations/ | sort | tail` y tomar el **siguiente número libre** (evitar
> colisiones: ya pasó un 079 duplicado, corregido). El dueño reporta haber corrido **hasta la 125** (todas aplicadas).
>
> Rango **016→031**: producto, config_hoteles, armado_paquetes, rangos_edad, reserva_tarifario,
> paquete_tipo, servicio_tarifas_pax, hotel_acomodaciones (reservar por habitaciones), formas_pago,
> servicio_categoria, contrato_vuelo_hotel_extra, **031** programas (circuitos de proveedor + `moneda`).
> Rango **032→067**: CxP automáticas, cartera/pagos, CRM, adjuntos de contrato, datos bancarios de
> proveedor, país de destino, documentos/fotos/estrellas/ubicación de hotel, cotizaciones
> (+share_token), solicitudes, vouchers, eliminar contrato, cobros, notificaciones, blackouts,
> **066** programas_vitrina, **067** programas_asistencia.
> Rango **068→085** (recientes): 068 programas_salidas · 069 videos_fondo · 070 bloqueo_cambios ·
> 071 bloqueo_origen_tarifa_neta · 072 permisos · 073 ventas_b2b (`b2b_usuario_id`, `modo_compra`,
> `comision_b2b`, `comision_estado`) · 074 b2b_solicitudes · 075 link_pago · 076 usuario_agencia ·
> 077 usuario_pct_comision · 078 web_cms · **079 web_paginas** (CMS por páginas/secciones) ·
> 080 web_storage (bucket `web-cms`) · 081 programa_edades · 082 crm_subcategoria ·
> 083 hotel_min_noches · **084 cotizacion_manual** (cotización dinámica: tablas/campos) ·
> **085 silla_contrato_manual** (contrato manual en la silla, fuera del flujo).
> **086 recobro_cotizacion** ← *aplicada*: `recobro_total/empresa/aliado` en
> `ventas` + parámetro `recobro_pct_aliado_b2b` (Distribución B2B, editable en
> Configuración → Parámetros tributarios).
> **087 auditoria** ← *aplicada*: log de trazabilidad de
> TODO el CRUD. Tabla `auditoria` + función `fn_auditoria()` (SECURITY DEFINER) + un trigger
> genérico `trg_auditoria` adjuntado por un bloque `DO` a **todas** las tablas base de
> `public` (excepto `auditoria` y `tarifario_resultado`). Registra quién (auth.uid() +
> snapshot email/nombre/rol), qué (tabla + registro_id = contrato/record/id) y los cambios
> (antes/después jsonb + `cambios` solo de campos modificados). RLS: solo leen `superadmin`
> y `gerencia`. ⚠️ Escrituras con `service_role` (sillas/costos al reservar) NO traen actor
> → quedan como "Sistema" (el cambio sí se registra). Re-correr el bloque DO adjunta el
> trigger a tablas nuevas.
> **088 servicio_descripcion_recargo** ← *aplicada*:
> `descripcion` + `recargo_individual` en `servicios_adicionales` (y denormalizadas a
> `tarifario_resultado`). El recargo individual es un **costo NETO del proveedor** (tarifa
> de individual) que aplica cuando el servicio (cobro POR PERSONA) se vende a 1 solo pax:
> entra al `costo_receptivo` y a la **CxP del proveedor** (Reservar lo toma del catálogo),
> y el PVP sube con su markup (en `tarifario_resultado.recargo_individual` se guarda ya con
> markup). Se publica en la vitrina pública de Servicios.
> **089 servicio_temporadas** ← *aplicada*: `servicio_temporadas` (tarifa por fecha del viaje
> + vigencia de compra + prioridad + `precio_persona`) y `servicio_tarifa_pax.temporada`
> (rangos por grupo por temporada; la base = 'GENERAL').
> **090 servicio_temporada_recargo** ← *aplicada*: `recargo_individual` en
> `servicio_temporadas`. Cierra el modelo: una temporada es una tarifa COMPLETA (persona +
> recargo + rangos por grupo). El editor de temporadas (al **Editar** un servicio) ya carga
> los tres; Reservar aplica los tres por fecha; el snapshot del tarifario y la edición de
> servicios del contrato usan SOLO la GENERAL. Se quitó el campo "Temporada (opcional)".
> Rango **091→106**: 091 servicio_alcance_internacional · 092 hotel_moneda · 093
> paquete_tarifario_moneda · 094 (salidas dinámicas/USD) · 095 finanzas_usd_abono_trm
> (`abonos.trm`/`monto_cop`, `ventas.trm_contrato`) · 096 trm_referencia · 097 cxp_trm ·
> 098 contabilidad_facturacion (`contrato_facturacion`: irt/ingreso_propio/lleva_iva) ·
> 099 contabilidad_exento · 100 proveedor_clasificacion · 101 punto_equilibrio
> (`pe_empleados`/`pe_costos`) · 102 cxp_clasificacion · 103 contabilidad_movimientos ·
> 104 conciliaciones · 105 facturacion_dian · 106 impuesto_renta (`IMPUESTO_RENTA` 0.35).
> Rango **107→113** (multitenant + catálogo): **107 multitenant** (columna `tenant` en
> ventas/abonos/CxP/facturación/aliados/comisiones/pe_*/movimientos/conciliación/usuarios +
> `mi_tenant()`/`puede_ver_tenant()`) · **108 auditoria_tenant** · **109 agencias** (identidad
> fiscal del RUT por agencia; lectura pública) · **110 servicio_moneda** (`servicios_adicionales.moneda`) ·
> **111 programa_highlights** (`programas.highlights` text[]) · **112 fusionar_destino**
> (`fn_fusionar_destino(origen,destino)` SECURITY DEFINER: re-apunta toda FK a destinos y borra) ·
> **113 programa_piezas** (bucket público `programas` + `programas.flyer_url`/`historia_url`).
> Rango **114→125** (CRM, seguridad, minorista, hoteles, contabilidad): **114 crm_difusion** (material/
> envío/plan) · 115 minorista_numeracion (fix numeración duplicada + `contrato_servicios`) ·
> **116 rls_tenant_isolation** (filtro de tenant en policies de ventas/abonos/CxP/comisiones/
> facturación) · **117 eliminar_contrato_rol** (candado de rol dentro del RPC) ·
> **118 hotel_infante_cargo** (`hoteles.infante_cargo_neto/infante_cargo_desc/infante_nota/
> nino_nota` — **118 reemplazada/superada por la 122**, ver abajo) · **119 hotel_adults_only**
> (`hoteles.adults_only`) · **120 crm_plan_vigencia** (`crm_difusion_plan.vigencia_hasta`) ·
> **121 hotel_pet_friendly** (`hoteles.pet_friendly/pet_costo_neto/pet_costo_desc/pet_nota`) ·
> **122 tarifa_infante** (ya corrida) — agrega `'infante'` al enum
> `acomodacion_tipo` (mismo patrón que `'nino2'` en la migración 020) +
> `tarifa_hotel.neto_infante/nota_infante`, con backfill desde los campos planos
> de la 118 (no los borra, solo deja de usarlos la app) ·
> **123 temporada_regimen_restringido** (ya corrida) —
> `hotel_temporadas.regimen_restringido` (texto libre, null = todos los régimen),
> usada tanto por la promo "N noches, 1 gratis" como por cualquier vigencia
> existente (tarifa/descuento_pct/descuento_monto) que se quiera limitar a un
> solo régimen. Detalle de cada una en "Novedades recientes" más arriba y en
> "Motor de cálculo" (118 ya no se usa/121/122/123) ·
> **124 conciliacion_sistema_contrato** (ya corrida) — agrega
> `conciliacion_sistema.numero_contrato` (snapshot al cruzar, null para
> movimientos genéricos sin contrato) para poder enlazar cada conciliado
> a su contrato · **125 retenciones_cxp** (ya corrida) — tabla
> `retenciones_cxp` (log de retenciones practicadas a proveedores: valor,
> fecha_practica, mes_declaracion; puede haber más de una por cuenta) —
> ver "Novedades recientes".
> *(Nombres exactos siempre en `supabase/migrations/`.)*
Scripts sueltos: `supabase/scripts/fusion_cartagena.sql` ·
`supabase/scripts/backfill_sillas_pasajeros.sql` (rellena datos de pasajero en sillas viejas) ·
`supabase/scripts/seed_web_cms.sql` (contenido inicial del CMS).
Env en Vercel: `SUPABASE_SERVICE_ROLE_KEY` (sillas/costos), opcional `CRON_SECRET`,
`RESEND_API_KEY` + dominio verificado para notificaciones/cobros (migr. 056/061/062);
configurar destinatarios en `config_solicitudes`/`config_cobros`/`config_notificaciones`.
Google OAuth: callback `/auth/callback`; Site URL = producción.

### PENDIENTE / próximos pasos
- **Etapa 2 — Servicios como add-on al reservar:** dejar de hornear servicios en la tarifa del
  hotel; en Reservar mostrar los servicios del paquete y calcular por persona (× pax) o por
  grupo (rango que cubra los pax), sumándolos al contrato. *(HECHO; queda afinar.)*
- Afinar rentabilidad/costos del contrato (módulo de gestión).
- Reservar desde el módulo Servicios del tarifario. *(HECHO.)*
- **Vuelos dinámicos (JetSMART/agregador) + empaquetado dinámico:** idea a futuro del
  dueño, NO construir hasta que lo confirme. Plan completo (caminos, costos, checklist,
  cómo encaja, esqueleto técnico) en `dspacios-travel/docs/futuro/vuelos-dinamicos-jetsmart.md`.
- **Sitio web público + CMS (HECHO Fase 1 y 2):** la web de marketing (antes en
  Hostinger Horizons, Vite) se portó a Next dentro del mismo proyecto en route group
  `app/(sitio)` (rutas `/ /paquetes /destinos /nosotros /testimonios /blog /cotizar`),
  reusando estructura/colores/UI; enlaza al tarifario. Contenido editable desde el
  **CMS** `/dashboard/cms` (solo superadmin) → tablas `web_*` (migración **078**), con
  **fallback** a `lib/sitio/data.js` mientras no se corra la 078/seed. Separación por
  subdominio en `proxy.ts` vía envs `NEXT_PUBLIC_SITIO_HOST`/`NEXT_PUBLIC_PORTAL_HOST`.
  *Pendientes:* (078/079/080 ya aplicadas → CMS y subida a Storage `web-cms` activos)
  opcional `seed_web_cms.sql`; configurar dominios/DNS (ver
  `docs/sitio-web/despliegue-dominio.md`); título/favicon propios; borrar `sitio-web/`
  (export Vite, hoy solo referencia). La carpeta `sitio-web/` NO se despliega.
- **CMS — estado real (rama actual):** el sitio público vive en `app/sitio_web/`
  (route group), NO en `app/(sitio)`; el CMS en `/cms` (no `/dashboard/cms`). Modelo
  **páginas + secciones tipadas**: `web_paginas` (árbol por `parent_id`, slug de UN solo
  segmento) → `web_secciones` (`datos` jsonb), + `web_blog`/`web_testimonios`/`web_config`.
  Lectura pública con fallback estático: `lib/sitio/paginas.ts` + `lib/sitio/cms.ts`
  (fallbacks en `paginasFallback.ts`/`data.js`). Render: `components/sitio/secciones/*`.
  Migraciones 078/079/080. La separación por subdominio del handoff **NO está** en
  `proxy.ts` (el sitio queda bajo `/sitio_web`; tendrá dominio propio luego — OK por ahora).
- **CMS → edición IN-SITU sobre la página real (en curso, rama `claude/peaceful-noether-713c7c`):**
  el dueño pidió cambiar el tipo de CMS a edición directa "click en un texto y editarlo en la
  vista en vivo" (estilo Webflow), NO un panel/lista aparte (se descartó el `BloquesCanvas`).
  - **Framework de edición in-situ:** `components/sitio/edicion/EdicionContext.jsx` (provider
    `EdicionSeccion` con `{editable, datos, set}`) + `Editable.jsx` (`EditableText` =
    contentEditable que guarda al `onBlur`). En el sitio público NO hay provider → `editable`
    false y todo renderiza idéntico. Secciones ya cableadas inline: **Hero, Texto, Cta**
    (las demás se editan por el panel ⚙ Campos). Para cablear otra sección: envolver sus
    textos con `<EditableText as=.. campo=.. >{valor}</EditableText>` y guardar `tipo` en el set
    `INLINE` de `LienzoVivo`.
  - **`app/cms/editors/LienzoVivo.tsx`:** renderiza las secciones REALES (`SeccionRenderer`)
    dentro del CMS con su `contexto` (config/testimonios/blog/destinos en forma "inglesa" de
    `lib/sitio/cms`, + `hijos` derivados del árbol). Cada bloque: barra flotante (arrastrar
    para reordenar con framer-motion `Reorder`, ⚙ campos en slide-over con `SeccionForm`,
    duplicar, ocultar, eliminar), selección, y `onClickCapture` que bloquea la navegación de
    los botones del sitio mientras editas. Guardado de campos con debounce (700ms) vía
    `actualizarSeccion`, sin refrescar (no pierde el foco).
  - `CmsClient` ya no usa iframe: muestra árbol (izq) + ajustes de página colapsables +
    `LienzoVivo`. `page.tsx` carga además los datos del sitio para el lienzo.
  - Server actions nuevas: `reordenarSecciones`, `duplicarSeccion`. **Bugs corregidos:**
    slug con `/` (404), `notFound`/SEO en `blog/[id]`, reordenar con rollback.
  - **Iconos lucide** (no emojis) en la paleta y la barra de bloques. **Todas las secciones**
    tienen sus encabezados editables inline (titulo/subtitulo/intro/textos); el contenido por
    ítem (listas, tarjetas, galería) e imágenes secundarias se editan por ⚙ panel. **Hero**
    edita su imagen de fondo in-situ (`EditableImage`, botón "Cambiar imagen"). **Toggle
    escritorio/móvil**: móvil = iframe real (publicado) en marco angosto. **`cotizar`**
    ahora es server + `CotizarClient` y toma el WhatsApp de `web_config` (ya no hardcodeado).
  - **Pendiente:** edición in-situ de imágenes en más secciones (Actividades/Consulta/Galería,
    hoy por ⚙); edición inline de ítems de lista (experiencias/actividades/plan); subir imagen
    (no solo URL) desde el botón in-situ.
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
