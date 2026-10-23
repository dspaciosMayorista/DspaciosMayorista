# SalesBot comercial multiproducto (#56)

Decision del dueno (2026-10-18): SalesBot debe orientar la venta del catalogo, no limitarse a Programas. El documento inicial de consulta de Programas describe una fuente de datos, no el alcance completo del producto.

## Orden comercial

1. **Bloqueos:** paquetes de vuelo negociado y hotel. La respuesta debe partir de la oferta publicada y comprobar fechas, precio y cupos de vuelo con las fuentes vigentes antes de afirmar disponibilidad. Un asiento no se promete ni se aparta por consultarlo.
2. **Porcion terrestre:** paquetes de hotel sin vuelo. Las fechas, ocupacion y acomodacion del cliente determinan el precio; la consulta debe reutilizar la reliquidacion vigente del tarifario/Booking, no un "desde" estatico como cotizacion final.
3. **Demas productos:** mapear hoteles individuales/dinamicos, vuelos y servicios segun los flujos de venta reales antes de definir el orden y las operaciones de lectura de cada uno.
4. **Programas:** PR #366 entrega una consulta interna de buscar/detalle como pieza parcial. No es un chatbot ni cierra #56; su motor de PVP no se aplica a bloqueos ni a porcion terrestre.

La prioridad 1-2 es de alcance comercial, no autorizacion para editar sus motores. El piloto sigue siendo interno, solo de lectura y con revision humana. No crea reservas, contratos, pagos ni cotizaciones vinculantes. No se activa IA ni canales sin proveedor, tope de gasto y gates propios.

## Contrato de lectura aprobado para la siguiente pieza

El mapa de bloqueo y porcion terrestre fue entregado en la bitacora externa de #56, seccion "Alcance multiproducto". Reutiliza `cargarDatosTarifario`, `buscarHoteles`, `cotizarPorFechas` y `computarReserva` sin editar esos motores. El contrato siguiente fija sus limites de salida:

Para cada uno de los dos productos prioritarios, la implementacion debe respetar:

- Fuente de ofertas publicadas, condiciones y precio; funcion/servicio existente que pueda reutilizarse sin duplicar formulas ni exponer netos, impuestos internos o datos del proveedor.
- Entradas minimas: destino, fechas, viajeros/edades, acomodacion y demas parametros que el motor real exija. Diferenciar precio orientativo de cotizacion reliquidada.
- Semantica de disponibilidad: inventario verificado, sujeto a confirmacion o no disponible. No inferir cupos por ver una tarjeta publicada; no prometer silla ni habitacion al consultar.
- Salida en lista blanca, sello de vigencia, permisos y tenant, errores explicitos y abstencion cuando falten datos o falle una consulta.
- Pruebas focales de precio frente al flujo actual, fecha/ocupacion, falta de cupos, errores de lectura, aislamiento de tenant y ausencia de costos en la salida.

Bloqueo usa el modulo `bloqueo` del tarifario (vuelo y hotel). Porcion terrestre usa `porcion_terrestre` (hotel sin vuelo) y su cotizacion por fechas reales. Ver `docs/tecnico/tarifario-y-paquetes.md`.

## Decisiones de negocio D8-D12

El dueno aprobo: totales orientativos tomados del motor vigente; solo el porcentaje B2B propio sin monto de comision; sin add-ons en esta pieza; pestanas por producto en la pantalla de SalesBot; hoteles Bernalo por unidad en una pieza posterior. El total no promete cupo ni habitacion, y una tarifa grupal pendiente no se presenta como precio final. No incluir mascotas hasta resolver H-PQ1.

H-PQ1 (lectura de `pct_mk` e `impuesto_fijo` con la sesion) y H-VU1 (lectura amplia de sillas con datos personales) son hallazgos separados; no autorizan cambios en los motores ni acceso a filas de sillas desde #56. H-VU1 requiere comprobacion de permisos efectivos en Produccion y hotfix de privacidad independiente.

## Gates

- GO local al mismo ejecutor de #56, en el worktree `codex/56-salesbot-programas` y el Draft #366, para cuatro operaciones de lectura: `buscarBloqueos`, `cotizarBloqueo`, `buscarPorcion` y `cotizarPorcion`. Archivos nuevos reservados: `lib/salesbot/paquetes/{contrato,bloqueo,porcion,lectura}.ts`, pantallas bajo `app/(dashboard)/dashboard/salesbot/*` y pruebas `pruebas/salesbot56{Bloqueo,Porcion}*`. Solo puede modificar `lib/salesbot/contrato.ts` y la pagina actual de SalesBot; consume los motores existentes sin editarlos.
- El ejecutor prueba paridad con el motor, cupos, vigencia, edades/capacidad, errores saneados y ausencia de netos, `record` y datos de silla a cualquier profundidad. No toca `reservar/actions.ts`, vuelos/sillas, `proxy.ts`, RLS, migraciones, `package.json` ni `types/database.ts`. Sin staging, commit, push ni SQL remoto.
- #57 corrige paridad y comision de Programas; no determina los precios de bloqueo o porcion terrestre. Cada producto necesita su propia prueba de paridad con la venta.
- La migracion 218 sigue siendo una reserva de numero para conversaciones futuras, sin SQL creado ni autorizado. El registro debe ser multiproducto y conservar las reglas de privacidad ya aprobadas.
- #58 y los permisos de las demas fuentes se revisan antes de cualquier canal externo. La IA conversa solo despues de contar con operaciones de lectura aprobadas y verificadas.

Este documento autoriza solo el codigo local de consulta indicado; no autoriza IA, persistencia, staging, commit, push, Ready, merge ni SQL remoto.
