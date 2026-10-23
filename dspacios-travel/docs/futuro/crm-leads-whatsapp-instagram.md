# CRM de leads, WhatsApp e Instagram

> **Borrador de propuesta (solo documental).** Diseño previo a construcción: no representa funcionalidad implementada, no es un pendiente priorizado ni autoriza cambios de código, SQL, datos o `TASKS.md`. Pasa a la cola solo si el usuario lo decide expresamente.
>
> Revisado el 2026-09-30: rutas y líneas citadas en "Estado actual comprobado" verificadas contra el repositorio.
>
> Actualización MVP manual: para la rama `crm-leads-mvp`, el primer corte se limita a captura y seguimiento manual. No incluye conversión a contacto, cotización desde lead, integraciones de Meta, métricas ni automatización.

## Objetivo

Ampliar la gestión comercial hacia ventas B2C iniciadas por WhatsApp e Instagram. Registrar cada oportunidad como una entidad de lead propia, permitir seguimiento humano y crear cotizaciones desde el lead; convertirlo en contacto/cliente cuando corresponda. Empezar con una operación sencilla y gratuita/manual y evolucionar después a integraciones oficiales y asistencia automatizada entrenada sobre información aprobada.

## Alcance

### MVP manual aprobado

- Entidad propia `crm_leads`, aislada por `tenant`, sin reutilizar `crm_contactos`.
- Origen manual WhatsApp/Instagram/otro, bandeja, búsqueda, detalle, responsable, etapa comercial, notas/actividades y próxima acción.
- Etapas observables: `nuevo`, `en_contacto`, `calificado`, `descartado`, `archivado`.
- Responsables posibles: usuarios activos con rol `venta`, `gerencia` o `administracion`.
- Visibilidad por RLS: `superadmin` y `gerencia` con alcance autorizado por tenant, `administracion` dentro de su tenant, `venta` solo sus leads o leads sin responsable de su tenant. `operaciones`, `control_vuelo` y roles externos quedan fuera.
- Sin borrado físico: cierre por `descartado` o `archivado` y bitácora append-only.
- Duplicados reactivos lead-contra-lead por tenant, con teléfono/email/documento normalizados.

### Fases posteriores

- Entidad de lead/oportunidad separada de `crm_contactos`, con identidad y datos de contacto disponibles, canal/origen, interés de viaje, estado comercial, responsable, fechas y bitácora.
- Bandeja y etapas configurables del proceso comercial desde nuevo hasta calificado, cotizado, seguimiento, ganado/perdido y conversión a contacto/cliente.
- Creación de cotización desde un lead y vínculo de cotización, contrato o venta resultante para conservar el recorrido comercial.
- Registro de seguimientos manuales: notas, tareas, próxima acción, fecha de contacto y resultado. Inicio de bajo costo sin exigir API de mensajería.
- Preparación para WhatsApp e Instagram como canales prioritarios. En fase inicial se podrá registrar el canal y la gestión realizada manualmente; conexión automatizada se hará en fase posterior mediante APIs oficiales.
- Automatización gradual: primero sugerencias/respuestas asistidas y derivación a humano; luego automatización acotada tras definir datos de entrenamiento, reglas y autorización.
- Métricas básicas de leads, conversión y tiempos de seguimiento. Administrador de contenido/marketing queda para una fase posterior.

## Fuera de alcance

- Reemplazar el CRM actual de contactos, campañas de correo y difusión.
- Convertir leads a `crm_contactos` en el MVP manual.
- Crear cotizaciones, contratos o ventas desde leads en el MVP manual.
- Consultar o deduplicar contra `crm_contactos` en el MVP manual.
- Enviar mensajes automatizados o conectarse a WhatsApp/Instagram en la primera fase gratuita/manual.
- Scraping, automatización de interfaz de consumidor o mecanismos que evadan APIs y políticas de Meta.
- Entrenar o desplegar un bot autónomo en el MVP.
- Construir el administrador de contenido de marketing en esta iniciativa inicial.
- Cambiar el flujo de venta vigente para todos los usuarios antes de validar la transición y la conversión de lead a contacto.
- Implementar código, SQL, migraciones o actualizar `TASKS.md` en esta etapa documental.

## Estado actual comprobado

