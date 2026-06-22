# DESPLIEGUE DESDE CERO — Edición SaaS White-Label

> Guía para montar **una instancia nueva** del SaaS en su **propia cuenta** (Supabase +
> Vercel), desde cero. Sigue los pasos en orden. Marca cada uno al completarlo.
>
> Esta instancia es **independiente** de D'spacios Travel (otra base, otro proyecto).

---

## 0. Requisitos previos (cuentas y herramientas)

- **Node.js 20+** y **npm** (para correr/compilar local).
- Cuenta en **Supabase** (https://supabase.com) — base de datos + auth + storage.
- Cuenta en **Vercel** (https://vercel.com) — hosting de la app Next.js.
- (Opcional) Cuenta en **Resend** (https://resend.com) + un **dominio verificado** —
  para los correos de notificaciones/cobros. Sin esto, esos correos no se envían (lo
  demás funciona).
- (Opcional) Proyecto en **Google Cloud Console** — para el login con Google (OAuth).
- El **código** de esta app (carpeta `dspacios-travel/`, rama `saas-whitelabel` o el
  repo ya extraído).

---

## 1. Conseguir el código

```bash
git clone <url-del-repo-saas>
cd <repo>/dspacios-travel        # la app vive en esta subcarpeta
npm install
```

---

## 2. Crear el proyecto de Supabase

1. En Supabase → **New project**. Elige nombre, contraseña de la base y región.
2. Cuando esté listo, ve a **Project Settings → API** y copia:
   - **Project URL** → será `NEXT_PUBLIC_SUPABASE_URL`.
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - **service_role** key (¡secreta!) → `SUPABASE_SERVICE_ROLE_KEY`.

---

## 3. Correr TODAS las migraciones (en orden)

Las migraciones crean **todo**: tablas, RLS, funciones, triggers y los **buckets de
Storage**. Están en `supabase/migrations/` y se corren **en orden por su número**
(`...001` → `...101`). Hay ~89 archivos.

**Opción A — Supabase CLI (recomendado):**
```bash
npm i -g supabase
supabase link --project-ref <ref-del-proyecto>   # el ref sale de la URL del proyecto
supabase db push                                 # aplica todas las migraciones en orden
```

**Opción B — SQL Editor (manual):** abre cada archivo de `supabase/migrations/` en orden
numérico y pégalo/ejecútalo en **Supabase → SQL Editor**. No te saltes ninguno.

> ⚠️ Importante: corre la **101** (`saas_org_id_backfill`) — crea la **organización #1**
> y agrega `org_id` a todas las tablas. Sin ella el SaaS no tiene tenant base.
> Las migraciones **100+** son exclusivas del SaaS (ver `CLAUDE-SAAS.md`).

---

## 4. Verificar los buckets de Storage

Las migraciones crean estos **5 buckets** (revísalos en Supabase → Storage):
`contratos`, `crm`, `hotel-fotos`, `hoteles`, `web-cms`.
Si alguno no aparece, vuelve a correr su migración (45 crm, 46 contratos, 52/55 hoteles,
80 web-cms). Sus políticas de acceso vienen en esas mismas migraciones.

---

## 5. (Opcional) Datos de ejemplo / semillas

En `supabase/scripts/` hay semillas opcionales (ejecutar en SQL Editor si las quieres):
- `seed_web_cms.sql` / `seed_web_paginas.sql` — contenido inicial del sitio público.
- `destinos_mundo.sql`, `seed_ejemplo_amazonas.sql`, `seed_programa_brasil.sql` — datos demo.
> Si los corres DESPUÉS de la 101, asígnales el `org_id` de la org #1 (o córrelos antes
> de poner `org_id NOT NULL`). Para una instancia limpia de cliente, **no** uses los demo.

---

## 6. Login con Google (OAuth) — opcional pero recomendado

1. Supabase → **Authentication → Providers → Google**: habilítalo y pega el **Client ID**
   y **Client Secret** de Google Cloud.
2. En **Google Cloud Console → Credentials → OAuth client** agrega como
   **Authorized redirect URI**: `https://<TU-PROYECTO>.supabase.co/auth/v1/callback`.
3. Supabase → **Authentication → URL Configuration**:
   - **Site URL** = la URL de producción de tu app en Vercel (ver paso 8).
   - **Redirect URLs**: agrega `https://<tu-dominio>/auth/callback`.

---

## 7. Variables de entorno (todas)

Crea `.env.local` para correr local, y configúralas también en Vercel (paso 8).

**Obligatorias:**
| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase (paso 2). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key (paso 2). |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (paso 2). **Secreta** — solo server. Se usa para sillas/costos al reservar, subida de archivos, crons. |

**Recomendadas / opcionales:**
| Variable | Qué es |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | URL pública de la app (`https://tudominio.com`). Hace que la imagen de previsualización al compartir (Open Graph) y los links absolutos salgan bien. Si no la pones, en Vercel usa `VERCEL_URL` del deploy. |
| `RESEND_API_KEY` | API key de Resend para enviar correos (notificaciones/cobros). Requiere dominio verificado en Resend. |
| `CRON_SECRET` | Token para proteger los endpoints de cron (`/api/cron/*`). Vercel lo manda en el header `Authorization`. |
| `QUICK_LOGIN_EMAIL` / `QUICK_LOGIN_PASSWORD` / `QUICK_LOGIN_CODE` | Acceso rápido de demo (interno). Dejar vacío en producción real. |
| `QUICK_LOGIN_B2B_EMAIL` / `QUICK_LOGIN_B2B_PASSWORD` / `QUICK_LOGIN_B2B_CODE` | Igual, para el portal B2B. |

> `VERCEL_URL` la inyecta Vercel sola; no la configures.

---

## 8. Desplegar en Vercel

1. Vercel → **Add New → Project** → importa el repo.
2. **Root Directory**: `dspacios-travel` (la app está en esa subcarpeta).
3. Framework: **Next.js** (autodetectado). Build command y output por defecto.
4. **Environment Variables**: pega todas las del paso 7.
5. **Deploy**.
6. Toma la URL de producción y ponla en `NEXT_PUBLIC_SITE_URL` y en la **Site URL** de
   Supabase (paso 6).

### Crons (ya configurados en `vercel.json`)
El repo trae 2 tareas programadas (Vercel las activa solas al desplegar):
- `/api/cron/liberar-vencidas` — diario 06:00 (libera sillas/reservas vencidas).
- `/api/cron/notificaciones` — diario 13:00.
Protégelas poniendo `CRON_SECRET` en las env vars.

---

## 9. Crear la PRIMERA organización y el PRIMER superadmin

> El onboarding self-service aún no está (Fase 2). Por ahora se hace a mano una vez.

La migración **101** ya creó la **org #1** con slug `dspacios` (renómbrala o crea la tuya).

1. **Crear/editar tu organización** (Supabase → Table Editor → `organizaciones`):
   - Si vas a usar la org #1, edita `slug`, `nombre`, colores, etc. a los de tu cliente.
   - O inserta una fila nueva (slug único, nombre, plan, estado=`activa`).
2. **Crear el usuario** (Supabase → Authentication → **Add user**) con email y contraseña,
   o deja que se registre por la app / Google. Eso crea su fila en `usuarios`
   (trigger `handle_new_user`).
3. **Vincular y dar rol** (Table Editor → `usuarios`, fila del usuario):
   - `org_id` = el `id` de tu organización.
   - `rol` = `superadmin`.
   - `activo` = true.
4. Entra a la app con ese usuario → ya eres superadmin de esa organización.

---

## 10. Verificación final

- [ ] La app abre y deja iniciar sesión.
- [ ] El usuario superadmin ve el dashboard y los módulos.
- [ ] Crear un destino/hotel de prueba funciona (y queda con el `org_id` correcto).
- [ ] Subir una imagen en el CMS funciona (bucket `web-cms` ok, `SUPABASE_SERVICE_ROLE_KEY` ok).
- [ ] Al compartir el link, la previsualización muestra tu marca (Open Graph), no Vercel.
- [ ] (Si configuraste) login con Google funciona.

---

## Notas

- Mientras la **Fase 1** no esté completa, el aislamiento entre organizaciones **no es
  total** (faltan inserts con `org_id` explícito y RLS por org en algunas tablas). Para
  un solo cliente por instancia esto no importa; para multi-tenant real, completar Fase 1.
- Mantén esta guía actualizada: cada env var, bucket o paso nuevo va aquí.
