# Hoja técnica — índice

> **Qué es esto:** una referencia técnica, módulo por módulo, de **cómo está construido** el
> sistema — qué archivo hace qué, qué función calcula qué, qué tabla toca, y con qué otro
> módulo está enlazado. El objetivo es que cualquiera (una sesión de IA nueva, un desarrollador
> nuevo) pueda encontrar la respuesta a "¿dónde vive esto?" o "¿qué toca si cambio esto?" sin
> tener que releer el código de cero.
>
> **Esto NO es el `CLAUDE.md`** (que es la visión, las reglas de negocio y el historial de
> cambios — "qué se decidió y por qué"). Esto es el mapa técnico — "cómo está armado, en qué
> archivo, con qué firma". Si algo cambia de comportamiento, actualiza el archivo del módulo
> correspondiente aquí; si cambia una decisión de negocio o se agrega una migración, eso va en
> `CLAUDE.md`.
>
> **Convención de cada archivo de módulo:** Qué es / Dónde vive (archivos exactos) / Modelo de
> datos (tablas y columnas) / Funciones clave (firma + qué hace + de dónde se llama) / Flujo
> paso a paso / Reglas de negocio y fórmulas / Gotchas y decisiones no obvias / Enlaces cruzados.

## Módulos documentados

| Módulo | Archivo | De qué se trata |
|---|---|---|
| **Contabilidad** | [`contabilidad.md`](./contabilidad.md) | PUC (plan de cuentas), Libro diario/auxiliar, posteo automático de partida doble (abonos, facturación, CxP, pagos, retenciones), Conciliaciones bancarias, Retenciones a proveedores + informe DIAN. |
| **Tarifas de hotel** | [`tarifas-hotel.md`](./tarifas-hotel.md) | Modelo de datos del tarifario neto por hotel (`hoteles`, `hotel_temporadas`, `tarifa_hotel`, categorías/regímenes) — y el ⚠️ **gotcha crítico**: todo se relaciona por texto (sin FK), así que renombrar una categoría/régimen/temporada puede "huerfanear" tarifas si no se cascada. |
| **Calculadoras de hotel** | [`calculadoras-hotel.md`](./calculadoras-hotel.md) | Los 3 motores que generan filas de `tarifa_hotel` a partir de parámetros más simples: Dubai (base + modificadores %), Mixta (por hab/pax + IVA), Corporativa (tarifa por habitación + suplementos). |
| **Tarifario y paquetes** | [`tarifario-y-paquetes.md`](./tarifario-y-paquetes.md) | Armado de paquetes (`armado_paquetes` y sus joins), el motor `lib/calc/paquetes.ts` (liquidación noche a noche, vigencias/promos, `componerTarifa`), `generarTarifario`, tarifario interno (y su pantalla legacy huérfana) y tarifario público (`app/tarifario/`, vista Booking, el fix del precio "desde"). |
| **Reservar** | [`reservar.md`](./reservar.md) | `reservarDesdeTarifario` paso a paso, cotización por fechas (`cotizarPorFechas`/`liquidarHotelPaquete`), validación de habitaciones/pax (`lib/acomodaciones.ts`), la máquina de estados pendiente→confirmado, y qué falta para editar una reserva pendiente. |
| **Vuelos / Inventario** | [`vuelos-inventario.md`](./vuelos-inventario.md) | Bloqueos de vuelo, sillas y sus estados, transferencias entre records (`cambiarSillas`/`movimientos_silla`), el cron de liberación de vencidas, y el gotcha de `rangos_edad` sin usar. |
| **Comisiones / Rentabilidad / Punto de equilibrio** | [`finanzas-comisiones.md`](./finanzas-comisiones.md) | El motor de P&L por contrato (`lib/calc/finanzas.ts` + `lib/finanzas/rentabilidad.ts`), comisión B2B y recobro, el mecanismo real de comisión de asesor interno (`/dashboard/liquidacion`, distinto de Rentabilidad), nómina/punto de equilibrio. |
| **Programas y Cotización manual** | [`programas-y-cotizacion-manual.md`](./programas-y-cotizacion-manual.md) | El motor `pvpPrograma` de circuitos de proveedor, el importador de texto pegado, y el flujo de cotización manual/dinámica (`convertirCotizacionManualAContrato`) — y por qué son motores deliberadamente independientes del de Paquetes. |
| **CRM Difusión** | [`crm-difusion.md`](./crm-difusion.md) | El motor de rotación de material promocional (`lib/crm/difusion.ts::rotacionDe`, reglas de 21/30 días — no round-robin), el calendario programado y sus 5 pestañas. |
| **Sitio web / CMS** | [`sitio-web-cms.md`](./sitio-web-cms.md) | El sitio de marketing (`app/sitio_web/`) y su CMS de edición in-situ (`app/cms/`, arquitectura `EdicionContext`/`LienzoVivo`/`Editable*`), el árbol de páginas/secciones, y el toggle escritorio/móvil. |
| **Multitenant / Auth / Roles / Auditoría** | [`multitenant-auth-auditoria.md`](./multitenant-auth-auditoria.md) | Cómo conviven mayorista/minorista (`lib/tenant.server.ts`, `proxy.ts`), el enum de 9 roles, el patrón de RLS con `puede_ver_tenant()`, y el trigger genérico de auditoría (`fn_auditoria()`). |
| **Portal B2B** | [`portal-b2b.md`](./portal-b2b.md) | Registro/aprobación de aliados (`b2b_solicitudes`), dashboard `/portal/b2b`, `usuarios.agencia_id`/`pct_comision`, `ventas_b2b` (`modo_compra`/`comision_estado`), el link de pago manual (`/pagar`) — y el ⚠️ gotcha del rol `cliente_final`, que existe en el enum pero no tiene ninguna UI construida para él. |

## Pendiente de documentar (según se vaya tocando cada módulo)

Todos los módulos identificados hasta ahora ya tienen su hoja técnica (tabla de arriba). Lo que
queda pendiente es lo que se vaya descubriendo/tocando de aquí en adelante:

- Cualquier módulo nuevo que se agregue al sistema.

Si vas a investigar algo a fondo que no esté cubierto arriba, considera dejar la hoja técnica
escrita antes de cerrar — así la próxima vez no hay que volver a investigar lo mismo.
