# CRM de leads — hoja técnica

> Índice: [`README.md`](./README.md) · Relacionado: [`crm-difusion.md`](./crm-difusion.md),
> [`multitenant-auth-auditoria.md`](./multitenant-auth-auditoria.md) ·
> [`historial-tarifas.md`](./historial-tarifas.md) · Propuesta y alcance:
> [`../futuro/crm-leads-whatsapp-instagram.md`](../futuro/crm-leads-whatsapp-instagram.md).
>
> Migración **202** (`supabase/migrations/20260601000202_crm_leads.sql`). **Sin aplicar** en
> ningún entorno remoto y sin fusionar: es el PR #351, en revisión. Debe aplicarse sobre la
> cadena 1→201 + 203 (probado así; no depende de la 203 ni la altera).

## 1. Qué es

Un lead es una **entidad propia**: no es un `crm_contactos`, no genera cotización y no se
convierte en cliente. Sirve para registrar y seguir una oportunidad comercial que llega por
WhatsApp o Instagram y que todavía no es una venta. El módulo es manual: captura el canal, un
contacto, un responsable, una etapa y una bitácora; no manda mensajes ni se conecta a Meta.

| Pieza | Dónde vive |
|---|---|
| Bandeja | `app/(crm)/crm/leads/page.tsx` + `LeadsClient.tsx` |
| Ficha | `app/(crm)/crm/leads/[id]/page.tsx` + `[id]/LeadDetalleClient.tsx` |
| Server actions | `app/(crm)/crm/leads/actions.ts` |
| Catálogos y normalización (TS) | `lib/crm/leads.ts` |
| Tipos de la base | `types/database.ts` (tablas `crm_leads`/`crm_lead_actividades`, funciones `crm_lead_*`) |
| Esquema, RLS y RPC | `supabase/migrations/20260601000202_crm_leads.sql` |
| Preflight / postcheck / rollback | `supabase/scripts/{preflight,postcheck,rollback}_202_crm_leads.sql` |
| Pruebas de comportamiento | `supabase/scripts/pruebas/test_202_crm_leads.sql` (+ `.sh`), `test_202_carreras.sh` |
| Pruebas de cableado | `pruebas/crmLeads.wiring.test.ts`, `pruebas/crmLeadsNormalizacion.test.ts` |
| Prueba de UI (formulario + action reales) | `pruebas/crmLeadsDocumento.react.ts` |

## 2. Modelo de datos

`crm_leads`: `id`, `tenant` (`mayorista`/`minorista`, inmutable), `etapa`, `canal`
(`whatsapp`/`instagram`/`otro`), `nombre`, `telefono`, `email`, `tipo_doc`, `documento`, `interes`,
`origen_detalle`, `notas`, `responsable_id`, `creado_por`, `proxima_accion_at`, `cerrado_at`,
`created_at`, `updated_at`.

- `telefono_norm`, `email_norm` y `documento_norm` son **columnas generadas** por la base
  (`crm_lead_normalizar_*`).
- **Identidad documental = `tipo_doc` + `documento`** (ver §4). `tipo_doc` es un código de
  catálogo cerrado **aprobado por el dueño** (`CC`, `CE`, `TI`, `RC`, `PAS`, `PPT`, `NIT`; mismo catálogo en
  `CRM_LEAD_TIPOS_DOC`). Tres `CHECK` lo atan al dato: tipo y número van **los dos o
  ninguno** (`crm_leads_documento_con_tipo`), el tipo está en el catálogo
  (`crm_leads_tipo_doc_catalogo`) y el número tiene al menos una letra o dígito
  (`crm_leads_documento_normalizable`). Un lead sin documento es válido.
- El **único índice único** (además de la PK) es `uq_crm_leads_tenant_tipo_documento`
  `(tenant, documento_norm, tipo_doc)`, parcial. Teléfono y correo tienen índices de
  **búsqueda** no únicos (`idx_crm_leads_tenant_telefono`, `idx_crm_leads_tenant_email`).
