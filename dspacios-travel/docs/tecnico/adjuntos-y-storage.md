# Adjuntos del contrato y Storage

Por qué falló `STORAGE DELETE (propio)` en producción, qué se corrigió y cómo se
prueba ahora.

| Archivo | Para qué |
|---|---|
| `lib/adjuntos/operaciones.ts` | Orquestación pura de subir/eliminar (archivo + fila). |
| `pruebas/adjuntos.test.ts` | Pruebas de regresión de lo anterior (`npm run test:unit`). |
| `supabase/scripts/pruebas/storage-adjuntos.mjs` | Prueba de integración por la API de Storage. |
| `supabase/scripts/test_venta_tokens_y_escritura.sql` | Prueba de RLS (ya no hace DML sobre `storage.objects`). |

---

## 1. La falla: la prueba estaba mal, no las policies

Tras aplicar la 149, `test_venta_tokens_y_escritura.sql` dio **117/118**. La
única en rojo:

```
STORAGE DELETE (propio) — debe afectar filas | > 0 filas | 0 | FALLA
```

La prueba hacía `delete from storage.objects ... where name like '<contrato>/%'`
y esperaba que borrara filas.

**Supabase trata `storage.objects` como solo lectura desde SQL.** Los archivos
se eliminan con la API (`.remove()`), que borra el objeto físico y después su
fila. Un `DELETE` en SQL:

- puede estar bloqueado en Supabase alojado aunque funcione en un PostgreSQL
  local — que es exactamente lo que pasó: en local daba verde, en producción no;
- y **aunque funcionara sería un error**, porque borraría el índice dejando el
  archivo físico huérfano en el almacenamiento.

**La aplicación nunca hace eso.** Borra siempre con `.remove()`
(`adjuntos-actions.ts`). Así que la comprobación en rojo no señalaba ningún
problema de permisos: señalaba que la prueba verificaba algo que el sistema no
hace, y que además no debería hacer.

### Por qué no se sabe todavía el motivo exacto del 0

La prueba hacía `exception when others then n := 0` y **se tragaba el mensaje de
PostgreSQL**. Un `0` puede ser "la policy lo denegó" o "la operación reventó por
otra razón" — y no había forma de distinguirlo.

Eso ya está corregido: `_res` tiene una columna `detalle` con el `SQLERRM`, y el
resultado la imprime. **Pero el motivo concreto de aquella ejecución se perdió**,
y no lo voy a inventar. No hace falta para nada: la prueba que lo provocaba
desapareció por ser inválida, y el comportamiento real se verifica ahora por la
API.

Lo que sí se puede afirmar de aquella corrida: `STORAGE INSERT (propio)` y
`STORAGE UPDATE (propio)` **sí pasaron**, así que `soy_asesor_del_contrato`
resolvía bien y las policies del bucket estaban puestas. Solo el DELETE se
comportó distinto.

---

## 2. Los agujeros reales que aparecieron al revisar esto

Ninguno lo detectaba la prueba SQL. Varios dejan **archivos huérfanos**: un
fichero con la cédula de un cliente que se queda en el bucket sin nada que lo
referencie, invisible en la pantalla e imposible de borrar desde la interfaz.

El hilo común de casi todos es el mismo: **una respuesta sin error no es una
operación realizada**. Aparece tres veces —en `remove()` de Storage, en el
`DELETE` de PostgREST, y en las órdenes de limpieza de la propia prueba de
integración— y las tres veces había que mirar algo más que `error`.

### 2.0 `eliminarAdjunto` confiaba en lo que mandaba el navegador

Recibía `id`, `path` y `numeroContrato` **del cliente** y borraba el `path`
recibido. Las policies de Storage lo filtran, así que no era explotable — pero
apoyar el borrado en un dato que viene del navegador convierte cualquier futuro
descuido en una policy en un problema grave.

Ahora recibe **solo el `id`**, lee la fila con el cliente autenticado (pasando
por RLS) y usa **exclusivamente** el `path` y el `numero_contrato` que dice la
base. Si la fila no es visible, se para **antes de tocar Storage**.

### 2.1 `eliminarAdjunto` tiraba el resultado de `remove()`

```ts
await sb.storage.from(BUCKET).remove([path]);   // ← resultado ignorado
const { error } = await sb.from("contrato_adjuntos").delete().eq("id", id);
```

