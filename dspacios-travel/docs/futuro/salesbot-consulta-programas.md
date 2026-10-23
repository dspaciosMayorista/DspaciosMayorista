# Salesbot conectado a programas y cotizaciones

> Propuesta para trabajar en una iniciativa y rama independientes. El bot debe consultar la información estructurada del sistema; no se considera que archivos cargados sean la fuente de verdad. Este documento no representa funcionalidad implementada ni autoriza cambios de código, SQL o `TASKS.md`.

## Objetivo

Construir un asistente comercial para responder consultas de viajeros usando los programas, precios, fechas, condiciones y disponibilidad vigentes en D'Spacios Travel. Empezar como piloto supervisado y evolucionar hacia la creación de leads y cotizaciones en el CRM, seguido de integraciones con WhatsApp e Instagram.

## Alcance

- Consultar el catálogo estructurado de programas publicado y la información necesaria para orientar al viajero.
- Obtener fechas, precios y condiciones mediante los mismos servicios o motores confiables que usa el sistema web; no pedir al modelo que invente o calcule tarifas.
- Responder en lenguaje natural con límites explícitos: señalar cuando no encuentra información suficiente y ofrecer transferencia a un asesor.
- Piloto sin canales conectados: interfaz de prueba y/o conversaciones ingresadas manualmente, respuestas sugeridas y revisión humana.
- Evolución para registrar leads, actividades de seguimiento y solicitudes de cotización en el CRM.
- Integración posterior con WhatsApp e Instagram mediante sus APIs oficiales, sujeta a cuentas, permisos, disponibilidad y costos del proveedor.
- Uso de un modelo de IA por API como componente intercambiable; la información comercial permanece en las fuentes del sistema.

## Fuera de alcance

- Reentrenar un modelo desde cero o cargar indiscriminadamente bases de datos y conversaciones.
- Usar documentos estáticos como única fuente de precios, disponibilidad o condiciones que cambian.
- Confirmar reservas, emitir contratos, cobrar o enviar una cotización vinculante sin validación y autorización definidas.
- Automatizar respuestas a clientes en producción durante el piloto.
- Modificar el cotizador o los programas para acomodarlos al bot antes de verificar los flujos existentes.
- Administrador de contenido de marketing, campañas masivas o publicación social.
- Cambios a `TASKS.md` hasta que se apruebe la revisión de los documentos de iniciativas.

## Estado actual comprobado

