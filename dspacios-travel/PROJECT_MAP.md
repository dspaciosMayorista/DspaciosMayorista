# PROJECT_MAP.md

Mapa del proyecto. Última actualización: 2026-09-17

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
| Add-ons (modo acotado por paquete) | `app/tarifario/CartDrawer.tsx` (`irAAgregarTours`, intent en `lib/cart/addonsIntent.ts` + `addonsNonce.ts`) → `app/tarifario/BuscadorReceptivos.tsx` (dentro de `VistaBooking.tsx`) → `buscarReceptivos` (`lib/reservar/cotizar.ts`) acota por `paqueteId` en servidor | Carrito |
| Add-ons (catálogo general) | Entrada directa a `BuscadorReceptivos` sin `paqueteId` (búsqueda general por destino); el modo acotado solo se abandona con `Limpiar resultados` | Sin alcance de paquete |
| Snapshot tarifario (vivo) | La 181 invalida por fuentes; `iniciar_generacion_tarifario` captura revisión/generación y `publicar_tarifario_resultado` reemplaza el snapshot atómicamente si el token sigue vigente (migración `supabase/migrations/...181`). La 182 expone `tarifario_resultado_publicable` (join autoritativo con `armado_paquetes`, security_barrier). Lectores en vivo: `lib/tarifario/paginacion.ts`, `app/tarifario/detalle-actions.ts`, `lib/reservar/cotizar.ts`, `lib/reservar/computo.ts` | Vista publicable |
| Snapshot tarifario (diagnóstico) | Administración lee `tarifario_resultado` crudo para diagnóstico; históricos (contratos/cotizaciones congelados) y Bernalo/unidad no dependen del snapshot actual | Autorizado |
| Tarjeta interna (cuatro secciones) | `HotelModal` en `app/tarifario/VistaBooking.tsx` — orden confirmado: Salidas → Motor interno → Incluye → Servicios add-on (commit `70263e3d`, solo traslado de JSX; lógica, props, precios y fuentes intactas) | Vista Booking |
| Tarjetas externas/Bernalo (independientes) | `TarjetaUnidadBusqueda` y `HotelBernaloCotizarModal` en `app/tarifario/VistaBooking.tsx` — variantes separadas del motor externo; `70263e3d` no las modificó; conservar la tarjeta completa en el motor externo sigue pendiente (ver `CURRENT_GOAL.md`) | Vista Booking |

## Reglas del repo
Ver `AGENTS.md` (raíz del repo). Fuente de verdad de diseño: `CLAUDE.md` (no releer salvo petición explícita).