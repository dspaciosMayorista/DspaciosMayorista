# Catálogos globales — permisos de lectura/escritura y frontera de agencia (#5 D8/D9, migración 237)

> **Estado:** implementado y probado en Docker local; **NO aplicado en Producción**. Hasta que el
> dueño ejecute el preflight, aplique la 237, ejecute el postcheck y complete el recorrido de §7,
> **#5 sigue abierta**.

## 1. Decisiones del dueño

- **D8** — Los catálogos globales solo se escriben operando desde **Mayorista**. Ningún usuario
  operando desde Minorista puede crearlos ni editarlos, **incluido superadmin** (que debe entrar por
  Mayorista).
- **D9** — `aliados`, `asesores`, `formas_pago`, `rangos_edad` y `parametros_tributarios` se
  **leen y usan** en ambas agencias; solo Mayorista los crea/edita y el cambio aplica a ambas.
  Tampoco superadmin los edita desde Minorista.
- **Proveedores** — matriz vigente intacta: catálogo base legible por personal interno de ambas
  agencias; datos sensibles solo para los roles de las migraciones 189/191.

## 2. Por qué `mi_tenant_real()` no bastaba

`mi_tenant_real()` devuelve el tenant *home* del perfil. La agencia **activa** de un superadmin
vive en una cookie que nunca llega a Postgres: un superadmin con perfil Mayorista que opera en
Minorista pasaba cualquier policy y podía escribir por la Data API directa. Control negativo
medido (Docker, sin la 237): superadmin sin contexto → escribe; `administracion` Minorista →
escribe `aliados`; `operaciones` Minorista → escribe `destinos`. La 237 cierra los tres.

## 3. Diseño (archivos exactos)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Contexto por sesión | `sesion_agencia(session_id, user_id, tenant)` | Agencia activa de **esa sesión de Auth**. Solo service_role la escribe (RLS forzada, sin grants a anon/authenticated). |
| Registro único de inicio | `sesion_agencia_inicio(session_id)` | Una sesión se inicia **una sola vez**. Mientras la sesión exista el registro permanece: un contexto perdido/borrado **no puede recrearse**. |
| Lectura confiable | `agencia_activa_sesion()` (definer, stable) | Exige usuario **activo**, sesión **viva** en `auth.sessions` (logout/revocación la matan al instante aunque el JWT siga vigente), claim `session_id` del JWT y fila de contexto. NULL ante cualquier falta → **falla cerrado**. |
| Compuerta | `puede_escribir_catalogo_global()` | `agencia_activa_sesion() = 'mayorista'`. |
| RLS | 3 policies **RESTRICTIVAS** (insert/update/delete) por catálogo | Se suman con AND a las policies de rol vigentes, que **no se tocan**. Registro: `catalogos_globales_registro()` (26 tablas). |
| RPC de contexto | `iniciar_contexto_agencia(sesión, agencia, ventana)` · `cambiar_contexto_agencia(sesión, agencia)` | **Solo service_role.** Iniciar exige sesión viva, usuario activo, agencia permitida para su rol, sesión creada hace ≤10 min y no iniciada antes. Cambiar exige superadmin y fila previa. El usuario lo deriva la base de `auth.sessions`; el cliente no pasa identidad. |
| Invalidación | trigger `usuarios_invalidar_contexto_agencia` | Cambiar rol/estado/agencia de un usuario borra sus contextos (una promoción a superadmin a mitad de sesión **no** hereda nada). |
| Definer guardadas | `fn_fusionar_destino`, `generar_tarifas_hotel_calculadora`, `reemplazar_tarifas_hotel_calculadora`, `aprobar_solicitud_b2b` (modo `nueva`) | Corren como dueño y se saltan RLS: llevan la misma guarda por dentro. |
| App | `lib/auth/contextoAgencia.ts`, `lib/auth/sesionJwt.ts` | `iniciarContextoAgencia()` (login, OAuth, atajo por código), `cambiarContextoAgencia()` (selector de agencia), `exigirEscrituraCatalogoGlobal()` (compuerta de Server Actions). |

