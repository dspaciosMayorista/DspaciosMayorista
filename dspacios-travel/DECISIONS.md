# DECISIONS.md

Registro de decisiones (ADL). Cada entrada: decisión, motivo, alternativas descartadas, fecha.

## ADL-001 — Middleware en Next 16
- Decisión: el middleware debe ser `proxy.ts`, nunca `middleware.ts`.
- Motivo: Next 16 usa `proxy.ts` como middleware; crear `middleware.ts` rompe el build.
- Alternativas descartadas: `middleware.ts`.
- Fecha: 2026-06-18 (`318cb13e` integra el bloqueo B2B en `proxy.ts` en vez de `middleware.ts`).

## ADL-002 — Migraciones Supabase manuales
- Decisión: un solo proyecto Supabase compartido; las migraciones se aplican a mano en el SQL Editor, no con `supabase db push`.
- Motivo: flujo acordado con el dueño; cada PR lista sus migraciones pendientes.
- Alternativas descartadas: `supabase db push` / deploy automático de migraciones.
- Fecha: Anterior a 2026-09-16; documentada 2026-09-16.

## ADL-003 — Producción en `main`
- Decisión: `main` es la Production Branch en Vercel; push a `main` ⇒ deploy automático.
- Motivo: despliegue ya configurado y en línea.
- Alternativas descartadas: rama de staging separada.
- Fecha: Anterior a 2026-09-16; documentada 2026-09-16.

## ADL-004 — Íconos lucide, sin emojis
- Decisión: usar `lucide-react` para íconos; no usar emojis en la UI.
- Motivo: regla permanente del repo.
- Alternativas descartadas: emojis, otros sets de íconos.
- Fecha: Anterior a 2026-09-16; documentada 2026-09-16.

## ADL-005 — Contexto de agente en archivos
- Decisión: mantener `PROJECT_MAP.md`, `CURRENT_GOAL.md`, `DECISIONS.md` y `TASKS.md` como contexto compacto para agentes, y `AGENTS.md` como archivo versionado de reglas de trabajo.
- Motivo: reducir consumo de tokens y no releer CLAUDE.md completo; las reglas permanentes viven versionadas en `AGENTS.md`.
- Alternativas descartadas: asumir contexto solo en memoria.
- Fecha: Anterior a 2026-09-16; documentada 2026-09-16.

## ADL-006 — `/cot/[token]` público por token
- Decisión: la cotización B2C compartida se abre por `share_token` en `/cot/[token]` sin login.
- Motivo: el cliente del tarifario guarda/imprime la cotización; `createAdminClient()` es correcto porque no hay sesión y el RLS no tiene con qué evaluar; el acceso se valida con `.eq("share_token", token)` (UUID impredecible que solo abre SU cotización).
- Alternativas descartadas: login obligatorio del B2C; filtrar por `id`.
- Fecha: 2026-06-08 (`1316b1c9` crea el enlace público por token); el whitelist de `proxy.ts` fue corregido/confirmado el 2026-09-16 en PR #302.

## ADL-007 — `/cotizacion/[id]` interno y autenticado
- Decisión: la cotización interna `/cotizacion/[id]` continúa siendo autenticada (panel).
- Motivo: es la vista del asesor/admin sobre la cotización del sistema; no aplica el vínculo compartido externo.
- Alternativas descartadas: volverla pública.
- Fecha: 2026-08-17 (`ab449ecc` cierra el aislamiento por tenant de la ruta interna, migraciones 153/154).

## ADL-008 — Roles de agentes en este repo
- Decisión: Codex audita/revisa; OpenCode, Sonnet o DeepSeek implementan según la complejidad.
- Motivo: mantener una sola revisión por entrega y separar revisión de implementación.
- Alternativas descartadas: delegar el mismo problema a varios agentes a la vez.
- Fecha: 2026-09-16.

