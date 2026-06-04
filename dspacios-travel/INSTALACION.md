# 🧭 Guía de instalación — Sistema de Gestión para Agencias de Viajes

Esta guía te lleva **de cero a funcionando**, sin asumir conocimientos técnicos.
Si sigues los pasos en orden, en ~30–45 minutos tienes la app en línea con la
marca de tu agencia.

La app usa **dos servicios gratuitos** (tienen plan gratis suficiente para empezar):

- **Supabase** → base de datos, usuarios y almacenamiento de archivos.
- **Vercel** → publica la página web en internet.

> No necesitas servidor propio. Todo corre en la nube.

---

## 0. Antes de empezar (crea estas cuentas)

1. **GitHub** → https://github.com (para guardar el código).
2. **Supabase** → https://supabase.com
3. **Vercel** → https://vercel.com (entra con tu GitHub).
4. (Opcional, solo para correr en tu PC) **Node.js 20+** → https://nodejs.org

Sube el código que compraste a un repositorio de **GitHub** (privado).

---

## 1. Crear la base de datos (Supabase)

1. En Supabase, **New project**. Ponle un nombre y una **contraseña de base de
   datos** (guárdala). Elige la región más cercana.
2. Espera ~2 min a que se cree.
3. Ve a **Project Settings → API** y copia estos 3 valores (los usarás luego):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` *(secreto, no lo compartas)*

### 1.1. Crear las tablas (migraciones)

1. En Supabase, abre **SQL Editor**.
2. Abre la carpeta del código `supabase/migrations/` y ejecuta **cada archivo
   `.sql` en orden por su número**, de la más antigua a la más nueva
   (`...000001` → `...000035`). Copia el contenido, pégalo en el SQL Editor y dale **Run**.
   - Hazlo uno por uno. Si alguno falla porque “ya existe”, continúa con el siguiente.
3. Cuando termines, la base ya tiene toda la estructura (incluida la tabla
   **`empresa_config`** de marca blanca, que arranca con datos genéricos).

> 💡 Si sabes usar la **CLI de Supabase**, puedes correr `supabase db push` en vez
> de pegar archivo por archivo.

### 1.2. (Solo D'spacios) Restaurar la identidad original

Si esta instalación es para **D'spacios Travel**, corre además, una sola vez, el
script `supabase/scripts/empresa_dspacios.sql` en el SQL Editor. Eso vuelve a
poner el nombre, logo y datos de D'spacios. **Para cualquier otra agencia, NO lo
corras**: la app queda genérica y tú la configuras en el paso 5.

---

## 2. Variables de entorno

La app necesita estas variables. Las pondrás en **Vercel** (paso 4) y, si corres
en tu PC, en un archivo `.env.local` dentro de `dspacios-travel/`.

| Variable | Obligatoria | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase → Settings → API (Project URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase → Settings → API (anon public) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase → Settings → API (service_role) |
| `CRON_SECRET` | Opcional | Invéntate una clave; protege la tarea diaria que libera reservas vencidas |

> ⚠️ Las que empiezan por `NEXT_PUBLIC_` son visibles en el navegador (está bien).
> `SUPABASE_SERVICE_ROLE_KEY` y `CRON_SECRET` son **secretas**.

---

## 3. (Opcional) Correr en tu computador para probar

Dentro de la carpeta `dspacios-travel/`:

```bash
npm install
# crea el archivo .env.local con las 3 variables del paso 2
npm run dev
```

Abre http://localhost:3000 — deberías ver el **login**.

---

## 4. Publicar en internet (Vercel)

1. En Vercel, **Add New → Project** e importa tu repositorio de GitHub.
2. En **Root Directory**, selecciona la carpeta **`dspacios-travel`**.
3. Framework: **Next.js** (lo detecta solo).
4. En **Environment Variables**, agrega las del paso 2 (marca **Production** y
   **Preview**).
5. **Deploy**. En 1–2 minutos te da una URL pública (ej. `tu-agencia.vercel.app`).

> Cada vez que cambies una variable de entorno, hay que **Redeploy** para que aplique.

### 4.1. (Opcional) Login con Google

1. Supabase → **Authentication → Providers → Google** → habilítalo (necesitas un
   Client ID/Secret de Google Cloud).
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL** = tu dominio de producción (ej. `https://tu-agencia.vercel.app`).
   - **Redirect URLs** = agrega `https://tu-agencia.vercel.app/auth/callback`.

