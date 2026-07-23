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

## Pendiente de documentar (según se vaya tocando cada módulo)

Estos módulos existen y funcionan, pero todavía no tienen su hoja técnica — se arma la primera
vez que una sesión los investigue a fondo (para no repetir la investigación, se documenta ahí
mismo antes de cerrar el tema). Lista de lo que falta:

- **Tarifario público/interno** (`app/tarifario/`, `app/(dashboard)/dashboard/tarifario/`) — cómo se arma la vista pública vs. la interna, cómo se calcula el "desde".
- **Reservar** (`app/(dashboard)/dashboard/reservar/`, `lib/reservar/cotizar.ts`, `lib/reservar/computo.ts`) — el motor de cotización por fechas, validación de habitaciones/pax, generación de contrato.
- **Paquetes / armado** (`app/(dashboard)/dashboard/paquetes/`, `lib/calc/paquetes.ts`) — liquidación noche a noche, vigencias/promos, `generarTarifario`.
- **Vuelos / Inventario** (`app/(dashboard)/dashboard/vuelos/`) — bloqueos, sillas, estados, cambios entre records.
- **Comisiones / Rentabilidad / Punto de equilibrio** (`app/(dashboard)/dashboard/comisiones/`, `/rentabilidad/`, `/punto-equilibrio/`, `lib/finanzas/`).
- **Programas** (circuitos de proveedor) y **Cotización manual/dinámica**.
- **CRM Difusión** (`app/(crm)/`).
- **Sitio web / CMS** (`app/sitio_web/`, `app/cms/`, `lib/sitio/`).
- **Multitenant / Auth / Roles / RLS** (`lib/tenant.server.ts`, `proxy.ts`, políticas de Supabase).
- **Auditoría** (trigger genérico de trazabilidad, `fn_auditoria()`).

Si vas a investigar uno de estos a fondo, considera dejar la hoja técnica del módulo escrita
antes de cerrar — así la próxima vez no hay que volver a investigar lo mismo.