- `etapa` y `cerrado_at` están acoplados por un `CHECK`: las etapas terminales exigen
  `cerrado_at` y las abiertas lo exigen nulo.
- **No hay borrado físico.** Un trigger `BEFORE DELETE` lo prohíbe y no existe policy de
  `DELETE`; un lead se cierra con `descartado` o `archivado`.

`crm_lead_actividades`: bitácora `append-only` (`lead_id`, `tipo`, `cuerpo`,
`proxima_accion_at`, `actor_id`, `actor_email`, `created_at`). Dos triggers `BEFORE UPDATE` y
`BEFORE DELETE` la blindan. `CHECK`: `cambio_etapa` y `reasignacion` pueden ir sin cuerpo;
los demás tipos exigen texto.

### Gotcha: la bitácora no la escribe la app, y `authenticated` no puede

`authenticated` tiene **solo `SELECT`** sobre `crm_leads` y `crm_lead_actividades` (y nada
sobre las secuencias). Con DML abierto, un asesor podía editar un lead sin dejar actividad y
escribir en la bitácora con un `actor_email` inventado: fabricar la traza comercial. Cerrado
el DML, las cinco escrituras son funciones SQL (`crm_lead_crear`, `crm_lead_actualizar`,
`crm_lead_tomar`, `crm_lead_cambiar_etapa`, `crm_lead_registrar_actividad`) y **la bitácora
solo la escriben ellas**. No quedan policies de INSERT/UPDATE/DELETE a propósito: si alguien
restituyera los privilegios por error, la ausencia de policy lo denegaría.

Consecuencia: las RPC son **`SECURITY DEFINER`** (`set search_path = public, pg_temp`), y la
RLS ya no autoriza escrituras. Cada RPC valida por su cuenta, en este orden:

1. `crm_lead_actor()` — el usuario existe y está **activo**, y su rol está en el módulo. Sin
   esto, un JWT vigente de un rol fuera del CRM entraría igual.
2. Visibilidad del lead: `crm_lead_permite_ver(tenant, responsable, actor_id, rol, tenant)`.
3. Transición permitida sobre el responsable **vigente**: `crm_lead_permite_cambiar_responsable`.
4. Responsable resultante válido y de la misma agencia: `crm_lead_responsable_valido`.

La matriz recibe la identidad del actor como parámetros en vez de leer `auth.uid()` dentro de
la propia función: dentro de un `SECURITY DEFINER` conviene no depender de una segunda
lectura de sesión para autorizar.

El resto de helpers (`crm_lead_actor`, `crm_lead_email_de`, `crm_lead_responsable_valido`, los
tres `crm_lead_permite_*`, `crm_lead_tipo_doc_validado`, `crm_lead_duplicado_id` y
`crm_lead_coincidencias`) son `SECURITY DEFINER` **sin `EXECUTE` para `authenticated`**
(tampoco `crm_lead_normalizar_tipo_doc`, que no alimenta ninguna columna generada): se llaman desde dentro de las RPC, que corren como el propietario. El
único abierto es `crm_lead_puede_ver(text, uuid)`, que necesitan las policies de lectura. Esto
importa: `crm_lead_email_de(uuid)` devuelve el correo de un usuario, y con `EXECUTE` abierto
habría servido para sacar el correo de cualquier asesor de cualquier agencia.

### Motivo de la coherencia, no de la seguridad

Las cinco escrituras son `SECURITY DEFINER` por lo anterior, pero el motivo por el que se
agruparon en funciones es la **coherencia**:

- el cambio de negocio y su bitácora se escriben en la **misma transacción**. Con dos llamadas
  separadas desde la app, guardar una actividad con próxima acción podía dejar la nota escrita
  y el lead sin actualizar;
- cada función que actualiza mira `get diagnostics v_filas = row_count`: **cero filas es un
  error**, nunca un éxito silencioso;
- los eventos de bitácora solo se insertan cuando el dato **cambió de verdad**
  (`v_responsable is distinct from v_actual.responsable_id`, `v_actual.etapa = v_etapa`), así
  que guardar dos veces no duplica nada.

### Bloqueo de fila: el "antes" de la bitácora es el real

