# Portal B2B — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`finanzas-comisiones.md`](./finanzas-comisiones.md) ·
> [`multitenant-auth-auditoria.md`](./multitenant-auth-auditoria.md) · [`reservar.md`](./reservar.md)

Área externa (`app/portal/`) para usuarios con rol `agencia`/`freelance`/`cliente_final`:
registro, aprobación, dashboard de contratos/comisiones, "agentes" de una agencia, y el
documento de cuenta de cobro. `proxy.ts` redirige cualquier `/dashboard/*` (excepto
`/dashboard/reservar`) a `/portal/b2b` para estos 3 roles.

---

## 1. Árbol de rutas

```
app/portal/
├── page.tsx                    "/portal" — elegir Portal Admin vs Portal B2B (pública)
├── b2b/
│   ├── page.tsx                "/portal/b2b" — dashboard del aliado
│   └── agentes/
│       ├── page.tsx            "/portal/b2b/agentes" — solo titular de agencia
│       ├── actions.ts          crearAgente / cambiarEstadoAgente
│       └── AgentesClient.tsx
├── comision/[numero]/page.tsx  "CUENTA DE COBRO" imprimible (solo freelance)
└── registro/
    ├── page.tsx / RegistroForm.tsx
    └── actions.ts               enviarSolicitudB2B
```
Relacionadas pero fuera de `app/portal/`: `app/pagar/page.tsx` (link de pago público, §4),
`app/estado-cuenta/[numero]/page.tsx` (estado de cuenta imprimible, compartido interno/aliado),
`app/(dashboard)/dashboard/usuarios/b2b/` (aprobación **interna** de solicitudes — no es parte
del portal externo), `app/(dashboard)/dashboard/reservar/` (única subruta de `/dashboard/*` que
`proxy.ts` no bloquea para roles externos).

No existen `/portal/login`, `/portal/cobros`, `/portal/notificaciones` ni `/portal/solicitudes`
— esas viven del lado interno del dashboard.

## 2. Registro externo — `app/portal/registro/actions.ts::enviarSolicitudB2B`

Campos: `tipo` ('agencia'|'freelance', cualquier otro valor cae a 'agencia'), `nombre, nit,
contacto, email, telefono, ciudad, notas, aceptaNotificaciones, password, passwordConfirm`.
Validación mínima: nombre/email obligatorios, password ≥6, password===passwordConfirm. **Sin
validación de formato de email ni de NIT.**

**Candado anti-suplantación** (los contratos de un aliado se vinculan también por nombre en
texto libre — ver §6): busca `usuarios` con `rol in ('agencia','freelance')` e `ilike` exacto
(no `%...%`) contra `input.nombre`, **sin filtrar por tenant** — si hay match, rechaza con "Ya
existe una cuenta de aliado registrada con ese nombre". **Este candado NO existe en
`crearAgente`** (§7) — un titular de agencia puede nombrar un agente sin chequeo de duplicado
(riesgo menor porque los agentes matchean por `agencia_id`, no por nombre).

Flujo de creación:
1. `admin.auth.admin.createUser({email, password, email_confirm:true, user_metadata:{nombre,
   rol:tipo}})` — la cuenta de Auth se crea de inmediato, sin esperar aprobación.
2. El trigger `handle_new_user()` inserta la fila en `usuarios` con el rol de `user_metadata`.
3. `enviarSolicitudB2B` hace `update` inmediato: `{rol:tipo, activo:false, nombre,
   pct_comision: tipo==='agencia'?0.12:0.11}` — **nace inactiva**, ya con el % default de su
   tipo.
4. Inserta en `b2b_solicitudes`: `{tipo, nombre, nit, contacto, email, telefono, ciudad, notas,
   acepta_notificaciones, estado:'pendiente', usuario_id}`.

**Requiere aprobación manual**, sí — aunque las credenciales de Auth ya sirven para loguearse,
`activo=false` hace que `/portal/b2b` muestre "Registro en revisión" (§9) hasta que se apruebe.

**No hay forma de "vincularse" a una agencia existente desde el registro público** — siempre
crea un usuario nuevo. Sumar gente a una agencia ya existente solo lo puede hacer el **titular**
desde `/portal/b2b/agentes` (§7).

## 3. `b2b_solicitudes` (migración 074)

