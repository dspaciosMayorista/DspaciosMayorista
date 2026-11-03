# Desglose interno de la cotización (hotfix) · migraciones 272 y 273

Ficha interna de cotización (`/dashboard/cotizaciones/[id]`): muestra de dónde sale el precio de venta SIN recalcular nada y sin cambiar ningún importe.

## Qué hay en la ficha
| Bloque | Fuente | Quién lo ve |
|---|---|---|
| Desglose congelado (`DesgloseInterno`): hotel, vuelo, servicios, suplementos, ajustes, «Otro concepto», «Importe no disponible», «Detalle incompleto» | `cotizaciones.detalle` (lo ya guardado al cotizar) | Quien abre la ficha interna (sin netos) |
| Composición (`ComposicionPrecio`): neto y venta por componente, markup global, redondeo, moneda/TRM, línea explícita del PVP fijo del infante | `cotizacion_composicion` (272), escrita al cotizar con los importes que produjo el motor | Solo `superadmin`, `gerencia`, `administracion`, `operaciones` (`ROLES_CONTRATO_COMPLETO`), leída con service-role tras el chequeo de tenant |
| «Pendiente de valoración» (hotel bajo solicitud sin neta) | estado de la cotización | Igual que el desglose; sin importes |
| Comparativa madre: `<details>` por opción con el desglose congelado de la hija + enlace a la ficha de la hija | `plantilla_hija.detalle` | Igual que el desglose; la composición se ve en la ficha de la hija |

Documentos públicos, `cotizaciones.detalle` y `tarifario_resultado_publicable` no cambian: no llevan netos ni composición.

## De dónde sale la composición
- **Por fechas (porción terrestre, dinámico, hotel bajo solicitud valorado):** `computarReserva` liquida en vivo y deja la base en `liquidacionHotel.composicionBase`.
- **Publicado (bloqueo, empaquetado, salida):** `tarifario_resultado_publicable` solo guarda el PVP compuesto. Por eso `generarTarifario` (`paquetes/actions.ts`) guarda en `tarifario_resultado_composicion` (273), ANTES de publicar, los insumos de cada estadía × hotel × categoría × régimen × origen (clave `{b|e|s|p}{id}|hotel|categoria|regimen|fechaIda|noches` + generación). La cotización lee la de `armado_paquetes.tarifario_generacion_publicada`.
- **Conversión de moneda (oferta `cop_trm_63`):** se guarda el neto convertido, el importe de origen y la TRM. Solo se compone si la TRM guardada es la de la cotización.
- Las RPC de publicación (monolítica y por lotes) NO se tocaron.

## Cuándo NO hay composición (la ficha lo dice; nunca se inventa un reparto)
- Cotizaciones y tarifarios anteriores a la 273 («no fue conservado»).
- Fila «desde» publicada de porción terrestre (solo referencia; al cotizar con fechas sí compone).
- PVP fijo del infante: línea explícita con su precio y el aviso, sin componentes.
- Línea cuyo precio guardado ya no coincide con el publicado, o redondeo fuera de [0, unidad).
- Oferta con conversión cuya TRM cambió desde que se generó el tarifario.
- Opciones de una comparativa antes de elegirlas.
- Vuelo vinculado en oferta con conversión: el neto del vuelo no se conoce (precio final R).
- Cotización manual: su propia tabla de servicios (sin `ComposicionPrecio`).

## No bloquea la venta
Guardar o leer la composición es mejor esfuerzo: `guardarComposicion` y `guardarComposicionesTarifario` van en `try/catch`, el cliente service-role se crea dentro del `try`, y `computarReserva` envuelve la lectura y la construcción. Si falta la tabla, la clave o el cliente, la cotización se crea igual y la ficha muestra «no fue conservado».