Si Storage rechazaba el borrado, la fila desaparecía igual. El adjunto dejaba de
verse y el archivo se quedaba ahí para siempre.

Corregido: se comprueba el resultado y **la fila solo se borra si el archivo se
borró de verdad**.

> **El detalle que no es evidente:** mirar `error` no basta. Cuando una policy
> filtra el objeto, la API responde **sin error** y devuelve la lista de lo que
> sí borró — donde ese path simplemente no aparece. Hay que comprobar que el
> path esté en `data`, no solo que `error` sea null.

**Y lo mismo pasa del lado de Postgres.** `delete().eq("id", id)` devolvía
`error: null` aunque la RLS filtrara la fila y no borrara nada: indistinguible
de un borrado correcto. Ahora es `delete().eq("id", id).select("id")` y se exige
**exactamente una** coincidencia. Es el mismo patrón dos veces: una respuesta
sin error no es una operación realizada.

#### El reintento tiene que poder resolver

Cuando el archivo se borra y el `DELETE` de la fila falla, queda una **fila
colgada**. El mensaje decía "vuelve a intentarlo" — y el reintento **no podía
funcionar**: el segundo `remove()` no borra nada (el archivo ya no está), así
que chocaba otra vez contra "el almacenamiento no eliminó el archivo" y la fila
no se podía quitar nunca desde la interfaz. Una instrucción que no resuelve hace
perder el tiempo y termina en algo que nadie limpia.

Ahora se distingue **por qué** `remove()` no borró nada:

| Causa | Respuesta |
|---|---|
| El archivo **sigue** ahí (la policy lo filtró) | No se toca la fila |
| El archivo **ya no está** | Se borra solo la fila: era la colgada |
| **No se pudo averiguar** | No se toca la fila (conservador) |

Borrar solo la fila en el segundo caso **no debilita nada**: para llegar ahí la
fila tuvo que ser visible bajo RLS (`buscarFila`), y `contrato_adjuntos` está
limitada a los contratos propios. El `DELETE` va igualmente por RLS. Ante la
duda no se borra: una fila colgada es molesta, un archivo huérfano con datos
personales no se ve nunca.

**Orden deliberado: primero el archivo, después la fila.** De los dos estados
intermedios posibles, se elige el que se nota: una fila que apunta a un archivo
que ya no está se ve en la pantalla y se puede reintentar; un archivo sin fila no
lo ve nadie.

### 2.2 Subida sin deshacer

`AdjuntosContrato.tsx` subía el archivo y después llamaba a `registrarAdjunto`.
Si el registro fallaba, el archivo ya estaba arriba y **nadie lo limpiaba**.

Corregido: si el registro falla, se deshace la subida. Y si el deshacer también
falla, el mensaje **dice qué archivo quedó colgado y a quién pedirle que lo
borre** — un huérfano callado es peor que un error.

También se capturan las **excepciones**, no solo los `{ok:false}`: una Server
Action puede lanzar (red caída, error de Next). Si el registro lanza tras una
subida buena, se deshace igual; si el `DELETE` de la fila lanza tras borrar el
archivo, se devuelve un resultado controlado.

**Y si es `upload()` el que lanza, el resultado es INDETERMINADO.** Que la
llamada falle no significa que el servidor no haya guardado el objeto: la
petición pudo completarse y perderse la respuesta (corte de red, timeout). Dar
el error por bueno y no limpiar deja exactamente el mismo huérfano. Se intenta
borrar la ruta como **mejor esfuerzo**: si se confirma la eliminación, el
mensaje es el error original y nada más; si no se puede confirmar, se añade el
aviso de posible huérfano con la ruta concreta.

No hay transacción posible entre Storage y Postgres. La regla es dejar el
sistema en un estado del que se pueda salir, y decir lo que pasó.

### 2.3 La pantalla descartaba el resultado

`AdjuntosContrato` hacía `start(() => { void eliminarAdjunto(...) })`: tiraba la
respuesta, así que un fallo —incluido "el archivo no se pudo borrar"— pasaba en
silencio y la fila parecía haberse ido. Además el estado `pending` se apagaba al
lanzar la promesa, no al terminar la operación.

Ahora espera el resultado, **muestra el error en la fila**, refresca solo si fue
bien, y el botón queda deshabilitado con "Eliminando…" durante la operación
real.

---

## 3. Cómo se prueba ahora

### `npm run test:unit` — regresión de la orquestación