```sql
b2b_solicitudes(id, tipo default 'agencia', nombre, nit, contacto, email, telefono, ciudad,
  notas, acepta_notificaciones default true, estado default 'pendiente', usuario_id (FK
  usuarios), revisado_por, revisado_at, created_at)
```
RLS: `insert` público (`with check(true)`); gestión (`for all`) solo
`superadmin/administracion/gerencia`.

Aprobación/rechazo — `dashboard/usuarios/b2b/actions.ts` (candado: `puedeEscribir("b2b", rol)`,
`ESCRITURA.b2b = ADMIN_ROLES = superadmin/administracion/gerencia`, vía `lib/roles.ts`):
- `aprobarSolicitudB2B(id)` — busca el usuario por email (**siempre existe**, el registro ya lo
  creó), `update({rol:tipo, activo:true})`, marca la solicitud `aprobada` + auditoría de
  quién/cuándo.
- `rechazarSolicitudB2B(id)` — solo marca `rechazada` + auditoría. **No revierte nada ni borra
  el usuario de Auth** — deja una cuenta de Auth huérfana, inactiva para siempre, sin ruta de
  limpieza en el código.

**Gotcha**: el comentario de la página dice "si no existe el usuario queda aprobada y se
vincula cuando inicie sesión con ese correo" — esa rama **nunca se ejecuta** con el flujo
actual, porque el registro siempre crea el usuario de Auth de inmediato. Describe un camino
alternativo (invitar primero, aprobar después) sin UI que lo dispare hoy.

## 4. `/pagar` — link de pago, NO es una pasarela

Migración `075_link_pago.sql` agrega **una sola columna** `config_sitio.link_pago text` (no
crea tabla `link_pago`). Comentario textual de la migración: *"URL del link de pago (Wompi/
Bold/Nequi/PayU/etc.) que pega el dueño... una pasarela 'real' (con webhooks que marquen el
abono solo) se conecta encima más adelante; por ahora es un enlace directo."*

`app/pagar/page.tsx`: lee `config_sitio.link_pago` (lectura pública `using(true)`); si existe,
muestra un botón `<a href={link} target="_blank">` a una URL externa arbitraria; si no, "El
pago en línea aún no está habilitado." Aviso tras el botón: *"Tras pagar, envía el comprobante a
tu asesor para registrar el abono"* — **100% manual, sin integración ni webhook que registre
el abono automáticamente.** `/portal/b2b` también enlaza este mismo `link_pago` como "Pagar en
línea →" en su barra de menú.

## 5. Notificaciones — el registro/aprobación B2B NO dispara ningún correo

`lib/notificaciones.ts` (`config_notificaciones`, migración 062) es un digest **operativo
interno** (CxP por vencer, cuotas de cliente por vencer, bloqueos por devolver/emitir) enviado
vía Resend a destinatarios del **equipo interno** — no al aliado. `config_solicitudes`
(migración 056) es para el carrito del tarifario dinámico público (WhatsApp/email de checkout),
no para registro de aliados. `config_cobros`/`cuotas` (migración 061) es % mínimo de abono y
plan de cuotas, uso interno.

Grep exhaustivo de `enviarEmail` en todo el repo: solo aparece en los archivos del CRM
(`crm/actions.ts`, `crm/campanas/actions.ts`, `crm/email/EmailConfigForm.tsx`, `lib/crm/
email.ts`) y `lib/notificaciones.ts`. **Ninguno referencia `b2b_solicitudes`.**

**Conclusión**: cuando el dueño aprueba o rechaza una solicitud B2B, el aliado **no recibe
ningún correo automático** — se entera solo si vuelve a `/portal/b2b` y ya no ve "Registro en
revisión" (aprobado), o nunca se entera (rechazado, sin aviso alguno).

## 6. `ventas_b2b` (migración 073) — `modo_compra`, `comision_estado`, `b2b_usuario_id`

Agrega a `ventas`: `b2b_usuario_id (FK usuarios), modo_compra ('neta'|'comisionable'),
comision_b2b numeric, comision_estado`.

