# TASKS.md - Dspacios Mayorista

Fuente unica y priorizada de pendientes. Ultima actualizacion: 2026-09-17.

## Cola priorizada

### 1. Compactar el flujo Codex, Sonnet y OpenCode

- [ ] Preparar prompts breves que lean solo `PROJECT_MAP.md`, `CURRENT_GOAL.md`, `DECISIONS.md`, `TASKS.md`, `git status` y el diff relevante.
- [ ] Codex coordina, revisa riesgos y valida antes del commit.
- [ ] Sonnet se usa para UI compleja o revision independiente de alto riesgo.
- [ ] OpenCode/Antigravity/modelos gratuitos se prueban con tareas pequenas, mecanicas y bien delimitadas.
- [ ] DeepSeek queda para implementaciones puntuales cuando haga falta.
- [ ] El usuario ejecuta Git, SQL remoto y validacion visual en Vercel Preview.
- [ ] Ejecutar una sola suite completa por entrega; durante la implementacion, usar pruebas focalizadas.
- [ ] No delegar simultaneamente el mismo problema a varios agentes.

### 2. Recalcular paquetes al editar tarifas o promociones

- [ ] Recalcular automaticamente todos los paquetes que usan un hotel cuando se guarda, edita o elimina una tarifa/promocion.
- [ ] Respetar promociones restringidas por alimentacion sin borrar tarifas base validas de otros planes.
- [ ] Cubrir edicion, eliminacion y relaciones entre hotel, tarifa, promocion y paquete.

### 3. Hoteles recomendados

- [ ] Permitir un maximo de 6 hoteles recomendados con prioridad manual de 1 a 6.
- [ ] Mostrar despues el resto del inventario con un orden definido por precio, estrellas/localizacion y etiquetas.

### 4. Smoke financiero posterior al PR #294

- [ ] Crear un caso real con servicio incluido por grupo y comparar vitrina, carrito, cotizacion y contrato.
- [ ] Confirmar una sola CxP por servicio, costos correctos y margen correcto.
- [ ] Confirmar en Vercel `/api/cron/reconciliar-financiero` y su ejecucion con `CRON_SECRET`.

### 5. Soporte unidad para paquetes dinamicos

- [ ] Implementar soporte real de `salidas_dinamicas` y cotizacion antes de anunciar hoteles unidad de paquetes `dinamico`.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 6. Soporte unidad para paquetes de servicios

- [ ] Implementar soporte real de hoteles unidad en paquetes `servicios` antes de anunciarlos como cotizables.
- [ ] Mantenerlos excluidos o marcados como no compatibles hasta completar la integracion.

### 7. Corregir los 15 fallos preexistentes de pruebas

- [ ] Inventariar cada fallo por nombre, causa y propietario.
- [ ] Separar defectos reales de pruebas de wiring obsoletas.
- [ ] Corregirlos por grupos para dejar de aceptar una linea base roja como normal.

### 8. Smoke visual de condiciones y restricciones

- [ ] Validar en produccion badges y condiciones en Booking y carrito de los PR #286/#287.
- [ ] Confirmar que el contenido sea consistente en escritorio, movil e impresion cuando aplique.

### 9. Smoke de excepcion comercial

- [ ] Probar con superadmin y contrato restringido el formulario, la autorizacion y la trazabilidad.
- [ ] Mantener como deuda no bloqueante la reutilizacion de la consulta de vigencia para evitar una segunda consulta O(1) a `hotel_temporadas`.

### 10. Mostrar conteos por destino

- [ ] Mostrar receptivos junto al conteo de hoteles, por ejemplo: `0 hoteles · 1 receptivo`.

### 11. Explicar bloqueos al eliminar destinos

- [ ] Mostrar en el modal por que un destino no puede eliminarse cuando tiene contenido asociado.

### 12. Mejorar la presentacion de servicios adicionales expandidos en las tarjetas

- [ ] Evitar que una tarjeta expandida aumente la altura de toda la fila y deje grandes espacios vacios.
- [ ] Evaluar modal/panel lateral o una superficie compacta equivalente, conservando identidad de paquete y detalle de cada servicio.

