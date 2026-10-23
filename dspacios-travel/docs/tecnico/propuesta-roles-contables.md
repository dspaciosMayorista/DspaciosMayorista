# Propuesta de roles contables en la app — PARCHE REVISABLE, NO APLICADO

Los tres roles existen en la base (migración 204, `alter type rol_usuario add
value`) pero la app no los conoce: `lib/constants.ts` mantiene su propia lista
`ROLES`, y un `contador` guardado en `usuarios.rol` no está en ella.

**Nada de lo de aquí está aplicado.** Este archivo es el diff para revisar.

## Verificación

El parche se verificó **ejecutándolo**, no leyéndolo. `verificar-roles-204.cjs`
aplica el diff a `lib/constants.ts`, `lib/roles.ts` y `types/database.ts` **en
memoria**, compila con esbuild y ejecuta las reglas reales del repo
(`moduloDeRuta`, `LECTURA_MODULO`, `modulosConsultables`, `ESCRITURA`,
`puedeEscribir`). No escribe nada.

```
node verificar-roles-204.cjs
→ 181 OK, 0 FALLA
```

Dos defectos del parche los encontró ese verificador antes de llegar a ti:

- La primera versión generaba `]` duplicado en `ROLES` (TS inválido).
- Faltaba `drop policy`-equivalente… no: la primera versión del parche de
  `types/database.ts` no coincidía con el enum por salto de línea CRLF.

## Por qué NO se agregan a `ROLES_INTERNOS`

`ROLES_INTERNOS` alimenta `LECTURA_MODULO` en casi todos los módulos
(`tarifario`, `reservar`, `cotizaciones`, `contratos`, `crm`, y los
`filter(r => r !== "venta")` de `ventas`, `vuelos`, `paquetes`, `producto`,
`finanzas`, `configuracion`). Meter ahí los roles contables les abriría ventas,
vuelos, producto y finanzas operativas. **No se tocan.**

Igual con `ADMIN_ROLES` en `lib/roles.ts`: alimenta `ESCRITURA.producto`,
`.vuelos`, `.ventas`, `.aliados`, `.b2b`. **No se tocan.** El verificador
comprueba que los tres roles quedan fuera de las seis.

## Diff

### 1. `lib/constants.ts`

```diff
 export const ROLES = [
   "superadmin",
   "gerencia",
   "administracion",
   "operaciones",
   "venta",
   "control_vuelo",
   "agencia",
   "freelance",
   "cliente_final",
+  // Rol contable (D1, §5.1). A propósito NO van en ROLES_INTERNOS: ese grupo
+  // abre ventas, vuelos, paquetes, producto y finanzas operativas, y un
+  // contador no debe heredar nada de eso. Su alcance es `contabilidad_dian`.
+  "contador",
+  "revisor_fiscal",
+  "admin_contable",
 ] as const;

 export const ROLES_EXTERNOS: Rol[] = ["agencia", "freelance", "cliente_final"];
+
+// Roles del area contable (D1). Reutilizados por LECTURA_MODULO y por
+// cualquier Server Action del staging.
+export const ROLES_CONTABLES: Rol[] = [
+  "contador",
+  "revisor_fiscal",
+  "admin_contable",
+];
```

```diff
 export const LECTURA_MODULO: Record<string, readonly Rol[]> = {
+  // Contabilidad DIAN: único módulo al que llegan los tres roles contables.
+  // Deliberadamente NO cuelga de `finanzas`: ese módulo da rentabilidad,
+  // cartera, pagos, comisiones y liquidación, que son finanzas operativas.
+  contabilidad_dian: ["superadmin", "gerencia", "administracion", ...ROLES_CONTABLES] as Rol[],
+
   // Comercial: lo que un asesor necesita para vender.
   tarifario: ROLES_INTERNOS,
```

```diff
 export const MODULO_POR_RUTA: { prefijo: string; modulo: string }[] = [
+  // `moduloDeRuta` gana el prefijo MÁS LARGO, así que esta entrada captura el
+  // staging sin tocar las pantallas contables que ya existen bajo
+  // /dashboard/contabilidad/*.
+  { prefijo: "/dashboard/contabilidad/staging-dian", modulo: "contabilidad_dian" },
   { prefijo: "/dashboard/contratos", modulo: "contratos" },
```

### 2. `lib/roles.ts`

