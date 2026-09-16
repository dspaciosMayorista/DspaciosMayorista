# PROJECT_MAP.md

Mapa del proyecto. Última actualización: 2026-09-16

## Stack
- App activa: `dspacios-travel/` — Next.js 16.x, React 19, TypeScript, Tailwind v4, pnpm
- Referencia legada: `sitio-web/` (Vite) — no desplegar, no leer `node_modules`
- Backend: Supabase (Auth, Postgres), migraciones aplicadas a mano en SQL Editor
- Despliegue: Vercel — Production Branch `main` (push ⇒ deploy), dominio `portal.dspaciostravel.com`

## Estructura clave
| Ruta | Propósito |
| --- | --- |
| `dspacios-travel/` | Código de la app (Next 16). Razón de que el middleware sea `proxy.ts`, no `middleware.ts` |
| `dspacios-travel/docs/` | Documentación: `tecnico/`, `marca/`, `programas/`, `referencia-estilo/` |
| `sitio-web/` | Sitio legado Vite (solo referencia) |

## Flujos confirmados
| Flujo | Ruta / archivo | Acceso |
| --- | --- | --- |
| Checkout/tienda pública B2C | `proxy.ts` (público) → `app/tarifario/` (+ `checkout/actions.ts` `crearSolicitudReserva`) | Sin login |
| Cotización pública | `app/cot/[token]/page.tsx` (lee por `share_token`, sin `auth.getUser`) | Sin login |
| Cotización interna | `app/cotizacion/[id]/page.tsx` | Autenticada (panel) |
| Contrato público | `app/c/[token]/page.tsx` (token imposible de adivinar; `/c/` en `RUTAS_PUBLICAS`) | Sin login |
| Contrato interno | `app/contrato/[numero]/page.tsx` (vista autenticada) | Autenticada |
| Add-ons (a investigar) | Tarjetas públicas `app/tarifario/TarifarioPublic.tsx` / `VistaBooking.tsx` y resumen en `lib/reservar/serviciosPaquete.ts` (incluidos/opcionales) | — |

## Reglas del repo
Ver `AGENTS.md` (raíz del repo). Fuente de verdad de diseño: `CLAUDE.md` (no releer salvo petición explícita).