**Regla para roles que no son superadmin:** solo pueden operar en su agencia de perfil (la app ya lo
impide), así que su agencia efectiva es el perfil leído **en vivo** (con `activo`). Solo el
superadmin necesita —y se le exige— fila de contexto. **Todos** los roles exigen `session_id` en el JWT
y esa sesión **viva** en `auth.sessions`: el JWT anterior de un administracion/operaciones deja de
escribir en cuanto hace logout, se elimina o expira su sesión. *La regla de agencia fija por perfil
no cambió (§9-R2).*

**Transiciones:** login/OAuth → inicia contexto con la agencia de la cookie validada contra el rol
(no se asume Mayorista); selector de agencia → cambia primero el contexto en la base y **solo si salió bien** cambia la
cookie (si la RPC falla: cookie intacta, error visible en el selector, sin recarga; si la cookie no se
puede escribir tras mover la base, se devuelve el contexto a la agencia anterior); logout → `auth.sessions` desaparece y el contexto deja de valer; refresh de token →
conserva `session_id` (mismo contexto); sesiones simultáneas → un contexto por sesión.

## 4. Matriz de lectura y escritura por catálogo

Roles: **SA** superadmin · **GE** gerencia · **AD** administracion · **OP** operaciones ·
**VE** venta · **CV** control_vuelo. Los roles externos (agencia/freelance/cliente_final) no leen
ningún catálogo salvo donde se indica «público» o «autenticado».
**Escritura (después de la 237):** el rol debe estar en la columna *Roles que escriben* **y** la
agencia activa de la sesión debe ser **Mayorista**. Todo lo que la 237 agrega es la segunda condición.

| Catálogo | Lectura (hoy, sin cambio) | Roles que escriben |
|---|---|---|
| `aliados` (D9) | SA GE AD OP VE CV, ambas agencias | SA GE AD |
| `asesores` (D9) | SA GE AD OP VE CV, ambas agencias | SA GE AD |
| `formas_pago` (D9) | cualquier usuario autenticado | SA GE AD |
| `rangos_edad` (D9) | SA GE AD OP (¹) | SA GE AD OP |
| `parametros_tributarios` (D9) | SA GE AD OP VE | SA |
| `destinos`, `hoteles` | público | SA GE AD OP |
| `aerolineas`, `aerolinea_tarifas` | público | SA GE AD OP |
| `planes_alimentacion` | público | SA AD OP |
| `hotel_fotos` | público | SA GE AD OP VE |
| `hotel_acomodaciones`, `hotel_blackouts` | autenticado | SA GE AD OP |
| `hotel_documentos` | SA GE AD OP VE | SA GE AD OP VE |
| `categorias_habitacion`, `hotel_categorias`, `hotel_regimenes`, `hotel_temporadas`, `hotel_calculadora`, `hotel_tarifas_unidad`, `tarifa_hotel` | SA GE AD OP | SA GE AD OP |
| `servicios_adicionales`, `servicio_tarifa_pax`, `servicio_temporadas` | SA GE AD OP | SA GE AD OP |
| `proveedores` (catálogo base) | SA GE AD OP VE CV, ambas agencias | SA GE AD OP con perfil Mayorista |
| `proveedores_datos_sensibles` | SA y GE (ambas agencias); AD OP VE CV solo Mayorista | SA GE AD OP con perfil Mayorista |

(¹) Observación **sin cambiar**: `rangos_edad` solo lo leen SA/GE/AD/OP, así que `venta` de Minorista
no lo lee aunque D9 lo declare «compartido». No se amplió el acceso por inferencia; confirmar si
corresponde (§9-R5).