`crm_lead_actualizar`, `crm_lead_cambiar_etapa` y `crm_lead_registrar_actividad` hacen
`select … for update` **antes** de comprobar permisos y de leer el estado. Dos ediciones
concurrentes se serializan por el candado, y la segunda ve lo que la primera escribió. Sin
esto, la bitácora podría registrar un "antes" obsoleto (`nuevo -> calificado` cuando en
realidad el recorrido fue `nuevo -> en_contacto -> calificado`) y un asesor podría modificar un
lead que otro acababa de tomar, porque su comprobación de visibilidad se habría hecho contra
la lectura previa.

`crm_lead_tomar` no necesita candado previo: su carrera se resuelve con compare-and-set en el
propio `UPDATE` (`and responsable_id is null`), que se evalúa con el bloqueo de fila.

## 3. Permisos

| Rol | Ve | Puede |
|---|---|---|
| `superadmin` / `gerencia` | las dos agencias (misma regla que `puede_ver_tenant`) | crear, editar, reasignar. **No pueden tomar**: su rol no está en la lista comercial de responsable |
| `administracion` | su tenant | lo mismo dentro de su agencia, incluida la reasignación y tomar un lead sin responsable |
| `venta` | su tenant, y solo leads **suyos o sin responsable** | crear, editar los suyos y los sin responsable, registrar actividad, cambiar etapa, **tomar** un lead sin responsable |
| `operaciones`, `control_vuelo`, externos, inactivos | nada | nada |

Helpers: `crm_lead_permite_ver`, `crm_lead_permite_crear`, `crm_lead_permite_cambiar_responsable`
y `crm_lead_responsable_valido(p_usuario, p_tenant)`, todos internos. Los tres primeros son la
matriz de roles; el cuarto valida que el responsable exista, esté **activo**, sea de rol
comercial **y pertenezca al mismo `tenant` que el lead**.

### El responsable tiene que ser de la misma agencia

`crm_lead_responsable_valido` compara `u.tenant = p_tenant`. Se exige en los dos caminos: al
crear (dentro de `crm_lead_permite_crear`) y al reasignar (`crm_lead_actualizar`). No hay
excepción para `superadmin`: su alcada transversal es de *lectura*, no de asignación.

Como el DML directo está cerrado, el rechazo no depende de la policy: es la propia RPC la que
no escribe. Aun así, si se restituyera el privilegio, la policy de solo-`SELECT` filtra la
fila en `UPDATE` y el error de `INSERT` sería explícito.

### Tomar un lead sin responsable

`crm_lead_tomar(bigint)` hace un único `UPDATE … where id = p and responsable_id is null` con
**tres** condiciones de autorización en el `WHERE`.

Las tres son obligatorias y ninguna puede apoyarse en la RLS: la RPC es `SECURITY DEFINER`, así
que la policy de `UPDATE` no autoriza.

| Condición | Qué acota |
|---|---|
| `crm_lead_permite_cambiar_responsable` | que el actor pueda tomar ese lead (`venta` solo sin dueño y en su agencia) |
| `crm_lead_permite_ver` | que el lead esté en un tenant que el actor puede ver |
| `crm_lead_responsable_valido(actor_id, tenant)` | que **el actor, como responsable recién asignado, sea válido en la agencia del lead** |

La tercera es la que no debe faltar. `permite_cambiar_responsable` y `permite_ver` le dan
verde a `superadmin` y a `gerencia` porque ambos tienen alcada transversal, así que sin ella
podían quedarse como responsables de un lead de la otra agencia. Como responsable, el actor
tiene que cumplir la misma regla que si gerencia se lo asignara a mano: activo, rol comercial
(`gerencia`/`administracion`/`venta`) y del mismo tenant que el lead.

Dos consecuencias que conviene tener presentes:

- **Tomar es siempre una operación dentro de la propia agencia**, para cualquier rol.
- **`superadmin` no puede tomar ningún lead**, ni uno de su propia agencia: su rol no está en la
  lista comercial. Puede ver ambos tenants y reasignar al equipo correcto, que es lo que le
  corresponde. Si además de tomar quiere atenderlo, se lo reasigna su equipo o se lo pide a un
  asesor.