- Ya existe un CRM separado en navegación/rutas `/crm`, con contactos, campañas, difusión, carga B2B y configuración de correo; ver [`app/(crm)/layout.tsx`](../../app/(crm)/layout.tsx#L9) y el resumen técnico en [`docs/tecnico/crm-difusion.md`](../tecnico/crm-difusion.md#L5).
- `crm_contactos` almacena contactos y campos como categoría, email, origen y aceptación de publicidad. La migración de contactos se documenta en [`supabase/migrations/20260601000042_crm_contactos.sql`](../../supabase/migrations/20260601000042_crm_contactos.sql#L1).
- Existen campañas de correo y configuración de proveedores de email; las tablas de difusión registran material y planes de envío. Ver [`supabase/migrations/20260601000043_crm_email_config.sql`](../../supabase/migrations/20260601000043_crm_email_config.sql#L1), [`supabase/migrations/20260601000044_crm_campanas.sql`](../../supabase/migrations/20260601000044_crm_campanas.sql#L1) y [`docs/tecnico/crm-difusion.md`](../tecnico/crm-difusion.md#L17).
- La ficha de contacto puede buscar vínculos con ventas por documento, email o nombre en [`app/(crm)/crm/[id]/page.tsx`](../../app/(crm)/crm/[id]/page.tsx#L35), pero esto no es una entidad de lead ni un pipeline B2C.
- Hay etiquetas o campos de canal asociados con WhatsApp e Instagram en la difusión, pero no se comprobó integración de mensajes, webhooks ni conversaciones con APIs de esos canales. Ver [`lib/crm/difusion.ts`](../../lib/crm/difusion.ts).
- Desde la migración 188 (PR #330) el CRM tiene además una consulta de solo lectura de pasajeros de contratos ([`app/(crm)/crm/pasajeros/PasajerosContratoClient.tsx`](../../app/(crm)/crm/pasajeros/PasajerosContratoClient.tsx)), separada de `crm_contactos` y de campañas; tampoco es una entidad de lead.
- El modelo de roles y el acceso a CRM ya existen, pero cualquier pipeline nuevo necesitará políticas propias de visibilidad y asignación; el patrón general de roles está en [`lib/constants.ts`](../../lib/constants.ts#L75).

## Diseño propuesto

### Entidad y conversión

Crear una entidad nueva de lead/oportunidad, distinta de `crm_contactos`. El lead representa una intención comercial y conserva canal, campaña/origen, responsable, producto/destino de interés, estado y actividad. Puede existir con información incompleta o sin un contacto ya consolidado.

Al convertir un lead, el flujo busca posibles contactos existentes por identificadores disponibles, permite elegir un contacto o crear uno, y conserva el vínculo y el historial del lead. La conversión no debe borrar ni reemplazar el registro original. Las cotizaciones y ventas se asocian al lead cuando su flujo lo permita.

### Fase gratuita/manual

Un usuario crea o registra el lead manualmente desde una conversación de WhatsApp o Instagram, anota el canal y el contexto, cambia su estado, agenda el seguimiento y crea una cotización. Esta fase no depende de permisos/tokens de Meta, evita prometer sincronización automática y permite validar campos, etapas y carga operativa antes de pagar una integración.

### Integraciones y asistencia posterior

En una fase posterior, conectar cuentas empresariales usando APIs oficiales y webhooks, vincular mensajes entrantes al lead/contacto correcto y registrar eventos con origen/fecha. La asistencia se incorpora en etapas: respuestas sugeridas con revisión humana; luego automatizaciones limitadas con transferencia clara a una persona. El alcance de “entrenarlo” debe definirse sobre fuentes aprobadas (catálogo, políticas, itinerarios y preguntas frecuentes), con control de versiones y revisión de respuestas.

### Seguimiento y métricas

La vista de trabajo prioriza leads sin responsable, seguimientos vencidos y próximas acciones. El pipeline y las métricas se filtran por canal, responsable, periodo y tenant cuando aplique. Los estados deben medir avance comercial, no sustituir los estados operativos de cotización o contrato.

## Fases

1. **Definición del flujo:** cerrar etapas, responsables, campos mínimos, reglas de duplicados, relación con contactos y permisos; confirmar qué tipos de cotización pueden nacer desde un lead.
2. **Leads y pipeline manual:** alta/edición, búsqueda, asignación, bitácora, etapas, tareas y captura de origen WhatsApp/Instagram sin conexión API.
3. **Lead a cotización y cliente:** crear cotización desde el lead, enlazar resultados comerciales, detectar contacto duplicado y convertir conservando historial.
4. **Seguimiento operativo:** agenda de acciones, alertas internas, vistas por responsable y métricas iniciales de conversión/tiempo.
5. **Integración oficial de canales:** evaluar requisitos y costos de WhatsApp Business Platform e Instagram Messaging, gestión de credenciales, webhooks, consentimiento, errores, reintentos y asociación de conversaciones.
6. **Asistencia entrenada:** sugerencias revisadas por persona, medición de calidad y transferencia a humano; ampliar automatización solo con criterios de aceptación y límites acordados.
7. **Marketing de contenidos:** iniciativa posterior para calendario, piezas y publicación, separada del pipeline de ventas hasta definir su alcance.

## Dependencias

- Confirmar campos mínimos, etapas, reglas de asignación, tratamiento de prospectos sin datos completos y cuándo convertir a contacto.
- Identificar el flujo de cotización que se invocará y si soporta asociar una cotización/venta a la oportunidad comercial.
- Revisar permisos, RLS, auditoría y aislamiento por tenant para leads, tareas e historial.
- Para API: cuentas empresariales y permisos de plataforma, revisión de disponibilidad y condiciones vigentes, configuración segura de secretos, webhooks y proceso de soporte.
- Para asistencia entrenada: fuentes autorizadas y actualizadas, criterios de respuesta, mecanismo de evaluación, supervisión humana y manejo de datos personales.
- Definir responsables comerciales y volumen esperado para establecer métricas útiles y evitar etapas que no reflejen el proceso real.

## Riesgos

- Duplicar contactos o crear leads repetidos al capturar manualmente mensajes de varios canales.
- Confundir un lead con un contacto, o perder historial al convertirlo; por eso la conversión debe ser explícita y reversible mediante vínculos auditables.
- Introducir más estados y trabajo administrativo sin mejorar el tiempo de respuesta o conversión.
- Depender de APIs, permisos o cambios de plataforma con costos y disponibilidad externos.
- Mensajes, webhooks y reintentos pueden duplicar eventos o asociar una conversación con la persona equivocada.
- Respuestas generadas pueden inventar precios, condiciones o disponibilidad; en etapas iniciales deben presentarse como sugerencias y usar información vigente.
- Los datos de conversaciones pueden contener información personal; acceso, retención y exportación requieren reglas claras.

## Permisos

- **Asesor comercial:** crea y actualiza leads asignados, registra actividad y crea cotizaciones desde ellos.
- **Supervisor/gerencia:** consulta y reasigna leads dentro del alcance autorizado, ve métricas y revisa actividad del equipo.
- **Administrador CRM:** configura etapas, campos, integraciones y plantillas; acceso a credenciales limitado y auditado.
- **Automatización/API:** procesa únicamente eventos autorizados y conserva identidad/origen; no debe obtener permisos interactivos más amplios que los necesarios.
- **Aislamiento:** aplicar el ámbito de tenant y las reglas de visibilidad existentes, definiendo explícitamente si los leads son exclusivos del tenant de origen o si hay una vista compartida autorizada. No inferir acceso transversal por el hecho de compartir canales.

## Criterios de aceptación

- Un asesor puede crear un lead separado de `crm_contactos`, indicar WhatsApp o Instagram como origen y registrar el contexto inicial.
- El lead puede asignarse, avanzar por las etapas acordadas y conservar notas, actividades y próximas acciones con autor y fecha.
- Desde un lead se puede iniciar el flujo de cotización seleccionado y volver al lead desde la cotización.
- La conversión a contacto encuentra duplicados probables, permite seleccionar o crear el contacto y mantiene ambos registros vinculados con el historial completo.
- Las vistas de trabajo muestran leads pendientes de atención y seguimientos vencidos sin mezclar sus estados con los estados de contratos/ventas.
- Los usuarios solo consultan los leads permitidos por tenant/rol; las reasignaciones y cambios relevantes quedan registrados.
- La fase inicial opera manualmente sin tokens, APIs ni envíos automáticos de WhatsApp o Instagram.
- La integración posterior procesa eventos con deduplicación, errores visibles y traspaso a una persona; los permisos de canal pueden revocarse sin perder el historial interno.
- Las respuestas asistidas indican su carácter de sugerencia, usan fuentes autorizadas y permiten revisión humana antes de enviarse.
- Marketing de contenidos queda fuera del pipeline inicial y puede planearse sin bloquear la gestión de leads.
