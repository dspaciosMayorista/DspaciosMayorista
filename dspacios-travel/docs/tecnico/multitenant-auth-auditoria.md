# Multitenant, Auth/Roles, RLS y Auditoría — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`contabilidad.md`](./contabilidad.md)

Cómo conviven dos agencias (mayorista/minorista) en una sola app, el modelo de roles/permisos,
el patrón general de RLS, y el sistema de auditoría (trazabilidad de todo el CRUD).

---

## 1. Multitenant — mecanismo

### `lib/tenant.ts` (isomórfico, sin `next/headers` — seguro para bundles de cliente)

```ts
export type Tenant = "mayorista" | "minorista";
export const TENANTS: Tenant[] = ["mayorista", "minorista"];
export const COOKIE_TENANT = "tenant";
export const PREFIJO_TENANT: Record<Tenant, string> = { mayorista: "", minorista: "MIN-" };

export function numeroConTenant(numero: string, tenant: Tenant): string {
  const pre = PREFIJO_TENANT[tenant];
  return pre && !numero.startsWith(pre) ? pre + numero : numero;
}
export function numeroVisible(numero): string { return numero.replace(/^MIN-/, ""); }
```

**Esquema de numeración**: `numero_contrato` lo genera una secuencia Postgres GLOBAL
(`siguiente_numero_contrato()`, formato `00-NNNN`) compartida por las dos agencias — es una PK
global referenciada por ~15 tablas hijas. Como minorista reusa la misma secuencia/formato, un
número crudo podría generarse igual en ambos tenants. Por eso todo número de minorista se
guarda con prefijo `MIN-` (`numeroConTenant`), haciendo los números de las dos agencias
disjuntos aunque el valor de secuencia subyacente se repita. `numeroVisible` solo quita el
`MIN-` para mostrar (el usuario nunca ve el prefijo de desambiguación interno).

### `lib/tenant.server.ts` (server-only)

```ts
async function tenantContext(): Promise<{tenant, userTenant, puedeCambiar, permitidos}> {
  // lee usuarios.rol/tenant del usuario actual
  puedeCambiar = (rol === "superadmin")          // SOLO superadmin puede cambiar de tenant
  permitidos = puedeCambiar ? TENANTS : [userTenant]
  // lee cookie 'tenant', la VALIDA contra permitidos (ignora/sobreescribe si no calza)
  tenant = (cookie válida y en permitidos) ? cookie : permitidos[0]
}
async function getTenant(): Promise<Tenant>       // wrapper de conveniencia
async function agenciaDe(t?: Tenant)               // fila de `agencias` (datos fiscales) del tenant
```
`gerencia`, pese a tener visibilidad cross-tenant en RLS vía `puede_ver_tenant()`, **NO** puede
cambiar el tenant activo — solo `superadmin`.

### Switch de tenant — `app/(dashboard)/tenant-actions.ts`
```ts
async function cambiarTenant(t): Promise<{ok}> {
  if (!permitidos.includes(t)) return {ok:false};   // re-valida server-side
  cookies().set(COOKIE_TENANT, t, {path:"/", maxAge: 1 año});
  revalidatePath("/dashboard", "layout");
}
```
`TenantSwitcher.tsx`: si `!puedeCambiar || permitidos.length<2` → badge estático (lo que ve
cualquier no-superadmin); si puede cambiar → `<select>`, y al cambiar hace **reload completo de
la página** (no solo refresh) para limpiar estado de cliente obsoleto. (Su propio comentario
dice "para superadmin/gerencia es un desplegable" — **desactualizado**: el gate real es
`rol === "superadmin"` solamente.)

### Columna `tenant` — migración `20260601000107_multitenant.sql`
12 tablas con `tenant text not null default 'mayorista'`: `ventas, abonos, cuentas_por_pagar,
facturacion, aliados_b2b, liquidacion_comisiones, pe_empleados, pe_costos,
contabilidad_movimientos, conciliacion, conciliacion_extracto, usuarios`.
**`auditoria.tenant` se agrega en la migración SIGUIENTE (108), no en la 107.**
Tablas hijas (`contrato_items`, `contrato_pasajeros`, etc.) NO tienen `tenant` propio — cuelgan
del contrato, que ya es de una sola agencia, y se filtran vía la venta.

### Funciones Postgres
```sql
mi_tenant() returns text
  -- coalesce(usuarios.tenant del uid actual, 'mayorista')
puede_ver_tenant(t text) returns boolean
  -- mi_rol() in ('superadmin','gerencia') OR mi_tenant() = t
```

