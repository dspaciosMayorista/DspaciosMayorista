# Validar el aislamiento multi-tenant (Paso 4)

Guía para comprobar, **con la app corriendo**, que cada organización ve solo lo suyo
y que el mono-tenant (sin slug) sigue funcionando igual.

## 0. Requisitos previos

1. Estar en la rama **`saas-whitelabel`** y haber desplegado/corrido la app.
2. **Correr las migraciones** que falten, en orden, hasta la **104**:
   - `100`–`103` (fundación SaaS + org_id + RLS por org).
   - **`104`** `saas_uniques_por_org` — *imprescindible antes de crear la 2ª org*
     (convierte los UNIQUE globales de catálogos a por-org).
3. Verifica que existe la org por defecto con slug **`dspacios`**
   (en `organizaciones`). Si no, créala o ajusta el slug por defecto en
   `lib/org.ts` (`ORG_SLUG_DEFAULT`).
4. `SUPABASE_SERVICE_ROLE_KEY` configurada en el entorno.

## 1. Crear la 2ª organización

1. Entra al dashboard como **superadmin** → menú **Organizaciones**
   (`/dashboard/organizaciones`).
2. **Nueva organización**:
   - Nombre: `Agencia Demo` · Slug: `demo` (queda `/o/demo/...`).
   - Elige colores de marca distintos (para notar el branding).
   - **Email del admin**: un correo de prueba → se crea su superadmin con
     contraseña temporal (anótala; aparece en el mensaje de éxito).
3. Debe aparecer en la lista con su badge de estado y el enlace **Ver tarifario ↗**.

## 2. Cargar producto en la 2ª org

1. Cierra sesión y entra con el **admin de `demo`** (email + contraseña temporal).
2. Crea lo mínimo para un tarifario:
   - **Producto → Destinos**: p. ej. `CARTAGENA` (debe dejar, aunque la org
     default ya tenga "CARTAGENA" → eso prueba la migración 104).
   - **Producto → Hoteles**: un hotel con su tarifa.
   - **Paquetes**: arma un paquete y **Generar tarifario**.
3. Verifica en **Tarifario interno** que aparece el resultado.

## 3. Comprobar el AISLAMIENTO (lo importante)

| Abrir | Debe mostrar |
|---|---|
| `/o/demo/tarifario` | SOLO los paquetes/programas de **Agencia Demo** + sus colores/logo |
| `/o/dspacios/tarifario` (o `/tarifario`) | SOLO lo de **D'spacios** (la default) |
| `/o/demo/sitio_web` | El sitio/CMS de Demo (o el fallback si no tiene contenido) |

- ❌ **Fallo** = ves productos de D'spacios dentro de `/o/demo/...` (o viceversa).
- ✅ **OK** = cada slug muestra solo lo suyo; `/tarifario` sin slug = la default.

Prueba también:
- **Registro B2B** desde `/o/demo/portal` → la solicitud/usuario debe quedar en
  `org_id` de Demo (revisar en `b2b_solicitudes`/`usuarios`).
- **Checkout** desde `/o/demo/tarifario` → la cotización creada debe tener el
  `org_id` de Demo (tabla `cotizaciones`).
- Acceso cruzado por id: `/o/demo/tarifario/programa/<id-de-un-programa-de-dspacios>`
  debe dar **404** (no se filtra por id).

## 4. Branding

- En `/o/demo/tarifario`, el header usa el **logo** y los **colores** de Demo
  (botones/precios/gradiente). Si Demo no tiene logo propio, cae al de D'spacios.

## 5. Notas / pendientes conocidos

- El **detalle tributario** del contrato/PDF y algunos textos siguen con la marca
  "D'spacios" hardcodeada (pendiente Fase 2: leer de `organizaciones`).
- El **sitio web** aún no aplica los colores por org (solo el tarifario).
- La cotización del checkout queda en la org correcta, pero el **motor de
  reservar interno** usa la org de la sesión (correcto para uso interno).

> Si algo del aislamiento falla, el patrón a revisar es siempre el mismo:
> la consulta pública debe resolver `orgDelRequest()` y filtrar por `org_id`
> (o, para inserts, estampar el `org_id` del slug). Ver `lib/org.ts`.
