# PROJECT_MAP.md

Mapa del proyecto. Última actualización: 2026-09-21

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
| Fuente autoritativa y recálculo de tarifas | `tarifa_hotel` materializada es la fuente autoritativa del precio; la vigencia es metadata y no deriva precios. Crear/editar/eliminar tarifas o temporadas regenera los paquetes asociados por el `hotel_id` autoritativo de la fila; una promoción solo gana si existe su fila materializada; sin ella gana la siguiente tarifa materializada válida; prioridad de suplemento promoción > base > general (PR #316, squash `ff9507da`) | Panel |
| Filtro de vigencia paginado | `cargarResumenTarifario` → `aplicarFiltrosPostCarga` → `filtrarTarifarioVencidas` (`lib/tarifario/vigencia.ts`) → lecturas paginadas de `hotel_temporadas` y `tarifa_hotel` vía `ejecutarConsultaPaginada` (`lib/tarifario/paginacion.ts`): orden estable por `id`, avance por filas reales, término solo con página vacía y fail-closed ante error en cualquier página; no relaja la vigencia ni sintetiza precios desde temporadas. Corrige el caso TAMACÁ (PA/PAM/PC) donde el Max Rows de PostgREST truncaba en silencio (PR #320, squash `7d8cf7ec`) | Vista tarifario |
| Tarjeta completa (exploración) | `HotelModal` en `app/tarifario/VistaBooking.tsx` — cuatro secciones, orden Salidas → Motor interno → Incluye → Servicios add-on | Vista Booking |
| Tarjeta completa (resultados "Buscar alojamiento") | Dos variantes reales: `Resultado` en `app/tarifario/BuscadorBooking.tsx` (hotel persona) y `TarjetaUnidadBusqueda` en `app/tarifario/VistaBooking.tsx` (unidad/Bernalo) | Vista Booking |
| Piezas compartidas de tarjeta | `app/tarifario/tarjetaHotelCompartida.tsx` (`Categoria`, `EtiquetasHotel`, `DescripcionHotelExpandible`, `UbicacionHotel`, `SeccionesIncluye`, `AddonsPaquete`, `ReceptivoModal`), reutilizado por `VistaBooking.tsx` y `BuscadorBooking.tsx` (archivo propio para evitar ciclo de módulos) | Vista Booking |
| Precio/disponibilidad y contenido por variante | Persona: precio interno existente. Unidad/Bernalo: precio y disponibilidad Bernalo en vivo. Incluye/add-ons se resuelven por el `paqueteId` de la oferta seleccionada, nunca por el hotel | Vista Booking |
| Hoteles recomendados por paquete | Administración: `app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx` + acciones de paquete. Motor puro: `lib/tarifario/recomendados.ts`. Estado optimista: `lib/tarifario/prioridadOptimista.ts`. Ensamblado visual: `app/tarifario/VistaBooking.tsx`. Etiqueta compartida: `app/tarifario/EtiquetaOferta.tsx`. Persistencia (`armado_hoteles.prioridad` 1-6, unicidad parcial por paquete) y protección de snapshot (un cambio exclusivo de prioridad no invalida; cambios reales de armado sí) en migraciones 183/184 (PR #318, squash `a2bcbf2a`). El autosave exitoso de prioridad revalida el editor y `/tarifario` sin regenerar el snapshot (PR #320, squash `7d8cf7ec`). Lectura pública de `armado_hoteles` (prioridades) usa `admin` (service-role), nunca `sb`: su RLS es solo interna y excluye visitantes anónimos (PR #322, squash `73339a1f`) | Vista Booking / Panel |
| Orden y filtros del resto del inventario | Motor puro: `lib/tarifario/inventarioResto.ts` (orden determinista precio→estrellas→zona→nombre→hotelId dentro de cada bloque por paquete; precio inválido/desconocido siempre al final) y `lib/tarifario/condicionOferta.ts` (combinación ternaria de condición de pago/política comercial, nunca clasifica un lado desconocido como neutro/flexible). Ensamblado: `app/tarifario/VistaBooking.tsx` (`PanelFiltrosResto`, selector "Ordenar por"). Filtros (precio, estrellas, zona, Pet Friendly, Adults Only, condiciones de pago, política comercial) aplican a recomendados y resto sin promover prioridades inferiores; zona/estrellas disponibles salen del universo de ofertas candidatas ya acotado al destino/búsqueda activa. Identidad siempre `(hotelId, paqueteId)` | Vista Booking |
| Deuda visual: add-ons expandidos | Al expandir servicios adicionales la fila puede crecer y dejar espacios vacíos; mejora pendiente (modal/panel lateral o superficie compacta), no resuelta | Pendiente |

## Coordinación de agentes
| Archivo | Propósito |
| --- | --- |
| `../AGENTS.md` | Router universal: reglas universales, enrutamiento por rol y lectura mínima por situación |
| `docs/agents/CODEX.md` | Auditor y coordinador: revisión contra diff, veredicto y comandos de Git tras aprobar |
| `docs/agents/SONNET.md` | UI compleja, refactors amplios y cambios de riesgo alto |
| `docs/agents/OPENCODE.md` | Documentación, tareas mecánicas y coordinación post-merge |
| `docs/agents/DEEPSEEK.md` | Implementaciones puntuales y segunda revisión técnica expresa |
| `docs/agents/PROMPTS.md` | Plantillas de usuario (no la leen los agentes) |

## Reglas del repo
Ver `AGENTS.md` (raíz del repo). Fuente de verdad de diseño: `CLAUDE.md` (no releer salvo petición explícita).