Verificación de que la **lectura no cambió**: snapshot de filas visibles por 10 actores × 26
catálogos antes y después de la 237 → idéntico (`diff` vacío). Ejemplo medido: `administracion`
Minorista ve 7 proveedores y **0** filas sensibles; `venta` Mayorista ve 7 y 7; `agencia` ve 0 y 0.

### Catálogos NO incluidos en esta entrega (decisión pendiente, §9-R3)
`paquetes`/`armado_*`/`programas*`/`empaquetados`/`salidas_dinamicas`/`tarifas`/`bloqueos_vuelo`/
`sillas`, `escalas_comision`, `config_*`, `crm_*` y `web_*` no tienen columna `tenant` pero son
producto armado, inventario operativo o configuración, no «catálogos». Añadirlos es agregar el
nombre a `catalogos_globales_registro()` y recrear sus policies en una migración nueva.

## 5. Inventario de SECURITY DEFINER y escrituras indirectas

Método (sobre el esquema con las migraciones 1..235): todas las funciones de `public` cuyo cuerpo
contiene `INSERT INTO|UPDATE|DELETE FROM|TRUNCATE` sobre alguno de los 26 catálogos, más las que usan
SQL dinámico (`EXECUTE` + `format`/`||`). Los triggers están incluidos (son funciones).

| Función | Definer | Escribe | Tratamiento |
|---|---|---|---|
| `fn_fusionar_destino(bigint,bigint)` | sí (`anon` tiene EXECUTE; el rol lo valida adentro) | `destinos` + `UPDATE` dinámico de toda FK a `destinos` | guarda añadida |
| `generar_tarifas_hotel_calculadora(...)` | sí | `tarifa_hotel` | guarda añadida |
| `reemplazar_tarifas_hotel_calculadora(...)` | sí | `tarifa_hotel` | guarda añadida |
| `aprobar_solicitud_b2b(...)` | sí | `aliados` (solo modo `nueva`) | guarda añadida antes del INSERT |
| `guardar_proveedor(jsonb,bigint)` | **no (invoker)** | `proveedores`, `proveedores_datos_sensibles` | cubierta por RLS; probado |
| `fn_renumerar_contrato` (dinámica) | sí | tablas de contrato, no catálogos | fuera de alcance |

Cascadas de FK (`ON DELETE`) no pasan por RLS, pero parten de un `DELETE` que sí está guardado.
Escrituras con **service-role** (bypass de RLS): inventario sobre `app/`, `lib/`, `components/` →
**ninguna Server Action de catálogos usa `createAdminClient`** (las 14 rutas que escriben catálogos
usan el cliente de sesión; las dos coincidencias con `createAdminClient` son un comentario y la
creación de usuarios del CRM). Si alguna ruta service-role escribiera un catálogo en el futuro,
**su autorización es código** y debe llamar a la compuerta.
`aprobar_solicitud_b2b` y `iniciar/cambiar_contexto_agencia` se llaman con service-role solo desde
`lib/auth/contextoAgencia.ts`.

## 6. Cobertura de Server Actions

- **Con compuerta explícita** (`exigirEscrituraCatalogoGlobal()` antes de tocar datos; mensaje claro):
  `aliados` (3), `proveedores` (3), `aerolineas` (5), `configuracion` — rangos de edad, asesores,
  formas de pago, parámetros (8) — y `servicios` (7). Probado por cableado estático.
- **Solo RLS** (mensaje genérico de Postgres si se deniega): `tarifario/actions.ts` (destinos,
  hoteles, temporadas, tarifas, inclusiones), `producto/hoteles/actions.ts` y subarchivos
  (`fotos`, `documentos`, `blackouts`, `tarifasUnidad`), `producto/configuracion/actions.ts`,
  `lib/hoteles/eliminarHotel.ts`, cargas masivas. La barrera es la misma (RLS); solo cambia el texto del error.
- **CRM «Cargar agencias B2B»** (`crm/b2b/actions.ts`): insertaba en `aliados` ignorando el error.
  Ahora lo informa fila a fila («solo se edita desde Mayorista»). El resto de la fila (contacto CRM,
  acceso) sigue su camino.
