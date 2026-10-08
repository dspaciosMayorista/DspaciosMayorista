# CRM de leads, WhatsApp e Instagram

> **Estado: el MVP manual está construido y en revisión (PR #351).** Lo que YA EXISTE
> en código es la sección "MVP manual implementado" más abajo: entidad propia de
> leads, bitácora, etapas y captura manual. **Lo que sigue siendo propuesta** es todo
> lo demás del documento (conversión a contacto/cotización, integraciones de Meta,
> automatización y marketing de contenidos). Nada de eso está autorizado ni
> estimado; pasa a la cola solo si el usuario lo decide expresamente.
>
> La migración `20260601000202_crm_leads.sql` **no está aplicada en ningún entorno**
> (ni remoto ni local) y el PR no está fusionado. Los criterios de aceptación se
> separan en dos bloques: los del MVP, que son los verificables hoy, y los de las
> fases futuras, que no aplican a este corte.
>
> Revisado el 2026-10-05: alcance del MVP y criterios de aceptación separados.

## Objetivo

Ampliar la gestión comercial hacia ventas B2C iniciadas por WhatsApp e Instagram. Registrar cada oportunidad como una entidad de lead propia, permitir seguimiento humano y crear cotizaciones desde el lead; convertirlo en contacto/cliente cuando corresponda. Empezar con una operación sencilla y gratuita/manual y evolucionar después a integraciones oficiales y asistencia automatizada entrenada sobre información aprobada.

## Alcance

### MVP manual implementado (PR #351, migración 202)

- Entidad propia `crm_leads` + bitácora `crm_lead_actividades`, aisladas por `tenant`, sin
  reutilizar `crm_contactos`. Rutas en `/crm/leads` (bandeja) y `/crm/leads/[id]` (ficha).
- Origen manual `whatsapp` / `instagram` / `otro`, búsqueda, detalle, responsable, etapa
  comercial, notas/actividades y próxima acción.
- Etapas observables: `nuevo`, `en_contacto`, `calificado`, `descartado`, `archivado`.
- Responsables posibles: usuarios activos con rol `venta`, `gerencia` o `administracion`
  **y del mismo `tenant` que el lead**. La asignación entre agencias se rechaza en la base,
  incluso por DML directo.
- Visibilidad por RLS: `superadmin` y `gerencia` con alcance transversal (la misma regla que
  `puede_ver_tenant` en el resto del producto), `administracion` dentro de su tenant, `venta`
  solo sus leads o los sin responsable de su tenant. `operaciones`, `control_vuelo` y roles
  externos quedan fuera, igual que los usuarios inactivos.
- Un asesor puede **tomar para sí un lead sin responsable de su tenant**, una sola vez: no
  puede quitárselo ni pasárselo a otro asesor. La carrera entre dos asesores la resuelve el
  propio `UPDATE` (`where responsable_id is null`), no un chequeo previo. Tomarse un lead exige
  cumplir la misma regla que si se lo asignaran: usuario activo, rol comercial y **del mismo
  tenant que el lead**. Por eso `superadmin` y `gerencia` no pueden tomar leads de la otra
  agencia (ni de la propia: su rol no es comercial), aunque sí puedan verlas y reasignarlas a
  su equipo.
- `authenticated` solo **lee** las dos tablas: cualquier escritura pasa por las funciones SQL
  del módulo, que validan usuario activo, rol, tenant, visibilidad y transición, y escriben
  el cambio y su bitácora en la misma transacción. Así no hay forma de editar un lead sin
  dejar rastro ni de escribir en la bitácora con un autor inventado.
- Sin borrado físico: cierre por `descartado` o `archivado` (que sella `cerrado_at`) y bitácora
  append-only. Ni la RLS ni el trigger permiten borrar ni reescribir la bitácora.
- Identidad documental = **tipo + número** de documento (decisión del dueño). Dentro del
  mismo `tenant` se rechaza el mismo tipo + número (normalizados), sin fusionar; el mismo
  número con otro tipo es otra persona y entra. Un número exige tipo explícito (no se asume
  CC) y un lead sin documento sigue siendo válido. Teléfono y correo **no** bloquean: varias
  personas pueden compartirlos, así que solo devuelven un aviso de coincidencia. El rechazo y
  el aviso solo nombran leads que el actor puede ver. Un tipo mal formado (`CC2`) se rechaza;
  solo se admite la sigla con puntos (`c.c.`).
- La edición es de formulario completo: la función de edición exige todos los campos y rechaza
  un payload parcial sin tocar la fila (antes vaciaba en silencio los campos omitidos).
- Las escrituras van por funciones SQL: el cambio de negocio y su bitácora se escriben en la
  misma transacción, ninguna operación devuelve éxito si su `UPDATE` afecta cero filas, los
  eventos de bitácora no se duplican cuando el dato no cambió, y la fila se bloquea antes de
  leer el estado para que el "antes" que registra la bitácora sea el real.
- Auditoría genérica (`fn_auditoria`) instalada **solo** en las dos tablas del CRM, para no
  duplicar en `auditoria` los historiales inmutables de la migración 203.

### Propuesta posterior (NO implementada, no estimada, no autorizada)

Todo lo de las "Fases posteriores", de "Diseño propuesto" y de "Fases" más abajo sigue siendo
borrador documental: conversión a contacto, cotización desde el lead, integraciones de Meta,
automatización, métricas y marketing de contenidos. El MVP manual no incluye ninguna de ellas.

### Fases posteriores

- Entidad de lead/oportunidad separada de `crm_contactos`, con identidad y datos de contacto disponibles, canal/origen, interés de viaje, estado comercial, responsable, fechas y bitácora.
- Bandeja y etapas configurables del proceso comercial desde nuevo hasta calificado, cotizado, seguimiento, ganado/perdido y conversión a contacto/cliente.
- Creación de cotización desde un lead y vínculo de cotización, contrato o venta resultante para conservar el recorrido comercial.
- Registro de seguimientos manuales: notas, tareas, próxima acción, fecha de contacto y resultado. Inicio de bajo costo sin exigir API de mensajería.
- Preparación para WhatsApp e Instagram como canales prioritarios. En fase inicial se podrá registrar el canal y la gestión realizada manualmente; conexión automatizada se hará en fase posterior mediante APIs oficiales.
- Automatización gradual: primero sugerencias/respuestas asistidas y derivación a humano; luego automatización acotada tras definir datos de entrenamiento, reglas y autorización.
- Métricas básicas de leads, conversión y tiempos de seguimiento. Administrador de contenido/marketing queda para una fase posterior.

## Fuera de alcance

Del MVP manual (verificado: el PR #351 no lo toca):

- Reemplazar el CRM actual de contactos, campañas de correo y difusión.
- Convertir leads a `crm_contactos`.
- Crear cotizaciones, contratos o ventas desde leads.
- Consultar o deduplicar contra `crm_contactos`.
- Enviar mensajes automatizados o conectarse a WhatsApp/Instagram.
- Scraping, automatización de interfaz de consumidor o mecanismos que evadan APIs y políticas de Meta.
- Entrenar o desplegar un bot autónomo.
- Construir el administrador de contenido de marketing.
- Cambiar el flujo de venta vigente para todos los usuarios.

De este documento en general (sigue en pie):

- Implementar las fases futuras sin que el usuario lo decida expresamente: son propuestas, no
  un pendiente priorizado, y no autorizan cambios de código, SQL, datos ni `TASKS.md`.

## Estado actual comprobado

- Ya existe un CRM separado en navegación/rutas `/crm`, con contactos, campañas, difusión, carga B2B y configuración de correo; ver [`app/(crm)/layout.tsx`](../../app/(crm)/layout.tsx#L9) y el resumen técnico en [`docs/tecnico/crm-difusion.md`](../tecnico/crm-difusion.md#L5).
- `crm_contactos` almacena contactos y campos como categoría, email, origen y aceptación de publicidad. La migración de contactos se documenta en [`supabase/migrations/20260601000042_crm_contactos.sql`](../../supabase/migrations/20260601000042_crm_contactos.sql#L1).
- Existen campañas de correo y configuración de proveedores de email; las tablas de difusión registran material y planes de envío. Ver [`supabase/migrations/20260601000043_crm_email_config.sql`](../../supabase/migrations/20260601000043_crm_email_config.sql#L1), [`supabase/migrations/20260601000044_crm_campanas.sql`](../../supabase/migrations/20260601000044_crm_campanas.sql#L1) y [`docs/tecnico/crm-difusion.md`](../tecnico/crm-difusion.md#L17).
- La ficha de contacto puede buscar vínculos con ventas por documento, email o nombre en [`app/(crm)/crm/[id]/page.tsx`](../../app/(crm)/crm/[id]/page.tsx#L35), pero esto no es una entidad de lead ni un pipeline B2C.
- Hay etiquetas o campos de canal asociados con WhatsApp e Instagram en la difusión, pero no se comprobó integración de mensajes, webhooks ni conversaciones con APIs de esos canales. Ver [`lib/crm/difusion.ts`](../../lib/crm/difusion.ts).
- Desde la migración 188 (PR #330) el CRM tiene además una consulta de solo lectura de pasajeros de contratos ([`app/(crm)/crm/pasajeros/PasajerosContratoClient.tsx`](../../app/(crm)/crm/pasajeros/PasajerosContratoClient.tsx)), separada de `crm_contactos` y de campañas; tampoco es una entidad de lead.
- El modelo de roles y el acceso a CRM ya existen, pero cualquier pipeline nuevo necesitará políticas propias de visibilidad y asignación; el patrón general de roles está en [`lib/constants.ts`](../../lib/constants.ts#L75).

## Diseño propuesto

> A partir de aquí **todo es propuesta, no descripción de lo que hay**. La entidad de lead,
> la captura manual, el responsable, la etapa, la bitácora y la próxima acción YA existen en
> el MVP del PR #351; lo que sigue describe hacia dónde podría evolucionar.

### Entidad y conversión

Crear una entidad nueva de lead/oportunidad, distinta de `crm_contactos`. El lead representa una intención comercial y conserva canal, campaña/origen, responsable, producto/destino de interés, estado y actividad. Puede existir con información incompleta o sin un contacto ya consolidado.

Al convertir un lead, el flujo busca posibles contactos existentes por identificadores disponibles, permite elegir un contacto o crear uno, y conserva el vínculo y el historial del lead. La conversión no debe borrar ni reemplazar el registro original. Las cotizaciones y ventas se asocian al lead cuando su flujo lo permita.

### Fase gratuita/manual

Un usuario crea o registra el lead manualmente desde una conversación de WhatsApp o Instagram, anota el canal y el contexto, cambia su estado, agenda el seguimiento y crea una cotización. Esta fase no depende de permisos/tokens de Meta, evita prometer sincronización automática y permite validar campos, etapas y carga operativa antes de pagar una integración.

> Parcialmente construido: el MVP del PR #351 cubre crear, anotar, cambiar etapa y agendar
> seguimiento. La creación de cotización desde el lead NO está implementada.

### Integraciones y asistencia posterior

En una fase posterior, conectar cuentas empresariales usando APIs oficiales y webhooks, vincular mensajes entrantes al lead/contacto correcto y registrar eventos con origen/fecha. La asistencia se incorpora en etapas: respuestas sugeridas con revisión humana; luego automatizaciones limitadas con transferencia clara a una persona. El alcance de “entrenarlo” debe definirse sobre fuentes aprobadas (catálogo, políticas, itinerarios y preguntas frecuentes), con control de versiones y revisión de respuestas.

### Seguimiento y métricas

La vista de trabajo prioriza leads sin responsable, seguimientos vencidos y próximas acciones. El pipeline y las métricas se filtran por canal, responsable, periodo y tenant cuando aplique. Los estados deben medir avance comercial, no sustituir los estados operativos de cotización o contrato.

## Fases

1. **Definición del flujo:** cerrar etapas, responsables, campos mínimos, reglas de duplicados, relación con contactos y permisos; confirmar qué tipos de cotización pueden nacer desde un lead.
2. **Leads y pipeline manual:** alta/edición, búsqueda, asignación, bitácora, etapas, tareas y captura de origen WhatsApp/Instagram sin conexión API. → **Implementado en el MVP (PR #351), salvo "tareas" como bandeja propia: la próxima acción vive en el lead y en la bitácora, sin entidad de tarea separada.**
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

Implementados en el MVP (migración 202):

- **`venta`:** crea leads en su tenant (sin responsable o a su propio nombre), actualiza los
  suyos y los sin responsable de su agencia, registra actividad, cambia etapa y **toma** un
  lead sin responsable una sola vez. No ve la cartera de otros asesores ni de otra agencia.
- **`administracion`:** lo mismo dentro de su tenant, y además puede reasignar a cualquier
  asesor de ESA agencia. No puede asignar entre agencias.
- **`superadmin` y `gerencia`:** alcance transversal (igual que `puede_ver_tenant` en el resto
  del producto) y reasignación, pero siempre con un responsable del mismo tenant que el lead. No
  pueden **tomar** leads: su rol no es comercial, así que añadirlos como responsables cruzaría
  la regla de la agencia.
- **Fuera del módulo:** `operaciones`, `control_vuelo`, roles externos (`agencia`,
  `freelance`, `cliente_final`) y usuarios inactivos. No leen ni escriben nada.

Propuestos para fases posteriores (no implementados):

- **Administrador CRM:** configura etapas, campos, integraciones y plantillas; acceso a
  credenciales limitado y auditado.
- **Automatización/API:** procesa únicamente eventos autorizados y conserva identidad/origen;
  no debe obtener permisos interactivos más amplios que los necesarios.
- **Aislamiento transversal:** hoy la vista compartida entre agencias es solo de `gerencia` y
  `superadmin`, por coherencia con el resto del producto. Ampliarla a otros roles es una
  decisión aparte, no una consecuencia de compartir canales.

## Criterios de aceptación

### Del MVP manual (los que este PR tiene que cumplir)

- [x] Un asesor crea un lead separado de `crm_contactos`, con origen WhatsApp/Instagram/otro y
  contexto inicial, y la operación deja su registro en la bitácora.
- [x] El lead avanza por las etapas acordadas; `descartado` y `archivado` sellan el cierre.
- [x] Notas, actividades y próximas acciones se conservan con autor y fecha; la bitácora no se
  edita ni se borra por ninguna vía.
- [x] Un asesor sin permiso de reasignación puede tomar un lead sin responsable de su agencia y
  queda como responsable. No puede quitárselo, pasárselo a otro ni tomar dos veces el mismo.
- [x] Tomar exige rol comercial y tenant válido: `superadmin` y `gerencia` no pueden tomar
  leads de la otra agencia ni de la propia, aunque sí verlos y reasignarlos a su equipo.
- [x] Los usuarios solo consultan los leads permitidos por tenant y rol, y `operaciones`,
  `control_vuelo`, externos e inactivos no ven nada.
- [x] Toda reasignación, toma y cambio de etapa queda registrado exactamente una vez.
- [x] Un cambio de negocio y su bitácora se escriben juntos: si la bitácora falla, el cambio no
  queda, y una operación que afecta cero filas devuelve error en vez de un falso éxito.
- [x] `authenticated` no puede escribir directamente en las tablas de leads ni de bitácora, ni
  siquiera en su propio tenant: todo cambio pasa por las funciones del módulo, de modo que no
  se puede editar un lead sin dejar rastro ni escribir una actividad con un autor inventado.
- [x] Dos personas que editan el mismo lead a la vez no producen una bitácora con un "antes"
  obsoleto, y un asesor no puede modificar un lead que otro acaba de tomar.
- [x] No se puede asignar a un responsable de otra agencia, ni siquiera llamando a la base
  directamente; tampoco a un usuario inactivo o de rol no comercial.
- [x] Un duplicado es el mismo tipo + número de documento dentro del mismo tenant: se
  rechaza sin fusionar, y se permite entre agencias; el mismo número con otro tipo entra; el
  mensaje no revela el id de un lead que el actor no puede ver.
- [x] Varias personas pueden compartir teléfono o correo: el alta entra y solo se avisa la
  coincidencia (con leads que el actor ve), nunca se bloquea.
- [x] La fase inicial opera manualmente, sin tokens, APIs ni envíos de WhatsApp o Instagram.

Cómo se verifican: `supabase/scripts/pruebas/test_202_crm_leads.sql` (comportamiento con
usuarios, roles y las dos agencias), `supabase/scripts/pruebas/test_202_carreras.sh` (dos
conexiones reales compitiendo por el mismo lead o por el mismo documento),
`preflight_202_crm_leads.sql`, `postcheck_202_crm_leads.sql`, el postcheck de la 203
re-corrido después de la 202, `pruebas/crmLeads.wiring.test.ts`,
`pruebas/crmLeadsNormalizacion.test.ts` y `pruebas/crmLeadsDocumento.react.ts`. Todo local y desechable; nada se ha aplicado en remoto.

### De las fases futuras (no aplican a este corte)

- [ ] Desde un lead se puede iniciar el flujo de cotización seleccionado y volver al lead desde
  la cotización.
- [ ] La conversión a contacto encuentra duplicados probables, permite seleccionar o crear el
  contacto y mantiene ambos registros vinculados con el historial completo.
- [ ] Las vistas de trabajo muestran leads pendientes de atención y seguimientos vencidos sin
  mezclar sus estados con los estados de contratos/ventas.
- [ ] La integración de canales procesa eventos con deduplicación, errores visibles y traspaso a
  una persona; los permisos de canal pueden revocarse sin perder el historial interno.
- [ ] Las respuestas asistidas indican su carácter de sugerencia, usan fuentes autorizadas y
  permiten revisión humana antes de enviarse.
- [ ] Marketing de contenidos queda fuera del pipeline inicial y puede planearse sin bloquear la
  gestión de leads.
