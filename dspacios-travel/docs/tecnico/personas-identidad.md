# Registro central de personas e identidad documental (#32)

Estado (2026-10-19):
- **#32 / migración 214:** fusionada en `main` `862edf42` (PR #363, squash de `d47eec0b`); Actions run
  `39151910521` en verde (71 OK / 0 fallos reportados). El dueño reportó preflight, aplicación y postcheck en
  Producción (G0 cerrado por su testimonio en `WORKSTREAMS.md`); este documento no lo verificó por SQL. No
  reaplicar la 214.
- **#42 / migración 219 (personas de cotizaciones en el CRM):** implementada SOLO en local en el worktree
  `personas-cotizaciones-42` (rama `codex/42-personas-cotizaciones`, base `main` `87beb622`). Pruebas TS locales;
  SQL, API, carreras y rollback se ejecutan en GitHub Actions (workflow `test-personas-cotizaciones-42.yml`),
  todavía SIN correr. Pendiente de Auditorías y Coordinador antes de Draft PR; sin staging, commit, push ni SQL
  remoto. Detalle en la sección 8.

Lo que sigue (secciones 1-7) es el contrato v3 de #32, con los dos ajustes obligatorios de su aprobación (base
NIT de 3-20 y variantes acotadas; sección 6), anotado donde #42 lo cambió.

