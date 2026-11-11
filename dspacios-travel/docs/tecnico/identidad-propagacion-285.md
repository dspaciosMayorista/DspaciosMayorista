# Propagación de la identidad del contrato (#75, entrega 2) — convenciones

Contexto y diseño: `reutilizacion-consecutivos.md` §15 (migración 284 = identidad + guardas; 285 = funciones, Storage, pendiente financiero y `ventas_basica.contrato_uid`).
Este documento fija **cómo viaja el UUID** desde la pantalla hasta la base. Es la referencia que sigue todo el código de la entrega 2.

## 1. Reglas

1. **El número es una etiqueta; la identidad es `ventas.contrato_uid`.** La base rechaza una escritura si el uid declarado no es el del contrato vigente (`CONTRATO_CAMBIO`, F4601) o si falta y el contrato nació de un número reutilizado (`IDENTIDAD_REQUERIDA`, F4602). Un contrato de siempre sin identidad pasa como hoy.
2. **El uid sale de los MISMOS datos que la pantalla leyó.** Se selecciona `contrato_uid` en la MISMA consulta que trae el contrato (o embebido en la consulta de las filas: `ventas(contrato_uid)`, `ventas!inner(contrato_uid)`). **Prohibido** resolverlo después con otra consulta por número para una petición que viene de una pantalla: devolvería la identidad del contrato NUEVO a un formulario que aún muestra datos del anterior.
3. **Una acción de usuario RECIBE la identidad de la pantalla y la reenvía.** No la lee de la base para sustituirla, no se auto-declara. Las únicas excepciones son (a) los flujos que CREAN el contrato (el uid sale del propio INSERT: `.insert(...).select("numero_contrato, contrato_uid")`) y (b) las tareas automáticas sin pantalla (cron), que usan la identidad CONSERVADA en su registro (`contrato_financiero_pendiente.contrato_uid`) o declaran dentro de la función SQL (`liberar_vencidas`).
4. **La llave de servicio no exime.** `createAdminClient(identidad)` también declara; la guarda de la base no distingue roles.
5. **Mover información entre dos contratos** (renumerar, mover pasajeros/sillas entre contratos): la pantalla declara AMBOS (`unirIdentidades(a, b)`).

## 2. Piezas

- `lib/contrato/identidad.ts` (puro): `IdentidadContrato` = `{ [numero]: uid }`, `identidadDe(numero, uid)`, `parseIdentidad(x)` (entrada del navegador, nunca lanza), `unirIdentidades`, `cabecerasIdentidad`, `esErrorIdentidad`, `mensajeSiIdentidad`, `MENSAJE_IDENTIDAD`.
- `lib/supabase/server.ts` → `createClient(identidad?)`; `lib/supabase/admin.ts` → `createAdminClient(identidad?)`; `lib/supabase/client.ts` → `createClient(identidad?)` (con identidad usa `isSingleton:false`). Fábricas **por llamada**: cree el cliente DESPUÉS de tener la identidad y no lo comparta entre peticiones.

## 3. Patrón en una Server Action que opera sobre un contrato EXISTENTE

```ts
export async function registrarAbono(numero: string, /* …args… */, identidad: IdentidadContrato) {
  const id = parseIdentidad(identidad);          // entrada del navegador: no confiable pero SOLO se reenvía
  const sb = await createClient(id);              // o createAdminClient(id)
  // … todas las escrituras (y RPC) de la acción usan clientes creados con `id` …
  if (error) return { ok: false, error: mensajeSiIdentidad(error) ?? error.message };
}
```
- `identidad` es **el último parámetro y obligatorio** en TypeScript (el compilador obliga a actualizar cada llamador). En tiempo de ejecución un bundle viejo puede mandar `undefined`: `parseIdentidad(undefined)` devuelve `{}` y la base decide (contrato de siempre pasa; de reuso se rechaza).
- Si la acción habla con helpers de `lib/` que reciben un cliente, pásales el cliente ya construido con la identidad. Si un helper crea su propio cliente y escribe tablas de contrato, recibe `identidad` como parámetro.
- Una acción que toca **otro** contrato (mover/copiar) recibe la identidad de ambos y usa `unirIdentidades`.
- Si una acción **no** escribe tablas de contrato (solo lee, o solo catálogos), no lleva identidad; si hay duda, lleva identidad.

## 4. Patrón en la pantalla

- La **página** (server component) selecciona `contrato_uid` en la misma consulta que carga el contrato y calcula `const identidad = identidadDe(venta.numero_contrato, venta.contrato_uid)`; la pasa como prop `identidad` a los componentes cliente. Para el rol `venta`, `ventas_basica` ya expone `contrato_uid` (migración 285).
- El **componente cliente** guarda `identidad` tal como llegó y la reenvía en cada llamada a la acción (último argumento). **No la recalcula ni la consulta de nuevo.**
- **Listados** con filas de varios contratos: cada fila trae su uid de la misma consulta (embed), y la acción de la fila recibe `identidadDe(fila.numero_contrato, fila.uid)`.
- Navegador + Storage (`AdjuntosContrato.tsx`): `createClient(identidad)` del navegador (instancia propia, `isSingleton:false`).

## 5. Errores

Si el error de la base es de identidad (`esErrorIdentidad`), muestra `MENSAJE_IDENTIDAD` (recarga y reabre el contrato). Los rechazos por identidad NO son errores de validación del formulario: no reintentar.

## 6. Inventario verificable

`pruebas/identidadPropagacion.wiring.test.ts` recorre la lista de archivos del inventario y falla si:
- hay `createClient()` / `createAdminClient()` **sin argumento** dentro de una acción de usuario, salvo líneas marcadas `// identidad:n/a — <motivo>`;
- una función exportada de esos archivos no declara el parámetro `identidad: IdentidadContrato` (salvo `// identidad:n/a — <motivo>` en la línea de la función);
- una página de la lista no selecciona `contrato_uid`.
Cada excepción necesita un motivo escrito. La lista de archivos vive en ese test (`INVENTARIO`).

## 7. Entrega 3 (2026-11-08) — dos adiciones a las reglas

- **Sillas y `control_vuelo`:** las pantallas de vuelos NO embeben `ventas(contrato_uid)` (ese rol no lee `ventas`). Llaman `rpc("sillas_identidades")` ANTES de leer las sillas y usan el uid solo si el número de la silla coincide (`identidadDeSilla`). Función en la migración 284, sección 6b.
- **Quien crea el contrato lo declara solo:** un INSERT en `ventas` declara `(número, uid)` durante esa transacción (284, sección 1b). Las funciones SQL que crean el contrato y sus hijas en una sola transacción no declaran nada. Las acciones de usuario sobre un contrato EXISTENTE siguen recibiendo y reenviando la identidad de la pantalla (reglas 1–5 de arriba).