- **Aviso en el panel:** al superadmin se le muestra un banner si su sesión no tiene agencia
  vinculada (debe volver a iniciar sesión) o si opera en Minorista (catálogos de solo lectura).

## 7. Recorrido de validación en Producción (dueño)

Orden: **(0)** preflight → **(1)** desplegar el código → **(2)** aplicar la 237 → **(3)** postcheck →
**(4)** recorrido. (El código es compatible con la base sin la 237: la compuerta solo deja pasar si la
función aún no existe; desplegar la 237 primero dejaría a los superadmin sin poder escribir hasta que
el código nuevo cree su contexto al iniciar sesión.)

0. `supabase/scripts/preflight_237_catalogos_globales.sql` (una consulta) → debe terminar en
   **LISTO PARA APLICAR**. Si algún `md5` de función no coincide, **no aplicar** (hotfix manual).
1. Tras aplicar: `supabase/scripts/postcheck_237_catalogos_globales.sql` → **CORRECTO**.
2. **Superadmin cierra sesión y vuelve a ingresar** (las sesiones previas no tienen contexto).
3. En **Mayorista**: crear **proveedor nuevo** con datos sensibles (NIT, razón social, banco, cuenta,
   política, contacto de voucher) → guardar → **editarlo** (cambiar un dato sensible) → verificar que
   se guarda.
4. Usar ese proveedor: asignarlo a un **hotel**, a un **servicio**, crear una **CxP** a su nombre y
   generar un **voucher** que muestre solo el contacto de voucher (sin cuenta bancaria).
5. Cambiar a **Minorista** (selector de agencia): aparece el aviso «catálogos de solo lectura»;
   abrir el proveedor, el hotel, la lista de aliados: **se ven**, pero **no hay forma de guardar**
   (botones fallan con mensaje «solo se editan desde Mayorista»). Un usuario real de Minorista
   (administracion): ve el proveedor **sin** datos sensibles.
6. Volver a **Mayorista**: se puede editar de nuevo sin cerrar sesión.
7. **Selectores con datos reales de ambas agencias:** en Minorista y en Mayorista abrir los
   selectores de destino, hotel, proveedor y aliado (contratos, CxP, vouchers, cotizaciones): mismas
   coincidencias que antes, sin duplicados nuevos, y el texto libre sigue permitido donde ya lo estaba.
8. Una **reserva** completa en Mayorista y una acción de contrato en Minorista (p. ej. registrar un
   abono): funcionan igual que antes (no usan catálogos globales para escribir).
9. Cerrar sesión y, con el botón «atrás», intentar guardar un catálogo: debe pedir ingresar de nuevo.

Reportar el resultado de cada paso. **#5 no se declara cerrada hasta entonces.**

## 8. Pruebas ejecutadas (Docker local, Supabase CLI 2.122, Postgres 15, GoTrue/PostgREST reales)

Ver el reporte de entrega para los números exactos. Artefactos reproducibles:
`supabase/scripts/pruebas_237/harness.mjs` (118 comprobaciones con sesiones reales: contexto por
sesión, logout, sesiones simultáneas, refresh token anterior, usuario desactivado, promoción a mitad de
sesión, anti-recreación, ventana, llamadas directas a REST/RPC con cabeceras forjadas, funciones
definer, regresiones de creación/edición, servicio-role) con modos `SNAPSHOT=archivo` (lectura antes/
después) y `CONTROL_SIN_237=1` (demuestra el hueco previo); `pruebas/catalogosGlobales237.test.ts`
(10, parte pura y cableado) y `pruebas/cambiarTenant237.test.ts` (12, el selector con la RPC fallando).
La 237 corre en una **transacción explícita** (`begin`/`commit`): probado en la ruta manual (psql sin
`-1`) que un fallo justo antes del `commit` termina en `ROLLBACK` sin tablas, funciones, trigger ni
policies a medias y con las 4 funciones intactas. Rollback: `supabase/scripts/rollback_237_catalogos_globales_frontera.sql`
(restaura las 4 funciones a su definición previa; verificado reaplicando la 237 después).

