# Entorno local de pruebas de #43/#60 (`local4360`)

> Entorno **habitual** para probar #43/#60 en el worktree `43-vigencias-dia`. **Solo local y aislado**: datos
> sintéticos, claves locales nuevas, ninguna conexión a Producción ni a servicios externos.
> **No es una validación integral del sistema** (ver §4): le faltan migraciones del repositorio y no reproduce
> Vercel. Sirve para los recorridos de #43/#60 que dependen solo de lo que sí tiene.

## 1. Qué hay

| Pieza | Qué es |
|---|---|
| App | Next.js del worktree. Desarrollo: **http://127.0.0.1:3043** · build de producción local: **http://127.0.0.1:3044** (solo loopback) |
| Gateway | Kong 2.8.1 en **http://127.0.0.1:54360** (`/auth/v1`, `/rest/v1`, `/storage/v1`, como Supabase); publicado solo en 127.0.0.1 |
| Base | Contenedor `pg4360` (propio de #43/#60, sin puertos publicados), base `dspacios_local4360` |
| Auth · REST · Storage | GoTrue v2.197.0 · PostgREST v16.4 · storage-api v1.84.19 (archivos en `%LOCALAPPDATA%\dspacios-local4360\storage`); sin puertos publicados, solo por el gateway |

**Datos:** `supabase/scripts/local4360/semilla_local4360.sql`, todos sintéticos (ids 4360xx):
- Hotel 1 · Dubai con grupos (Semana L–J / Finde V–D en ALTA; grupo en la vigencia CERRADA; promoción PROMO-ALTA).
- Hotel 2 · Mixta con grupos · Hotel 3 · Corporativa con grupos (impuesto 0, descuento de la tarifa 10 %).
- Hotel 4 · Dubai sin grupos · Hotel 5 · por unidad. Regímenes PAM, PC y **FULL**; vigencias ALTA y BAJA (compra abierta), CERRADA (compra cerrada).
- 3c (`semilla_local4360_3c.sql`): en LOCAL 1, vigencia **PUENTE** (15–17 mar 2027, lunes a miércoles, prioridad 1) con doble Estándar/PAM: compite con la Semana de ALTA y debe dar un empate al aplicar.

**Usuarios de prueba** (contraseña común `Local4360!`, solo local): `operaciones@` (operaciones, Mayorista — el principal), `superadmin@`, `gerencia@`, `minorista@` (operaciones Minorista, sin escritura de catálogo), `venta@` (sin calculadora), `agencia@` (portal B2B), todos `@local4360.test`.

## 2. Aislamiento

- **Proceso hijo con entorno controlado.** La app (y `next build`/`start`) corre en un proceso hijo con un entorno armado desde cero: solo variables mínimas del sistema operativo (PATH, TEMP, APPDATA…) + la configuración local. **La terminal no se modifica** (no se asigna ningún `$env:`); al salir, también ante errores, se compara su huella y se informa.
- **Sin `.env`.** Next carga `.env*` de la carpeta de la app por su cuenta: si existe alguno (salvo `.env.example`), el script **no arranca** y solo dice sus nombres; nunca los lee ni los copia.
- **Guardia de red** (`guardia_red_local4360.cjs`, precargada en todos los procesos Node de la app con `NODE_OPTIONS`): rechaza **antes de resolver DNS o abrir el socket** cualquier conexión que no sea loopback — Supabase alojado, correo (Resend, Brevo), pagos (Wompi), webhooks, telemetría. Única excepción: las fuentes públicas de Google que descarga `next/font`. Cada intento queda en `%LOCALAPPDATA%\dspacios-local4360\red_bloqueada.log` (solo host y hora). Además: telemetría de Next apagada, atajo de login apagado, las claves de correo del CRM no existen en la base local.
  - Qué cuenta como loopback: el nombre exacto `localhost` o una **IP literal** de loopback (127.0.0.0/8, `::1`, `::ffff:127.x`). Un dominio que empiece por «127.» (p. ej. `127.ejemplo.com`) **no** es una IP y se rechaza sin resolver DNS.
  - **Alcance: protege SOLO los procesos Node de la app** (servidor de Next, build y sus workers, Server Actions y rutas). **No es un firewall**: no controla lo que pide el **navegador** (imágenes de Unsplash, fuentes, enlaces de WhatsApp o YouTube, o un enlace de pago que alguien abra a mano) ni el tráfico de los **contenedores** (GoTrue, PostgREST, Storage, Kong, Postgres). Esos no tienen credenciales reales ni datos de Producción: GoTrue no envía correos (autoconfirmación) y Storage guarda en disco local.
- **Solo loopback:** la app escucha en 127.0.0.1; Kong publica en 127.0.0.1; base y servicios no publican puertos.
- **Memoria** (ver §2.1): el heap de Node (3 GB dev, 4 GB build, 2 GB start) es solo un **tope**, no se reserva. Para arrancar se exige la RAM **medida** + un piso de 400 MB, y un **vigilante** detiene la app si la RAM libre baja del piso. **Dev y producción nunca a la vez** (candado + comprobación de los dos puertos).
- Claves locales y aleatorias en `%LOCALAPPDATA%\dspacios-local4360\config.json` (secreto JWT, anon, service, cron, contraseña de los roles de servicio de `pg4360`).

### 2.1 Perfil de memoria (equipo de 15 GB, normalmente con 1–2 GB libres)

- **Kong pequeño:** con `worker_processes=auto` levantaba **16 workers** (uno por núcleo, ~100 MB cada uno) = **1,38 GB**. Ahora usa `KONG_NGINX_WORKER_PROCESSES=1`, `KONG_MEM_CACHE_SIZE=16m` y tope de contenedor `--memory 256m`: **120 MB**. `iniciar` recrea `local4360-kong` si no trae el perfil (no tiene estado: DB-off, `kong.yml` montado). El resto ya era pequeño: Auth 10 MB, REST 90 MB, Storage 78 MB, `pg4360` 230 MB.
- **Requisito de arranque medido** (pico del árbol de procesos / caída de la RAM libre del sistema; cada ejecución queda en `%LOCALAPPDATA%\dspacios-local4360\mediciones.log`):

  | Modo | Pico del árbol | Caída del sistema | Se exige libre |
  |---|---|---|---|
  | dev (humo de 5 rutas) | 692 MB | ~1.200 MB | 1.500 + 400 = **1,9 GB** |
  | build (con caché de Turbopack) | 1.186 MB | ~1.050 MB | 1.400 + 400 = **1,8 GB** |
  | start (2 mediciones) | 132–140 MB | ~300–650 MB | 700 + 400 = **1,1 GB** |

  La caída del sistema supera al árbol porque incluye la caché de archivos y la carga de Postgres/REST atendiendo las consultas. Antes se exigía heap + 512 MB (3,5 / 4,5 / 2,5 GB), que no se podía cumplir en este equipo.
- **Vigilante:** cada 3 s mide la RAM libre y el árbol de procesos; si la RAM libre baja de **400 MB**, mata el árbol (`taskkill /T`) y lo registra como «DETENIDO por el piso». Por eso el requisito no necesita cubrir el peor caso: una sesión de dev larga (que compila más rutas) o un build en frío **no medido** se cortan antes de agotar el equipo.
- Limitaciones: muestreo cada 3 s (un pico más corto no se ve); el build medido aprovechó la caché de Turbopack.

**Comprobación** (`& $L aislamiento`, sin llamadas reales al exterior): 21 comprobaciones — qué cuenta como loopback (6 válidos aceptados, 10 falsos rechazados, incluidos `127.ejemplo.com` y `127.0.0.1.nip.io`, que además se bloquean antes de DNS); ninguna variable de credenciales del usuario pasa a la app; URL y claves locales; guardia y presupuesto cargados; los 7 destinos externos (incluido el proyecto Supabase de producción y una IP pública) bloqueados antes de conectar; el gateway local responde; la base sin claves de correo; la terminal igual. Probadas también las negativas: `.env` presente, memoria insuficiente, puerto de la otra app ocupado y candado de otra app viva.

## 3. Comandos (PowerShell)

```powershell
$L = "C:\Users\Usuario\Documents\DspaciosMayorista\dspacios-travel\.worktrees\43-vigencias-dia\dspacios-travel\supabase\scripts\local4360\local4360.ps1"
& $L iniciar       # levanta Auth/REST/Storage/Gateway (y pg4360 si estaba detenido)
& $L estado        # contenedores, bases y salud
& $L aislamiento   # comprueba el aislamiento (sin llamadas externas)
& $L dev           # app en desarrollo → http://127.0.0.1:3043 (Ctrl+C para salir)
& $L prod          # next build + next start → http://127.0.0.1:3044 (no a la vez que dev); guarda la huella del build
& $L start         # SOLO next start del build existente → http://127.0.0.1:3044, sin recompilar (equipo con poca memoria)
& $L restaurar     # vuelve SOLO los datos locales a la foto inicial (base y archivos de Storage locales)
& $L detener       # detiene solo los contenedores local4360-*;  -IncluirPostgres también pg4360
& $L preparar      # solo la primera vez (ya hecho)
```
**`start` y el build existente** (`huella_build_local4360.mjs`): `prod` guarda tras el build `.next/local4360-huella.json` (sha256 de cada archivo que entra al build: lo versionado o nuevo según git, salvo `docs/`, `supabase/`, `pruebas/` y `*.md`). `start` se **niega a arrancar e informa** si el código cambió (lista los archivos), si el `BUILD_ID` no es el de la huella, si falta el build, si el build no lleva la URL del gateway local o si lleva la de un Supabase alojado. Un build anterior a la huella solo se puede comparar **por fecha** (lo dice así). Mismo entorno aislado, guardia, loopback, candado y vigilante que `prod`. Si dice DESACTUALIZADO hay que recompilar con `prod` (~1,8 GB libres).

Humo con sesión real (lectura): `node supabase\scripts\local4360\humo_local4360.mjs "$env:LOCALAPPDATA\dspacios-local4360\config.json" [http://127.0.0.1:3044]`.

## 4. Diferencias con Producción y límites (no presentar como validación integral)

**Esquema.** Base = copia de `plantilla_prod_actual` (≤287 + 293 + 294, vacía) + **295, 297, 298, 299**. Respecto del repositorio y de Producción **faltan**:

| Migración | Qué toca | En Producción |
|---|---|---|
| 286 `cotizacion_comision_acuerdo` | cotización manual con acuerdo de comisión | confirmar con el dueño (#97) |
| 288 `obligaciones_al_confirmar` · 292 `servicio_obligaciones_previstas` | confirmar venta y obligaciones previstas | confirmar con el dueño (#75) |
| 289 `elegibilidad_dtm_ampliada` | reutilización de consecutivos DTM | confirmar con el dueño (#75) |
| 290 `comision_manual_pendiente_y_duplicado` · 291 `reemision_neto_pendiente` | comisiones B2B y reemisión neta | confirmar con el dueño (#75/#97) |
| 296 `identidad_borrado_en_cascada` | borrado de contratos con identidad | **aplicada**; no está en esta rama |
| 282 | (no existe en el repositorio) | — |

Por eso **no** se validan aquí contratos, confirmación de ventas, cartera, obligaciones, comisiones B2B ni DTM. Para eso habría que incorporar esas migraciones (en el orden y con las dependencias de #75/#97) antes de usar este entorno para ellos.

**Ajustes solo locales:** `auth.uid()` con la definición de Supabase; esquema `auth` de `supabase_auth_admin` y `auth.sessions.updated_at` (la plantilla trae un stub); contraseña local de los roles de servicio.

**Solo en Vercel/Preview:** funciones, límites de duración y cuerpo, caché, middleware en el edge, CDN, optimización de imágenes, crons, Google OAuth, correo real, datos y volumen reales, consumo y Observability; diferencias de versión entre este Supabase local y el alojado.

## 5. Guía: calculadoras por grupo (Semana y Finde con modificadores y FULL distintos)
1. `& $L iniciar` y `& $L dev` → abrir **http://127.0.0.1:3043** → entrar como `operaciones@local4360.test` / `Local4360!`.
2. Producto → Hoteles → **«LOCAL 1 · Dubai con grupos»** → «Tarifa por fórmula (calculadora)» → **Calcular para: «ALTA · Semana (L M X J)»**.
3. Ver «Usar los generales del hotel» marcado, los generales bloqueados y la **referencia** (Sencilla +50 %, Suplemento FULL 100.000…). Elegir **«Valores propios de este grupo»**: se habilitan con una copia de los del hotel.
4. Base Estándar **100.000**; **Sencilla 60**; **Suplemento FULL 80.000**. La vista previa del cálculo cambia sin solicitudes (Estándar / FULL doble = 180.000).
5. «Revisar propuesta del grupo»: aparecen «Parámetros de la fórmula de este grupo» (Sencilla % 50 → 60, Suplemento FULL 100.000 → 80.000) y la propuesta. Resolver edades/condición si las pide y **cada acomodación «hoy sin venta»** (nada viene marcado; «Mantener sin venta» o «Habilitar a …») → **«Confirmar propuesta y bases del grupo»**.
6. Cambiar a **«ALTA · Finde (V S D)»** → valores propios → **Sencilla 40**, **Suplemento FULL 120.000**, base 100.000 → revisar → confirmar (Estándar / FULL doble = 220.000).
7. Volver a Semana y luego a Finde: cada uno reabre **con lo suyo**; recargar la página da lo mismo. La calculadora general («Todos los días») sigue con Sencilla 50 y FULL 100.000.
8. Opcional: en Finde volver a «Usar los generales del hotel», revisar (dice «propios → los generales del hotel») y confirmar.
9. Otras comprobaciones: «CERRADA · Todos» aparece deshabilitado (compra cerrada); «LOCAL 4» no muestra selector; «LOCAL 5» (por unidad) tampoco; en «LOCAL 3 · Corporativa» se exige aceptar «Tarifa no incluye impuestos.».
10. `& $L restaurar` para volver a empezar.

## 6. Guía: aplicar a la venta por grupos, empates, borrador, volver y CSV (entrega 3c, migración 299)
Hotel **«LOCAL 1 · Dubai con grupos»**, vigencia **ALTA**, como `operaciones@local4360.test`. Recorrido en orden; `& $L restaurar` vuelve a la foto (la 3b validada, con la 299 y PUENTE).
1. Ficha → Vigencias: ALTA muestra «Semana L M X J · Finde V S D · **preparado**». Abrir «Grupos de días» de ALTA: cabecera «Preparado — no se vende todavía». Si la propuesta está vacía, cargar la Semana (o usar la calculadora por grupo, §5) y confirmarla.
2. Sección **Venta** → «Revisar aplicación a la venta» (1 lectura). Debe aparecer, en rojo, **«Empate de prioridad entre ALTA y PUENTE (las dos con prioridad 1): Estándar / PAM · Doble, del 15/03/2027 al 17/03/2027»** y «Aplicar a la venta» deshabilitado. «Cancelar (no cambia nada)».
3. Resolver el empate: cerrar el panel, «Editar» la vigencia PUENTE y subirle la **prioridad a 2** (o acotar sus fechas). Volver a revisar: el empate ya no aparece.
4. Revisar de nuevo: lista de cambios (antes → después por grupo frente a lo que hoy se vende ESOS días), las **acomodaciones que hoy no se venden** con su casilla **sin marcar** (marcarlas una por una o «Confirmar todas»), los efectos (días sin grupo, promociones calculadas desde ALTA que conservan su precio, **el «Desde» de porción de este hotel deja de mostrarse**, se regeneran los tarifarios). «Aplicar a la venta» se habilita solo con todo confirmado. Confirmar.
5. Comprobar: cabecera «Se vende por grupos de días»; en la ficha, ALTA dice «se vende por grupos» y la tabla de tarifas muestra las filas de cada grupo con su etiqueta y «Se edita en Grupos de días» (sin editar/eliminar). Los días de los grupos están bloqueados. Volver a aplicar sin cambios: la revisión dice «No hay cambios pendientes».
6. **Borrador con venta activa**: cambiar un precio de la Semana y «Confirmar propuesta»: lo que se vende no cambia (columna «Se vende hoy»). «Revisar cambios para aplicar a la venta» muestra solo ese cambio → aplicar. Repetir con otro cambio y probar «Descartar borrador»: la propuesta vuelve a lo vigente.
7. **Calculadora**: «Calcular para: ALTA · Semana — se vende (el cálculo queda en el borrador)»; confirmar y aplicar desde Grupos de días. Con «Todos los días» la calculadora avisa que ALTA se vende por grupos y no la genera ni la reemplaza (tampoco PROMO-ALTA, calculada desde ALTA).
8. **Empate por edición directa**: «Editar» PUENTE y volver a prioridad 1 → se rechaza con «Empate de prioridad entre ALTA y PUENTE…» y no se guarda.
9. **Borrar un grupo que se vende**: borrar el Finde → el texto lista sus tarifas que salen de la venta y que viernes a domingo salen de la cobertura; confirmar. Intentar borrar la Semana (único que se vende): no se puede confirmar.
10. **Volver a «todos los días»**: elegir para cada combinación la tarifa de qué grupo se conserva o «No conservar» (nada viene elegido; sin elegir todas no se confirma) → ALTA vuelve a «preparado» con la tarifa elegida para todos los días; los grupos conservan su propuesta.
11. **CSV** (Producto → Hoteles → carga de tarifas): una fila con `grupo` = «Semana» para ALTA va al **borrador** (aviso «fueron al borrador»; no se vende hasta aplicar). Una fila sin `grupo` para una vigencia que se vende por grupos se rechaza con mensaje claro; una con un grupo que no existe o sin ningún neto rechaza esa vigencia del CSV.
12. Roles: `venta@` no abre la calculadora ni la revisión; `minorista@` puede revisar pero no aplicar (catálogo solo desde Mayorista).

**Resto de #43/#60:** se irá sumando sobre estos hoteles sintéticos a medida que se implementen 4, 5, L y 6 (plan en `vigencias-por-dia-43-60.md` §AG).
