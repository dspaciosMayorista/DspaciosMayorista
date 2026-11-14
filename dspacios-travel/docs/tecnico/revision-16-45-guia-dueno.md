# Guía de revisión del dueño — #16 (fechas heredadas) y #45 (descripción de habitaciones por hotel)

Entorno LOCAL con datos sintéticos. No toca Producción ni la base `revision43`. La migración 303 está aplicada **solo** en la base local `revision1645`.
Rutas, botones y textos de esta guía están **comprobados en pantalla** con sesión real (`supabase/scripts/recorrido_16_45.mjs`, Chrome local).

## Entrar

- App: http://127.0.0.1:3047 · usuario `dueno@revision43.test` · contraseña `Revision43!` (superadmin, agencia Mayorista).
- Hoteles de prueba: **R43 HABITACION** (9306, Estándar), **R43 MIXTO** (9307), **R43 PROMO NUEVA** (9309), **R43 VARIAS CATEGORIAS** (9310, Estándar y Superior).

## A. #45 — Descripción y «qué incluye» por categoría, dentro de cada hotel

Regla aprobada: el **nombre** de la categoría es el del catálogo global; solo el **texto** es propio de cada hotel. No cambia precios.

1. Menú lateral → **Netas → Hoteles** → abre **R43 VARIAS CATEGORIAS** (pestaña **Configuración**).
2. Abre el panel plegable **«Categorías de habitación y regímenes»**. Más abajo está **«Descripción por categoría en este hotel»** con **Estándar** y **Superior** (dice «Sin descripción para este hotel.» mientras no haya texto).
3. En **Superior** pulsa **Editar**: *Descripción* `Habitación de 32 m² con balcón y vista parcial al mar.` y *Qué incluye (una línea por ítem)* `Minibar`, `Caja fuerte`, `Wi-Fi` → **Guardar** (el que está junto a **Cancelar**). Debe verse la descripción y «Incluye: Minibar / Caja fuerte / Wi-Fi».
4. Recarga la página y vuelve a abrir el panel: el texto sigue ahí.
5. Misma categoría en otro hotel: en **R43 HABITACION → Estándar** escribe un texto distinto (p. ej. `Habitación exterior con vista a la piscina.`). Cada hotel conserva el suyo aunque la categoría se llame igual.
6. Si dejas vacíos los dos campos y guardas, vuelve a «Sin descripción para este hotel.».
7. Desmarcar/marcar categorías con el botón **Guardar** de arriba conserva el texto de las que siguen; quitar una categoría borra solo su texto en ese hotel.
8. Ficha en el tarifario: **Tarifario ↗** → **Vista Booking** → pestaña **Porción terrestre** → bloque **«Buscar alojamiento»**: Destino **T293 DESTINO**, Ida `27/06/2027`, Regreso `30/06/2027` → **BUSCAR HOTELES**. En la tarjeta del hotel, debajo de los selectores **Categoría / Alimentación**, aparece un cuadro gris con la descripción (y la lista «qué incluye») de la categoría elegida; al cambiar de categoría cambia el texto; sin texto no se muestra nada. Los precios no cambian.
   - R43 VARIAS CATEGORIAS tiene tarifa en julio de 2027 (1–31 jul); con las fechas de junio de arriba aparecen **R43 HABITACION** y **R43 MIXTO**.
   - Comprobado en pantalla (app reconstruida): R43 HABITACION muestra «Habitación exterior con vista a la piscina.» y «Desayuno buffet»; R43 MIXTO, sin texto, no muestra ningún cuadro; el texto de otro hotel con la misma categoría no se cruza; los totales siguen en $ 660.000 y $ 510.000.

**Alcance de #45 hoy:** ficha del tarifario (búsqueda por fechas, selectores de la tarjeta/modal). **Documentos (cotización, contrato, PDF):** el trabajo existe aparte como parche (`45-documentos.patch`) y **no** se integra a #442 hasta que confirmes el alcance — la sesión que integra #442 informó que lo excluiste; en esta revisión se me pidió incluirlo. Dime cuál vale.

## B. #16 — Fechas heredadas en el contrato manual

Alcance: **contrato manual**. La cotización manual no tiene fechas por servicio (se retiró esa ampliación).

1. Abre **Contratos → Nuevo** (ruta directa `/dashboard/contratos/nuevo`, formulario manual; la ruta es la comprobada, el texto exacto del submenú no).
2. Escribe *Fecha de salida (viaje)* `15/10/2026` y *Fecha de regreso* `18/10/2026` (los campos de fecha muestran `dd/mm/aaaa`).
3. **+ Agregar hotel**: *Ingreso al hotel* = `15/10/2026` y *Fecha de salida* = `18/10/2026` (editables).
4. **+ Agregar tramo** (vuelo): *Fecha de este tramo* = `15/10/2026`. En un tramo ya creado, **+ Agregar regreso (invierte origen/destino)** trae `18/10/2026`.
5. Edita el *Ingreso al hotel* a `16/10/2026` y luego cambia la salida del viaje a `20/10/2026`: el hotel **conserva** `16/10/2026`; un hotel nuevo toma `20/10/2026`.

Comprobado en pantalla: pasos 2 a 5 (8 verificaciones, sin errores de consola).

## Qué decirme después de revisar

- #45: ¿el texto se queda solo en la ficha del tarifario o también va a cotización/contrato/PDF?
- #16: ¿otro servicio del contrato manual necesita fechas heredadas?
- Aprobación para publicar: migración 303 (preflight → 303 → postcheck → código), siempre ejecutada por ti.

## Apagar / limpiar

- Parar: Ctrl+C en la terminal del `servir`, luego `sh supabase/scripts/revision_1645.sh detener`.
- Borrar lo de esta revisión (solo `revision1645` y sus contenedores): `sh supabase/scripts/revision_1645.sh limpiar`. **No se ejecuta sin que lo pidas.**