Se calcula en `dashboard/reservar/actions.ts` (bloque "Modo de compra B2B"):
```
if (tipoAsesor !== 'interno' && modoCompra) {
  baseComisB2B = max(0, precioVenta - impuestoTotal)
  pct = aliado.pct_comision ?? (agencia?0.12:0.11 default de parametros_tributarios)
  comision = round(baseComisB2B * pct)
  if (modoCompra==='neta') { precioFinal = max(0, precioVenta - comision); comisionEstado='descontada' }
  else                     { comisionEstado='pendiente' }   // el aliado paga el PVP completo
  b2bUsuarioId = (usuario logueado tiene rol agencia|freelance) ? su auth.uid() : null
}
```
- `'neta'` → el aliado paga PVP−comisión de una vez; `comision_estado` queda `'descontada'`
  (**un 5º valor real que sí se escribe**, no listado en el comentario original de la migración
  `pendiente|cuenta_cobro|facturada|pagada`).
- `'comisionable'` → paga el PVP completo; comisión se cobra aparte (cuenta de cobro/factura).
- **`b2b_usuario_id` solo se estampa si el propio aliado logueado hace la reserva.** Si un
  asesor interno reserva eligiendo un `aliadoId` del catálogo `aliados` en nombre de una
  agencia, `b2b_usuario_id` queda `null` y el vínculo es **solo por texto**
  (`agencia_nombre`/`freelance_nombre`) — el mismo vector de suplantación que mitiga el candado
  de nombre en el registro (§2).

**`comision_estado` nunca se actualiza después de creado** (grep confirma cero acciones de
"marcar facturada/pagada") — los valores `'cuenta_cobro'/'facturada'/'pagada'` del comentario
de la migración y del mapa `ESTADO_COMISION` en la UI son **aspiracionales, no implementados**;
en producción solo existen `'pendiente'` y `'descontada'` (este último se muestra crudo, sin
traducir).

### Dos conceptos de "aliado" sin FK entre sí
1. **`aliados`** (catálogo, id serial) — usado por `crearContrato`/`reservarDesdeTarifario` para
   tomar `nombre, nit, pct_comision, aplica_retencion, pct_retencion`; alimenta `aliados_b2b`.
   Sin login.
2. **`usuarios` con `rol IN ('agencia','freelance')`** — cuentas del Portal B2B, con
   `agencia_id`/`pct_comision` propio. Se vinculan a ventas por `b2b_usuario_id` (fuerte) o por
   coincidencia de nombre (`agencia_nombre`/`freelance_nombre`, débil/legacy).

`input.aliadoId` en el formulario de reservar apunta a `aliados.id`, **no** a `usuarios.id` —
son universos separados.

## 7. `usuario_agencia` (076) / `usuario_pct_comision` (077)

- **076**: `usuarios.agencia_id → usuarios(id)`. "Una agencia (usuario rol 'agencia' con
  `agencia_id` NULL = titular) puede tener varios AGENTES (rol 'agencia' con `agencia_id` =
  id del titular). La facturación en contrato NETO siempre es de la AGENCIA (el titular), sin
  importar qué agente reserve."
- **077**: `usuarios.pct_comision numeric` (fracción). "La comisión es POR AGENCIA, no por
  paquete. Cada aliado trae su % por defecto al registrarse (12%/11%) y el superadmin puede
  ajustarlo por usuario."

Cómo se combinan (`app/portal/b2b/page.tsx`):
```
pctAgencia = perfil.pct_comision
si perfil.agencia_id existe: pctAgencia = (pct_comision DEL TITULAR)   // el agente hereda del titular
pctEfectivo = pctAgencia ?? comisionDefault(rol)
categoria   = categoriaAliado(rol, pctEfectivo, default)   // Junior/Senior, derivado, sin persistencia
```
**Aclaración de nomenclatura**: un agente (`agencia_id` no nulo) **siempre usa el
`pct_comision` del titular**, ignorando el suyo propio si lo tuviera — `usuarios.pct_comision`
(el % del aliado, editable por superadmin) es una columna homónima pero conceptualmente
distinta de `aliados.pct_comision` (catálogo interno de §6); mismo nombre, dos tablas, dos
propósitos.

## 8. RLS — el portal B2B NO está protegido por RLS

Confirmado por grep exhaustivo: **ninguna policy otorga a `'agencia'`, `'freelance'` o
`'cliente_final'` acceso directo a `ventas`, `abonos`, `cuentas_por_pagar`, `aliados_b2b` ni
`cotizaciones`.** Por eso TODO `app/portal/**`, `app/estado-cuenta/`, `app/portal/comision/`
usan `createAdminClient()` (service-role, bypassa RLS por completo) y filtran "solo lo mío" **a
mano en el código de cada página** (`b2b_usuario_id === user.id` o nombre contra
`agencia_nombre`/`freelance_nombre`). **RLS no es la capa de seguridad del portal — lo es la
lógica de aplicación en cada page.tsx/lib**; un bug ahí es una vulnerabilidad de datos completa,
no mitigada por ninguna policy de base de datos. No hay un helper centralizado para este
chequeo (salvo el caso puntual de `lib/cuenta/estado.ts`) — cualquier página nueva del portal
debe replicarlo manualmente.

