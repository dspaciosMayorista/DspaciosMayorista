# Sitio web público + CMS — despliegue y dominios

La web de marketing y el sistema (portal/tarifario/dashboard) viven en **el mismo
proyecto Next** (`dspacios-travel/`) y se despliegan juntos. La separación es por
**host** (subdominios), no por proyecto.

## Arquitectura
- **Web pública (marketing):** route group `app/(sitio)` → rutas `/`, `/paquetes`,
  `/destinos`, `/nosotros`, `/testimonios`, `/blog`, `/cotizar` (+ detalles `[id]`).
  Contenido editable desde el **CMS** (`/dashboard/cms`, solo superadmin), guardado
  en Supabase (tablas `web_*`, migración 078). Si las tablas están vacías, el sitio
  cae a contenido estático de `lib/sitio/data.js` (nunca se ve vacío).
- **Sistema:** `/dashboard/*`, `/tarifario`, `/portal`, `/cot`, etc. (como hasta hoy).
- Enlaces de la web al **tarifario** en el header, footer y CTAs.

## Separación por subdominio (middleware `proxy.ts`)
Se activa con dos variables de entorno. **Sin ellas, todo convive en un solo
dominio** (modo combinado, seguro por defecto).

| Env | Ejemplo | Efecto |
|---|---|---|
| `NEXT_PUBLIC_PORTAL_HOST` | `app.dspaciostravel.com` | En ese host, la web de marketing redirige al `/tarifario` (el dominio del sistema no muestra la web). |
| `NEXT_PUBLIC_SITIO_HOST` | `www.dspaciostravel.com` | En ese host, las rutas del sistema (`/dashboard`, `/cot`, `/crm`, `/contrato`, `/voucher`) redirigen al portal. |

> El dominio "desnudo" (apex, `dspaciostravel.com`) conviene apuntarlo a `www`
> (la web) con un redirect 308 en Vercel.

## Pasos para publicar
1. **Correr la migración 078** en Supabase (crea las tablas `web_*` + RLS).
   *(Pendiente, junto con 066/067.)*
2. En **Vercel** (proyecto `dspacios-travel`): Settings → Domains, agrega:
   - `www.dspaciostravel.com` (web)
   - `app.dspaciostravel.com` (portal/sistema)
   - `dspaciostravel.com` → redirect a `www`
3. **Variables de entorno** (Vercel → Settings → Environment Variables):
   - `NEXT_PUBLIC_SITIO_HOST = www.dspaciostravel.com`
   - `NEXT_PUBLIC_PORTAL_HOST = app.dspaciostravel.com`
   - (Redeploy para que tomen efecto.)
4. **DNS en el registrador del dominio:**
   - `www` → **CNAME** → `cname.vercel-dns.com`
   - `app` → **CNAME** → `cname.vercel-dns.com`
   - apex `@` → **A** → `76.76.21.21` (o ALIAS/ANAME a `cname.vercel-dns.com`)
5. Esperar propagación; verificar HTTPS (Vercel emite el certificado solo).
6. Bajar la web de Hostinger una vez todo responda en los nuevos dominios.

## Google OAuth (recordatorio)
Si el login vive en el subdominio del portal, ajustar en Supabase Auth:
**Site URL** y **Redirect URLs** (`https://app.dspaciostravel.com/auth/callback`).

## Pendientes / siguientes pasos
- Subida de imágenes a **Supabase Storage** desde el CMS (hoy se pegan URLs).
- Título/favicon/logo propios del sitio (hoy heredan los del sistema).
- Mapear los íconos de redes reales (la versión de `lucide-react` del sistema no
  trae `Facebook`/`Instagram`; se usaron alias temporales).
- Borrar la carpeta `sitio-web/` (Vite) cuando se confirme que el porte quedó bien.