### `proxy.ts` — gate de módulos ocultos para minorista
```ts
MINORISTA_OCULTAS = ["/dashboard/reservar","/dashboard/cotizaciones","/dashboard/vuelos",
  "/dashboard/paquetes","/dashboard/producto","/cms"]
```
Si el cookie `tenant==='minorista'` y la ruta matchea (exacto o prefijo `+"/"`), redirige a
`/dashboard`. Espejado en el nav (`app/(dashboard)/layout.tsx`, flag `minoristaOculto: true`),
que además oculta `/tarifario` y `/cms` del sidebar — **`/tarifario` NO está en
`MINORISTA_OCULTAS`** porque es una ruta pública (listada en `RUTAS_PUBLICAS`), la gating de
tenant a nivel de proxy no aplica ahí; solo se oculta el LINK del nav.

## 2. `proxy.ts` (convención Next 16 — no `middleware.ts`)

Confirmado: no existe `middleware.ts` en el repo. `proxy.ts` en la raíz exporta `proxy(request)`
+ `config.matcher`. Orden de la lógica:
1. Bootstrap del cliente SSR de Supabase (cookies get/set para que la sesión refrescada se
   propague).
2. `user = await supabase.auth.getUser()`.
3. **Allowlist pública** (`RUTAS_PUBLICAS`): `["/tarifario","/login","/c/","/auth","/portal",
   "/pagar","/sitio_web"]` + la raíz `"/"`. `/auth` público porque `/auth/callback` (OAuth)
   corre antes de que exista sesión; `/portal`/`/pagar` son superficies públicas B2B/pago;
   `/sitio_web` es el sitio de marketing.
4. **Gate de auth**: sin usuario y ruta no pública → redirect a `/login`. Único checkpoint que
   protege todo lo demás, incluido `/dashboard/*` y `/cms`.
5. **Redirect de roles externos B2B**: solo si `pathname` empieza con `/dashboard` Y NO con
   `/dashboard/reservar` (única excepción — agencia/freelance/cliente_final lo usan para
   generar su propio contrato desde el tarifario). Si `rol` está en
   `["agencia","freelance","cliente_final"]`, redirect a `/portal/b2b`.
6. Gate minorista (§1).
7. `matcher`: excluye `_next/static`, `_next/image`, `favicon.ico`, `logo`, extensiones de
   imagen estáticas.

## 3. Auth / Roles

### Enum `rol_usuario` (migración 001) — **9 valores exactos, sin cambios desde entonces**
```sql
'superadmin','gerencia','administracion','operaciones','venta','control_vuelo',
'agencia','freelance','cliente_final'
```
Internos: `superadmin, gerencia, administracion, operaciones, venta, control_vuelo` (6 —
`control_vuelo` es un rol interno propio, aparte). Externos/B2B: `agencia, freelance,
cliente_final` (3). **No existe rol `publico`** — el acceso anónimo se resuelve solo a nivel de
ruta (`RUTAS_PUBLICAS`), nunca con un valor de rol. Default de `usuarios.rol` = `'venta'`.

```sql
mi_rol() returns rol_usuario  -- select rol from usuarios where id=auth.uid(), security definer stable
```
Es el único helper de rol a nivel Postgres usado en RLS/funciones SECURITY DEFINER.

**(jul-2026, superado) `lib/permisos.ts` + `permisos_rol`/`permisos_usuario`:** existió una capa
aparte y más fina (matriz `consultar/modificar/eliminar` configurable por rol/usuario desde
`/dashboard/usuarios/permisos`), pero una auditoría encontró que solo gobernaba la
**visibilidad del menú** — de los ~13 módulos que administraba, sus casillas de
`modificar`/`eliminar` solo se consultaban de verdad en 1 flujo (aprobaciones B2B) de toda la
app. El resto de páginas o no tenía ningún check de rol (confiaba 100% en RLS) o tenía su
propio array hardcodeado por archivo, sin relación con la matriz — y ninguna de las dos capas
se sincronizaba con los roles que realmente autorizaba la RLS de cada tabla, causando bugs
recurrentes (ej. un rol veía el botón "editar" pero el guardado fallaba con un error crudo de
RLS). Se retiró (migración 137 + `lib/roles.ts`, ver ese archivo abajo); las tablas
`permisos_rol`/`permisos_usuario` quedan en la BD sin usarse (no se borran por convención).