### 13. Integrar hoteles unidad en empaquetados

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` dentro de productos empaquetados.

### 14. Integrar hoteles unidad con vuelos y bloqueos

- [ ] Integrar y validar hoteles `modelo_tarifario = "unidad"` con vuelos, salidas y bloqueos.

### 15. Investigar hotel 217 ausente en Vista Booking

- [ ] Diagnosticar por que el hotel 217 no aparece en Porcion terrestre sin destino o buscando `odair`.
- [ ] Trazar en Vercel Preview: `tarifario_resumen` -> filtros post-carga -> `TarifarioPublic` -> `VistaBooking` -> tarjetas.
- [ ] No cambiar generacion, vigencia ni identidad categoria/regimen sin reproducir primero el descarte real.
- [ ] Fixture confirmado de produccion: hotel 217, paquete 50 activo, modelo persona, SAN ANDRES, 28 filas en `tarifario_resultado`, 4 filas en `tarifario_resumen`, 2 noches, Estandar/Superior, PAE/FULL y procedencia Promocion.

### 16. Separar Preview y Produccion

- [ ] Usar entornos y bases de datos independientes.
- [ ] Documentar el orden de migraciones y las variables por ambiente.

### 17. Desarrollo posterior del negocio

- [ ] Desarrollo integral B2B/B2C.
- [ ] Marketing y redes sociales.
- [ ] Automatizacion comercial y ventas.

## Cerrado recientemente

- [x] PR #312 (squash `ba78c77d`, 2026-09-17): tarjetas completas de "Buscar alojamiento" para hoteles persona y unidad/Bernalo. Muestran foto/video, informacion del hotel, ubicacion/mapa, Incluye/No incluye y add-ons; Incluye/add-ons respetan el paquete de la oferta; precio y disponibilidad conservan sus motores originales; descripcion con Ver mas/Ver menos; servicios adicionales colapsados con contador. Flujo validado en Vercel Preview.
- [x] Orden de secciones en `HotelModal` del motor interno (2026-09-17, commit `70263e3d`): Salidas -> Motor interno -> Incluye -> Servicios add-on. Traslado de JSX sin cambios de logica, props, precios, disponibilidad, acciones ni fuentes; prueba de regresion agregada (`pruebas/hotelModalOrdenSecciones.test.ts`) y flujo visual validado por el usuario. Las variantes externas/Bernalo no fueron modificadas.
- [x] Integracion principal Bernalo/unidad para Porcion terrestre: editor, busqueda, carrito, menores y add-ons.
- [x] PR #298: persistencia versionada, adaptador y migracion 173 de Bernalo.
- [x] Dubai: edades y suplementos propios por base/promocion; migracion 177 aplicada y validada.
- [x] Condiciones Dubai en contratos; migracion 178 aplicada y validada.
- [x] Procedencia Base/Promocion y precio final; migraciones 179/180 y hotfix 180 aplicados y verificados.
- [x] Docker Desktop/WSL recuperado; migraciones 179/180 validadas en Postgres 16 desechable.
- [x] PR #288: fuente unica CHD/INF, responsable adulto e inventario de sillas.
- [x] PR #289: infantes de contratos manuales visibles en vuelos, incluido cross-tenant autorizado.
- [x] PR #290: infante subordinado visualmente al adulto responsable.
- [x] PR #291: enlace Editar en contrato con cambio a la agencia real.
- [x] PR #292: crear/editar infantes desde vuelos con datos completos y responsable.
- [x] PR #293: descripcion manual del paquete.
- [x] PR #294: servicios incluidos, CxP por servicio y reconciliacion financiera durable.
- [x] PR #308 `8a2b5985` (2026-09-17): snapshots atomicos y bloqueo de versiones invalidas. Migraciones 181/182 aplicadas en Supabase remoto (preflight/postcheck esperados). Invalidacion segura por cambios de fuentes, publicacion atomica del snapshot y bloqueo server-side de snapshots no publicables o de paquetes inactivos. Preview validado en Vercel.
- [x] PR #306 `fca2e834` (2026-09-16): add-ons acotados al paquete de origen. Comportamiento confirmado: `+ Agregar servicios / tours` conserva `paqueteId`; muestra unicamente los servicios opcionales del paquete de origen; no mezcla servicios de otros paquetes del mismo destino; `Limpiar resultados` abandona el alcance y restaura el catalogo general; validado en Vercel Preview con el caso Cartagena: 14 propios frente a los 112 del catalogo general.
- [x] PR #302 (squash): condiciones de tarifa, procedencia y cotizacion B2C publica (`/cot/[token]` sin login); migraciones 178-180 integradas.
- [x] Merge correctivo 2026-09-16 (`e0efc7ed` sobre `f40716a7`): retira alcance accidental del PR #302 (TarifarioPublic, VistaBooking, vigencia y pruebas).
- [x] Organizacion de los archivos de coordinacion: TASKS, CURRENT_GOAL, DECISIONS, PROJECT_MAP y revision de AGENTS; los cinco se versionan.
- [x] Barra de estilos oculta al imprimir contratos/PDF.