`responsable_id is null` se evalúa con el bloqueo de fila: dos asesores que lo intenten a la
vez se serializan, gana uno y el otro recibe cero filas y el error "Ese lead ya tiene
responsable o no te corresponde". Además `crm_lead_permite_cambiar_responsable` exige
`p_anterior is null and p_nuevo = p_actor_id` para `venta`, así que tomar es de una vez y no
se puede repetir ni pasar el lead a otro asesor.

En la ficha el botón "Tomar lead" solo aparece cuando el lead no tiene responsable y el usuario
no tiene permiso de reasignación; **guardar los cambios nunca autoasigna**: quien no puede
reasignar reenvía el responsable que ya tenía.

## 4. Identidad documental y duplicados

Decisión del dueño (#351): **la identidad documental es la pareja TIPO + NÚMERO**. El número
sirve para empezar a buscar, pero nunca identifica por sí solo a la persona: `CC 1020304` y
`TI 1020304` son dos personas distintas (típico: el titular y su hijo).

| Caso (mismo tenant) | Resultado |
|---|---|
| mismo tipo + mismo número (normalizados: `c.c.`→`CC`, `1.020.304`→`1020304`) | **se rechaza** con `crm_lead_duplicado:<id>`; no fusiona ni toca el existente |
| mismo número, distinto tipo | **entra**, con aviso de coincidencia `numero_documento` |
| mismo teléfono o correo | **entra**, con aviso de coincidencia `telefono` / `email` |
| número sin tipo | se rechaza: **no se asume CC** |
| tipo sin número, tipo fuera del catálogo, número sin letras ni dígitos | se rechaza |
| tipo mal formado (`CC2`, `C-C`, `C C`, `..CC`, `cédula`) | se rechaza: **no se limpia** hasta parecer un tipo válido |
| sin tipo ni número | válido (lead todavía sin documento) |
| cualquier dato repetido en la **otra** agencia | no es duplicado ni coincidencia |

Teléfono y correo **no son únicos** porque varias personas los comparten (el WhatsApp del papá,
el correo de la casa, la empresa): bloquear por ellos impedía registrar a la segunda persona.

**Cómo se aplica.** `crm_lead_tipo_doc_validado(tipo, numero)` valida la pareja y devuelve el
tipo normalizado (las mismas reglas que los `CHECK`, con mensaje claro); `crm_lead_crear` y
`crm_lead_actualizar` la llaman **después** de autorizar al actor. El único `unique_violation`
posible es el documental: la RPC lo captura y lanza `crm_lead_duplicado:<id>`; `actions.ts` lo
traduce a "Ya existe otro lead con ese tipo y numero de documento (#id)". La carrera entre dos
altas simultáneas del mismo tipo + número la resuelve el índice único: la segunda espera a que
la primera confirme y choca (`test_202_carreras.sh`, C6).

`crm_lead_duplicado_id(tenant, tipo, numero_norm, excluir, actor…)` **solo devuelve el id si el
actor puede ver ese lead**: si el duplicado es de otro asesor, el mensaje sale genérico. Decir
"ya existe el lead #7" filtraría la cartera ajena justo en el intento de verla. `excluir` es el
propio lead al editar, para que guardar sin cambios no choque consigo mismo.

**Coincidencias (aviso, no bloqueo).** `crear` y `actualizar` devuelven
`{ id, coincidencias: [{ id, por: ["telefono" | "email" | "numero_documento"] }] }`, calculado
por `crm_lead_coincidencias` (máx. 5, mismo tenant, excluye el propio lead). Con la misma
regla que el duplicado, **solo lista leads que el actor ve**: el aviso no sirve para sondear
la cartera de otro asesor. La UI lo muestra en ámbar ("Comparte datos con #7 (teléfono)…
Revisa si es la misma persona; no se fusionó nada"). Fusionar queda fuera de alcance.

**Normalización del tipo.** La única variante de puntuación admitida es la sigla con puntos:
letras separadas por **un** punto, con punto final opcional (`c.c.`, `C.C`, `p.a.s.`), más
espacios alrededor y cualquier combinación de mayúsculas. Eso se reduce a `CC`/`PAS`. Cualquier
otra forma sale de `crm_lead_normalizar_tipo_doc` **sin limpiar** (recortada y en mayúscula) para
que el catálogo la rechace: antes se borraba todo lo que no fuera letra y `CC2` terminaba como
`CC`, cambiando en silencio la identidad de la persona. `normalizarTipoDocLead` (TS) usa la misma
expresión; `crmLeads.wiring.test.ts` falla si se separan.

En la interfaz el selector de tipo **arranca vacío** en el alta (no hay CC por defecto) y con
el tipo guardado en la ficha; la bandeja muestra y busca el documento como `CC 1020304`.
`validarDocumentoLead` (`lib/crm/leads.ts`) repite la validación en la Server Action para no
gastar un viaje; la base vuelve a validarla.

### Edición = formulario completo

`crm_lead_actualizar` reemplaza **todos** los campos editables con lo que recibe (un campo vacío
significa "borrarlo"). Por eso exige las **once claves** (`canal`, `nombre`, `telefono`, `email`,
`tipo_doc`, `documento`, `interes`, `origen_detalle`, `notas`, `responsable_id`,
`proxima_accion_at`), cada una texto o `null`. Un JSON parcial —p. ej. solo `responsable_id`— se
rechaza con `crm_lead_payload_incompleto: faltan …` (y un valor que no es texto con
`crm_lead_payload_invalido: …`) **después de autorizar al actor y antes de bloquear o modificar la
fila**: antes vaciaba en silencio teléfono, correo, documento y notas. El cast del responsable a
`uuid` ocurre después de esa comprobación.

En la app, `validarEntradaLead(input, modo)` (`lib/crm/leads.ts`) valida la entrada de
`crearLead` y `actualizarLead`, que se pueden invocar desde el navegador con cualquier payload:
objeto, solo claves conocidas, valores de texto, nombre, canal, documento, responsable con forma
de `uuid` y fecha legible. Los dos modos se distinguen también en los tipos:

| Acción | Tipo de entrada | Modo | Clave ausente |
|---|---|---|---|
| `crearLead` | `LeadCrearInput` (opcionales omitibles) | `"crear"` | se completa vacía: un lead nuevo no tiene datos que borrar |
| `actualizarLead` | `LeadFormularioCompleto` (las once claves obligatorias) | `"editar"` | **error antes de llamar a Supabase**; no se rellena con `""` |

En edición, rellenar una clave ausente con `""` convertía `actualizarLead(id, { nombre, canal })`
en un formulario aparentemente completo que la RPC aceptaba y que borraba teléfono, correo,
documento y notas. Ahora una clave ausente (o `undefined`) se rechaza con "Faltan campos del
formulario del lead: … No se modifico nada."; un campo **presente** y vacío (`""` o `null`) sí
limpia el dato. El tipo no basta: la comprobación es de runtime, y la RPC la repite.

En los dos modos la salida trae siempre las once claves, que es lo que `datosLead` envía a la RPC.
Las acciones que reciben un id (`actualizarLead`, `tomarLead`, `cambiarEtapaLead`,
`agregarActividadLead`) exigen un entero positivo antes de llamar a la base. Un script o
integración futura que edite leads tiene que mandar el formulario completo (leer el lead,
cambiar lo que haga falta, reenviar todo).

## 5. Auditoría

La 202 instala `trg_auditoria` (`fn_auditoria` de la 087/108) **solo** en `crm_leads` y
`crm_lead_actividades`, con dos `create trigger` explícitos. No recorre `pg_tables` como hace
la 087: hacerlo colgaría el trigger de todas las tablas nuevas de otras migraciones, incluidos
los historiales inmutables de la 203, duplicando cada versión en `auditoria`.

Verificación cruzada: `postcheck_203_tarifas_generacion_acotada.sql` re-corriendo después de la
202 sigue dando `true` en "historiales sin triggers propios", y
`postcheck_202_crm_leads.sql` lo comprueba desde el otro lado.

## 6. Pruebas

| Qué | Dónde | Cómo corre |
|---|---|---|
| Comportamiento con usuarios, roles y las dos agencias | `supabase/scripts/pruebas/test_202_crm_leads.sql` | `sh supabase/scripts/pruebas/test_202_crm_leads.sh [contenedor]` — monta una base desechable con la cadena 1→201 + 203 + 202, corre el SQL y la borra |
| Carrera real: tomar un lead, editarlo recién tomado, dos cambios de etapa a la vez y altas documentales simultáneas | `supabase/scripts/pruebas/test_202_carreras.sh` | `sh supabase/scripts/pruebas/test_202_carreras.sh [contenedor]` — conexiones reales; mide que la segunda espera el candado, que la bitácora encadena las etapas sin "antes" obsoleto, que dos altas del mismo tipo + número se serializan en el índice (una gana, la otra se rechaza) y que mismo número con otro tipo + mismo teléfono entran las dos sin esperarse |
| Cableado en TS | `pruebas/crmLeads.wiring.test.ts` | `pnpm test:unit` |
| Normalización e identidad documental en TS | `pruebas/crmLeadsNormalizacion.test.ts` | `pnpm test:unit` |
| Formulario real + Server Action real (tipo vacío por defecto, número sin tipo o tipo mal formado no viajan, aviso de coincidencias, duplicado con/sin id, rol fuera del módulo, entrada e id inválidos; edición parcial rechazada sin llamar a la RPC y con los datos previos intactos, formulario completo aceptado, alta con opcionales omitidos) | `pruebas/crmLeadsDocumento.react.ts` | `pnpm test:react` |

Todas las SQL corren **contra una base local desechable** y terminan en `ROLLBACK` (o borran la
base). Ninguna toca Supabase remoto ni un Preview, que comparte base con Producción. El runner
de la prueba de carreras es un `.sh` para un entorno con Docker y PostgreSQL locales; en
Windows sin WSL hay que correr los dos archivos con `docker exec` a mano.

## 7. Rollback

`supabase/scripts/rollback_202_crm_leads.sql` **se niega sin cambiar nada si hay leads o
actividades**: la bitácora comercial es el único registro de esos contactos y un
`drop ... cascade` la destruiría en silencio. Con el módulo vacío retira solo objetos propios:
el trigger de auditoría de sus dos tablas, las dos tablas **sin `CASCADE`** (si algo ajeno las
referenciara, falla en vez de arrastrarlas) y las 23 funciones `crm_lead_*` (más, si quedó en una
base local, la firma de `crm_lead_duplicado_id` de un borrador anterior sin tipo de documento).

## 8. Gotchas

- El layout `/crm` solo exige sesión: **cada ruta y cada action validan el rol por su cuenta**.
  La entrada de menú "Leads" no autoriza a nadie.
- `authenticated` no puede escribir en las dos tablas. Si alguna vez hace falta un script de
  mantenimiento, que sea por `service_role` o restaurando el privilegio a propósito: con las
  RPC no se puede escribir "un cambio" suelto sin pasar por la lógica de negocio.
- El `tenant` de un lead se toma del contexto de agencia (`tenantContext()`) al crear y es
  **inmutable** después; hay un trigger que lo rechaza.
- `proxima_accion_at` se escribe en dos sitios a propósito: al guardar la ficha (edición) y al
  registrar una actividad con próxima acción. Ambas rutas son la misma operación atómica.
- La migración es idempotente para el esquema (`if not exists` / `create or replace`): aplicarla
  dos veces no rompe nada, pero el preflight avisa si el módulo ya estaba **o si quedó alguna
  función `crm_lead_*` de un borrador anterior** (`create or replace` con otra firma crea una
  sobrecarga, no reemplaza).
- Teléfono y correo **nunca** deben volver a ser únicos, ni el número de documento sin el tipo:
  el postcheck y `crmLeads.wiring.test.ts` fallan si aparece un índice único así.