**Reemplazo: `lib/roles.ts`.** Una sola constante `ESCRITURA` (recurso → roles autorizados a
escribir) que debe reflejar EXACTAMENTE las políticas RLS de escritura de la tabla
correspondiente — no hay forma de que Postgres "importe" la constante, así que ambas capas se
mantienen sincronizadas a mano (el comentario de cada policy en las migraciones lo indica).
`ESCRITURA` se usa donde una Server Action no puede confiar solo en RLS (usa el cliente
service-role, que la bypassa — ej. aprobaciones B2B) y `LECTURA_MODULO` (más amplio,
`ROLES_INTERNOS` para casi todos los módulos) gatea la visibilidad del menú lateral
(`app/(dashboard)/layout.tsx`). `miRol()` reemplaza la vieja `permisosDelUsuario()`.

### Patrón repetido: revalidar el rol dentro de cada Server Action
Aunque una Server Action llame a un RPC SECURITY DEFINER o al cliente admin de service-role,
vuelve a leer `usuarios.rol` del llamante vía el cliente atado a sesión (no confía en nada que
mande el cliente). Archivos con este patrón exacto: `app/cms/actions.ts`,
`dashboard/usuarios/actions.ts`, `dashboard/contratos/actions.ts`,
`dashboard/contratos/importar/actions.ts`, `dashboard/contratos/[numero]/admin-actions.ts`,
`dashboard/reservar/actions.ts`, `app/tarifario/checkout/actions.ts`, `crm/actions.ts`,
`crm/campanas/actions.ts`, `crm/b2b/actions.ts`. Ejemplo (`eliminarContrato`):
```ts
const { data: perfil } = await sb.from("usuarios").select("rol").eq("id", user.id).single();
if (perfil?.rol !== "superadmin") return { ok:false, error:"Solo un superadmin..." };
const { error } = await sb.rpc("eliminar_contrato", {...});   // el RPC TAMBIÉN re-chequea (§6)
```
Belt-and-suspenders: un cliente podría llamar el RPC directo desde el navegador con su propio
JWT, saltándose la Server Action — por eso el candado vive en los DOS lados.

### `dashboard/usuarios/actions.ts` — fix de escalación de privilegios
`requireGestionUsuarios()`: permite gestionar usuarios a `superadmin`/`administracion`, pero:
```ts
if (input.rol === "superadmin" && gate.rol !== "superadmin")
  return { ok:false, error:"Solo superadmin puede asignar el rol superadmin." };
```
en `crearUsuario` y `cambiarRol` — cierra la vía por la que una cuenta `administracion` podía
promoverse (o promover a otra) a `superadmin`. También anti-impersonación: dos cuentas
agencia/freelance no pueden compartir el mismo nombre (case-insensitive) — la vinculación
contrato↔aliado se resuelve por texto en otros lugares del sistema.

## 4. Patrones de RLS

Patrón general (post migración 116):
```sql
using ( mi_rol() in ('superadmin','gerencia',...) and puede_ver_tenant(tenant) )
```
Rol Y tenant en AND — un usuario autorizado por rol solo ve filas de SU tenant salvo que sea
superadmin/gerencia.

**Migración `20260601000116_rls_tenant_isolation.sql`** es el fix: la 107 agregó la columna
`tenant` y los helpers, pero **ninguna policy los usaba** hasta la 116 — un
`administracion`/`operaciones`/`venta` de UNA agencia podía leer/escribir datos de la OTRA (el
aislamiento era solo de UI, no de base de datos). Reescribe (idempotente,
`drop policy if exists`+`create policy`) las policies de: `ventas` (4 policies distintas —
lectura operativa, "asesor ve sus contratos" con `asesor = mi email`, escritura
operaciones/venta, actualizar operaciones), `abonos`/`cuentas_por_pagar`/`aliados_b2b` (for all,
roles superadmin/gerencia/administracion/operaciones), `liquidacion_comisiones`/`facturacion`
(for all, sin operaciones), `pe_empleados`/`pe_costos`/`contabilidad_movimientos`/
`conciliacion`/`conciliacion_extracto` (for all, superadmin/gerencia/administracion). Todas
ANDan `puede_ver_tenant(tenant)`.

`auditoria` tiene su propia policy dedicada (solo select, `mi_rol() in
('superadmin','gerencia')`) — **sin cláusula de tenant en la policy misma**; el filtro por
tenant para auditoría pasa a nivel de aplicación (`.eq("tenant", tenant)` en la query de la
página), no en RLS — asimetría vs. el patrón usado en el resto (bajo riesgo porque los únicos
roles con acceso ya ven ambos tenants de todos modos).

## 5. Auditoría — `auditoria` + `fn_auditoria()` (migración 087, +108 para tenant)