**31 pruebas** sobre `lib/adjuntos/operaciones.ts`, sin red ni base de datos.
Cubren los estados intermedios: la fila no es visible por RLS, Storage devuelve
error, Storage responde sin error pero no borró, borró otro archivo, lanza
excepción, el `DELETE` responde `error: null` sin afectar filas, el registro
falla o **lanza**, el deshacer falla, `upload()` lanza con resultado
indeterminado, y el reintento sobre una fila colgada.

Incluye **dos controles negativos** que reimplementan el comportamiento viejo y
comprueban que producía el huérfano. Si alguien "simplifica" las operaciones y
vuelve a ese comportamiento, esas dos pruebas lo delatan.

> El número de pruebas se queda desactualizado con facilidad. Si esta cifra no
> coincide con lo que imprime `npm run test:unit`, la que manda es la del
> comando.

### `storage-adjuntos.mjs` — integración real

```bash
node supabase/scripts/pruebas/storage-adjuntos.mjs --confirmar
```

Crea **tres** usuarios (dos `venta` y uno `administracion`) y dos contratos
temporales con la marca `__TEST_STORAGE__`, inicia sesión **con la clave anon**
—como entra la aplicación— y ejecuta **subir, leer, reemplazar y eliminar** sobre
su contrato y sobre el de un colega, con la API de Storage.

- Informa el **error exacto** de cada operación. Un "denegado" sin motivo no
  distingue una policy que funciona de una llamada mal hecha.
- Comprueba con service-role que el archivo ajeno **sigue intacto** después de
  los cuatro intentos, y que no quedó ningún archivo colado.
- Comprueba que un rol administrativo **sí** puede: si no, la prueba pasaría
  igual cerrándole el paso a todo el mundo. Y lo hace con un **usuario
  administrativo real** y sesión con la clave anon — la versión anterior usaba
  service-role para ese caso, que **se salta la RLS por definición** y por tanto
  no probaba nada. Service-role queda solo para fixtures, verificación
  independiente y limpieza.
- Limpia todo en el `finally`, aunque falle a mitad. **Cada fallo de limpieza
  cuenta como comprobación fallida** y al final se verifica explícitamente que
  no quedaron objetos, contratos, perfiles ni usuarios con la marca
  `__TEST_STORAGE__`. Los usuarios de Auth se comprueban **uno por uno con
  `getUserById`**, no listando: un `listUsers({perPage:200})` puede dejar los
  temporales fuera de la página en un proyecto con muchos usuarios y dar verde
  con ellos todavía en la base: que una orden de borrado no dé error no significa que haya
  borrado — es el mismo patrón que este trabajo persigue en todo lo demás.

⚠️ Escribe en la base real, por eso exige `--confirmar`.

### La prueba SQL

Ya **no hace DML sobre `storage.objects`**. Comprueba la lectura (que es
legítima y decide si un asesor puede pedir una URL firmada), que las cuatro
policies existan, y **qué deciden**, evaluando su predicado como el usuario. Eso
último es una consulta booleana: no escribe nada y no depende de si Supabase
permite DML sobre esa tabla.

---

## 4. El bucket no separaba las dos agencias — CERRADO por la migración 150

Las cuatro policies de la 148 tenían esta forma:

```sql
bucket_id = 'contratos'
and mi_rol() in ('superadmin','gerencia','administracion','operaciones','venta')
and (mi_rol() <> 'venta' or soy_asesor_del_contrato(split_part(name,'/',1)))
```

Dos agujeros, los dos de lógica pura:

1. **Para cualquier rol que no fuera `venta`, la condición de propiedad ni se
   evaluaba.** `mi_rol() <> 'venta'` ya es `true`, así que el `or` se resolvía
   ahí y `soy_asesor_del_contrato` nunca corría.
2. **Ninguna comparaba el tenant.** `soy_asesor_del_contrato` tampoco: es
   `SECURITY DEFINER` y empareja solo por nombre contra `ventas.asesor`.

De donde salían dos caminos reales:

| Camino | Quién | Qué alcanzaba |
|---|---|---|
| A | `gerencia`/`administracion`/`operaciones` de **cualquiera** de las dos agencias | **Todos** los archivos del bucket |
| B | `venta` cuyo nombre coincidiera con `ventas.asesor` de un contrato de la otra agencia | Los archivos de **ese** contrato |