Alcance de #32: el registro central, su gramática documental y una consulta exacta y segura.
Fuera de alcance: escritura desde cotizaciones y vínculos (#42), adaptador histórico para #40,
backfill, UI, loaders, `package.json`, migraciones 042/047/154/187/202/207.

---

## 1. Modelo fuente - persona - observación y proyección por rol

### 1.1 Qué se almacena

| Objeto | Qué es | Qué NO es |
|---|---|---|
| `personas` | **Una** identidad documental por `(tenant, tipo_doc, numero_norm)`. Solo identidad: tenant, tipo y número **originales** tal como se capturaron, tipo/número normalizados, estado y marcas de tiempo. | No guarda nombres, fechas de nacimiento, teléfonos, correos **ni el DV del NIT**. |
| `persona_capturas` | **Una captura concreta** de una fuente sobre una persona. Su `id` (UUID) es el **identificador estable de la captura**: lo aporta el escritor y lo repite en cada reintento del mismo evento. Guarda la procedencia **una sola vez**: fuente, nivel, clave de origen tipada por fuente, el documento tal como lo afirmó esa captura, actor y fecha. Append-only. | No es `contrato_numero` ni otra clave de negocio: esas son columnas de **origen**, no la identidad de la captura. |
| `persona_observaciones` | Pares `(campo, valor)` aportados por **una** captura (`captura_id`). Append-only. Dos capturas que coinciden o que discrepan generan filas distintas: la procedencia nunca se colapsa y nunca gana la primera ni la más reciente. | No es una proyección ni un "perfil consolidado". |
| Fuente | `captura_interna` y `contrato_pasajero` en V1, escritas solo por funciones privadas de `service_role`; ningún flujo de la app las llama. `cotizacion` la agrega la 219 (#42): solo la escriben sus fachadas (sección 8), con origen tipado `cotizacion_id` + `participante_ref` + `rol`. | `crm_leads`, `crm_contactos`, `ventas` y `aliados` NO son fuentes (ver 1.4). |

Separar identidad (1 fila), capturas (N por persona) y observaciones (N por captura) distingue "una
persona central única" de "varias observaciones autorizadas": el índice único protege lo primero; lo
segundo es deliberadamente multivaluado y la consulta lo devuelve como variantes con su captura de origen.

### 1.2 Esquema (implementado en la 214; antes comprobado con un stub en 3.7)

```sql
create schema p214_priv;   -- gramática, filtro de visibilidad y escritores privados (1.4)

create table public.personas (
  id                  uuid primary key default gen_random_uuid(),
  tenant              text not null check (tenant in ('mayorista','minorista')),
  -- Originales TAL COMO LLEGARON (R0). NULL = no se envió. Se conservan aunque el tipo no esté en el
  -- catálogo (CC2, C.C., cédula). Máximo 64 puntos de código.
  tipo_doc_original   text null check (tipo_doc_original  is null or char_length(tipo_doc_original)  <= 64),
  documento_original  text null check (documento_original is null or char_length(documento_original) <= 64),
  nit_dv_estructurado boolean not null default false,   -- solo el escritor la pone en true, tras dv_nit_valido (2.3)
  -- Generadas: las cuatro desde columnas BASE de la fila; ninguna lee otra generada.
  tipo_doc        text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).tipo_doc)    stored,
  numero_norm     text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).numero_norm) stored,
  estado_doc      text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).estado)      stored,
  motivo_revision text generated always as ((p214_priv.norm_documento(tipo_doc_original, documento_original, nit_dv_estructurado, 'alta')).motivo)      stored,
  clave_alta      uuid null,   -- = id de la captura que creó una ficha NO documentada (3.3); NULL si nació documentada
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint personas_id_tenant_uk unique (id, tenant),   -- destino de la FK compuesta de las capturas
  constraint personas_nit_dv_estructurado_ck
    check (nit_dv_estructurado = false or (tipo_doc is not null and tipo_doc = 'NIT'))
);
create unique index uq_personas_clave_documentada on public.personas (tenant, tipo_doc, numero_norm)
  where estado_doc = 'documentada';
create unique index uq_personas_clave_alta on public.personas (tenant, clave_alta)
  where clave_alta is not null;

create table public.persona_capturas (
  id                   uuid primary key,   -- identificador ESTABLE de la captura: lo aporta el escritor
  persona_id           uuid not null,
  tenant               text not null,
  fuente               text not null check (fuente in ('captura_interna','contrato_pasajero')),
  nivel                text not null check (nivel in ('comercial','pasajero_contrato')),
  -- Documento tal como lo afirmó ESTA captura (R0): una promoción posterior de la persona no lo borra.
  tipo_doc_capturado   text null check (tipo_doc_capturado  is null or char_length(tipo_doc_capturado)  <= 64),
  documento_capturado  text null check (documento_capturado is null or char_length(documento_capturado) <= 64),
  -- Origen tipado por fuente. NO es la identidad de la captura.
  contrato_numero      text   null,
  contrato_pasajero_id bigint null,
  actor_id             uuid null,   -- nunca se devuelve (1.3)
  actor_rol            text null,
  created_at           timestamptz not null default now(),
  constraint persona_capturas_persona_fk foreign key (persona_id, tenant) references public.personas (id, tenant),
  constraint persona_capturas_id_persona_tenant_uk unique (id, persona_id, tenant),  -- destino de la FK de observaciones
  constraint persona_capturas_fuente_ck check (
       (fuente = 'captura_interna'   and contrato_numero is null     and contrato_pasajero_id is null)
    or (fuente = 'contrato_pasajero' and contrato_numero is not null and contrato_pasajero_id is not null)),
  constraint persona_capturas_nivel_ck check ((fuente = 'contrato_pasajero') = (nivel = 'pasajero_contrato')),
  constraint persona_capturas_contrato_numero_ck
    check (contrato_numero is null or (contrato_numero <> '' and contrato_numero = btrim(contrato_numero, ' ')))
);

create table public.persona_observaciones (
  id          uuid primary key default gen_random_uuid(),
  captura_id  uuid not null,
  persona_id  uuid not null,
  tenant      text not null,
  campo       text not null check (campo in ('nombres','apellidos','fecha_nacimiento','nacionalidad','telefono','email','nit_dv')),
  valor       text not null check (char_length(valor) between 1 and 200),
  created_at  timestamptz not null default now(),
  constraint persona_observaciones_captura_fk foreign key (captura_id, persona_id, tenant)
    references public.persona_capturas (id, persona_id, tenant),
  constraint persona_observaciones_nit_dv_ck check (campo <> 'nit_dv' or valor collate "C" ~ '^[0-9]$'),
  constraint persona_observaciones_idem_uk unique (captura_id, campo, valor)
);
```

**Identidad de la captura frente a su origen.** `persona_capturas.id` es el identificador estable: el
escritor lo genera una vez por evento (envío de un formulario, fila importada) y lo repite en cada reintento.
Es distinto de `contrato_numero`, `contrato_pasajero_id` y de cualquier clave de negocio, que son **origen**
validado por fuente (3.1). Dos capturas independientes con igual campo y valor tienen ids distintos y
conservan cada una su procedencia (sonda I14); la idempotencia de la observación es `(captura_id, campo,
valor)`, columnas `NOT NULL` sin expresiones (3.2). La procedencia de la creación ya no es una columna de
`personas`: es la primera captura, y en una ficha no documentada `clave_alta` apunta a ella.

**El DV de un NIT no vive en `personas`.** Es la observación `campo='nit_dv'` de cada captura, así
nunca se "elige" ni se sobrescribe un DV (2.3). `nit_dv_estructurado` solo registra el hecho de que la
captura que fijó los originales vino con base y DV válido por separado; no almacena el valor.

`tipo_doc`, `numero_norm`, `estado_doc` y `motivo_revision` son **columnas generadas** `STORED` por la
gramática (sección 2): no pueden quedar inconsistentes con los originales. Cada una selecciona un campo de
`p214_priv.norm_documento(...)` evaluada con las **tres columnas base** y `'alta'`; Postgres prohíbe que una
generada lea otra (sonda X1). Postgres comprueba el `EXECUTE` de esa función con el rol que escribe la fila
(sondas E1/E2: sin `EXECUTE`, `42501`), así que `service_role` (escritor) y el owner necesitan `USAGE` sobre el
esquema y `EXECUTE` sobre ella; ningún otro rol (1.4). Promover una ficha provisional a documentada es un `UPDATE` de los campos originales
(que recalcula las generadas, sonda G7b); el índice único decide si hay colisión (sonda G6). Los originales
anteriores no se pierden: siguen en `documento_capturado`/`tipo_doc_capturado` de la captura que los aportó.

**Clave inmutable una vez documentada.** Un trigger rechaza, para todos los roles, cualquier `UPDATE` de
`tipo_doc_original`, `documento_original` o `nit_dv_estructurado` en una fila cuyo `estado_doc` anterior sea
`documentada`. Esa clave solo nace (alta o promoción) y nunca cambia ni desaparece: no hay `DELETE` de
`personas` salvo el rollback vacío de 3.4. Es lo que hace confiable la relectura de 3.3.

### 1.3 Proyección por rol (qué se consulta y qué procedencia ve cada actor)

La única superficie de lectura es `public.buscar_personas_documento(p_tenant, p_tipo_doc, p_numero,
p_limite, p_offset)`. **No recibe DV**: la consulta es por base (2.3). El actor se deriva de la sesión
(`auth.uid()`), nunca de parámetros; `p_tenant` es solo una **solicitud** que se valida.

| Actor | Tenant consultable | Observaciones visibles | Procedencia visible |
|---|---|---|---|
| anon | ninguno (sin EXECUTE) | - | - |
| inactivo, sin fila en `usuarios`, rol no interno (B2B, `control_vuelo`) | ninguno (vacío). B2B lee sus personas de cotizaciones por la lista de la 219 (sección 8), nunca por esta consulta | - | - |
| venta | el suyo | `nivel='comercial'` (= `captura_interna` y, desde la 219, titulares de cotización del tenant, D-3=N2); `nivel='pasajero_contrato'` solo si pasan 1.3.1 sobre una única fila de `ventas`; `nivel='pasajero_cotizacion'` solo de cotizaciones con `creado_por_id` = su usuario | `fuente`, `captura_id` y fecha; `contrato_numero` y `cotizacion_id` solo en lo propio |
| administracion, operaciones | el suyo | todas las capturas de ese tenant; las `pasajero_contrato` solo si pasan 1.3.1 (sin la condición de asesor) | fuente, `captura_id`, `contrato_numero`, fecha, `actor_rol` |
| gerencia, superadmin | ambos, **solo si `p_tenant` los nombra explícitamente** | igual que el anterior | igual, siempre rotulado con su tenant |

#### 1.3.1 Prueba de una captura `pasajero_contrato`: una sola fila de `ventas`

La 142 ofrece `soy_asesor_del_contrato(num)` (L58-64), pero esa función busca el número en **todas** las
agencias y delega en `soy_ese_asesor(v.asesor)` (L47-54), que compara `lower(btrim(...))` del texto
`ventas.asesor` con el nombre o correo del usuario `auth.uid()` activo sin mirar tenant. Combinarla con un
`EXISTS` aparte que compruebe el tenant permite que **dos filas distintas** satisfagan cada mitad: si un
número existiera en las dos agencias, un `venta` que es asesor del contrato homónimo de la otra agencia
vería la observación de un contrato ajeno de la suya. Por eso la consulta **no usa**
`soy_asesor_del_contrato`: número, tenant y asesor se comprueban sobre la **misma** fila `v`, en un único
`EXISTS`, evaluado con el actor ya resuelto (1.4):

```sql
-- c = la captura (public.persona_capturas); se evalúa solo si c.fuente = 'contrato_pasajero'.
exists (
  select 1
    from public.ventas v
   where v.numero_contrato = c.contrato_numero                  -- misma fila: número
     and v.tenant          = c.tenant                           -- misma fila: tenant de la captura
     and v.tenant          = t_aut                              -- misma fila: tenant autorizado de la llamada
     and (v_rol <> 'venta' or public.soy_ese_asesor(v.asesor))  -- misma fila: asesor (solo venta)
)
```

- **Fuente tipada:** solo se evalúa para `c.fuente = 'contrato_pasajero'`, cuyo `contrato_numero` y
  `contrato_pasajero_id` son obligatorios por el CHECK de 3.1 (con `IS NOT NULL` explícito). El filtro es por
  `fuente`, no solo por `nivel`.
- `v_rol` y `t_aut` salen del actor leído dentro de la función (1.4), nunca de parámetros; en este punto
  `v_rol` ya es un rol interno no nulo y `t_aut` un tenant válido, así que la condición no puede dar `NULL`.
- `public.soy_ese_asesor(a)` recibe `v.asesor` de **esa misma fila**: no puede responder por otra. Devuelve
  `a is not null and exists (...)`, nunca `NULL`. Hereda el empate por texto dentro de la misma agencia
  (homónimos), deuda de la 142 que #32 no resuelve.
- Es un `EXISTS` por la PK de `ventas`; no devuelve ninguna columna de la venta. No se lee
  `contrato_pasajeros` en la consulta: la restricción 147/187 se conserva sin ampliar nada.
- Un contrato inexistente, eliminado (`eliminar_contrato`) o renumerado (`fn_renumerar_contrato`, 115 L39)
  después de la captura oculta la observación para todos los roles, superadmin incluido: falla cerrado (4.8).
- Hoy `ventas.numero_contrato` es PK global (002 L7; ninguna migración la altera), así que un número
  repetido entre agencias no puede existir. El predicado **no depende** de esa garantía: la prueba V3 de la
  sección 5 la retira dentro de una transacción desechable para demostrarlo.

Esta regla vive en una sola función privada `p214_priv.captura_visible(c, actor)` usada por la consulta, para
que no existan dos versiones del filtro. Una prueba de cableado falla si la 214 menciona
`soy_asesor_del_contrato`.

#### 1.3.2 Orden de cálculo y no filtración de existencia

0. Parámetros: `p_limite` entre 1 y 50 y `p_offset >= 0`; fuera de rango = **error** de parámetro (nunca
   recorte silencioso). El error depende solo de los parámetros, no de los datos, así que no revela nada.
1. Se resuelve el actor y el tenant autorizado `t_aut` (1.4). Sin ellos: respuesta vacía.
2. Se normaliza la clave de consulta (2.4). Si es inválida: `formato_no_admitido`, solo a actores ya
   autorizados (a los demás, respuesta vacía).
3. Candidata: como mucho **una** fila de `personas` con `tenant = t_aut`, `estado_doc = 'documentada'` y la
   clave exacta (la unicidad de 3.2 lo garantiza). Fichas `provisional` y `revision` nunca son candidatas.
4. Se **filtran** las capturas de esa candidata con `captura_visible` (1.3 y 1.3.1) y, con ellas, sus
   observaciones. El resultado del filtro es el conjunto `A` de observaciones autorizadas.
5. Si `A` está vacío, la respuesta es **idéntica bit a bit** a "no existe": ninguna fila, `total = 0`,
   `has_more = false`, sin `persona_id`. No se revela la persona por id, por `total`, por `has_more` ni por
   las variantes.
6. Sobre `A`, y solo sobre `A` (ajuste obligatorio de Auditorías: la respuesta nunca trae detalle ilimitado):
   - Unidad de paginación: **la observación**. Orden `(campo, created_at, id)`. Página = como máximo
     `p_limite` (≤ 50) filas desde `p_offset`. **La procedencia detallada** (`captura_id`, `fuente`,
     `capturado_en`, `contrato_numero` y, desde administración, `actor_rol`) **solo sale en la página**.
   - `total = |A|`; `has_more = (p_offset + filas_devueltas) < total`; `divergencia` global = algún campo con
     más de un valor en `A`. Son agregados sobre todo `A`, no detalle.
   - `variantes`: un elemento por `campo` presente en `A` (como mucho 7) con `n_valores` (valores distintos en
     todo `A`), `divergencia` (`n_valores > 1`), `valores` = **como máximo 10** `{valor, n_capturas}` (los de más
     capturas primero; empate por valor con `COLLATE "C"`), y `valores_omitidos = max(n_valores - 10, 0)`. Sin
     procedencia por valor. Cota de la respuesta: ≤ 50 observaciones + ≤ 7 × 10 valores.
   - `persona_id` se devuelve solo si `|A| >= 1`.

   Forma (implementada en la 214 y tipada en `lib/personas/consulta.ts`):
   ```json
   { "persona": { "id": "uuid", "tenant": "mayorista", "tipo_doc": "CC", "numero_norm": "1020304050" },
     "observaciones": [ { "campo": "nombres", "valor": "Ana", "captura_id": "uuid", "fuente": "captura_interna",
                          "capturado_en": "…", "contrato_numero": null, "actor_rol": null } ],
     "total": 6, "has_more": false, "divergencia": true,
     "variantes": [ { "campo": "nombres", "n_valores": 2, "divergencia": true,
                      "valores": [ { "valor": "Ana", "n_capturas": 2 } ], "valores_omitidos": 0 } ] }
   ```
   La respuesta vacía es siempre el mismo objeto (`persona` nulo, listas vacías, `total` 0, `has_more` y
   `divergencia` falsos); a un actor autorizado con formato inválido se le agrega `"error": "formato_no_admitido"`.

Una persona sin observaciones autorizadas no es visible por esta función: el escritor siempre crea la
persona junto con su captura de origen y sus observaciones (3.3). Lo mismo una persona cuyas capturas son
todas `pasajero_contrato` de contratos ajenos para un `venta`: para él no existe.

Reglas transversales:
- Un tenant no permitido devuelve vacío, igual que "no existe". Sin garantía de tiempo constante
  (límite aceptado y registrado).
- Nunca se devuelven `actor_id`, `contrato_pasajero_id` ni el `contrato_numero` ajeno. De la procedencia
  salen `fuente`, `captura_id` y fecha, más `actor_rol` desde administración en adelante.
- Sin `p_tipo_doc` válido no se devuelve nada: el número solo nunca confirma existencia.
- Búsqueda exacta sobre la clave normalizada. Sin prefijos, sin `like`, sin listado.
- Orden determinista (`campo`, `created_at`, `id`); `p_limite` máximo 50 con **error** si se excede, no recorte.

### 1.4 Por qué no hay acceso directo ni lateral a PII

**Directo.** Ninguna policy permite SELECT/INSERT/UPDATE/DELETE sobre `personas`, `persona_capturas` ni
`persona_observaciones` a `anon`, `authenticated` ni `public`: RLS activado, sin policies para esos
roles, y `REVOKE ALL` de tabla. Solo `service_role` tiene privilegios. No se concede SELECT a los
roles internos aunque una policy por tenant lo permitiría, porque eso habilitaría **enumerar** a
todas las personas de un tenant, justo lo que la consulta exacta impide.

**Por la función.** `buscar_personas_documento` es la única excepción y por eso es
`SECURITY DEFINER` (un invoker exigiría conceder SELECT sobre la tabla). Controles obligatorios:

| Control | Regla implementable | Cómo se comprueba |
|---|---|---|
| Actor activo, rol y tenant **dentro** de la función | La primera sentencia es `select rol, tenant from public.usuarios where id = auth.uid() and activo is true`. Sin fila, `auth.uid()` nulo (`anon`, `service_role` sin `sub`), `activo` nulo/falso, rol fuera de `superadmin, gerencia, administracion, operaciones, venta`, o `tenant` nulo o fuera de `mayorista, minorista`: respuesta vacía (1.3.2). No usa `mi_rol()`/`mi_tenant()`: así no hereda la deuda de `search_path` de `mi_rol()` (140) ni el `coalesce(..., 'mayorista')` de `mi_tenant()`; llamarlos calificados no corrige esa deuda (sección 4, punto 3). | Pruebas por rol y por API (sección 5) |
| Tenant autorizado `t_aut` | `p_tenant` es solo una solicitud. `superadmin`/`gerencia`: `t_aut = p_tenant` si es `mayorista` o `minorista`; nulo o desconocido = vacío (no hay "ambos a la vez" ni un valor por defecto). Resto de roles: `t_aut = usuarios.tenant`; un `p_tenant` distinto del suyo = vacío, igual que "no existe". | Pruebas de `p_tenant` falsificado |
| Owner | Owner explícito con `ALTER FUNCTION ... OWNER TO <rol de migraciones>` (el mismo que posee las tablas). Prohibido que sea `anon`, `authenticated`, `service_role`, `authenticator` o cualquier rol con el que `authenticator` pueda hacer `SET ROLE`. | Postcheck: `pg_get_userbyid(proowner)` igual al esperado y no en esa lista |
| Atributos | `language sql` o `plpgsql`, `STABLE`, `SECURITY DEFINER`, `set search_path = pg_catalog, pg_temp` (`pg_temp` explícito y último, para que no se busque primero). | Postcheck sobre `prosecdef`, `provolatile`, `proconfig` |
| Objetos calificados | Toda tabla y función con esquema: `public.personas`, `public.persona_capturas`, `public.persona_observaciones`, `public.usuarios`, `public.ventas`, `public.soy_ese_asesor`, `p214_priv.*`, `auth.uid()`. No se invoca `public.soy_asesor_del_contrato` (1.3.1). Funciones y operadores de sistema resuelven en `pg_catalog`, primero en el `search_path`. | Revisión estática + prueba con una tabla temporal `ventas` y una función homónima en otro esquema que no deben alterar el resultado |
| Función pública | Tras crearla: `REVOKE ALL ON FUNCTION public.buscar_personas_documento(...) FROM PUBLIC, anon, authenticated, service_role`; `GRANT EXECUTE ... TO authenticated` y nada más. El `REVOKE` a `anon`, `authenticated` y `service_role` es obligatorio aparte de `PUBLIC`, porque en Supabase real los `ALTER DEFAULT PRIVILEGES` del proyecto conceden `EXECUTE` directo a esos roles sobre cada función nueva (ya documentado en `postcheck_167`, `rollback_155`/`158`, `test_empaquetados`). `service_role` no la necesita: sin `sub` siempre devolvería vacío. | `has_function_privilege` por rol en el postcheck |
| Helpers privados | Esquema `p214_priv` (precedente `f208_priv`, 208). Cada función: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE` solo a `service_role` (lo exigen las columnas generadas y las escrituras de 3.5). La función pública los usa como owner. | Postcheck: ningún `anon`/`authenticated` con `EXECUTE` ni `USAGE` |
| Esquema privado | `REVOKE ALL ON SCHEMA p214_priv FROM PUBLIC, anon, authenticated`; `GRANT USAGE` solo a `service_role`; nunca en la lista de esquemas expuestos de PostgREST. | `has_schema_privilege` + prueba HTTP con `Accept-Profile: p214_priv` |
| Tablas | `REVOKE ALL ON public.personas, public.persona_capturas, public.persona_observaciones FROM PUBLIC, anon, authenticated` (los `ALTER DEFAULT PRIVILEGES` de Supabase también conceden tablas nuevas a esos roles). `service_role`: `SELECT, INSERT, UPDATE` en `personas`; `SELECT, INSERT` en `persona_capturas` y en `persona_observaciones`; nunca `DELETE` ni `TRUNCATE`. RLS activada y sin policies en las tres. Triggers de 1.2 y 3.1 para inmutabilidad. | `has_table_privilege` por rol + prueba HTTP |

**Lateral.**
- `crm_contactos`, `crm_leads`, `aliados`: ninguna se une ni se lee. `ventas` solo en el `EXISTS` de 1.3.1 (consulta) y en el disparador de escritura de 3.1; `contrato_pasajeros` solo en ese disparador, nunca en la consulta. No hay JOIN que devuelva sus columnas, así que no heredan ni abren sus policies.
- El nivel `pasajero_contrato` conserva la restricción de la 147/187 (1.3.1).
- No se modifica ninguna policy ni helper global (107/142/154/187/207). Gerencia/superadmin ven ambos tenants **solo dentro del módulo nuevo**, con lógica propia en la función.
- B2B (#42, D-4) usa `crm_personas_cotizacion_buscar` (219), ligada al `creado_por_id` estable de cada
  cotización, no esta función. Ese id lo estampan la 211 (comparativas), la 216 (manual, #39) y, desde la 219,
  `sellar_creador_cotizacion` en Reservar y en el checkout con sesión; antes de la 219 ninguna vía de alta de
  Reservar/checkout lo escribía.

---

## 2. Una sola gramática de tipo y número (app y SQL)

### 2.1 Implementación única, dos lenguajes, un archivo de vectores

- SQL: `p214_priv.norm_documento(p_tipo text, p_numero text, p_nit_dv_estructurado boolean, p_modo text,
  OUT tipo_doc text, OUT numero_norm text, OUT estado text, OUT motivo text)`, `IMMUTABLE`, sin acceso a
  tablas y sin `SECURITY DEFINER`.
  - `p_modo = 'alta'`: `p_nit_dv_estructurado` es obligatorio (`NULL` = error de programación). Es la única
    entrada de la regla 4 de 2.3: la clasificación del NIT depende de ella y de nada más.
  - `p_modo = 'consulta'`: `p_nit_dv_estructurado` debe ser `NULL` y se ignora; la regla 4 no aplica (la
    consulta es por base, 2.4).
  - Cualquier otro `p_modo` = error.
- SQL: `p214_priv.dv_nit_valido(p_dv text) returns boolean`, `IMMUTABLE`: aplica R1 y después
  `^[0-9]$` con `COLLATE "C"`; `NULL` = `false`. El escritor la usa **antes** de marcar una captura como
  estructurada (2.3).
- Columnas generadas: cada una se calcula de las **columnas base** de su fila (`tipo_doc_original`,
  `documento_original`, `nit_dv_estructurado`) con `norm_documento(..., 'alta')`; ninguna lee otra generada
  (Postgres lo prohíbe; sonda X1 de 3.7).
- TypeScript: `normalizarDocumento({ tipo, numero, nitDvEstructurado, modo })` y `dvNitValido(dv)` en
  `lib/personas/identidad.ts`, con las mismas entradas y salidas.
- Vectores compartidos: `pruebas/fixtures/personasIdentidad.vectores.json`. Una prueba TS (`node --test`)
  y una prueba SQL (carga el JSON con `\set` + `jsonb_array_elements`) recorren **el mismo archivo** y exigen
  salida idéntica. Cada vector fija las cuatro entradas (tipo, número, marca, modo) y las cuatro salidas; los
  de `dv_nit_valido` fijan entrada y booleano. Es la única fuente de verdad de la equivalencia; no se afirma
  equivalencia que los vectores no cubran.

### 2.2 Reglas deterministas (en este orden exacto)

**Restricciones comunes a TS y SQL (para que ninguna regla dependa de locale o Unicode).**
- Clases solo con rangos ASCII explícitos (`[A-Za-z0-9 .]`). **Prohibidos** `\d`, `\s`, `\w`, `[[:alpha:]]` y
  demás clases POSIX en los dos lenguajes: en Postgres dependen del `LC_CTYPE` (pueden aceptar dígitos de
  otros alfabetos o de ancho completo); en JS `\s` acepta NBSP y otros espacios.
- SQL: toda comparación por expresión regular lleva `COLLATE "C"` (`x COLLATE "C" ~ '^[A-Za-z]+$'`).
  TS: expresiones sin flags `i`, `u` ni `v` (con `i` + `u`, U+212A Kelvin coincide con `k`).
- Ni TS ni SQL aplican normalización Unicode (`normalize('NFC'|'NFKC')`, `normalize()` de Postgres): NFKC
  convertiría ancho completo o `ſ` en ASCII y crearía otra identidad.
- Longitudes en **puntos de código**: SQL `char_length(x)`; TS `Array.from(x).length` (no `x.length`, que cuenta
  unidades UTF-16 y duplica cada carácter fuera del plano básico).
- Entradas que SQL no puede representar se rechazan **antes** de escribir, en TS, como error de entrada (no
  como ficha): `U+0000` (Postgres no admite NUL en `text`) y surrogates sueltos (UTF-16 mal formado). No hay
  vector SQL para ellas; el vector TS las marca `error_entrada`.

**R0 · Originales.** `tipo_doc_original` y `documento_original` se guardan **tal como llegaron**, sin
recorte ni conversión, aunque el tipo no esté en el catálogo. `NULL` significa "no se envió"; la cadena
vacía o solo espacios se guarda tal cual y R1 la trata como ausente. Máximo 64 puntos de código: más allá,
la función de escritura **rechaza con error** (no trunca). Nada de lo que sigue modifica los originales.

**R1 · Recorte ASCII.** Se quitan **solo espacios ASCII U+0020** al inicio y al final.
- SQL: `btrim(x, ' ')`. TypeScript: `x.replace(/^ +| +$/g, '')`. **Prohibido `String.prototype.trim()`**
  (quita NBSP, tabuladores, saltos de línea y otros espacios Unicode que SQL no quita, lo que haría que
  app y SQL disientan).
- Un tabulador, NBSP o salto de línea en los bordes **no se quita**: queda en la cadena y falla R2/R3
  (-> `revision`), nunca se descarta en silencio.

**R2 · Tipo.** Sobre el tipo ya recortado:
1. Vacío (o `NULL`) = **tipo ausente**.
2. Si no, debe cumplir `^[A-Za-z]+$` (ASCII, **antes** de cualquier conversión de mayúsculas). Si no
   cumple (`C.C.`, `CC2`, `cédula`, `ı`, U+212A Kelvin) = **tipo presente pero inválido**.
3. Conversión a mayúsculas **solo ASCII**: SQL `translate(x, 'abcdefghijklmnopqrstuvwxyz',
   'ABCDEFGHIJKLMNOPQRSTUVWXYZ')`; TS `x.replace(/[a-z]/g, c => String.fromCharCode(c.charCodeAt(0) - 32))`.
   **Prohibido `upper()`/`toUpperCase()`** (dependen de locale/Unicode: `ı`->`I`, `ß`->`SS`, `ſ`->`S`, U+212A->`k`
   cambiarían una identidad). Por R2.2 esos caracteres ya fueron rechazados antes de convertir.
4. El resultado debe estar **exactamente** en `CC, CE, TI, RC, PAS, PPT, NIT`; si no = tipo presente
   pero inválido. No se heredan las tolerancias de la 202 (`C.C.` -> `CC`).

**R3 · Número (alfabeto).** Sobre el número ya recortado: solo `[A-Za-z0-9]` y, como separadores de
formato, espacio ASCII y punto `.`. Un separador solo es válido **entre** grupos alfanuméricos
(`^[A-Za-z0-9]+([ .][A-Za-z0-9]+)*$`). Cualquier otro carácter (Unicode, tabulador, `-`, `/`, `ñ`, ancho
completo, NBSP) = formato inválido -> `revision`; nunca se elimina.

**R4 · Longitud y forma.** Número sin separadores: 3 a 20 caracteres. `CC, CE, TI, RC, NIT`: solo dígitos
(**CE numérica**). `PAS, PPT`: alfanumérico. Un tipo numérico con letras, o fuera de rango = `revision`.
Las reglas específicas de NIT están en 2.3. R3 y R4 solo se evalúan si R2 dio un tipo válido; con tipo
inválido el número se conserva original y no se normaliza (2.3, fila 1).

**R5 · Normalización** (solo si R2-R4 pasaron): quitar espacios y puntos y pasar a minúsculas con
conversión **solo ASCII** (misma técnica que R2.3). **Los ceros iniciales se conservan**
(`007` y `7` son identidades distintas; el número es texto).

### 2.3 Estados y NIT: gramática de alta vs. gramática de consulta

Estado de una fila, evaluado en este orden (el primero que aplica gana):

| # | Condición | `estado_doc` | `motivo_revision` |
|---|---|---|---|
| 1 | Tipo **presente pero inválido** (R2.2 o R2.4), con o sin número | `revision` | `tipo_invalido` |
| 2 | Tipo ausente, o número ausente (vacío tras R1) | `provisional` | - |
| 3 | Número que viola R3 o R4 | `revision` | `numero_invalido` |
| 4 | Solo en modo `alta`: tipo `NIT` y `nit_dv_estructurado = false` (la captura no trajo un DV válido por separado) | `revision` | `nit_sin_dv_estructurado` |
| 5 | En otro caso | `documentada` | - |

`provisional` significa "falta información para formar una identidad". Un tipo mal escrito **no** es
ausencia: es información presente y dudosa, por eso va a revisión con el original intacto y consultable
(`tipo_doc_original`), no a una ficha que parezca simplemente incompleta.

**Gramática de ALTA del NIT (estructurada).** El escritor recibe dos parámetros separados: `p_numero` = base
y `p_nit_dv` = DV. Base: R1-R4 con solo dígitos, separadores R3 permitidos (`900.123.456`), sin guion.
Longitud de la base: **3 a 20 caracteres normalizados, el default V1 aceptado** (ajuste obligatorio de
Auditorías: no se introduce el límite 5-10 sin otra decisión). Base y DV siguen separados.

La marca `nit_dv_estructurado` la decide solo la función privada de escritura, **después de validar el DV**,
en este orden y antes de escribir nada:
1. Resuelve el tipo con `norm_documento(p_tipo, p_numero, false, 'alta')` (el tipo no depende de la marca).
2. Si llega `p_nit_dv` y el tipo no es `NIT`: error de entrada `nit_dv_sin_nit`.
3. Si llega `p_nit_dv` y `dv_nit_valido(p_nit_dv)` es falso (`K`, `77`, vacío, solo espacios, dígito de ancho
   completo): error de entrada `nit_dv_invalido`. Un DV estructurado inválido no es un dato ambiguo de texto
   libre sino un error del formulario; se rechaza igual que un original de más de 64 (R0): no se escribe nada y
   nada se descarta en silencio, porque el llamador conserva su entrada.
4. Solo entonces `nit_dv_estructurado = (p_nit_dv is not null)`, y el DV recortado se guarda como observación
   `nit_dv` **de esa captura**.

Con la marca en `true` y una base válida, la fila queda `documentada`. La validación del DV con el algoritmo
DIAN queda diferida (default aceptado): un DV de un dígito se registra aunque no verifique. Respaldo en la
base (3.1): `personas_nit_dv_estructurado_ck` (la marca solo con tipo `NIT`) y el disparador diferido
`personas_nit_dv_observado` (al confirmar, toda persona marcada tiene al menos una observación `nit_dv`).

Un NIT en campo libre (`900123456-7`, `9001234567`, `900.123.456-7`) o sin `p_nit_dv` = `revision`
(`nit_sin_dv_estructurado`, o `numero_invalido` por el guion): no se separa, no se recorta y no se registra
ninguna observación `nit_dv`, porque no se sabe cuál es el DV. Esa ficha en revisión **nunca se adjunta** a
una persona `documentada` con la misma base: queda como ficha propia, con su original y su procedencia,
hasta que personal autorizado la revise (fuera de #32). Hay 14 de 44 NIT históricos de `aliados` que
normalizan a 10 caracteres (foto 2026-10-10), indistinguibles entre "base de 10 dígitos" y "base + DV";
cortar uno sería inventar una identidad.

**Gramática de CONSULTA del NIT (por base).** `buscar_personas_documento` **no recibe DV** y no lo exige:
acepta solo una base válida (R3-R4, solo dígitos, 3-20, sin guion) y busca por igualdad exacta con
`numero_norm`. Una entrada ambigua (guion, texto libre) devuelve `formato_no_admitido` a actores
autorizados y nunca se trunca ni se reinterpreta. Una entrada de 10 dígitos se busca tal cual como base
de 10 dígitos; si en realidad fuera base de 9 + DV, el resultado es 0 (no se corta).

**Divergencia de DV.** Si dos capturas aportan DV distintos para la misma base, **ambas** observaciones
`nit_dv` quedan, cada una ligada a su captura (fuente, origen, `actor_rol`, fecha), y ninguna sobrescribe a
la otra. Lo mismo si la misma fuente aporta en momentos distintos dos DV diferentes: son dos capturas. La
idempotencia es por captura, `UNIQUE (captura_id, campo, valor)` (3.2): el reintento de la **misma** captura
no duplica, y otra captura con el mismo o con otro DV es otra fila. El alta de la persona por clave (3.3)
**no toca** las observaciones previas: el segundo escritor recibe el mismo `persona_id` y solo agrega su
propia captura y sus observaciones.
La consulta devuelve la divergencia como `variantes` del campo `nit_dv` (valores acotados, 1.3.2; la
procedencia de cada uno sale en la página de observaciones) y `divergencia = true` cuando hay más de un valor
distinto **en el conjunto autorizado `A`**. Si el
actor solo ve una de las dos capturas, ve una sola variante y `divergencia = false`: no se le revela que otra
captura ajena dice otra cosa. No existe columna central de DV que alguien pueda "elegir" por orden de
llegada. La resolución de una divergencia es explícita y de personal autorizado, fuera de #32.

### 2.4 Consulta: misma gramática, sin DV

`norm_documento(p_tipo, p_numero, NULL, 'consulta')` aplica R1-R5 y 2.3 (alfabeto, longitud, base de NIT)
pero no la regla 4 (marca estructurada); devuelve `numero_norm` o `formato_no_admitido`. Es la misma función SQL/TS: no
existe una tercera gramática. Tipo ausente o inválido en consulta = `formato_no_admitido` (el número solo
nunca confirma existencia). La longitud de base NIT en consulta es la misma de alta: 3 a 20.

### 2.4.1 Casos previstos (especificación de los vectores, no los vectores)

Notación: `·` = espacio ASCII, `\uXXXX` = carácter Unicode. "Original" se conserva siempre tal como entra.
Cada fila se ejecuta en TS y en SQL con salida idéntica, salvo las marcadas "solo TS".

| # | Tipo | Número | Modo | `tipo_doc` | `numero_norm` | Estado / motivo |
|---|---|---|---|---|---|---|
| T1 | `CC` | `123456` | alta | `CC` | `123456` | documentada |
| T2 | `cc` | `123456` | alta | `CC` | `123456` | documentada |
| T3 | `·CC·` | `·123456·` | alta | `CC` | `123456` | documentada; originales con espacios intactos |
| T4 | `CC2` | `123456` | alta | null | null | revision / tipo_invalido; `tipo_doc_original = 'CC2'` |
| T5 | `C.C.` | `123456` | alta | null | null | revision / tipo_invalido (no se hereda la tolerancia de la 202) |
| T6 | `cédula` | `123456` | alta | null | null | revision / tipo_invalido |
| T7 | ` CC` | `123456` | alta | null | null | revision / tipo_invalido (NBSP no se recorta) |
| T8 | `CC\t` | `123456` | alta | null | null | revision / tipo_invalido (tabulador no se recorta) |
| T9 | `paſ` | `AB123` | alta | null | null | revision / tipo_invalido (con `upper()` sería `PAS`) |
| T10 | `""` y `···` | `123456` | alta | null | null | provisional (tipo ausente) |
| T11 | null | null | alta | null | null | provisional |
| T12 | `CC` | `""` | alta | `CC` | null | provisional (número ausente) |
| T13 | `CC2` | `""` | alta | null | null | revision / tipo_invalido (presente-inválido gana a ausente) |
| N1 | `CC` | `1.234.567` | alta | `CC` | `1234567` | documentada |
| N2 | `CC` | `1·234·567` | alta | `CC` | `1234567` | documentada |
| N3 | `CC` | `1..234` | alta | `CC` | null | revision / numero_invalido (separador doble) |
| N4 | `CC` | `.1234` | alta | `CC` | null | revision / numero_invalido (separador al borde) |
| N5 | `CC` | `1234-5` | alta | `CC` | null | revision / numero_invalido (guion) |
| N6 | `CC` | `１２３４` | alta | `CC` | null | revision / numero_invalido (ancho completo) |
| N7 | `PAS` | `AÑ12345` | alta | `PAS` | null | revision / numero_invalido (`Ñ`) |
| N8 | `PAS` | `ABK123` | alta | `PAS` | null | revision / numero_invalido (con `lower()` sería `abk123`) |
| N9 | `CC` | `123 456` | alta | `CC` | null | revision / numero_invalido (NBSP interior) |
| N10 | `CC` | `0071234` y `71234` | alta | `CC` | `0071234` / `71234` | dos documentadas distintas |
| N11 | `CC` | `12` / `123` / 20 dígitos / 21 dígitos | alta | `CC` | null / `123` / valor / null | revision / ok / ok / revision |
| N12 | `CE` | `AB1234` | alta | `CE` | null | revision / numero_invalido (CE numérica) |
| N13 | `PAS` | `ab·12.34` | alta | `PAS` | `ab1234` | documentada |
| N14 | `CC` | `1234\u0000` | alta | - | - | error_entrada, **solo TS** |
| D1 | `NIT` | base `900123456`, DV `7` | alta, marca `true` | `NIT` | `900123456` | documentada + observación `nit_dv = 7` de esa captura |
| D2 | `NIT` | base `900.123.456`, DV `7` | alta, marca `true` | `NIT` | `900123456` | documentada |
| D3 | `NIT` | `900123456-7`, sin DV | alta, marca `false` | `NIT` | null | revision / numero_invalido; sin observación `nit_dv` |
| D4 | `NIT` | `9001234567`, sin DV | alta, marca `false` | `NIT` | null | revision / nit_sin_dv_estructurado; no se corta |
| D5 | `NIT` | base `900123456`, DV `K` / `77` / `""` / `·` / `７` | escritor | - | - | error de entrada `nit_dv_invalido`; no se escribe nada (no es un estado de la gramática) |
| D6 | `NIT` | base de 2 y de 21 dígitos, DV `7` | alta, marca `true` | `NIT` | null | revision / numero_invalido (fuera de 3-20); bases de 3 y de 20: documentada |
| D7 | `CC` | `123456`, DV `7` | escritor | - | - | error de entrada `nit_dv_sin_nit`; no se escribe nada |
| D8 | `CC` | `123456` | alta, marca `true` | - | - | imposible: la rechaza `personas_nit_dv_estructurado_ck` (`23514`); la gramática sola devolvería documentada, por eso el respaldo es el CHECK |
| C1 | `NIT` | `900123456` | consulta | `NIT` | `900123456` | busca por base, sin DV |
| C2 | `NIT` | `900123456-7` | consulta | - | - | formato_no_admitido |
| C3 | `NIT` | `9001234567` | consulta | `NIT` | `9001234567` | busca base de 10 tal cual; no encuentra la de 9 |
| C4 | `CC` | `1.234.567` | consulta | `CC` | `1234567` | consulta normal |
| C5 | `CC2` o vacío | `123456` | consulta | - | - | formato_no_admitido |

Casos de `dv_nit_valido` (TS y SQL, salida idéntica): `7` y `·7·` = true; `77`, `K`, `""`, `·`, `７` (ancho
completo), `٧` (U+0667), `7\t` y `NULL` = false.

Propiedad comprobable: para cualquier entrada **válida** en esta gramática y tipo no NIT, `numero_norm`
coincide con el que produce la 202 (ambos minúsculas y sin separadores), de modo que el cruce futuro con
`crm_leads` no se rompe. Los vectores la verifican; no se asume fuera de ellos.

### 2.5 Históricos: sin atribución automática

Esta gramática **no se aplica retroactivamente**. No hay adaptador ni backfill en #32. Una fila histórica
sin tipo (`ventas`, 21 cotizaciones carrito en la foto de 2026-10-10, el `CC` forzado del checkout) no
genera persona ni se le asigna tipo. Quien las lea en el futuro deberá entrar por una función de
adaptación explícita y revisada (fuera de #32). No se promete búsqueda histórica.

---

## 3. CHECK, índice único, estados, variantes y colisiones

### 3.1 NOT NULL, CHECK, FK y disparadores

Regla: toda columna necesaria es `NOT NULL`, y cada CHECK se escribe con `IS NULL`/`IS NOT NULL` explícitos
o solo sobre columnas `NOT NULL`, de modo que **nunca** evalúa a `NULL`. Postgres acepta la fila cuando un
CHECK da `NULL` (desconocido): el CHECK de la v2, `(nivel = 'pasajero_contrato') = (fuente =
'contrato_pasajero' and contrato_numero is not null)` con `nivel` anulable, dejaba pasar `nivel = NULL` con
`fuente = 'contrato_pasajero'` y sin contrato (sonda X4). Todas las columnas de FK son `NOT NULL`, así que la
semántica `MATCH SIMPLE` (que omite la verificación si alguna columna es `NULL`) nunca se activa.

| Tabla | Restricción | Por qué no puede dar `NULL` | Sonda |
|---|---|---|---|
| `personas` | `tenant` `NOT NULL` y en `('mayorista','minorista')` | columna obligatoria | - |
| `personas` | originales: `x is null or char_length(x) <= 64` | `IS NULL` explícito | - |
| `personas` | `personas_nit_dv_estructurado_ck`: `nit_dv_estructurado = false or (tipo_doc is not null and tipo_doc = 'NIT')` | marca `NOT NULL` y `IS NOT NULL` explícito sobre la generada. La forma anterior `... or tipo_doc = 'NIT'` daba `NULL` con tipo inválido y dejaba pasar la marca | G2 |
| `persona_capturas` | `persona_id`, `tenant`, `fuente`, `nivel`, `created_at` `NOT NULL` | obligatorias | I2, I3 |
| `persona_capturas` | `persona_capturas_fuente_ck`: un disyunto por fuente; cada uno exige sus columnas de origen `IS NOT NULL` y las de las otras fuentes `IS NULL` | `fuente` `NOT NULL` y solo `IS [NOT] NULL` | I1, I4 |
| `persona_capturas` | `persona_capturas_nivel_ck`: `(fuente = 'contrato_pasajero') = (nivel = 'pasajero_contrato')` | ambas `NOT NULL` | I5 |
| `persona_capturas` | `contrato_numero is null or (contrato_numero <> '' and contrato_numero = btrim(contrato_numero, ' '))` | `IS NULL` explícito | - |
| `persona_observaciones` | `captura_id`, `persona_id`, `tenant`, `campo`, `valor`, `created_at` `NOT NULL`; `campo` en lista cerrada; `char_length(valor) between 1 and 200` | obligatorias | I7, I8 |
| `persona_observaciones` | `campo <> 'nit_dv' or valor collate "C" ~ '^[0-9]$'` | `campo` y `valor` `NOT NULL` | I9, C1-C5 |
| FK | `persona_capturas (persona_id, tenant)` -> `personas (id, tenant)`; `persona_observaciones (captura_id, persona_id, tenant)` -> `persona_capturas (id, persona_id, tenant)` | columnas `NOT NULL`: una captura no puede tener otro tenant que su persona, y una observación no puede colgar de la captura de otra persona ni de otro tenant | I6, I10, I11 |

Disparadores:
- `personas`: `tenant` inmutable (como la 154) y clave inmutable una vez documentada (1.2).
- `personas_nit_dv_observado`: `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` sobre `INSERT` y
  `UPDATE OF nit_dv_estructurado`: al confirmar, toda persona con la marca en `true` tiene al menos una
  observación `nit_dv` (sondas D1 y D2). Respalda el paso 4 de la gramática de alta (2.3).
- `persona_capturas` y `persona_observaciones`: append-only (UPDATE/DELETE rechazados, incluso para
  `service_role`).
- `persona_capturas`, `BEFORE INSERT` cuando `fuente = 'contrato_pasajero'`: exige que exista
  `public.contrato_pasajeros cp` con `cp.id = contrato_pasajero_id` y `cp.numero_contrato = contrato_numero`, y
  que la **misma** fila `public.ventas v` (`v.numero_contrato = contrato_numero`) tenga `v.tenant` igual al
  `tenant` de la captura; si no, error. Así una captura `contrato_pasajero` siempre tiene contrato tipado,
  tenant coherente y clave de origen **al escribirse**. La consulta vuelve a comprobar número y tenant sobre la
  misma fila de `ventas` (1.3.1), porque el contrato puede eliminarse o renumerarse después. No hay FK hacia
  `ventas` ni `contrato_pasajeros` a propósito: bloquearía `eliminar_contrato()` o borraría procedencia en
  cascada.
- Que una observación `nit_dv` solo cuelgue de una persona de tipo `NIT` lo valida el escritor (2.3, paso 2):
  `tipo_doc` vive en otra tabla y un CHECK no puede leerla. Tiene prueba propia (sección 5).
- A diferencia de la 202 **no** se exige `(documento is null) = (tipo is null)`: una ficha provisional puede
  tener solo uno de los dos. La coherencia la expresa `estado_doc`.

### 3.2 Índice único

```
create unique index uq_personas_clave_documentada
  on public.personas (tenant, tipo_doc, numero_norm)
  where estado_doc = 'documentada';
```

Solo participan las documentadas. Mismo número con distinto tipo, o en distinto tenant, son filas
distintas y legales (sonda G5). Provisionales y en revisión no tienen unicidad documental ni se deduplican.

Las otras unicidades usan **columnas canónicas `NOT NULL`, sin expresiones**:
- `persona_capturas.id` (PK): una captura existe una sola vez; reutilizar su id para otra persona choca con
  la PK (sonda I15) y el escritor lo informa como `captura_inconsistente` (3.3).
- `persona_observaciones_idem_uk UNIQUE (captura_id, campo, valor)`: el reintento de la misma captura no
  duplica (sonda I13); otra captura con igual campo y valor es otra fila (sonda I14). No se fusionan fuentes.
- `uq_personas_clave_alta (tenant, clave_alta) where clave_alta is not null`: idempotencia de las fichas no
  documentadas (3.3).
- Una expresión como `coalesce(contrato_numero, '')` **no cabe** en un `UNIQUE` de tabla (sonda X2, `42601`);
  si alguna vez hiciera falta, iría en un índice único de expresión (sonda X3). Aquí no hace falta.

### 3.3 Colisiones concurrentes (aislamiento definido)

Las funciones de escritura exigen **`READ COMMITTED`** (el valor por defecto de Postgres, PostgREST y
`psql`, y el que usan las pruebas de carrera). Si `current_setting('transaction_isolation')` es otro, la
función aborta con error explícito (no intenta adivinar).

**Alta idempotente** `p214_priv.upsert_persona(p_captura_id uuid, p_tenant, p_fuente, <origen tipado>,
p_tipo, p_numero, p_nit_dv, p_observaciones, p_actor...)`. Antes de escribir nada valida las entradas: originales
de hasta 64 puntos de código (R0), `p_captura_id` no nulo y el DV según 2.3 (pasos 1-4, que fijan la marca).
Después evalúa la gramática (`norm_documento` con esa marca, la misma lógica de las columnas generadas) para
saber si la entrada será `documentada`.

*Reintento (antes de tocar la persona):* si ya existe una captura con `p_captura_id`, se compara la carga
completa con la recibida (paso 7) y se devuelve su `persona_id` con resultado `reintento`, o se rechaza con
`captura_inconsistente`. Así un reintento sigue siendo idempotente aunque la persona se haya promovido después
(sus originales cambiaron, pero la captura conserva lo que afirmó).

Resultados: `creada`, `existente` o `reintento`. Errores: `22023` entrada inválida (`captura_id_obligatorio`,
`tenant_invalido`, `fuente_invalida`, `original_demasiado_largo`, `origen_invalido`, `observaciones_invalidas`,
`nit_dv_sin_nit`, `nit_dv_invalido`), `25000` `aislamiento_no_admitido` y `P0001` `captura_inconsistente`,
`clave_alta_reutilizada` o `alta_inconsistente`. Un `23514` del disparador del pasajero de contrato se propaga.

*Caso documentada* (clave completa):
1. `INSERT ... ON CONFLICT (tenant, tipo_doc, numero_norm) WHERE estado_doc = 'documentada' DO NOTHING
   RETURNING id`. Si devuelve fila: `creada`.
2. Semántica de Postgres en la que se apoya: si otra transacción **aún no confirmada** insertó la misma
   clave, este `INSERT` **espera** a que termine. Si la otra confirma, aquí hay conflicto y no se inserta
   nada; si la otra aborta, este `INSERT` inserta su fila **en la misma sentencia** (no hace falta
   reintentar para ese caso).
3. Sin fila devuelta = conflicto contra una fila **ya confirmada**: **relectura en una sentencia nueva**
   (`SELECT id FROM public.personas WHERE tenant = .. AND tipo_doc = .. AND numero_norm = .. AND
   estado_doc = 'documentada'`). Bajo READ COMMITTED cada sentencia toma una instantánea nueva y ve esa fila.
   Resultado: `existente`.
4. La relectura no puede fallar en condiciones normales, porque una clave documentada es inmutable y no se
   borra (1.2). Si aun así no encuentra la fila, se repite desde 1 una sola vez; si vuelve a fallar, error
   explícito `alta_inconsistente` (nunca éxito, nunca duplicado). Es una defensa, no un camino esperado, y
   tiene prueba propia (con un trigger temporal que simula el borrado).

*Caso provisional o revisión* (no participa en el índice único):
5. La clave de idempotencia es el id de la captura: `clave_alta = p_captura_id`. Sin `p_captura_id` ya se
   abortó en la validación inicial: un reintento sin clave crearía otra ficha y no sería idempotente.
6. `INSERT ... ON CONFLICT (tenant, clave_alta) WHERE clave_alta IS NOT NULL DO NOTHING RETURNING id`, y
   relectura por `(tenant, clave_alta)` con las mismas reglas 2-4. Si la fila releída tiene originales
   distintos a los enviados, error `clave_alta_reutilizada`: no se sobrescribe ni se asume que es la misma
   persona. Así un doble envío concurrente del mismo evento no deja una segunda ficha provisional huérfana.

*Común (captura y observaciones):*
7. `INSERT INTO public.persona_capturas (id, ...) VALUES (p_captura_id, ...) ON CONFLICT (id) DO NOTHING
   RETURNING id`. Si no devuelve fila (reintento, o el mismo evento enviado dos veces a la vez: el `INSERT`
   esperó a la otra transacción y esta ya confirmó), se relee la captura en una **sentencia nueva** y se
   compara la carga completa con la recibida: persona, tenant, fuente, nivel, origen tipado, documento
   capturado y el conjunto exacto de `(campo, valor)`. Igual: devuelve el mismo `persona_id` sin escribir.
   Distinta: error `captura_inconsistente` (una clave, un único contenido; nada se sobrescribe ni se mezcla).
   La comparación ve el conjunto completo porque la captura ganadora y sus observaciones se confirman en la
   misma transacción.
8. Las observaciones de **esa** captura se insertan con `ON CONFLICT (captura_id, campo, valor) DO NOTHING`, sin
   tocar las de otras capturas (2.3). Resultado: dos llamadores con el mismo evento reciben el mismo
   `persona_id` y una sola captura; dos eventos independientes (ids distintos) con igual campo y valor
   conservan dos capturas y dos observaciones, cada una con su procedencia.
9. Si `current_setting('transaction_isolation') <> 'read committed'`, la función aborta antes del primer
   `INSERT` con `aislamiento_no_admitido`. Un `40P01` (deadlock) se propaga: la operación completa es
   idempotente y el llamador puede repetirla con el mismo `p_captura_id`.

El resultado `creada`/`existente` es solo para `service_role`. La capa que lo exponga a B2B (#42) devolverá la
misma forma en ambos casos para no revelar si la ficha preexistía.

**Promoción provisional/revisión -> documentada** `p214_priv.promover_persona(persona_id, ...)`:
1. `SELECT ... FROM public.personas WHERE id = p_persona_id FOR UPDATE`. Esto serializa dos promociones de
   la **misma** ficha: la segunda espera y relee la fila ya actualizada.
2. Si ya está `documentada` con exactamente la clave pedida: devuelve `ya_documentada` con su id
   (idempotente). Si está documentada con otra clave: `clave_distinta`, sin cambios.
3. Si no, dentro de un sub-bloque `BEGIN ... EXCEPTION WHEN unique_violation` (atrapa solo
   `uq_personas_clave_documentada`, identificado con `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`; cualquier otra
   violación se relanza): valida el DV como en 2.3 (pasos 1-4), hace el `UPDATE` de los originales y la marca
   de **esa** fila, e inserta la captura que aporta el documento nuevo (id estable del escritor, con su
   `documento_capturado`) y sus observaciones con las reglas 7-8 del alta. Cuando otra ficha (otra promoción o
   un alta) ocupa la clave destino, el índice único hace esperar a esta transacción hasta que la otra confirme
   y entonces lanza `23505` (sonda G6). La función:
   - revierte solo su sub-bloque: la ficha queda **intacta** (mismos originales, mismo `estado_doc`, mismas
     capturas y observaciones, mismo `updated_at`) y la captura nueva no se registra;
   - **no mueve ni fusiona** observaciones, ni elige una ficha ganadora;
   - **devuelve** (no lanza) `conflicto` con el id de la ficha ya documentada, sin escribir nada más. Así un
     llamador futuro (#42) no aborta toda su transacción por un conflicto que debe resolver una persona.
4. Alta y promoción cruzadas a la misma clave: si confirma primero la promoción, el alta entra por la
   relectura y obtiene el id promovido (`existente`); si confirma primero el alta, la promoción devuelve
   `conflicto`. En ningún orden quedan dos documentadas con la misma clave.

**Variantes:** diferencias entre capturas (otro nombre, otra fecha, otro DV) son observaciones
adicionales; la consulta las devuelve agrupadas por `campo` con su captura de origen.

### 3.4 Rollback seguro

`rollback_214_personas_identidad.sql` corre en **una sola transacción** y, antes de cualquier comprobación,
toma `LOCK TABLE public.personas, public.persona_capturas, public.persona_observaciones IN ACCESS EXCLUSIVE
MODE` (con `lock_timeout` corto). Así ninguna escritura concurrente puede colarse entre la comprobación y el
`DROP`. Después **aborta antes de borrar nada** (`RAISE EXCEPTION`, nunca `CASCADE`) si se cumple
**cualquiera** de:
1. Existe **cualquier** fila en `personas` (incluidas provisionales, en revisión y de pruebas).
2. Existe **cualquier** fila en `persona_capturas`.
3. Existe **cualquier** fila en `persona_observaciones`.
   Las tres se cuentan siempre y por separado, aunque por las FK bastaría con `personas`: las FK pueden
   desactivarse (`session_replication_role = replica`) y el script no debe depender de ellas.
4. Existe cualquier restricción FK de **otra** tabla que apunte a `personas`, `persona_capturas` o
   `persona_observaciones` (vínculos de #42 u otros), tenga o no filas.
5. Existe cualquier columna fuera de la 214 llamada `persona_id`, `captura_id` o terminada en `_persona_id`
   (tablas, vistas, vistas materializadas y tablas foráneas de cualquier esquema no del sistema), aunque no
   tenga FK: es una referencia blanda que quedaría huérfana. #42 debe declarar sus vínculos con FK; esta
   comprobación evita depender de que lo haga. Se busca en `pg_catalog.pg_attribute`, **no** en
   `information_schema.columns`: este último oculta las tablas sobre las que el rol que ejecuta no tiene
   privilegios, y la primera corrida real (RB5) lo demostró: con la tabla creada por otro rol,
   `information_schema` le mostraba 0 columnas al rol de migración y el rollback **procedió**. RB5 revoca
   ahora explícitamente esos privilegios y exige `information_schema` = 0 como precondición, para reproducir
   el caso también en la imagen de Supabase (donde las ACL por defecto de `supabase_admin` se los darían). El preflight
   (P7), la guarda de columnas de la migración y el postcheck (C7) usan el catálogo por la misma razón.
6. Existe algún objeto ajeno a la 214 que dependa de sus tablas, funciones o del esquema `p214_priv`
   (`pg_depend`/`pg_rewrite`: vistas, funciones, triggers, policies), salvo los propios de la 214.

El mensaje indica qué condición falló e incluye **siempre** los tres conteos (personas, capturas,
observaciones), sin datos personales. Sin ninguna condición elimina, en orden inverso, la función pública,
triggers, tablas y esquema `p214_priv`, y verifica al final que no queda ningún objeto de la 214. Recuperar con datos presentes es una operación distinta (exportación y aprobación
explícita), no este script.

### 3.5 Superficie de escritura de V1

V1 **no expone API de escritura** a roles de aplicación. Existen `p214_priv.upsert_persona(...)` y
`p214_priv.promover_persona(...)` con `EXECUTE` solo para `service_role`; aceptan las fuentes `captura_interna`
y `contrato_pasajero`, y las pruebas de carrera y de visibilidad las usan. Ningún adaptador histórico las llama.

Con la 219 (#42): la app solo llama a `upsert_persona` a través de las fachadas `registrar_personas_cotizacion`
y `actualizar_titular_cotizacion` (sección 8), con la fuente `cotizacion`; `upsert_persona` rechaza esa fuente
(`fuente_solo_por_fachada`, 42501) si la llama directo un rol de la API, incluido `service_role`.
`promover_persona` no tiene llamador en #42 V1 y no puede crear capturas `cotizacion` (no tiene parámetros de
origen: `validar_entrada_captura` responde `origen_invalido`).

### 3.6 Extensión para #42 (diseño original; implementada por la 219, ver sección 8)

Lo implementado difiere del boceto de abajo en: `pasajero_ref` pasó a llamarse `participante_ref` (el titular
también es un puesto); `cotizacion` NO queda fija en `comercial` (D-3=N2: titular `comercial`, pasajero
`pasajero_cotizacion`); `captura_visible` se reemplazó con firma nueva y `buscar_personas_documento` se re-creó
con la misma firma; `validar_entrada_captura`, `captura_coincide` y `upsert_persona` se generalizaron (DROP y
CREATE, parámetros nuevos con default nulo); el id de captura es `md5(participante_ref:clave:nivel)`; y el
vínculo apunta a su captura con una FK compuesta.

#42 aportará la clave **cotización–pasajero–rol** como **origen tipado** de una fuente nueva, sin cambiar la
identidad de la captura ni la idempotencia de las observaciones. Su migración (no la 214) hará:
1. `alter table public.persona_capturas add column cotizacion_id bigint null, add column pasajero_ref uuid null,
   add column rol text null;`
2. Sustituir, en la misma transacción, `persona_capturas_fuente_ck` por una versión con un disyunto por fuente
   en la que cada fuente exige sus columnas `IS NOT NULL` y las de las demás `IS NULL` (así ninguna fila de
   V1 puede quedar con columnas de cotización):
   ```sql
   check (
        (fuente = 'captura_interna'   and contrato_numero is null     and contrato_pasajero_id is null
                                      and cotizacion_id is null and pasajero_ref is null and rol is null)
     or (fuente = 'contrato_pasajero' and contrato_numero is not null and contrato_pasajero_id is not null
                                      and cotizacion_id is null and pasajero_ref is null and rol is null)
     or (fuente = 'cotizacion'        and contrato_numero is null     and contrato_pasajero_id is null
                                      and cotizacion_id is not null and pasajero_ref is not null
                                      and rol is not null and rol in ('titular','pasajero'))
   )
   ```
   y ampliar `fuente in (...)`. Con el `persona_capturas_nivel_ck` vigente, `cotizacion` queda `comercial`; si
   #42 necesitara otro nivel, cambia ese CHECK en su migración.
3. La idempotencia sigue siendo `persona_capturas.id`. #42 decide cómo deriva ese UUID por evento (generado una
   vez por envío y repetido en los reintentos, o determinista a partir de cotización, `pasajero_ref`, rol y la
   revisión del dato). Si además quiere unicidad por puesto, la declara sobre columnas canónicas, nunca con
   `coalesce`: `create unique index ... on public.persona_capturas (persona_id, cotizacion_id, pasajero_ref, rol,
   <revisión>) where fuente = 'cotizacion';`.
4. Vínculos, titular activo y correcciones siguen siendo de #42; el rollback de la 214 aborta en cuanto exista
   su FK o columna de referencia (3.4, puntos 4 y 5).

### 3.7 Sonda de SQL real (2026-10-17, Postgres 15.19 local y desechable)

Qué es y qué no es: un contenedor `postgres:15` local y desechable con el DDL de 1.2 y un **stub** de
`norm_documento` con la firma de 2.1 pero lógica mínima (solo CC/NIT, sin las reglas completas de 2.2).
Prueba la mecánica del esquema —generadas desde columnas base, CHECK, FK compuestas, índices y `ON
CONFLICT`—, no la gramática ni la RPC. Nada remoto. El contenedor y los archivos de la sonda se eliminan al
terminar; no forman parte del repo.

| Código | Qué se comprobó | Resultado |
|---|---|---|
| T0 | Las tres tablas se crean con las generadas por selección de campo de `norm_documento(...)` y el CHECK sobre la generada `tipo_doc` | creadas |
| G1 | Estados derivados solo de columnas base: `CC` documentada; `C.C.` revision/tipo_invalido; sin tipo provisional; `NIT` sin marca revision/nit_sin_dv_estructurado | como se esperaba |
| G2 | Marca NIT con tipo `CC` | `23514` |
| G3b | NIT con marca y base válida | documentada/800111222 |
| G4 | `ON CONFLICT (tenant, tipo_doc, numero_norm) WHERE estado_doc = 'documentada' DO NOTHING` sobre generadas | 0 filas devueltas; sigue habiendo 1 documentada |
| G5 | Mismo tipo y número en el otro tenant | aceptado |
| G6 / G6b | Promover una ficha en revisión a una clave ocupada | `23505`; la ficha sigue C.C./revision/tipo_invalido |
| G7b | Promover una provisional a una clave libre | CC/555555/documentada (las generadas se recalculan) |
| X1 | Generada que lee otra generada | `42P17` (Postgres lo prohíbe) |
| X2 | `coalesce` dentro de un `UNIQUE` de tabla | `42601` |
| X3 | Índice único de expresión con `coalesce` | aceptado |
| X4 | CHECK de la v2 con `nivel = NULL`, `fuente = 'contrato_pasajero'` y sin contrato | **aceptado**: ese CHECK dejaba pasar la fila inválida |
| I1-I15 | Integridad de capturas y observaciones (3.1) | todos con el código esperado: I1, I4, I5, I9 `23514`; I2, I3, I7, I8 `23502`; I6, I10, I11 `23503`; I15 `23505`; I12 ok; I13 reintento sin duplicar (1 fila); I14 dos capturas independientes = 2 observaciones de 2 capturas |
| D1 / D2 | Disparador diferido: marca sin observación `nit_dv` / con ella | `23514` / ok |
| P1 | Patrón de la v2 (`EXISTS` por tenant + asesor por número aparte) con un número repetido en dos agencias (tabla de juguete sin PK); `venta` mayorista homónimo del asesor minorista | `true`: **filtra** |
| P2 / P3 | Patrón de 1.3.1 (misma fila): el homónimo / la asesora real | `false` / `true` |
| G8 | Las cuatro generadas son `STORED` (`pg_attribute.attgenerated = 's'`) | tipo_doc, numero_norm, estado_doc y motivo_revision = `s` |
| C1-C5 | CHECK `campo <> 'nit_dv' or valor collate "C" ~ '^[0-9]$'` | `7` ok; `X`, `７` y U+0667 `23514`; otro campo con valor libre ok |
| C6 | `[0-9]` frente a U+0667 sin y con `collate "C"` (base `en_US.utf8`) | `false` / `false`: aquí el rango ya era ASCII; el `collate "C"` se mantiene por la regla de 2.2, no porque la sonda mostrara diferencia |
| E1 / E2 | Insertar en `personas` sin / con `EXECUTE` sobre `norm_documento` | `42501` / ok (fila documentada/991133) |

Fallos de la propia sonda (no del DDL) y cómo se resolvieron:
- En la primera pasada G3 imprimió `ok -> (no insertada)` y G7 una línea vacía. La comprobación iba en la
  misma sentencia que el `INSERT`/`UPDATE` ejecutado dentro de una función, y la subconsulta usa la instantánea
  de inicio de esa sentencia; en G7, además, `estado || '/' || NULL` da `NULL`. La segunda pasada, con
  sentencias separadas, dio G3b, G6b y G7b correctos (tabla).
- G8, que listaba las generadas desde `pg_attribute`, falló por un error de la consulta de la sonda
  (`operator is not unique: text || "char"`). Se corrigió en la tercera pasada (tabla).
- Docker dejó de responder entre la segunda y la tercera pasada; la tercera y la cuarta corrieron cuando volvió.
  El contenedor y los archivos de la sonda se eliminaron después (2026-10-17, 00:58-00:59).

---

## 4. Contradicciones y hallazgos frente al código vigente

1. **Normalizador de la 202 contradice el contrato** de rechazar caracteres: elimina en vez de rechazar
   (`migraciones/202`, `lib/crm/leads.ts`). Resuelto con gramática propia (sección 2); la 202 no se toca.
2. **`public.puede_ver_tenant()` (107, L35-37) no comprueba rol:** `mi_rol() in ('superadmin','gerencia') or
   mi_tenant() = t`, y `mi_tenant()` devuelve `'mayorista'` por defecto aun sin fila. Un inactivo, B2B o
   `control_vuelo` pasa el segundo término para su tenant. **El módulo nuevo no lo usa.**
3. **`public.mi_rol()` (140, L32-35) es `SECURITY DEFINER` sin `set search_path`** y `mi_tenant()` aplica un
   `coalesce` a `'mayorista'`. Llamarlos calificados **no corrige** esa deuda ni la traslada a la nueva
   función. Por eso el módulo **no los usa**: lee `public.usuarios` directamente dentro de la función
   (1.4). Siguen siendo deuda de los helpers globales, fuera de #32.
4. **`soy_asesor_del_contrato` / `soy_ese_asesor` (142) empatan por nombre o correo en texto** (L47-64) y la
   primera busca el número en todas las agencias. Por eso la consulta no usa `soy_asesor_del_contrato` y pasa
   a `soy_ese_asesor` el `asesor` de la misma fila de `ventas` ya filtrada por número y tenant (1.3.1; sondas
   P1-P3). Además ambas son `SECURITY DEFINER` con `search_path = public` sin `pg_temp` explícito; califican
   sus tablas (`public.ventas`, `public.usuarios`), así que una relación temporal no las desvía, pero es deuda
   de la 142 que #32 no corrige ni hereda: la función nueva solo invoca `public.soy_ese_asesor` calificada y no
   depende de su `search_path`.
5. **Reserva y `types/database.ts`:** reservado a #35 y cedido a #32 solo para "nuevos objetos de personas";
   será una sección aditiva y su conciliación con #23/#35 es obligatoria antes del PR.
6. **Reserva sin `package.json`:** las pruebas se ejecutan directamente (`node --test pruebas/personas*.test.ts`).
7. **Diferencia con `crm_leads`:** la 202 exige `documento` y `tipo_doc` ambos o ninguno; aquí no, porque la
   ficha provisional puede tener uno solo y el tipo inválido se conserva como original.
8. **Contrato eliminado o renumerado después de una captura.** `eliminar_contrato()` (060, última versión en
   166) borra la fila de `ventas` y `fn_renumerar_contrato()` (115 L39) cambia su número; la captura conserva
   el `contrato_numero` original (append-only y sin FK, 3.1), así que su observación queda oculta para todos
   (1.3.1). Falla cerrado; reapuntarla es una recaptura explícita, no una corrección silenciosa.
9. **Gramática y columnas generadas.** Las generadas se calculan al escribir la fila. Cambiar
   `norm_documento` después exige una migración que recalcule las filas existentes (un `UPDATE` que reasigne
   los originales a sí mismos) y revise antes las colisiones del índice; nunca un `create or replace` aislado.
10. **`ventas.numero_contrato` es hoy PK global** (002 L7). El predicado de 1.3.1 no depende de ello: la sonda
   P1 muestra que el patrón de la v2 filtraría con un número repetido entre agencias, y P2 que el nuevo no.

---

## 5. Pruebas

**Cómo se ejecutan** (todo local y desechable; nunca contra Supabase remoto):
1. `node --test --experimental-strip-types pruebas/personasIdentidad.test.ts pruebas/personasConsulta.wiring.test.ts`
   (gramática con los vectores compartidos y cableado estático).
2. Un Postgres 15 desechable y una base plantilla con el esquema vigente SIN la 214 (migraciones 001-213,
   que incluyen 211, 212 y 213, aplicadas en orden con `psql -1`). Dos variantes:
   - **Recomendada y versionada:** imagen de Supabase (`public.ecr.aws/supabase/postgres:15.8.1.085`)
     preparada con `supabase/scripts/preparar_esquema_local.sh <contenedor> 213 <plantilla>` (el arnés de #23,
     ya en `main`; #32 no lo modifica). Roles reales: `ROL_ADMIN=supabase_admin`, `ROL_MIGRA=postgres` (los
     valores por defecto del runner). La cabecera del runner trae la secuencia completa de comandos.
   - `postgres:15` simple con el andamiaje mínimo que la 214 necesita de Supabase: roles `anon`,
     `authenticated`, `service_role` (BYPASSRLS) y `authenticator` (login, noinherit); un rol de migración
     NO superusuario con BYPASSRLS, dueño de lo que crea y con los `ALTER DEFAULT PRIVILEGES` de Supabase
     hacia los tres roles de API; `auth.uid()/role()/jwt()` leyendo `request.jwt.claims`, `auth.users` y
     `storage.buckets/objects`. Se ejecuta con `ROL_ADMIN=<superusuario> ROL_MIGRA=<rol de migración>`.
   La primera corrida (base `ef03a489`) usó la segunda variante, con un script de preparación que no está en
   el repo: la imagen de Supabase entraba en bucle de recuperación en este equipo. La corrida de conciliación
   (base `8987932e`, 5.1) usa la primera, toda versionada; la causa de las caídas era la memoria del equipo
   (Docker con ~3,9 GB compartidos), no la imagen. Sobre la imagen, el runner hace en `crear_base` dos ajustes
   de ENTORNO, no de esquema, antes de tomar la huella de M7: `GRANT CREATE ON SCHEMA public` al rol de
   migración (en Supabase alojado `postgres` crea en `public`; aquí la base la crea `supabase_admin`) y el
   `auth.uid()`/`auth.role()` de Supabase alojado, que leen `request.jwt.claims` además del GUC heredado
   (la imagen sin el servicio de Auth trae la versión antigua, que solo lee `request.jwt.claim.sub`; los
   arneses versionados `local-desde-cero.sh` y `test_207_api_*` hacen lo mismo).
3. `sh supabase/scripts/test_214_personas_carreras.sh <contenedor> <plantilla> <red>`: ciclo de la migración
   (preflight, 214 dos veces como `ROL_MIGRA`, postcheck, regresión de objetos ajenos),
   `test_214_personas_identidad.sql`, carreras K, rollback RB y API H con un PostgREST propio. Cada base lleva
   una marca y se borra al terminar.

**Equivalencia app/SQL** (un solo JSON de vectores, ejecutado por TS y por SQL con salida idéntica):
- Todos los casos de 2.4.1 (T1-T13, N1-N14, D1-D8, C1-C5) y los de `dv_nit_valido`, más `ı`, `ß`, `ſ` y
  U+212A sueltos como tipo, y `\n` en los bordes. Con los ajustes de la aprobación, los bordes de la base
  NIT van en las dos gramáticas: alta con 2, 3, 20 y 21 dígitos (D6a-D6d) y consulta con 2, 3, 20 y 21
  (C6, C7, C10, C11). El archivo tiene 65 vectores de gramática, 3 de llamadas mal formadas, 14 de DV, 5 de
  longitud de originales y 3 solo de TS; TS y SQL fallan si el conteo cambia sin actualizarlos a la vez.
  Cada vector fija las cuatro entradas (tipo, número, marca,
  modo) y la salida completa (`tipo_doc`, `numero_norm`, `estado_doc`, `motivo_revision`), y además que los
  originales salen idénticos a la entrada. Los casos "escritor" (D5, D7) se prueban contra la función de
  escritura, no contra la gramática.
- Prueba de cableado sobre el código TS: falla si `lib/personas/identidad.ts` contiene `.trim(`,
  `toUpperCase(`, `toLowerCase(`, `normalize(`, `\d`, `\s`, `\w` o una expresión con flag `i`/`u`/`v`.
  Equivalente SQL en el postcheck (C19): el cuerpo de las funciones de `p214_priv` y de la consulta no
  contiene `upper(`, `lower(`, `trim(` sin segundo argumento, `normalize(` ni `[[:`.
- Cableado de la 214: falla si la migración menciona `soy_asesor_del_contrato`, si alguna generada de
  `personas` no llama a `norm_documento` exactamente con `tipo_doc_original, documento_original,
  nit_dv_estructurado, 'alta'`, o si `persona_observaciones` vuelve a tener columnas de fuente u origen.
- Longitud de originales: 64 puntos de código aceptados aunque `x.length` en TS dé más (carácter fuera del
  plano básico); 65 rechazados en ambos lenguajes.
- Propiedad "coincide con la 202" para entradas válidas no NIT.

**Divergencia de DV:**
- Dos capturas con DV distintos para la misma base: dos observaciones `nit_dv`, cada una con su captura,
  `divergencia = true` para administración; ninguna sobrescribe.
- Misma fuente con DV distinto en dos momentos: dos capturas, dos observaciones.
- Reintento de la misma captura con el mismo DV: una sola observación. Con otro DV: `captura_inconsistente`,
  nada escrito.
- Actor que solo ve una de las dos capturas: una variante y `divergencia = false`.
- Alta libre `900123456-7` cuando ya existe la documentada `900123456`: queda una ficha aparte en revisión,
  sin observación `nit_dv` y sin cambiar la documentada.
- DV inválido (`K`, `77`, ancho completo) o DV con tipo no NIT: error de entrada antes de escribir; conteos de
  las tres tablas sin cambios.
- `nit_dv` para una persona que no es NIT: lo rechaza el escritor (no hay CHECK posible entre tablas).

**Visibilidad y no filtración** (cada caso compara la respuesta completa, no solo el conteo):
- Persona cuyas observaciones son todas no autorizadas para el actor: respuesta idéntica a la de una clave
  inexistente (sin filas, `total = 0`, `has_more = false`, sin `persona_id`, mismas claves JSON).
- `venta` con captura `pasajero_contrato` de: contrato propio (visible); contrato de un colega de su agencia
  (oculta); contrato eliminado o renumerado después de la captura (oculta para todos, superadmin incluido:
  R27/R27b borran la fila de `ventas`; R28 llama a la `fn_renumerar_contrato` real de la 115, que mueve el
  pasajero por su FK y deja la captura con el número viejo, y comprueba el vacío idéntico para `venta`,
  administración y superadmin).
- **Número repetido entre agencias** (bloque `V3a-V3f` del SQL; base desechable, transacción que termina en
  `ROLLBACK`). Primero se comprueba que hoy es imposible: insertar el número de un contrato mayorista
  (`DTM-92141`) en minorista falla; con el esquema vigente lo rechaza antes el CHECK de formato por agencia
  de la 160 (`23514`) y, si faltara, la PK global (`23505`). Luego, dentro de la transacción, se retiran los
  dos candados (`ventas_numero_contrato_formato_por_tenant` y `ventas_pkey ... cascade`) y se siembra
  `DTM-92149` en mayorista (asesora "Ana Ruiz") y en minorista (asesor "Luis Mora"), con una captura
  `pasajero_contrato` mayorista ligada a ese número. Esperado y comprobado: con el número repetido,
  `soy_asesor_del_contrato` da `true` al homónimo de la otra agencia (la fuga que 1.3.1 evita); aun así el
  `venta` mayorista "Luis Mora" **no** la ve; "Ana Ruiz" sí; el `venta` minorista "Luis Mora" no la ve por
  tenant. Los números de prueba siguen el formato de la 160 (`DTM-` en mayorista, `MIN-` en minorista).
- Una captura con `nivel = 'pasajero_contrato'` y otra fuente, o sin contrato, no se puede insertar (`23514`,
  sondas I1 e I5): el filtro no depende de que no exista.
- Paginación (P1-P8): sobre la misma persona, 60 capturas `captura_interna` de la agencia (autorizadas para
  todo interno de ella, cada una con un nombre distinto) y 10 `contrato_pasajero` de un contrato de un colega
  (valor `AJENO ...`), que un `venta` que no es su asesor no debe ver. `p_limite = 50`
  da 50 filas, `total = 60`, `has_more = true`; la página 2 da 10 filas y `has_more = false`; las dos
  páginas no se solapan y cubren las 60. Las variantes se calculan sobre las 60 (`n_valores = 60`,
  `divergencia = true`) pero solo detallan 10 valores (`valores_omitidos = 50`); administración ve 70 con
  10 detallados y 60 omitidos. Ningún `AJENO` aparece en la página ni en las variantes. La respuesta con 70
  observaciones autorizadas mide menos de 64 KiB. Desplazamiento más allá del total: página vacía,
  `total` intacto. `p_limite = 51`, `0` o negativo y `p_offset` negativo: error de parámetro (`22023`),
  igual con o sin datos.
- Ficha provisional y ficha en revisión con el mismo número: nunca aparecen en la consulta.

**Integridad: la base rechaza los estados inválidos, no solo el escritor.** Cada fila de la tabla de 3.1 con
su `SQLSTATE` esperado: `23502` por `NOT NULL` (fuente, nivel, campo o valor nulos); `23514` por CHECK
(`contrato_pasajero` sin contrato, captura interna con contrato, nivel incoherente con la fuente, `nit_dv` que no
es un dígito, marca NIT con tipo no NIT); `23503` por las FK compuestas (captura con otro tenant que su persona,
observación sobre la captura de otra persona o con otro tenant); `23505` por la PK de capturas (id reutilizado
para otra persona). Además, la marca NIT sin observación `nit_dv` falla al confirmar (`23514`, disparador
diferido), y el disparador de `contrato_pasajero` rechaza un `contrato_pasajero_id` que no pertenece al
contrato o un contrato de otro tenant. Las sondas I1-I15, G2 y D1/D2 de 3.7 ya comprobaron el DDL de 1.2.

**ACL/RLS por llamada directa a tablas y función** (anon, B2B propio y ajeno, venta propio/ajeno/cruzado,
administración, operaciones, gerencia, superadmin, `control_vuelo`, inactivo, usuario sin fila): `SELECT/
INSERT/UPDATE/DELETE` a las tres tablas denegados a `anon` y `authenticated`; `service_role` sin `DELETE` ni
`TRUNCATE`, y sin `UPDATE` de capturas, de observaciones ni de la clave de una documentada (triggers); `EXECUTE` de
`buscar_personas_documento` solo para `authenticated` (denegado a `anon`, `service_role` y `PUBLIC`); `EXECUTE`
de `p214_priv` y `USAGE` del esquema solo para `service_role`. El postcheck verifica con `has_table_privilege`,
`has_function_privilege` y `has_schema_privilege` cada combinación rol x objeto, además de `proowner`,
`prosecdef`, `provolatile` y `proconfig`. Se corre también sobre una base con los `ALTER DEFAULT PRIVILEGES`
de Supabase reproducidos, para demostrar que los `REVOKE` explícitos los anulan.

**Pruebas por API con JWT reales (PostgREST local):** un PostgREST desechable con secreto JWT local y tokens
HS256 firmados para cada usuario sembrado (claims `sub`, `role`, `aud`, `exp`). Las rutas se escriben como
en Supabase (`/rest/v1/...`); el PostgREST local las sirve en la raíz (`/personas`, `/rpc/...`), sin el
gateway que antepone `/rest/v1`. Comprobar, por rol:
- `GET`, `POST`, `PATCH`, `DELETE` sobre `/rest/v1/personas`, `/rest/v1/persona_capturas` y
  `/rest/v1/persona_observaciones`: denegados o sin datos, nunca filas.
- `POST /rest/v1/rpc/buscar_personas_documento`: resultado esperado de 1.3 por rol; sin `Authorization`
  (anon): denegado.
- `p214_priv`: `POST /rest/v1/rpc/upsert_persona` y lo mismo con `Content-Profile`/`Accept-Profile:
  p214_priv`: no alcanzable (esquema no expuesto, sin `USAGE`).
- Token firmado con **otro secreto**, token vencido, y token con `role` o `sub` alterados después de
  firmar: rechazados con 401 por PostgREST antes de llegar a la base.
- `p_tenant` de la otra agencia en el cuerpo, para `venta`/`administracion`/`operaciones`: vacío
  indistinguible de "no existe".
- Usuario desactivado (`activo = false`) después de emitir el token: vacío, aunque el token siga vigente.
- Token válido con `role = service_role` y sin `sub`: la función devuelve vacío (y no tiene `EXECUTE`).

**Límite que se registra:** falsificar `request.jwt.claims` o GUC dentro de una sesión `psql` que **ya tiene**
`SET ROLE authenticated` solo prueba la lógica de la función dado un contexto de claims; **no** prueba
resistencia de la autenticación, porque quien puede ejecutar SQL como `authenticated` puede fijar esos GUC por
sí mismo. En producción los GUC los fija PostgREST tras verificar la firma, y el cliente nunca abre conexión
SQL directa. Por eso las pruebas de autenticación son las HTTP con JWT reales, y las de `psql` se etiquetan
"lógica de autorización", no "seguridad de autenticación". Las pruebas HTTP locales demuestran que PostgREST
rechaza firmas, vencimientos y claims alterados con el secreto local; no prueban la configuración de claves
ni la emisión de tokens de GoTrue en Supabase real, que queda fuera del entorno local y se registra como
límite.

**Carreras reales** (dos o tres conexiones `psql` como `service_role`, `READ COMMITTED`, Postgres
desechable). El orden se fuerza sin `pg_sleep` como sincronizador: la sesión A abre transacción, ejecuta su
operación y **queda abierta**; la B lanza la suya, que debe quedar en espera (se comprueba en
`pg_stat_activity.wait_event_type = 'Lock'`); entonces A confirma o aborta.
- K1. Dos altas documentadas de la misma clave con capturas distintas, A confirma: B devuelve `existente` con
  el mismo id; una persona; una captura por llamador, con sus observaciones.
- K2. Igual, pero A aborta: B devuelve `creada` en la misma sentencia; una persona; nunca duplicado ni éxito
  falso.
- K3. Dos altas provisionales con el mismo id de captura (`clave_alta`): una ficha y una captura. Con el mismo
  id y originales distintos: `clave_alta_reutilizada`, sin cambios.
- K4. Dos promociones de **fichas distintas** a la misma clave: la primera en confirmar queda documentada; la
  otra devuelve `conflicto` con el id ganador, y su ficha queda **intacta** (se compara la fila completa, sus
  capturas y sus observaciones antes y después; la captura de la promoción perdedora no existe); nada se fusiona.
- K5. Dos promociones de **la misma** ficha a la misma clave: una `documentada`, la otra `ya_documentada`.
- K6. Alta y promoción cruzadas a la misma clave, en los dos órdenes (4. de la promoción).
- K7. Llamada bajo `REPEATABLE READ` o `SERIALIZABLE`: `aislamiento_no_admitido` y nada escrito.
- K8. Relectura que no encuentra la fila: **no ejecutable**. Con el borrado y el cambio de clave bloqueados por
  disparadores (y la consulta de relectura con nombres calificados, imposible de interceptar), el caso es
  inalcanzable sin desactivar disparadores. El código conserva la defensa (`alta_inconsistente`); queda sin
  prueba y así se informa.
- K9. El mismo evento (mismo id de captura) enviado dos veces a la vez sobre una documentada: una persona, una
  captura, observaciones sin duplicar; ambos reciben el mismo `persona_id`.
- K10. Reintento con el mismo id de captura y carga distinta (otro valor u otro origen): `captura_inconsistente`,
  nada escrito en ninguna de las tres tablas.
- K11. Dos eventos independientes (ids distintos) con igual campo y valor sobre la misma persona: dos capturas y
  dos observaciones, cada una con su procedencia (el caso que la v2 colapsaba).

**Rollback** (cada caso parte de la 214 aplicada y comprueba que tras abortar no se borró nada):
- Aborta con una persona sin capturas ni observaciones (documentada, provisional y en revisión, por
  separado); el mensaje trae los conteos 1/0/0.
- Aborta con una persona y una captura sin observaciones (1/1/0).
- Aborta con persona, captura y observaciones (1/1/n). Los tres conteos del mensaje prueban que cada
  comprobación corre por separado sin necesitar estados que las FK impiden: una observación o una captura sin
  persona no son alcanzables y no se prueban.
- Aborta con una tabla ajena con FK hacia `personas` o `persona_capturas`, aunque esté vacía.
- Aborta con una tabla ajena con columna `persona_id` o `captura_id` sin FK.
- Aborta con una vista o función ajena que dependa de las tablas o de `p214_priv`.
- Escritura concurrente (RB7/RB7b), con la misma compuerta que K y sin `pg_sleep` como sincronizador: A
  inserta una persona sin confirmar y se detiene en la compuerta; se comprueba en `pg_stat_activity` que el
  rollback quedó esperando el `LOCK` de la tabla; se abre la compuerta. Si A aborta (RB7), el rollback
  procede sobre tablas vacías; si A confirma (RB7b, en una base aparte porque la fila no se puede borrar), el
  rollback aborta con 1/0/0 y los objetos quedan intactos (postcheck en verde). El `lock_timeout` de 10 s
  del rollback es parte del producto; la prueba abre la compuerta en cuanto ve la espera.
- Referencia blanda invisible (RB5c): con la tabla ajena sin privilegios para nadie, un rol sin privilegios
  (`anon`) obtiene 0 columnas en `information_schema` y 1 en `pg_catalog`. En Supabase el rol `postgres`
  es miembro de `pg_read_all_data` y vería la columna igual; el rollback no depende de eso.
- Con todo vacío: se ejecuta, no queda ningún objeto de la 214, y volver a aplicar la 214 funciona.

**Regresión (M7):** antes de aplicar la 214 y después de aplicarla dos veces se toma, por catálogo, una huella
de todo lo ajeno a ella: `pg_policies` completas, la definición, ACL y dueño de cada función fuera de
`p214_priv` (menos la consulta nueva), ACL, RLS y dueño de cada tabla/vista ajena, disparadores de tablas
ajenas, ACL de esquemas y ACL por defecto. Las seis huellas deben ser idénticas; se informa además el estado
de `crm_contactos` (policies, RLS y si `anon` puede leerla), que la 207 cerró y la 214 no debe reabrir. La
202 queda cubierta por la huella de funciones (definición incluida).

**Auditoría (087):** el disparador genérico `trg_auditoria` se adjuntó con un bloque `DO` a las tablas que
existían al correr la 087; la 214 **no** lo adjunta a sus tablas a propósito. Copiaría los documentos y las
observaciones (antes/después en `jsonb`) a `auditoria`, que leen `superadmin` y `gerencia` sin el filtro por
fuente y contrato de 1.3, y abriría por ahí la vía lateral que 1.4 cierra. La trazabilidad de la 214 está
en sus propias filas: las capturas no se editan ni se borran y guardan actor, rol, fuente y origen. Volver
a correr el bloque `DO` de la 087 **sí** lo adjuntaría; quien lo haga debe excluir estas tres tablas. Como en
la 203, el comentario de cada tabla lo dice, y el postcheck (C20) falla si aparece un disparador que no sea
uno de los nueve propios.

### 5.1 Corridas locales de la migración real

**CI (desde el merge de #363):** el job `test-214-personas.yml` corre en Actions sobre la cadena 001-213 +
214 (run `39151910521`, verde). Queda **fijo** en esa cadena y probando la 214 sola: en una base con la 219, la
E8g de `test_214_personas_identidad.sql` (la fuente `cotizacion` todavía no existe) se invertiría a propósito.
La 219 trae su propio workflow (`test-personas-cotizaciones-42.yml`), que corre la prueba SQL 214 completa,
E8g incluida, DESPUÉS de su rollback (sección 8.6).

**Vigente: conciliación con `main` `8987932e` (2026-10-17).** Todo con archivos versionados: imagen
`public.ecr.aws/supabase/postgres:15.8.1.085`, plantilla con `preparar_esquema_local.sh pg214_sb 213
plantilla214sb` (211 migraciones, 001-213, que incluyen 211, 212 y 213; 0 fallos de esquema) y la 214
aplicada por `postgres` (NO superusuario, BYPASSRLS, miembro de `pg_read_all_data`, como en Supabase).

| Bloque | Resultado |
|---|---|
| TS focal (`node --test` de las dos pruebas de #32) | 28 pruebas, 28 OK |
| `tsc --noEmit -p tsconfig.json` (todo el proyecto, `strict`) | rc 0 |
| `eslint` sobre `lib/personas` y las dos pruebas | rc 0 |
| M (ciclo) | preflight sin bloqueantes, 214 dos veces, postcheck 20/20, 0/0/0 filas, M7 idéntica (`anon` sigue sin leer `crm_contactos`) |
| S (`test_214_personas_identidad.sql`) | 149 verificaciones OK |
| K (carreras) | K1-K7, K9, K10 OK (K11 dentro de K1); K8 no ejecutable (3.3) |
| RB (rollback) | RB1-RB9, RB5b, RB5c y RB7b OK |
| H (PostgREST v16.1, JWT HS256) | H0-H21 OK; H22 informativa |
| Total del runner | 59 OK, 0 fallos; ninguna base de prueba sobrante |

Inestabilidad del entorno registrada, no de la 214: el equipo trabajaba casi sin memoria comprometible y el
servidor del contenedor se reinició tres veces (`server process ... exited with exit code 2`); la corrida que
coincidió con dos de esos reinicios dio 53 OK y 5 fallos: K3 (dos líneas), RB7 y RB8 por los reinicios, y
RB5 porque su diseño suponía que `postgres` no vería la tabla, cosa que la imagen invalida. Se corrigió el arnés (compuerta reintentable en K, RB7 con compuerta en vez de
`pg_sleep`, RB5c con un rol sin privilegios, limpieza con reintentos y `DROP DATABASE ... WITH (FORCE)`) y la
corrida de 59/0 no tuvo ningún reinicio del servidor.

**Histórica: base `ef03a489`.** `postgres:15` simple con un script de preparación que no estaba en el repo
(plantilla 001-212): TS 28/28, `tsc` estricto sobre los 5 archivos TS rc 0, SQL 149 OK y runner 57 OK / 0
fallos. Defectos que encontró y se corrigieron: precedencia de `COLLATE` sobre `->>` en `carga_esperada`;
números de contrato de prueba fuera del formato de la 160; `request.jwt.claims` vacío (`''`) en las pruebas,
que rompe `fn_auditoria`; la referencia blanda que `information_schema` ocultaba al rollback (3.4); y una
plantilla cuyo `GRANT` masivo posterior a las migraciones deshacía sus `REVOKE`.

## 6. Defaults V1 aceptados por Auditorías

Sujetos a vectores y sin descartar valores originales: longitud normalizada 3-20; CE numérica; espacio ASCII
y punto como separadores; guion excluido; NIT libre en revisión; verificación DIAN del DV diferida;
`actor_id` nunca devuelto; origen ajeno oculto (la "`fuente_ref` ajena" del default es hoy `contrato_numero`
y `contrato_pasajero_id`, 1.3); máximo 50 resultados por página con error si se excede; escritura privada
solo para `service_role`.

Ajustes obligatorios de la aprobación de la v3, ya incorporados: la base NIT usa el mismo rango 3-20 (no
5-10), y la consulta acota también el detalle de `variantes` (10 valores por campo, sin procedencia por valor;
1.3.2).

## 7. Dependencias

- **Base conciliada:** el worktree pasó de `ef03a489` a `main` `8987932e` (#23/213, #52 y #35/211 ya
  integrados). `types/database.ts` se concilió sin conflicto: `main` agregó tablas y columnas (213 y 211) y
  siete RPC de la 211 dentro de `Functions` (`crear_cotizacion_comparativa` ... `comparativas_b2b_visibles`);
  la entrada de #32 sigue siendo solo `buscar_personas_documento`, al final de `Functions`, sin solaparse
  con ellas ni repetir nombres (el cambio de #32 es idéntico al previo: 17 líneas añadidas, 0 quitadas).
  211, 212 y 213 no alteran `usuarios`, `ventas.asesor/tenant/numero_contrato`, `contrato_pasajeros`,
  `soy_ese_asesor` ni `auth.uid()`, y no crean nombres `persona*`, `p214*` ni columnas `persona_id`/`captura_id`.
  La 211 agrega `trg_madre_sin_venta` en `ventas`, que solo actúa sobre `cotizacion_id` (las pruebas de la 214
  no lo usan) y la FK `cotizaciones.propietario_id -> usuarios` (ON DELETE RESTRICT; la 214 no borra usuarios).
- **#35 / 211:** comparte `types/database.ts` y rutas de cotizaciones, que #32 no toca.
- **#42 (219):** solo llama a `upsert_persona` desde sus dos fachadas; `promover_persona` no tiene llamador.
  Agrega la fuente `cotizacion`, el vínculo y el ref estable de pasajero (sección 8).
- **#40:** consume `buscar_personas_documento`; cobertura histórica requiere adaptador aparte. Desde la 219 la
  respuesta trae también capturas de cotización (procedencia `cotizacion_id`, `rol`, `activo`).
- **Aplicación remota:** la 214 ya corrió en Producción según el dueño. La 219 sigue su propio orden (8.7).

## 8. #42 — personas de cotizaciones en el CRM (migración 219)

Contrato: `docs/coordinacion/auditorias-identidad-crm.md` (C1-C8) y decisiones del dueño D-3=N2, D-4, D-5 y D-6
(D-1 retiro de pasajero y D-2 titular que viaja, diferidas: V1 sin editor/retiro de pasajeros ni fusión por
inferencia). Reserva en `WORKSTREAMS.md` (2026-10-19). Archivos:
`supabase/migrations/20260601000219_personas_cotizaciones.sql` y `supabase/scripts/*_219_personas_cotizaciones.*`.

### 8.1 Modelo
- `persona_capturas` gana `cotizacion_id`, `participante_ref` y `rol`, obligatorios solo para la fuente
  `cotizacion` (CHECK de tres disyuntos). Nivel N2: titular `comercial`, pasajero `pasajero_cotizacion`.
- `cotizacion_participantes` es el **puesto**: `id` = `participante_ref` (inmutable), cotización + tenant con FK
  `(cotizacion_id, tenant) -> cotizaciones` ON DELETE RESTRICT, rol, orden (solo para mostrar), persona y captura
  vigentes con FK compuesta `(captura_id, persona_id, tenant, cotizacion_id, id, rol)` (una captura de otro
  puesto, cotización, tenant o persona no cabe), `activo`/`retirado_*` (sin uso en V1), `version` que sube sola.
  Un solo titular activo por cotización. Sin DELETE ni TRUNCATE; RLS sin policies; `service_role`
  SELECT/INSERT/UPDATE; sin `trg_auditoria`.
- Identidad de la captura: `md5(participante_ref || ':' || clave || ':' || nivel)::uuid`, con `clave = 'alta'`
  en el alta y un UUID por envío en las correcciones. Misma clave con otra carga = `captura_inconsistente`.

### 8.2 Ref estable por flujo (C2)
- **Reservar** (`crearCotizacion`): `asignarRefsPasajeros` (lib/personas/cotizacion.ts) da en servidor, ANTES del
  insert, un UUID a cada fila identificada de `payload.pasajeros` y `detalle.pasajeros`; descarta cualquier `ref`
  del navegador. Las filas vacías no crean puesto. `PasajeroReserva.ref?` es aditivo y las conversiones lo
  ignoran (`payloadGuardarPasajeros` arma claves explícitas).
- **Titular** (todos los flujos): sin ref en el payload; se encuentra por el índice de titular activo.
- La fachada exige que el ref de un pasajero esté en el `payload.pasajeros` de ESA cotización
  (`ref_inconsistente` si no, o si ya es de otra).

### 8.3 Fachadas (SECURITY DEFINER, EXECUTE solo `service_role`, primer candado = la cotización)
- `registrar_personas_cotizacion(id, usuario, participantes)`: alta y reintento. Rechaza puestos sin documento,
  nombres ni apellidos (`participante_vacio`), campos ajenos al puesto, dos titulares y el tipo en una
  cotización anónima. Un alta repetida no escribe (`reintentos`); si el editor ya corrigió el puesto, el alta se
  omite (`omitidos`). Devuelve conteos; nunca ids de persona ni si la ficha existía (D-4).
- `actualizar_titular_cotizacion(id, usuario, titular, version, clave)`: solo manuales simples abiertas; en una
  transacción registra la captura nueva, re-apunta el vínculo (versión +1) y reescribe `payload.cliente`,
  `detalle.venta.cliente`, `cliente` y `cliente_documento` con el tipo CRUDO (vacío se guarda vacío; la 198 lo
  sigue exigiendo al convertir). CAS por versión (`version_obsoleta`), `sin_cambios` si coincide con la captura
  vigente y `reintento` si se repite el mismo envío. Crea el puesto en cotizaciones anteriores a #42.
- `sellar_creador_cotizacion(id, usuario)`: el sello NUEVO de Reservar y del checkout con sesión. Solo
  `tarifario`/`carrito` simples abiertas, sin sello, con `creado_por` = correo del usuario y de menos de 15
  minutos: un histórico o una cotización ajena nunca se vuelve propia. Idempotente. La manual conserva el sello
  de la 216 y las comparativas/hijas el de la 211.
- Actor (defensa en profundidad): activo; interno = tenant de la cotización (superadmin cualquiera);
  agencia/freelance solo si `creado_por_id` = su usuario; usuario nulo solo en el checkout anónimo (carrito o
  comparativa del carrito, mayorista, sin creador/propietario/aliado), cuyas capturas son siempre provisionales.

### 8.4 Lecturas (un solo filtro: `p214_priv.captura_visible`)
- Para `cotizacion`: solo la captura VIGENTE de un puesto (una corrección deja de mostrar la anterior), del
  tenant autorizado; `venta` ve lo comercial del tenant y lo restringido solo en cotizaciones propias;
  agencia/freelance solo puestos activos de cotizaciones de su usuario.
- `buscar_personas_documento` (misma firma) agrega `cotizacion_id` (a `venta` solo si es propia), `rol` y
  `activo`; sigue cerrada a B2B.
- `crm_personas_cotizacion_buscar(p_tenant, p_texto, p_limite, p_offset)`: lista paginada (máx. 50 con error)
  de puestos activos con su captura vigente, estado de ficha y cotización de origen. `venta` y B2B, solo
  cotizaciones propias; gerencia/superadmin con `p_tenant` explícito; vacío idéntico para "sin permiso".
  Vista: `/crm/personas-cotizacion`.

### 8.5 App y errores (C7)
- Cada alta llama a la fachada DESPUÉS de guardar la cotización y nunca ignora su resultado: si falla, log sin
  datos personales (`[personas42] origen=… etapa=… cotizacion=… codigo=…`) y, en flujos internos,
  `avisoPersonas` en el resultado. La ficha muestra un aviso persistente CALCULADO (titular identificado sin
  puesto activo o pasajero con ref sin puesto) con «Reintentar», que reconstruye desde el payload guardado.
- El checkout pide el tipo de documento (D-6) sin bloquear el envío; anónimo = provisional.
- Mensajes en español por código (`mensajePersonas`); nunca el texto crudo de Postgres.

### 8.6 Pruebas
- TS (local): `pruebas/vectoresPersonasCotizacion42.test.ts` y `pruebas/cableadoPersonasCotizacion42.wiring.test.ts`.
- Actions (`test-personas-cotizaciones-42.yml`, cadena 001-217 sin fabricar la 218): M (preflight, 219 dos veces,
  postcheck 20/20, postchecks 216/217 intactos, postcheck 214 en rojo SOLO en C15/C16, objetos ajenos idénticos),
  S (`test_219_personas_cotizaciones.sql`), G (batería de #39 con la 219), K (carreras), RB (rollback: aborta con
  datos, vista ajena o foto incompleta; vacío restaura la 214 exacta, postcheck 214 20/20 y prueba SQL 214 con
  E8g) y H (PostgREST con JWT).

### 8.7 Orden remoto (lo ejecuta el usuario, con autorización separada)
preflight 219 (fila consolidada) → 219 → postcheck 219 (fila consolidada; "Filas" trae el monitor de C7) →
despliegue del código. Con la 219 aplicada y el código viejo, nada se rompe: las cotizaciones nuevas quedan
sin puestos (el monitor y el aviso de la ficha las muestran) hasta el despliegue. Revalidar el orden con la 218
de #56 antes de aplicar. Rollback: `rollback_219_personas_cotizaciones.sql` (solo sin capturas de cotización
ni puestos).