## 9. Riesgos abiertos

- **R1 — Refresh token anterior / reutilización:** el contexto se ata a `session_id`, que el refresh
  conserva; reutilizar un refresh token viejo devuelve la misma sesión mientras Auth la acepte, y la
  base no lo distingue. No concede nada que la sesión legítima no tuviera, pero es un límite de la
  garantía (el spike V1–V13 lo registró como INFORMA).
- **R2 — Alcance «contexto solo para superadmin».** Si el dueño quiere exigir fila de contexto a
  **todos** los roles (más estricto), todo usuario de Mayorista tendría que volver a iniciar sesión
  tras aplicar la 237. Hoy se evita esa interrupción porque el perfil de un rol no superadmin ya fija
  su agencia.
- **R3 — Alcance de «catálogos globales»:** lista de 26 elegida por mí (§4); lo excluido (producto
  armado, vuelos, config, CRM, web) necesita decisión.
- **R4 — Sesiones previas:** los superadmin deben re-ingresar; el banner lo avisa. Sin eso, escriben
  → error claro, no corrupción.
- **R5 — `rangos_edad` para `venta` Minorista** (§4, nota ¹), sin cambio.
- **R6 — Server Actions «solo RLS»** (§6): seguras pero con mensaje genérico.
- **R7 — La capa Next (cookies SSR) no se ejecutó contra GoTrue local;** se probó la base con sesiones
  reales y la lógica pura/cableado en unidades. Cubierto por el recorrido de §7.
- **R8 — Dependencia de `auth.sessions`** (tabla interna de GoTrue): columnas `user_id`, `created_at`,
  `not_after` verificadas en la versión local y en el preflight (control 11).
- **R9 — TRUNCATE** no pasa por RLS, pero PostgREST no lo expone; sin cambio.
- **R10 — JWT sin `session_id`:** como ahora todos los roles lo exigen, un token que no lo traiga (no ocurre con el Auth actual; el flujo local lo confirma) quedaría sin escritura de catálogos hasta renovar la sesión. Lectura intacta.

- **R11 — Doble fallo del selector (cookie + restauración):** `tenantContext()` ya no confía en la cookie para el superadmin: si difiere de `sesion_agencia` muestra la agencia de la SESIÓN (`resolverTenantEfectivo`, `desincronizada`), `cambiarTenant` devuelve `recargar: true` y el selector recarga; el panel muestra el aviso «cambio no completado». Queda un lector de cookie aparte, `contextoCrearContrato` (`lib/contrato/contexto.ts`), que fija el tenant de un contrato nuevo; no afecta la autorización de catálogos.

- **R12 — Lectura de la agencia de la sesión (cuatro desenlaces):** `clasificarAgenciaSesion` (lib/tenant.ts) separa RPC **ausente** (PGRST202/42883, código antes que la 237: rige la cookie), respuesta **válida sin contexto** (null: rige la cookie, la base ya niega catálogos), **ok** (manda la sesión) y **error técnico** (la cookie NO se presenta como verificada: el panel lo avisa y marca "(sin verificar)", `getTenant()` lanza `AgenciaNoVerificadaError` y `contextoCrearContrato()` rechaza ANTES de numerar). `contextoCrearContrato()` usa ahora `resolverTenantEfectivo`, la misma agencia que el panel (R11 queda cerrado). Único lector residual de la cookie: `proxy.ts`, que solo oculta módulos de Minorista (bloquea, no autoriza); con un cambio a medias podría redirigir módulos de producto aunque el panel muestre Mayorista. Lista cerrada de lectores/escritores de la cookie vigilada por `pruebas/tenantEfectivo237.test.ts`.