El camino B no era teórico: el importador de minorista escribe en
`ventas.asesor` el nombre del **freelance** de la hoja (ver
`caso-freelance-en-asesor.md`), así que una persona interna de mayorista que se
llame igual caía justo ahí.

El contrato en sí nunca se filtró —`puede_ver_contrato` sí compara el tenant—.
Lo expuesto eran los **archivos**: cédulas, pasaportes y soportes.

### Cómo quedó

`supabase/migrations/20260601000150_storage_contratos_por_tenant.sql` reemplaza
las cuatro policies por una llamada al helper
**`acceso_archivo_contratos(ruta)`**:

| Rol | Alcance |
|---|---|
| `superadmin` | todo el bucket |
| `gerencia` / `administracion` / `operaciones` | solo contratos de SU agencia |
| `venta` | solo contratos de SU agencia **y** donde sea el asesor |
| cualquier otro, inactivo, o sin sesión | nada |

El helper es `SECURITY DEFINER` con `search_path = public, pg_temp`, y exige
sesión, usuario existente y `activo`. **No usa `puede_ver_contrato()`** a
propósito: esa función responde "quién ve la FILA del contrato", que es otra
pregunta con otra respuesta (deja a `gerencia` cross-agencia y a `venta` toda su
agencia). Tampoco puede ser INVOKER: desde la 144 `venta` no tiene ninguna
policy de SELECT sobre `ventas`, así que como INVOKER le cerraría hasta sus
propios adjuntos.

### ⚠️ Asimetría deliberada con `gerencia` — pendiente de decidir

`puede_ver_tenant()` (migración 107) deja a `gerencia` ver las FILAS de las dos
agencias. La 150 **no** reproduce esa excepción: aquí `gerencia` queda acotada a
la suya, por instrucción explícita. Consecuencia: un `gerencia` verá la ficha de
un contrato de la otra agencia pero **no sus adjuntos**. Es una inconsistencia
real entre dos reglas, escrita a propósito en la cabecera de la migración para
que se resuelva a conciencia en un sentido o en el otro.

### El bucket no guarda solo adjuntos de contrato

Auditadas todas las rutas que la aplicación escribe. Son **dos, y solo dos**
(búsqueda de `storage.from("contratos")` en todo el código):

| Ruta | Origen | Aislamiento |
|---|---|---|
| `<numero_contrato>/<tipo>-<epoch>.<ext>` | `AdjuntosContrato.tsx` | por `ventas.tenant` del contrato |
| `pe-empleados/<pe_empleados.id>-<epoch>.<ext>` | `PuntoEquilibrioClient.tsx` (contratos laborales) | por `pe_empleados.tenant` del empleado |

La carpeta de nómina **sí** tiene con qué aislarse: el id del empleado va en el
nombre y esa tabla tiene `tenant`. Se refleja su propia RLS
(`superadmin`/`gerencia`/`administracion`), lo que además cierra algo que antes
estaba abierto: `operaciones` y `venta` podían abrir contratos laborales con el
salario de cada empleado sin poder leer la tabla.

**Prefijo desconocido → solo `superadmin`** (falla cerrado). Puede dejar sin
acceso a objetos históricos con otra forma de ruta, así que la migración trae la
consulta para listarlos **antes** de aplicarla.

### Cómo se prueba

| Script | Qué responde |
|---|---|
| `supabase/scripts/test_storage_por_tenant.sql` | ¿La regla es correcta? Monta sus propios datos y ejecuta SELECT/INSERT/UPDATE/DELETE reales por cada rol y ruta contra una matriz de expectativa. **168 comprobaciones.** |
| `supabase/scripts/test_storage_cruce_tenant.sql` | ¿A quién afecta de verdad? Evalúa el predicado contra los usuarios y contratos REALES. Detecta si está aplicada la 148 o la 150 y lo dice. |
| `supabase/scripts/pruebas/storage-adjuntos.mjs` | Lo mismo por la API de Storage (listar, firmar, subir, reemplazar, eliminar). |

Contra una base local construida desde cero con todas las migraciones
(`supabase/scripts/pruebas/local-desde-cero.sh`):

```
antes de la 150 →  168 comprobaciones · 104 correctas · 64 FUGAS
después         →  168 comprobaciones · 168 correctas ·  0 fugas
```

Las 64 incluyen el caso concreto: la `venta` de mayorista alcanzando el contrato
de su homónima de minorista, y al revés.