`usuarios`: un aliado solo puede leer/escribir su **propia fila** (`id=auth.uid()`) vía RLS
normal — por eso `crearAgente`/`cambiarEstadoAgente` usan `createAdminClient()` para tocar
usuarios de otros ids (agentes de la misma agencia).

`b2b_solicitudes`: insert público (`with check(true)`); gestión solo roles admin.
`config_sitio` (incl. `link_pago`): lectura pública.

## 9. `agencia` vs `freelance` vs `cliente_final`

| | `agencia` | `freelance` | `cliente_final` |
|---|---|---|---|
| Naturaleza | Persona jurídica | Persona natural | Consumidor final |
| `/portal/b2b` | dashboard completo | dashboard completo | **NO reconocido** — cae a la pantalla genérica "ingresa o regístrate" con copy confuso ("Estás con una cuenta interna") aun logueado |
| Cuenta de cobro | no (ve "Factura electrónica") | **sí, exclusivo** | no aplica |
| Crear "agentes" | sí, si es titular | no existe el concepto | no aplica |
| `/estado-cuenta/[numero]` | accesible si `esDueno` | igual | **nunca matchea** — no hay columna que vincule `ventas` a un `cliente_final` por `usuarios.id` |
| Alta | registro público o interna | igual | **solo asignable manualmente** por un admin en `/dashboard/usuarios` — sin flujo de registro público |

### ⚠️ Gotcha mayor: `cliente_final` es un rol "fantasma"
Existe en el enum, en `ROLES_EXTERNOS` (`proxy.ts`/`lib/constants.ts`), y el login
lo redirige a `/portal/b2b` igual que agencia/freelance — **pero no existe ninguna pantalla,
tabla de vínculo, ni feature construida para que vea/descargue su propio contrato.** Está en
toda la infraestructura de enrutamiento/permisos pero sin una sola línea de UI que lo reconozca
positivamente (`esB2B` en `portal/b2b/page.tsx` lo excluye explícitamente). Si se asigna este
rol hoy: login exitoso → redirigido a `/portal/b2b` → ve la pantalla de "ingresar/registrarse"
como si fuera anónimo, sin ningún dato suyo visible, y si alguien le pasa el link directo de su
`/estado-cuenta/[numero]` tampoco le sirve (`notFound()`, `esDueno` no lo reconoce).

`categoria:"cliente_final"` en el CRM de marketing (clasificación de contacto,
`app/tarifario/checkout/actions.ts`/`crm/actions.ts`) es un valor de **otro dominio** (contactos
de campañas), sin relación con el rol de autenticación homónimo — mismo string, dos cosas.

## 10. Otros gotchas

- **Código muerto**: `app/portal/b2b/page.tsx` tiene un segundo bloque `if (!esB2B)` (líneas
  ~60-69, "Usuario interno: este portal no es para él") que nunca se alcanza — la condición ya
  fue capturada y retornada por el primer bloque.
- **Solicitudes rechazadas dejan un usuario de Auth activo-en-Supabase, `activo=false` para
  siempre** — sin acción de limpieza/eliminación en el código.
- **`/dashboard/reservar` no tiene gating de rol dentro de la página** (solo el bloqueo general
  de `proxy.ts` para todo lo demás de `/dashboard`) — un `cliente_final` con sesión válida
  podría técnicamente cargarla, aunque no tiene forma de llegar ahí desde ningún link visible.

## Enlaces cruzados

- **Comisiones/Rentabilidad** — el gate cuenta de cobro vs. factura electrónica y `aliados_b2b`
  — ver [`finanzas-comisiones.md`](./finanzas-comisiones.md) §9.
- **Multitenant/Auth** — el enum de roles y `proxy.ts` — ver
  [`multitenant-auth-auditoria.md`](./multitenant-auth-auditoria.md).
- **Reservar** — dónde nace `modo_compra`/`b2b_usuario_id`/`aliados_b2b` al reservar — ver
  [`reservar.md`](./reservar.md).