## ADL-009 — El usuario ejecuta Git, SQL y validación
- Decisión: el usuario ejecuta Git (commits/push/merge), SQL remoto y la validación visual en Vercel Preview.
- Motivo: los agentes no tocan credenciales ni despliegues; los secretos no salen del entorno del usuario.
- Alternativas descartadas: agentes con acceso directo al SQL Editor o a git remoto.
- Fecha: 2026-09-16.

## ADL-010 — Add-ons acotados al paquete de origen
- Decisión: los add-ons abiertos desde un hotel del carrito (`+ Agregar servicios / tours`) conservan `paqueteId` y la consulta se acota en servidor (`buscarReceptivos`); el catálogo general solo reaparece mediante una salida explícita (`Limpiar resultados`).
- Motivo: identidad del paquete de origen; evita que el catálogo general del destino (ej. 112 servicios) reemplace los add-ons propios del paquete (ej. 14).
- Alternativas descartadas: búsqueda general por destino desde el carrito; filtrar solo en cliente.
- Fecha: 2026-09-16 (PR #306, `fca2e834`).

## ADL-011 — Respuestas asíncronas obsoletas no reemplazan la búsqueda vigente
- Decisión: una respuesta asíncrona obsoleta nunca puede reemplazar la búsqueda vigente.
- Motivo: toda invalidación incrementa la generación de forma síncrona (`buscar()` al iniciar y `limpiarTodo()`); cada búsqueda solo publica si la generación sigue intacta al resolver, y `montadoRef` cubre el desmontaje.
- Alternativas descartadas: confiar en el orden de resolución de las promesas.
- Fecha: 2026-09-16 (PR #306, `fca2e834`).

## ADL-012 — Publicación atómica del snapshot
- Decisión: el snapshot se publica de forma atómica (delete+insert+cambio de estado en UNA transacción, `publicar_tarifario_resultado`) y solo una revisión/generación vigente puede reemplazarlo; si el token quedo obsoleto, la publicacion se rechaza sin tocar el snapshot anterior.
- Motivo: una publicacion con generacion/revision vencida pisaria un calculo mas nuevo; la atomicidad evita estados parciales visibles.
- Alternativas descartadas: escribir el snapshot fuera de transaccion; aceptar generaciones/revisiones antiguas.
- Fecha: 2026-09-17 (PR #308, `8a2b5985`, migracion 181).

## ADL-013 — Publicabilidad gobernada por paquete
- Decisión: `tarifario_snapshot_publicable` y el estado activo real del paquete (`armado_paquetes.activo`) gobiernan si el snapshot puede servirse.
- Motivo: un snapshot viejo de un paquete inactivo o invalidado (fuente cambiada) no debe servirse como si fuera vigente.
- Alternativas descartadas: servir el snapshot solo por existencia de filas.
- Fecha: 2026-09-17 (PR #308, `8a2b5985`, migraciones 181/182).

## ADL-014 — Lectores en vivo vs. tabla cruda
- Decisión: los lectores en vivo (Vista Booking, cotizacion, reserva) usan `tarifario_resultado_publicable` (vista con join autoritativo a `armado_paquetes`); la tabla cruda `tarifario_resultado` queda solo para diagnostico administrativo autorizado.
- Motivo: un solo punto de filtrado server-side que bloquea snapshots no publicables/inactivos sin duplicar la regla en cada reader.
- Alternativas descartadas: cada lector replicando el filtro; exposicion publica de la tabla cruda.
- Fecha: 2026-09-17 (PR #308, `8a2b5985`, migracion 182).

## ADL-015 — Históricos y Bernalo fuera del bloqueo
- Decisión: los contratos/cotizaciones congelados (historica) y Bernalo/hoteles por unidad (cotizan en vivo) quedan fuera de ese bloqueo.
- Motivo: los documentos congelados no dependen del snapshot actual; Bernalo no usa el snapshot-persona y no debe bloquearse por el.
- Alternativas descartadas: aplicar el bloqueo tambien a historicos o a la cotizacion en vivo de Bernalo.
- Fecha: 2026-09-17 (PR #308, `8a2b5985`, migraciones 181/182).

## ADL-016 — Orden de secciones en la tarjeta del motor interno
- Decisión: la tarjeta del motor interno (`HotelModal` en `app/tarifario/VistaBooking.tsx`) conserva el orden Salidas → Motor interno → Incluye → Servicios add-on.
- Motivo: presentar primero la elección y configuración cotizable, y después la información incluida y los extras.
- Alternativas descartadas: mantener Incluye/add-ons antes del motor interno; reordenar también las variantes externas/Bernalo.
- Referencia: commit `70263e3d`.
- Alcance: esta decisión no implica que el motor externo ya tenga tarjeta completa; conservarla completa en el motor externo permanece como siguiente objetivo (ver `CURRENT_GOAL.md`).
- Fecha: 2026-09-17.

## ADL-017 — Tarjeta completa en el motor externo, precio/disponibilidad por fuente
- Decisión: las tarjetas del motor externo (`Resultado` en `app/tarifario/BuscadorBooking.tsx` y `TarjetaUnidadBusqueda` en `app/tarifario/VistaBooking.tsx`) conservan el contenido comercial completo para hotel persona y unidad, pero precio y disponibilidad mantienen su fuente autoritativa correspondiente: persona conserva el precio interno existente; unidad/Bernalo usa precio y disponibilidad Bernalo en vivo.
- Decisión: Incluye y add-ons se resuelven por el paquete de la oferta seleccionada (`paqueteId`), nunca por el hotel de forma genérica.
- Decisión: descripción compacta con Ver más/Ver menos medido por desborde real, y servicios adicionales colapsados con contador.
- Motivo: evitar mezclar datos internos con disponibilidad/precio Bernalo, y unificar la presentación reutilizable sin perder información comercial.
- Alternativas descartadas: duplicar la JSX de la tarjeta en cada variante; indexar Incluye/add-ons por hotel en vez de por paquete.
- Deuda no cerrada: mejorar la presentación de servicios adicionales expandidos (evitar que la tarjeta expandida alargue toda la fila) sigue pendiente en `TASKS.md`; no es una decisión cerrada.
- Referencia: PR #312, squash `ba78c77d` (2026-09-17).

## ADL-018 — Documentación modular por rol y lectura mínima
- Decisión: la coordinación se divide en un router universal (`AGENTS.md`) y archivos de rol en `docs/agents/` (`CODEX.md`, `SONNET.md`, `OPENCODE.md`, `DEEPSEEK.md`), con las plantillas de usuario aisladas en `PROMPTS.md`.
- Decisión: la lectura mínima depende de la situación: tarea nueva (router, `CURRENT_GOAL.md`, archivo del rol, `git status` y diff), corrección en la misma conversación (solo archivos afectados, diff nuevo y pruebas relacionadas) y post-merge (router, `OPENCODE.md`, `TASKS.md`, `CURRENT_GOAL.md`, `git status` y diff mínimo del merge).
- Decisión: las correcciones de la misma conversación no releen coordinación; solo lo hacen si cambió la rama, cambió el objetivo o apareció una contradicción.
- Decisión: un solo implementador por problema y validación incremental (pruebas focalizadas durante el trabajo; una sola suite completa por entrega cuando corresponda).
- Motivo: reducir tokens y ambigüedad, evitar duplicación de reglas y que cada rol lea solo lo que necesita.
- Alternativas descartadas: obligar a leer los cinco documentos en cada ronda; duplicar reglas en varios archivos.
- Fuera de alcance: el usuario sigue siendo el único responsable de Git remoto (staging/commit/push), SQL remoto y validación en Vercel.
- Referencia: PR #314, squash `11589a0f` (2026-09-17).

## ADL-019 — Fuente materializada, promociones y recalculo por hotel
- Decisión: la fuente autoritativa del precio es `tarifa_hotel` materializada; una vigencia por sí sola no genera ni modifica precios (el porcentaje/monto guardado en la vigencia promocional queda como metadata).
- Decisión: una promoción solo gana para un combo si existe su fila materializada en `tarifa_hotel`; sin fila promocional gana la siguiente tarifa materializada válida.
- Decisión: la calculadora descuenta la promoción sobre la tarifa completa, incluido el suplemento efectivo; prioridad de suplemento: promoción > base > general.
- Decisión: crear, editar o eliminar tarifas/temporadas regenera los paquetes asociados por el `hotel_id` autoritativo de la fila; los errores al buscar paquetes asociados no quedan silenciosos y la regeneración conserva independencia entre paquetes.
- Deuda no cerrada: el metadata de la vigencia promocional resulta engañoso en la UI y debe aclararse, renombrarse u ocultarse; registrado en `TASKS.md` como pendiente, sin objetivo activo.
- Referencia: PR #316, squash `ff9507da` (2026-09-18).

## ADL-020 — Hoteles recomendados por paquete
- Decisión: la prioridad recomendada es por oferta `(paquete_id, hotel_id)`, con namespace propio 1-6 de cada paquete; el mismo hotel puede tener prioridad y etiqueta distintas en paquetes diferentes.
- Decisión: sin búsqueda se muestran únicamente las posiciones literales 1-2 de cada paquete en bloques (no sustituye ausentes con 3-6); con búsqueda por destino cada paquete coincidente aporta sus prioridades 1-6 y el resto corresponde solo a resultados reales del motor.
- Decisión: la identidad de la tarjeta es compuesta `(hotelId, paqueteId)`; "Recomendado" aparece solo en ofertas seleccionadas, todas conservan el nombre del paquete, y precio/disponibilidad/Incluye/add-ons siguen ligados al paquete de la oferta.
- Decisión: el selector administrativo usa autosave optimista (respuesta inmediata, sin refresh en éxito, rollback y refresh autoritativo en error).
- Decisión: la prioridad es presentación fuera del snapshot; la migración 183 agrega `armado_hoteles.prioridad` (rango 1-6, unicidad parcial por paquete) y la 184 hace que un cambio exclusivo de prioridad no invalide el snapshot, mientras que cambios reales de armado sí lo invalidan.
- Decisión: guardar o quitar `armado_hoteles.prioridad` con éxito revalida el editor y `/tarifario` sin regenerar el snapshot, publicar uno nuevo ni alterar su estado; ambas superficies releen `armado_hoteles`.
- Deuda no cerrada: el orden del resto del inventario (precio, estrellas/localización, etiquetas) sigue pendiente en `TASKS.md` (#1).
- Referencia: PR #318, squash `a2bcbf2a` (2026-09-18); ampliada con el PR #320, squash `7d8cf7ec` (2026-09-19).

## ADL-021 — Lecturas auxiliares de vigencia con paginación completa
- Decisión: las lecturas auxiliares de vigencia cuya cardinalidad puede superar el "Max Rows" de PostgREST (`hotel_temporadas` y `tarifa_hotel` en `filtrarTarifarioVencidas`) se paginan por completo con `ejecutarConsultaPaginada`: orden total y determinista por `id`, avance por la cantidad real de filas recibidas y término únicamente con una página vacía.
- Decisión: un error en cualquier página aborta la verificación con el mismo fail-closed explícito de siempre: sin verificación de vigencia, se ocultan las filas hoteleras verificables; no se relaja la vigencia ni se sintetizan tarifas desde temporadas.
- Motivo: PostgREST trunca en silencio (sin `error`) por el "Max Rows" del proyecto; las filas faltantes se interpretaban como tarifas no materializadas y el caso real TAMACÁ BEACH RESORT (paquete 53 / hotel 57) perdía PA/PC en el modal (solo mostraba PAM) porque esas filas quedaban fuera del primer bloque no paginado.
- Alternativas descartadas: consultas únicas sin `.range()`; lecturas paginadas sin orden total; término por `page.length < 1000`.
- Referencia: PR #320, squash `7d8cf7ec` (2026-09-19).