**Rollback verificado**: aplicar
`supabase/scripts/rollback_150_storage_contratos.sql` devuelve exactamente
104/64 —el estado previo— y volver a aplicar la 150 devuelve 168/0.

---

## 5. El mismo patrón fuera de Storage — CERRADO

Buscando lo anterior aparecieron dos funciones con la **misma forma de fallo**:
leían con service-role (se saltan la RLS a propósito) y decidían el acceso por
rol, **sin comparar el tenant**, aunque lo tenían en la fila recién leída.

| Archivo | Función | Qué exponía |
|---|---|---|
| `lib/finanzas/comisionResolver.ts` | `resolverComisionB2B` | Cuenta de cobro y estado de cuenta de comisión de **cualquier** contrato, por URL |
| `lib/cuenta/estado.ts` | `cargarEstadoCuenta` | Estado de cuenta (PVP, abonos, saldo) de **cualquier** contrato, por URL |

Las dos hacían:

```ts
const esInterno = ROLES_INTERNOS.includes(perfil?.rol ?? "");  // incluye `operaciones`
if (!esInterno && !esDueno) return null;                        // ← y nada más
```

Y `esDueno` emparejaba **por nombre**, no por `aliado_id`.

`cargarPlanCobro` y `cargarRecibo` delegan en `cargarEstadoCuenta`, así que
heredaban lo mismo: cuatro documentos por URL con el mismo agujero.

### Cómo quedó

Una sola función pura y compartida:
**`lib/auth/accesoDocumentoContrato.ts`**. El orden es deliberado — primero los
vínculos por id, después el rol, y el nombre solo como último recurso:

1. `superadmin` → global.
2. `b2b_usuario_id` → lo compró él mismo desde el portal.
3. `aliado_id` → su ficha del catálogo es la del contrato. **Cruza agencias a
   propósito**: un interno de mayorista enlazado como aliado a un contrato B2B
   de minorista entra como **dueño** (`esDueno`), no como personal interno
   (`esInterno` en false) — su rol no le da nada ahí. El id sale de
   `ventas.aliado_id` o de `aliados_b2b.aliado_id` (comisiones cargadas a mano,
   único camino en minorista).
4. Rol interno **y el mismo tenant**. La comparación que faltaba.
5. Nombre — **solo si `b2b_usuario_id` y `aliado_id` son los dos null**, es
   decir en contratos anteriores a la 143 que nadie ha enlazado. En cuanto
   existe un id, manda el id y un homónimo sin enlace queda fuera.

La causa raíz no fue un descuido puntual: fue que **la regla estaba escrita dos
veces**, con dos listas de roles distintas, y las dos copias se olvidaron de lo
mismo. Por eso hay una guarda dedicada:
`pruebas/documentosContrato.wiring.test.ts` mira el código fuente y falla si
alguno de los dos archivos vuelve a declarar su propia lista de roles o a
emparejar por nombre.

Comportamiento cubierto por `pruebas/accesoDocumentoContrato.test.ts`
(**66 pruebas** en total con las de adjuntos), incluidos dos controles negativos
que reimplementan la regla vieja y comprueban que dejaba pasar.

Una prueba encontró además un fallo que no estaba buscando: dos nombres en
blanco empataban entre sí (`"   ".trim() === "   ".trim()`), así que un contrato
con el nombre del aliado vacío se habría abierto para cualquiera con el suyo
también vacío — el mismo error que emparejar dos NULL. Corregido.

### Lo que NO cambió

`venta` sigue sin abrir estos cuatro documentos por URL, igual que antes: no
está en `ROLES_CARTERA`. Ampliarlo sería otra decisión, no un efecto secundario
de esta.

---

## 6. Ninguna policy se relajó

Las secciones 1 y 2 (la prueba SQL inválida y los archivos huérfanos) no tocaron
la base de datos: eran problemas de la prueba y del código.

La sección 4 sí añade una migración, la **150**, y va en la dirección contraria
a relajar: quita alcance a `gerencia`, `administracion`, `operaciones` y `venta`,
y no se lo da a nadie. `superadmin` queda igual. El único cambio que podría
notarse como pérdida es el de `gerencia` entre agencias, avisado arriba y en la
cabecera de la migración.

**Sin correr todavía.** Antes de aplicarla conviene ejecutar la consulta de
prefijos desconocidos que trae la propia migración: si devuelve filas, hay
objetos históricos con otra forma de ruta que quedarían solo al alcance de
superadmin.