- El sistema ya tiene un motor de precios para Programas: `pvpPrograma` está en `lib/programas.ts`; la hoja técnica describe su cálculo y relación con campos de programa en [`docs/tecnico/programas-y-cotizacion-manual.md`](../tecnico/programas-y-cotizacion-manual.md#L12).
- Los programas tienen salidas y precios asociados, y hay una ruta diferenciada para cotización manual; la misma hoja explica que son motores separados y documenta la conversión a contrato en [`docs/tecnico/programas-y-cotizacion-manual.md`](../tecnico/programas-y-cotizacion-manual.md#L108).
- El CRM existente tiene contactos, campañas y difusión en una aplicación con layout propio; ver [`app/(crm)/layout.tsx`](../../app/(crm)/layout.tsx#L9) y [`docs/tecnico/crm-difusion.md`](../tecnico/crm-difusion.md#L5).
- El modelo existente `crm_contactos` se usa para contactos, pero no es un pipeline de leads B2C con seguimiento comercial. La tabla está creada en [`supabase/migrations/20260601000042_crm_contactos.sql`](../../supabase/migrations/20260601000042_crm_contactos.sql#L8).
- El sistema distingue tenants y aplica controles de acceso; el Salesbot necesitará resolver el tenant de cada conversación antes de consultar datos comerciales. El patrón de aislamiento está documentado en [`docs/tecnico/multitenant-auth-auditoria.md`](../tecnico/multitenant-auth-auditoria.md#L180).
- No se comprobó una integración de mensajería conversacional con WhatsApp o Instagram ni una entidad de lead del Salesbot en el CRM actual.

## Diseño propuesto

### Fuente de verdad y consultas

El backend ofrece operaciones limitadas para buscar programas publicados, consultar sus detalles y solicitar precios/condiciones al motor existente. El asistente convierte la pregunta en una consulta estructurada; recibe resultados del backend y redacta una respuesta basada en ellos. No obtiene credenciales de base de datos ni consulta tablas sin mediación del backend.

Cada respuesta comercial debe distinguir entre dato consultado y dato no disponible. En particular, solo afirma precio, fecha o disponibilidad cuando el servicio correspondiente devuelve información actual para el tenant y los parámetros requeridos. Si faltan destino, fechas, ocupación u otros datos necesarios, pregunta antes de presentar una cotización.

La biblioteca de conocimiento puede apoyar respuestas sobre políticas, definiciones y orientación, pero los hechos operativos cambiantes (precio, cupos, vigencia y disponibilidad) se consultan en tiempo real en las fuentes del sistema.

### Piloto independiente

El primer piloto vive en una rama de Git propia y tiene una interfaz de pruebas. Usa datos de prueba o un acceso de solo lectura a consultas autorizadas. Registra preguntas, datos recuperados, respuesta, versión del modelo y revisión del asesor para poder evaluar calidad. No envía mensajes al cliente ni modifica registros de producción.

### Integración comercial

Después de validar respuestas, conectar el Salesbot a la entidad de lead prevista en `docs/futuro/crm-leads-whatsapp-instagram.md`. Las acciones para crear lead, registrar seguimiento o preparar cotización se implementan como operaciones explícitas con validación de permisos e idempotencia. En el primer paso, la IA prepara un borrador y el asesor decide guardarlo o enviarlo.

### Canales y transferencia

WhatsApp e Instagram se conectan en una fase posterior mediante integraciones aprobadas oficialmente. Las conversaciones se vinculan con tenant, canal, identificador externo y lead/contacto cuando sea posible. Debe haber una acción visible para transferir a una persona, detener automatizaciones y continuar manualmente.

### Trabajo en otro computador

Usar el mismo repositorio Git y una rama nueva basada en una rama compartida limpia, no en la rama local del indicador de carga. El otro computador debe hacer `fetch` del remoto, crear una rama exclusiva para Salesbot, publicar cambios en esa rama y abrir una revisión antes de integrar. No trasladar el trabajo copiando carpetas ni versionar claves/API tokens; usar variables de entorno locales o el gestor de secretos del despliegue.

## Fases

1. **Descubrimiento del dominio:** trazar desde el catálogo de Programas los datos publicados, salidas, motor de PVP, condiciones y el flujo de cotización; decidir qué consultas existen y cuáles deben reutilizarse.
2. **Contrato de consultas de solo lectura:** definir entradas, salidas, permisos, tenant, errores y vigencia de respuestas para buscar programas, ver detalles y obtener precio/condiciones calculados por el sistema.
3. **Piloto conversacional aislado:** interfaz interna, modelo por API, respuestas con referencias a resultados consultados, escalamiento a asesor y registro para evaluación; sin escritura ni canales externos.
4. **Evaluación con casos reales controlados:** medir exactitud de datos, preguntas de aclaración, respuestas sin soporte, latencia y costo; corregir cobertura de consultas antes de ampliar el acceso.
5. **CRM y cotización asistida:** asociar a leads, guardar seguimientos y crear borradores de cotización con aprobación humana, evitando duplicados y manteniendo trazabilidad.
6. **Canales oficiales:** integrar WhatsApp e Instagram, probar recepción, asociación de conversación, respuestas y handoff en entorno controlado; activar tráfico gradualmente.
7. **Automatización acotada:** habilitar respuestas automáticas solo para intenciones probadas, con límites, monitoreo, apagado rápido y transferencia a asesor.

## Dependencias

- Identificar para cada dato comercial su tabla/servicio fuente y si existe una consulta pública o interna reutilizable para programas, salidas, PVP, vigencia y disponibilidad.
- Definir contexto de tenant por canal/número/cuenta y si el bot atenderá a ambos tenants. No inferir tenant por el texto del usuario.
- Acordar condiciones de cotización, redondeos, moneda, ocupación y campos requeridos para llamar a motores existentes.
- Definir arquitectura de backend y proveedor/modelo de IA, tratamiento de datos, presupuesto máximo y monitoreo de gasto.
- Tener ambiente de prueba, credenciales separadas y datos representativos sin exponer secretos ni información personal innecesaria.
- Para CRM: iniciativa de leads, permisos, política de duplicados y vínculo con cotizaciones/ventas.
- Para canales: cuentas empresariales, permisos y configuración oficiales de Meta, webhooks, ventanas y reglas vigentes, costos por canal y proceso de soporte.

## Riesgos

- Respuestas con precio o disponibilidad desactualizados si se leen datos sin pasar por el motor vigente.
- Ambigüedad entre tenants que exponga datos o tarifas incorrectas.
- Respuesta segura en lenguaje natural que oculte que la consulta falló; las fallas deben convertirse en una abstención y transferencia.
- Cotizaciones duplicadas o incompletas si la IA repite acciones; proteger cada operación de escritura con validación e idempotencia.
- Cambios en programas, reglas de precio, canales o APIs externas pueden alterar las respuestas; registrar versiones y monitorear resultados.
- Costos variables de API de IA y mensajería; definir límites, alertas y apagado por presupuesto.
- Las conversaciones pueden contener datos personales; minimizar datos, restringir acceso y definir retención.
- Empezar con una rama basada en cambios locales no integrados puede arrastrar trabajo ajeno; partir de una referencia compartida limpia y revisar el diff.

## Permisos

- **Asesor:** revisa respuestas, atiende conversaciones transferidas y autoriza acciones comerciales de acuerdo con sus permisos CRM.
- **Supervisor:** consulta métricas y conversaciones autorizadas, reasigna atención y revisa calidad.
- **Administrador del Salesbot:** configura fuentes permitidas, instrucciones, límites y proveedor/modelo; no recibe acceso directo innecesario a datos financieros o secretos.
- **Servicio del bot:** consulta únicamente operaciones de lectura aprobadas y, en fases posteriores, ejecuta acciones CRM explícitas con mínimo privilegio, tenant obligatorio y registro de auditoría.
- **Aislamiento:** todo acceso se resuelve contra el tenant autorizado para la cuenta/canal. Las conversaciones y leads de un tenant no se muestran al otro salvo decisión de negocio y permisos explícitos.

## Criterios de aceptación

- El piloto responde con datos de programas obtenidos del sistema y no presenta como hecho un precio, fecha o disponibilidad que no haya consultado.
- Para obtener una cotización, solicita los parámetros que el motor existente requiere y explica qué dato falta si no puede calcularla.
- Cuando la información está ausente, ambigua o el servicio falla, reconoce la limitación y ofrece transferencia a un asesor.
- Las consultas aplican el tenant correcto y una prueba cruzada confirma que no se devuelve información del otro tenant.
- El piloto no puede modificar programas, reservas, contratos, leads ni cotizaciones.
- Cada respuesta de prueba conserva modelo/versión, consulta ejecutada, resultado usado y evaluación del asesor, sin registrar secretos.
- Las métricas permiten revisar exactitud factual, abstenciones, transferencias, costo y latencia antes de activar canales.
- Las acciones CRM posteriores crean o vinculan un lead y una cotización borrador sin duplicados; el asesor confirma antes de enviar al cliente.
- El handoff detiene respuestas automáticas para la conversación transferida hasta que el flujo acordado la reactive.
- El trabajo puede desarrollarse y revisarse en una rama exclusiva creada desde una base compartida limpia, sin incluir cambios del indicador de carga ni credenciales.