```diff
-import { LECTURA_MODULO, type Rol } from "@/lib/constants";
+import { LECTURA_MODULO, ROLES_CONTABLES, type Rol } from "@/lib/constants";

 export const ESCRITURA = {
   …
   usuarios: ["superadmin", "administracion"] as Rol[],
+
+  // Staging DIAN. Clave ADITIVA: no se toca ninguna entrada existente, así que
+  // los roles contables no heredan escritura de producto, vuelos, ventas,
+  // aliados ni b2b.
+  dian_staging: ["superadmin", "gerencia", ...ROLES_CONTABLES] as Rol[],
 } satisfies Record<string, Rol[]>;
```

### 3. `types/database.ts`

```diff
       rol_usuario:
         | "superadmin"
         …
         | "freelance"
-        | "cliente_final";
+        | "cliente_final"
+        | "contador"
+        | "revisor_fiscal"
+        | "admin_contable";
```

El verificador comprueba que el enum queda con los **12 valores en el mismo
orden** que `ROLES`, y sin duplicados.

### 4. `proxy.ts` y `app/(dashboard)/layout.tsx` — sin cambios

El proxy lee `perfil.rol` como `string`; una entrada nueva en `LECTURA_MODULO`
ya lo bloquea. El nav sale de `modulosConsultables`. No se agrega ningún ítem
porque no hay UI.

## Rutas: comprobadas una por una con la lógica real

| Ruta | Módulo resultante | Los 3 contables |
|---|---|---|
| `/dashboard/contabilidad/staging-dian` | `contabilidad_dian` | **Entran** |
| `/dashboard/contabilidad/staging-dian/lote/12` | `contabilidad_dian` | **Entran** |
| `/dashboard/contabilidad/staging-dian/documento/44` | `contabilidad_dian` | **Entran** |
| `/dashboard/contabilidad` | `finanzas` | No |
| `/dashboard/contabilidad/facturacion` | `finanzas` | No |
| `/dashboard/ventas`, `/ventas/nueva` | `ventas` | No |
| `/dashboard/vuelos`, `/vuelos/123/silla` | `vuelos` | No |
| `/dashboard/cartera` | `finanzas` | No |
| `/dashboard/pagos`, `/comisiones` | `finanzas` | No |
| `/dashboard/rentabilidad`, `/liquidacion`, `/aliados` | `finanzas` | No |
| `/dashboard/flujo-caja`, `/punto-equilibrio` | `finanzas` | No |
| `/dashboard/producto`, `/producto/hoteles/12/tarifas` | `producto` | No |
| `/dashboard/usuarios`, `/usuarios/b2b` | `usuarios` / `b2b` | No |
| `/dashboard/configuracion` | `configuracion` | No |
| `/dashboard/crm` | `crm` | No |
| `/dashboard/reservar`, `/cotizaciones`, `/contratos`, `/tarifario`, `/paquetes` | los suyos | No |

`modulosConsultables(rol)` devuelve **exactamente** `{contabilidad_dian}` para los
tres. Un contador entra al dashboard y ve una sola sección.

## Doble capa: por qué esto no basta solo

`proxy.ts` y el nav son la capa de **experiencia**: evitan menús que no llevan a
ninguna parte. La capa que manda es la RLS:

- Los helpers de la 204 acotan cada rol a su tenant y a su acto (§6.2).
- `proveedores`, `puc_cuentas`, `asientos_contables` y las operativas ya
  excluyen a quien no esté en su policy.

## Lo que este diff NO resuelve

- **D3a**: en la base, un `contador` no puede aprobar. Cuando exista la tabla de
  política, el punto a tocar es el helper `dian_staging_puede_aprobar`, no este
  diff.
- **Importar**: los tres roles pueden cargar archivos. Cargar no es un acto de
  revisión, así que no rompe la separación, pero si el negocio quiere que solo
  el contador cargue, se quita `revisor_fiscal` de
  `dian_staging_puede_importar`.
- **No hay exclusividad**: nada impide asignar `contador` a un usuario que
  además sea `venta`. El `tenant` de `usuarios` es el que decide.

## Antes de aplicar

```bash
npx tsc --noEmit
npm run lint -- lib/constants.ts lib/roles.ts
node verificar-roles-204.cjs     # debe seguir dando 0 FALLA

# Con un usuario de rol `contador` en la base:
#  1. /dashboard                     -> solo la sección de staging DIAN
#  2. /dashboard/cartera             -> redirige a /dashboard
#  3. /dashboard/vuelos              -> redirige a /dashboard
#  4. /dashboard/contabilidad        -> redirige a /dashboard
#  5. El formulario de usuarios ofrece los tres roles nuevos
```