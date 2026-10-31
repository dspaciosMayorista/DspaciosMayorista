# Armado de paquetes: casillas con guardado optimista (Producto → Paquetes)

Vuelos, hoteles, empaquetados y servicios (casilla individual y «Seleccionar todos») responden al clic al instante; el servidor confirma por detrás.

- **Lógica pura:** `lib/paquetes/seleccionOptimista.ts` (`ColaSeleccion`, `efectivos`, `estadoFila`, `bloqueoGenerar`). Prueba con promesas controladas: `pruebas/seleccionOptimista.test.ts`.
- **Cableado:** `app/(dashboard)/dashboard/paquetes/[id]/ArmadoClient.tsx`. Integración con acciones diferidas: `pruebas/armadoOptimista.react.ts`.
- **Reglas:** (1) el check y los contadores leen la selección *efectiva* (servidor + lo pendiente); (2) cada fila muestra «Guardando…»; (3) las operaciones de un tipo salen EN ORDEN y de a una, y un clic repetido sobre la misma fila aún en cola reemplaza al anterior,
  así una respuesta antigua nunca revierte un clic más reciente; (4) si falla, la fila vuelve al último valor confirmado (o al del servidor) y muestra el error (un lote fallido se explica una vez); (5) un guardado exitoso NO llama a `router.refresh()`:
  se marca «sucio» y se refresca UNA vez al abrir la pestaña Tarifario (única parte que depende del servidor); `Generar tarifario` ya refresca por su cuenta; (6) el valor confirmado se conserva hasta que LLEGAN datos nuevos del servidor de un refresco
  iniciado después de esa confirmación (`reconciliar`); un refresco anterior a un clic más reciente no lo pisa; (7) **«Generar tarifario» se bloquea** mientras haya guardados pendientes («Guardando cambios…») o errores sin descartar.
- **No cambia** tarifas, reglas de publicación ni las acciones de servidor.
- **Costura de pruebas:** `ArmadoClient` acepta `acciones?` (por defecto las reales); solo una prueba de navegador las sustituye.
- **Límite:** si dos refrescos del servidor se superponen, el segundo podría reconciliar con datos del primero (la señal es la llegada de props nuevas); no ocurre en el flujo actual (un refresco por entrada a la pestaña Tarifario).