### Esquema
```sql
auditoria(id, creado_en, actor_id uuid, actor_email, actor_nombre, actor_rol,
  accion ('INSERT'|'UPDATE'|'DELETE'), tabla, registro_id text, antes jsonb, despues jsonb,
  cambios jsonb, tenant text default 'mayorista')
```
Índices en `creado_en desc`, `(tabla, registro_id)`, `actor_id`.

### `fn_auditoria()` (trigger function, security definer)
- `actor := auth.uid()`; si existe, busca `usuarios.email/nombre/rol` EN EL MOMENTO de la
  escritura y los guarda como snapshot (por eso el log sigue siendo correcto aunque el usuario
  se renombre/borre después — no hay FK sobre el actor, deliberadamente desacoplado).
- `registro_id` = `coalesce(numero_contrato, record, id, codigo)` de old/new — estrategia
  genérica que funciona sobre tablas heterogéneas sin config por tabla.
- `tenant` = `coalesce(new.tenant, old.tenant, 'mayorista')`.
- Para UPDATE: calcula `cambios` como diff jsonb SOLO de las claves que cambiaron; **si nada
  cambió realmente, no inserta fila** (evita ruido de auditoría por resaves sin cambios reales).

### Trigger genérico attach (bloque `DO`)
```sql
for r in select tablename from pg_tables where schemaname='public'
  and tablename <> all(array['auditoria','tarifario_resultado'])
loop create trigger trg_auditoria after insert or update or delete on public.<tabla> ...
```
Se adjunta a TODA tabla base de `public` excepto `auditoria` (evita recursión) y
`tarifario_resultado` (tabla de caché de alto volumen, excluida por ruido). Como el loop corre
al momento de aplicar la migración, tablas nuevas creadas DESPUÉS no quedan cubiertas
automáticamente — necesitan una migración nueva que re-corra un bloque `DO` equivalente.

### Limitación conocida: escrituras service-role aparecen como "Sistema"
Documentado explícitamente en el comentario de la migración: escrituras con la llave
`service_role` (ej. sillas/costos al reservar) no traen `auth.uid()` → el actor queda null → la
UI muestra "Sistema" — el cambio de datos SÍ se registra, solo el actor no.

### `/dashboard/auditoria/page.tsx`
- Rol: `["superadmin","gerencia"]` (redirect a `/dashboard` si no).
- Tenant: `.eq("tenant", tenant)` a nivel de query (no de RLS, ver §4).
- Filtros: `tabla` (dropdown curado ~17 tablas), `accion`, `q` (registro_id ilike), `actor`
  (ilike email/nombre), `desde`/`hasta`.
- Paginación 50/página. UI expandible: diff antes/después campo por campo (UPDATE), `<pre>` de
  `antes`/`despues` completo (DELETE/INSERT). Muestra `actor_nombre || actor_email || "Sistema"`.

## 6. Hallazgos de seguridad — verificados como YA corregidos en el código actual

- **Cron sin `CRON_SECRET` → falla cerrado (503)**, no abre: `app/api/cron/*` comparan
  `Authorization: Bearer ${CRON_SECRET}` y devuelven 503 si la env var no existe.
- **`eliminar_contrato()` RPC** (migración 117) — agrega el candado DENTRO de la función
  (`if mi_rol() <> 'superadmin' then raise exception`), porque ser SECURITY DEFINER bypasea RLS
  y la Server Action sola no protege una llamada directa `supabase.rpc(...)` desde el navegador.
- **Importador histórico minorista** — `tenantMinoristaOFalla()` exige rol
  superadmin/administración Y que el tenant activo sea `minorista` (doble candado: rol + "no
  estás parado en mayorista", para no reescribir por accidente datos reales de producción vía
  el flujo destructivo delete+insert del importador).
- **`crearContrato` — validación numérica de ítems**: cada `adultos/ninos/tarifaAdulto/
  tarifaNino` se valida `Number.isFinite(n) && n>=0` antes de sumar al PVP — evita
  NaN/Infinity/negativos desde un payload de cliente manipulado. Guards análogos sobre
  `precioVenta`/`pax` agregados.

## Enlaces cruzados

- **Contabilidad** — el mismo patrón service-role + re-chequeo de rol se repite en los posteos
  automáticos — ver [`contabilidad.md`](./contabilidad.md).
- **Comisiones/Rentabilidad** — el tenant-scoping (o su ausencia) de `parametros_tributarios`/
  `asesores` — ver [`finanzas-comisiones.md`](./finanzas-comisiones.md) §10.