---

## 5. Configurar TU agencia (marca blanca) 🎨

1. **Crear el primer usuario** (superadmin):
   - Supabase → **Authentication → Users → Add user** (email + contraseña, marca
     **Auto Confirm User**). Copia su **UID**.
   - Supabase → **SQL Editor**, corre (cambiando el UID y el correo):
     ```sql
     insert into public.usuarios (id, email, nombre, rol, activo)
     values ('PEGA_AQUI_EL_UID', 'admin@tuagencia.com', 'Administrador', 'superadmin', true);
     ```
2. Entra a la app (`/login`) con ese usuario.
3. Ve al menú **Configuración → Información de la empresa** y llena:
   - **Identidad:** nombre comercial, lema, colores.
   - **Logos:** sube tu logo (specs abajo).
   - **Datos tributarios** (los del RUT): razón social, NIT, RNT, dirección,
     ciudad, teléfono, email, sitio web. *(Salen en la cabecera y el pie del contrato.)*
   - **Cuenta bancaria:** banco, tipo, número, titular. *(Sale en la cláusula de
     pagos del contrato.)*
   - **Condiciones y políticas:** política de pago/cancelación, términos, notas.
     *(Salen como “Condiciones adicionales” del contrato. Déjalo en blanco si no aplica.)*
4. **Guardar**. ¡Listo! La marca, el contrato y el tarifario ya muestran tu agencia.

### 📐 Especificaciones del logo

- **Logo horizontal** (sidebar / contrato): PNG o **SVG** con **fondo
  transparente**, proporción ~**3.5:1**, ideal **600×170 px**.
- **Ícono cuadrado** (app/PWA): **512×512 px** PNG transparente.
- Sube una versión **a color** (fondos claros) y una **blanca** (fondos de color).
- Peso máximo recomendado: ~300 KB por archivo.

### 🖼️ Reemplazar los íconos de la app (PWA/favicon)

Los íconos de instalación viven en `dspacios-travel/public/`. Reemplázalos por los
tuyos manteniendo los mismos nombres:
`icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-icon.png`.
Tras reemplazarlos, vuelve a desplegar (`git push`).

---

## 6. Mantenimiento

- **Tarea diaria** (libera reservas vencidas): en Vercel ya queda configurada vía
  `vercel.json` (cron). Si pusiste `CRON_SECRET`, úsalo igual en la variable.
- **Actualizar parámetros tributarios / salario mínimo:** menú **Configuración**.
- **Respaldos:** Supabase hace backups automáticos en su plan; revisa la sección
  **Database → Backups**.

---

## 7. Seguridad (importante)

- Si en pruebas usaste el **ingreso rápido por código** (`QUICK_LOGIN_EMAIL` /
  `QUICK_LOGIN_PASSWORD`), **bórralo en producción**: quita esas variables en Vercel.
- Nunca subas llaves al repositorio: van solo en variables de entorno.
- Cada agencia tiene su **propio** proyecto de Supabase (datos aislados).

---

## ¿Problemas frecuentes?

- **“Falta configurar …”** al iniciar sesión → faltó una variable de entorno o un
  **Redeploy** después de agregarla.
- **El logo no cambia** → recarga forzada (Ctrl/Cmd + Shift + R); el archivo se sirve
  con caché.
- **El contrato sale sin datos de empresa** → llena **Información de la empresa**
  (paso 5); por defecto viene en blanco a propósito.

---

*Fin de la guía. Cualquier ajuste de marca se hace desde la app, sin tocar código.*