## Despliegue (orden)
1. Preflight: `supabase/scripts/preflight_272_273_composicion.sql` (todas las filas `requisito` en OK).
2. Aplicar `20260601000272_cotizacion_composicion.sql` y `20260601000273_tarifario_resultado_composicion.sql` (aditivas, sin datos previos; se niegan si la tabla ya existe).
3. Postcheck: `supabase/scripts/postcheck_272_273_composicion.sql` (todas las filas `control` en OK).
4. Desplegar el código. (Es tolerante: desplegar antes que las tablas solo deja las cotizaciones sin composición.)
5. **Regenerar** el tarifario de los paquetes de bloqueo / empaquetado / salida que se quieran explicar: sin regenerar después de la 273, sus cotizaciones nuevas salen sin composición.
- Rollback: `rollback_273_tarifario_resultado_composicion.sql`, `rollback_272_cotizacion_composicion.sql` (solo borran composición; no tocan precios, tarifarios ni cotizaciones).
- Prueba local repetible: `supabase/scripts/test_272_273_composicion.sh <t273_x> pg273 plantilla273` (plantilla = `preparar_esquema_local.sh <ct> 271 plantilla273`): 272→273, seguridad, publicador monolítico y por lotes, rollback, publicar sin las tablas y reaplicar.
- Medido en local: guardar 1.810 composiciones (paquete de 12.669 filas) ≈ 80 ms, frente a ≈ 1,4 s de publicar ese tarifario.

## Código y pruebas
`lib/cotizacion/{desgloseInterno,composicionPrecio,composicionServidor}.ts`, `lib/tarifario/composicionTarifario.ts`, `components/cotizacion/{DesgloseInterno,ComposicionPrecio}.tsx`, `lib/reservar/{computo,liquidacionHotel}.ts`, `paquetes/actions.ts`, `reservar/actions.ts`, `tarifario/checkout/actions.ts`.
Pruebas: `desgloseInterno.test.ts`, `desgloseInterno.react.ts`, `composicionPrecio.test.ts`, `composicionRecorrido.test.ts` (generador real → motor real, COP/USD, conversión con TRM, porción por fechas).

## Validación en Preview (cotizaciones NUEVAS, después de 272 + 273 + regenerar)
Con un rol con costos (`administracion`/`gerencia`) y uno sin (`venta`). «Cuadra» = suma de ventas por componente = fila de habitación = total.

| # | Cotización nueva | Moneda | Antes | Con costos | Sin costos |
|---|---|---|---|---|---|
| 1 | Bloqueo, 2 habitaciones distintas + 1 niño | COP | regenerar un paquete de bloqueo | Composición: hotel, vuelo, cada servicio incluido (neto y venta), markup global, redondeo; cuadra | Solo desglose congelado, sin netos ni composición |
| 2 | Bloqueo | USD | regenerar un bloqueo en USD | Igual, en USD, redondeo al dólar entero | Igual que 1 |
| 3 | Empaquetado (tiquete por sistema) | COP y USD | regenerar un paquete empaquetado | Composición con vuelo; cuadra | Sin netos |
| 4 | Empaquetado/oferta con conversión de moneda | COP | regenerar la oferta y cotizar con la misma TRM | Neto convertido con «USD x × TRM n» y la TRM usada | Sin netos |
| 5 | Porción terrestre por fechas | COP y USD | no requiere regenerar la fila; sí la 272 | Hotel y servicios incluidos, sin vuelo; cuadra | Sin netos |
| 6 | Hotel bajo solicitud | COP | antes de valorar: sin importes | «Pendiente de valoración». Valorada: desglose y composición; se conserva al confirmar | Pendiente / desglose sin netos |
| 7 | Manual (con niños) | COP y USD | nada | Su tabla de servicios (sin Composición) | Igual, sin costos |
| 8 | Comparativa madre (2–3 opciones) | COP y USD | nada | Desglose congelado por opción + enlace a la hija; la hija nueva muestra composición | Desglose sin netos |
| 9 | Control: una cotización anterior a la 273 | — | — | «No fue conservado», sin importes inventados | Igual |
| 10 | Con infante de PVP fijo | COP | paquete con ese infante | Línea explícita del PVP fijo, sin reparto | Sin netos |

Siempre comprobar además: el documento público / link compartido NO muestra netos, markup ni composición; el total de la ficha es el mismo que antes; y una cotización creada con una tabla ausente (o con la clave faltante) se crea igual.
