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
archivo, se devuelve un resultado controlado que dice que quedó una fila sin
archivo.

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

**24 pruebas** sobre `lib/adjuntos/operaciones.ts`, sin red ni base de datos.
Cubren los estados intermedios: la fila no es visible por RLS, Storage devuelve
error, Storage responde sin error pero no borró, borró otro archivo, lanza
excepción, el `DELETE` responde `error: null` sin afectar filas, el registro
falla o **lanza**, el deshacer falla.

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
  `__TEST_STORAGE__`: que una orden de borrado no dé error no significa que haya
  borrado — es el mismo patrón que este trabajo persigue en todo lo demás.

⚠️ Escribe en la base real, por eso exige `--confirmar`.

### La prueba SQL

Ya **no hace DML sobre `storage.objects`**. Comprueba la lectura (que es
legítima y decide si un asesor puede pedir una URL firmada), que las cuatro
policies existan, y **qué deciden**, evaluando su predicado como el usuario. Eso
último es una consulta booleana: no escribe nada y no depende de si Supabase
permite DML sobre esa tabla.

---

## 4. Ninguna policy se relajó

Este trabajo no toca la base de datos. No hay migración nueva y no se cambió
ninguna policy: el problema estaba en la prueba y en el código de la aplicación.
Si algún día hiciera falta tocar RLS de Storage, el punto de partida es la
migración 148.
