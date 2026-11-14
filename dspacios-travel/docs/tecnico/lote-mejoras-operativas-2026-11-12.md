# Lote local de mejoras operativas — 2026-11-12

Autorización del dueño: trabajar juntas las seis tareas propuestas en un worktree separado; probar todo localmente e integrar al final en una sola entrega para un único Preview. No abrir otro PR ni publicar este lote por separado.

Worktree: `dspacios-travel/.worktrees/lote-mejoras-operativas`. Rama: `codex/lote-mejoras-operativas`. Base inicial: referencia local `origin/main`, `8578c266e` (#447); no se consultó el remoto en esta preparación. No incluye los cambios sin publicar de #43/#60.

## Alcance y aceptación

Decisión aprobada por el dueño (2026-11-12), #15: año de dos dígitos con ventana móvil de 100 años que termina en el año actual + 30, sustituyendo la propuesta de +20. En 2026: 00–56 → 2000–2056; 57–99 → 1957–1999. Siempre mostrar el año completo al confirmar el campo, antes de guardar. Fechas con cuatro dígitos conservan su año explícito; no reinterpretar históricos. Actualizar implementación, ejemplos y pruebas de frontera; la aprobación documental no implica que el código ya esté actualizado.

| Tarea | Alcance | Comprobación mínima |
|---|---|---|
| #15 | Fechas manuales: admitir DDMMAAAA, DDMMAA, DD/MM/AAAA y DD/MM/AA además del calendario. `09052026` y `090526` representan 09/05/2026. | Fechas imposibles rechazadas sin normalización silenciosa; bisiestos, escritura parcial, pegado, blur, calendario y payload ISO; definir la conversión del año de dos dígitos antes de implementar si el componente no tiene regla. No limitar todas las fechas a futuro: nacimientos e históricos siguen siendo válidos según su campo. |
| #34 | Rótulos Incluye/No incluye de Bloqueo y Porción terrestre sin llamarlos «programa». | Ambas variantes; programas legítimos conservan su etiqueta; no cambiar precios ni contenido. |
| #50 | Inventario de listas con casillas; completar selección/deselección masiva donde falta. | Semántica explícita de filtro/página, filas deshabilitadas, selección parcial, cero y muchas filas; sin seleccionar filas invisibles por accidente ni ejecutar acciones destructivas automáticamente. Servicios y aéreos ya integrados se conservan. |
| #59 | Dashboard: «X sillas disponibles en Y records» y alerta por salida a menos de 15 días, Bogotá. | Días pasado, hoy, 14 y 15; sin disponibilidad, duplicados, varios records; sin sondeos nuevos. |
| #89 | Reproducir y corregir portada de servicios receptivos cuando tarda la respuesta. | Red lenta, recarga y cambios de filtro; no asignar portada de otro servicio; cancelar/ignorar respuestas obsoletas y sin reintentos en bucle. |
| #65 | Verificar si el rótulo/conteo «tarifas» en paquetes sigue siendo engañoso. | Reproducir antes de cambiar; mostrar datos autoritativos. Si ya está resuelto, documentar evidencia y no modificar por obligación. |

## Coordinación obligatoria

- Un solo implementador de este lote. Codex audita; no se ha modificado código de producto en esta preparación.
- No editar el worktree ni cambios de #43/#60. Antes de tocar componentes compartidos, inventariar las rutas y compararlas con su diff local; coordinar quién conserva cada cambio. Particular atención a fechas, tarjetas, `paquetes/actions.ts`, tipos, cargadores de pruebas y package.json.
- La regla del límite de 30 noches pertenece a #43/#60. Este lote no cambia validaciones comerciales ni duplica esa implementación.
- Revisar tareas antiguas y ramas existentes antes de rehacer trabajo; las referencias históricas no prueban que esté fusionado.
- Ante una investigación de más de tres archivos de código adicionales, presentar el alcance según AGENTS.md.

## Método y cierre

1. Inventario focal de las seis tareas: reproducción, archivos, cambios ajenos y pruebas; comenzar por #15 y #34 después de coordinar archivos compartidos.
2. Implementar por bloques internos y revisar localmente, sin pushes por bloque.
3. Aplicación y base locales con datos sintéticos; ningún secreto productivo ni escritura remota. No duplicar el conjunto de servicios Docker de #43/#60 sin necesidad; coordinar su uso y detener solo los propios al terminar. No activar contenedores por esta preparación.
4. Pruebas focalizadas durante el trabajo; integración del lote y build de producción local al cierre. Medir solicitudes, efectos, sondeos y reintentos. No clasificar fallos como previos sin comparación equivalente.
5. El dueño conserva staging, commit, push, SQL remoto y Vercel. Cuando ambos frentes estén completos y auditados, preparar integración local con #43/#60, conservando los cambios de ambos y repitiendo pruebas afectadas sobre el árbol combinado.
6. Integración prevista en la entrega/PR #448 existente, previa comprobación de su estado y ramas al final. No fusionar ni copiar árboles ahora, no reset/force-push y no abrir un PR adicional. El Preview existente de #448 es anterior a esta ampliación: antes de otro despliegue se explicará al dueño la excepción de publicación; no se despliega implícitamente por este plan.

Estado inicial: worktree y plan creados; sin implementación, pruebas de producto, servidor local, staging, commit, push o cambios remotos.
