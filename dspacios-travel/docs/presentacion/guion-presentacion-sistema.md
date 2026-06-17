# Guion de presentación — Sistema Integral D'spacios Travel

> **Cómo usar este archivo.** Tiene **dos versiones** del mismo contenido:
> - **VERSIÓN 1 — Guion para ti (humano):** úsalo tal cual. Cada bloque es una
>   "diapositiva": dice **qué captura tomar**, dónde, y el **monólogo** para
>   narrar (o pegar como nota del orador). Solo tomas el screenshot, lo pegas y
>   lees/ajustas el texto.
> - **VERSIÓN 2 — Brief para otra IA:** un prompt estructurado para que una IA
>   especializada (generador de presentaciones / guionista) regenere, traduzca
>   o expanda el monólogo. Pégalo en la otra IA junto con tus capturas.
>
> Tono objetivo: **técnico-comercial** — claro para un decisor de negocio, pero
> con la precisión técnica que convence a un perfil de sistemas.

---
---

# ═══════════════════════════════════════════
# VERSIÓN 1 · GUION HUMANO (slide por slide)
# ═══════════════════════════════════════════

## Slide 0 — Portada
**📸 Captura:** Logo D'spacios Travel sobre el degradado de marca (o el header del tarifario público).
**🎙️ Monólogo:**
> "D'spacios Travel — Sistema Integral de Operación Mayorista. Una sola aplicación
> web que reemplaza las hojas de cálculo y apps sueltas: del tarifario a la venta,
> del inventario de vuelos a las finanzas. Base de datos real, multiusuario, con
> control por roles. Esto es lo que hace."

## Slide 1 — La visión / el problema que resuelve
**📸 Captura:** El menú lateral del portal (mostrando todos los módulos).
**🎙️ Monólogo:**
> "Antes: tarifas en un Excel, ventas en otro, vuelos en un tercero, finanzas en
> una app aparte. Aquí todo vive conectado por dos llaves: el **número de contrato**
> y el **record (PNR)** del vuelo. Un cambio en un lado se refleja en todos. El
> sistema cubre cinco frentes: Producto, Tarifario, Reservas/Contratos, Inventario
> de vuelos y Finanzas — más CRM y un sitio web público con su propio CMS."

## Slide 2 — Acceso por roles (seguridad)
**📸 Captura:** Pantalla de login (con botón de Google) y/o el menú variando por rol.
**🎙️ Monólogo:**
> "Acceso con login y **roles**: superadmin, gerencia, administración, operaciones,
> ventas y control de vuelos; y hacia afuera, agencias, freelance y cliente final.
> Cada rol ve solo lo que le compete. La seguridad no es cosmética: está aplicada a
> nivel de base de datos con **RLS (Row Level Security)** — un usuario no puede leer
> ni tocar lo que no le corresponde, aunque intente saltarse la interfaz."

## Slide 3 — Producto: las tarifas NETAS
**📸 Captura:** Producto → Hoteles (detalle de un hotel con sus temporadas y la tarifa neta por categoría/régimen).
**🎙️ Monólogo:**
> "Todo arranca en el **costo neto**. Cargamos destinos (con código IATA), proveedores,
> y hoteles con sus **temporadas propias**, su tarifa neta por **categoría de habitación**
> y **régimen de alimentación**, e incluso precios diferenciados de **Niño 1 y Niño 2**.
> Configuramos por hotel las **edades** (qué es niño, qué es infante) y las **acomodaciones**
> (cuántas personas cubre cada habitación). También servicios receptivos — por persona o
> por grupo con rangos de pax. Hay **carga masiva por CSV** para no teclear uno por uno."

## Slide 4 — Montaje de producto (Paquetes)
**📸 Captura:** Paquetes → armado de un paquete (vuelos + hoteles + servicios + % markup).
**🎙️ Monólogo:**
> "Sobre esos costos netos armamos **paquetes**: elegimos el tipo (bloqueo con vuelo,
> porción terrestre o solo servicios), le sumamos los **vuelos** negociados, los **hoteles**
> y los **servicios**, y aplicamos el **margen (markup)**. Con un clic se **genera el
> tarifario**: el sistema liquida noche por noche, mezcla temporadas, suma el aporte del
> vuelo y el impuesto, y calcula el **precio de venta** por acomodación. La fórmula es única
> y testeada — no hay dos cálculos que se contradigan."

## Slide 5 — Tarifario público (vista tabla)
**📸 Captura:** Tarifario público, vista tabla horizontal (Hotel · Categoría · Régimen · Sencilla/Doble/Triple/Múltiple · Niño 1 · Niño 2).
**🎙️ Monólogo:**
> "El resultado se publica en el **tarifario**. Vista de tabla: por hotel ves cada
> categoría y régimen con sus precios por acomodación y por niño, y **debajo del hotel,
> la edad configurada** ('Niño de 5 a 11 años') para que nadie dude. Hay buscador por
> nombre y filtros por categoría, régimen y acomodación. El público sin login ve la
> tarifa comercial; la agencia, con login, ve su tarifa neta."

## Slide 6 — Tarifario público (vista Booking)
**📸 Captura:** Vista Booking — buscador (origen/destino/fechas + habitaciones) y las tarjetas de hotel; idealmente el modal de un hotel abierto.
**🎙️ Monólogo:**
> "Y una vista tipo **motor de reservas**: el cliente elige fechas y habitaciones, y el
> sistema **re-liquida en vivo** esas noches. Al abrir un hotel puede **escoger categoría
> y alimentación** (no solo la más barata) y ve el precio cambiar al instante; agrega
> niños e **infantes** dentro de la capacidad real de la habitación, y arma su carrito.
> Hay topes de negocio: máximo 8 habitaciones — a partir de 9, contacta a un asesor."

## Slide 7 — Reservar / generar el contrato
**📸 Captura:** Flujo de Reservar (formulario por habitaciones + pasajeros + tipo de venta).
**🎙️ Monólogo:**
> "De la cotización a la **reserva**: se reserva **por habitaciones** (1 Doble = 2 pax),
> con niños e infantes aparte, se capturan los pasajeros y el sistema **valida que las
> edades cuadren con la acomodación** — si no cuadra, no deja generar. Se define el tipo de
> venta (interno, agencia o freelance → canal B2B/B2C) y el plazo. Al generar: nace la
> **venta con su número de contrato**, se **descuentan las sillas** del vuelo, y se produce
> el **PDF del contrato**."

## Slide 8 — Contratos
**📸 Captura:** Detalle de un contrato (estado, abonos, documento).
**🎙️ Monólogo:**
> "El **contrato** queda como pendiente hasta confirmarse — y se confirma con un abono o
> manualmente por un rol alto, lo que pasa las sillas a 'confirmada'. Se registran abonos
> con su forma de pago, se calculan los costos netos, y un **cron diario libera** las
> reservas vencidas que no se pagaron. El documento se ve profesional: hotel como
> '1 hab Doble (2 pax)', servicios aparte, vuelo con origen/destino derivados de la ruta IATA."

## Slide 9 — Inventario de vuelos
**📸 Captura:** Dashboard de Vuelos (tarjetas de estado) y/o el detalle de un record con sus pasajeros.
**🎙️ Monólogo:**
> "El **inventario de vuelos** controla los bloqueos: origen y destino salen del catálogo
> de destinos y la **ruta se arma sola** (BOG–SMR–BOG). Cada bloqueo tiene sus cupos,
> fechas, tarifa y plazo de devolución. Por record vemos sus **pasajeros silla por silla**,
> con su estado (disponible, en plazo, confirmada, devuelta…), y podemos **editar, liberar
> o mover un pasajero a otro record** dejando registro del cambio. El tarifario oculta
> automáticamente las salidas sin cupos."

## Slide 10 — Finanzas: rentabilidad y flujo de caja
**📸 Captura:** Finanzas → Flujo de caja (gráfico de barras por mes) o Rentabilidad.
**🎙️ Monólogo:**
> "El área financiera es el cerebro: **rentabilidad por contrato** con las provisiones
> colombianas (ICA, Fontur, renta, IVA), **cartera** por cobrar y **pagos a proveedores**
> con sus cuentas por pagar automáticas. Y un **flujo de caja presente/futuro**: imputa cada
> contrato a su mes —por fecha de viaje o por fecha de venta— y proyecta ingresos, egresos y
> saldo, con gráfico de barras. Sabes cuánto entra y sale hoy, el próximo mes y a futuro."

## Slide 11 — Finanzas: punto de equilibrio (nómina)
**📸 Captura:** Punto de equilibrio (con el detalle de un empleado: SS, parafiscales, prestaciones).
**🎙️ Monólogo:**
> "El **punto de equilibrio** te dice cuánto debes vender al mes para cubrir costos. Liquida
> la **nómina 2026** real —seguridad social, parafiscales y prestaciones— y aplica la
> **exoneración de aportes (Art. 114-1)** para empleados bajo 10 SMMLV. El **margen** lo toma
> automático de la rentabilidad. Todo con la normatividad vigente, no a ojo."

## Slide 12 — CRM y campañas
**📸 Captura:** CRM → base de contactos y/o el módulo de campañas de email.
**🎙️ Monólogo:**
> "Un **CRM** con la base de contactos —clientes, agencias, freelance, empresas, pasajeros—
> cruzada con el historial de compras de cada uno. Desde ahí se lanzan **campañas de email**
> segmentadas por categoría, **respetando el consentimiento (Habeas Data, Ley 1581)**: solo
> reciben quienes autorizaron. Marketing serio y dentro de la ley."

## Slide 13 — Cotizaciones y portal B2B
**📸 Captura:** Una cotización generada (o el link compartible) / portal de agencias.
**🎙️ Monólogo:**
> "Las **cotizaciones** se arman desde el tarifario, se comparten por un **link** y se
> **convierten en contrato** con un clic. Las agencias y freelance tienen su **portal B2B**
> con su tarifa neta y su comisión configurada. Cero retecleo entre cotizar y vender."

## Slide 14 — Sitio web público + CMS
**📸 Captura:** El sitio web público (una página de destino) y el CMS (`/cms`) editando.
**🎙️ Monólogo:**
> "Y la cara pública: un **sitio web** de marketing dentro del mismo sistema, con su árbol de
> páginas (destinos nacionales e internacionales, experiencias, blog…) y un **CMS estilo
> 'creador de sitios'** —solo para el superadmin— donde se edita cada sección con **vista en
> vivo**: textos, fotos, flyers que abren en la misma página, y un botón que lleva directo al
> tarifario. La web y el sistema, un solo proyecto, un solo despliegue."

## Slide 15 — Cierre: stack y diferenciales
**📸 Captura:** Diagrama simple o logos del stack (Next.js + Supabase + Vercel) — o de nuevo el logo.
**🎙️ Monólogo:**
> "Por debajo: **Next.js** sobre **Supabase (Postgres)** con seguridad por filas, desplegado
> en **Vercel**. Multiusuario, en tiempo real, con respaldo y migraciones versionadas. En una
> frase: D'spacios Travel pasó de operar en hojas sueltas a un **sistema integral** donde
> consultar una tarifa, armar un paquete, vender, controlar el vuelo y ver la rentabilidad
> es **un solo flujo conectado**. Gracias."

---
---

# ═══════════════════════════════════════════
# VERSIÓN 2 · BRIEF / PROMPT PARA OTRA IA
# ═══════════════════════════════════════════

> Copia todo lo que sigue y pégalo en la IA generadora de presentaciones/guiones,
> adjuntando tus capturas de pantalla en el orden indicado.

---

**ROL:** Eres un guionista experto en presentaciones de producto de software B2B
(SaaS de turismo). Escribes en español, en tono **técnico-comercial**: claro y
persuasivo para un decisor de negocio, pero preciso para un perfil de sistemas.

**OBJETIVO:** Generar el **monólogo de presentación** (notas del orador, una por
diapositiva) de un sistema llamado **D'spacios Travel — Sistema Integral de
Operación Mayorista de Turismo**. El usuario aportará una **captura de pantalla por
diapositiva**; tú escribes el texto que acompaña a cada captura.

**AUDIENCIA:** Dueños/gerentes de agencias mayoristas y su equipo técnico; también
puede leerlo otra IA para reformatear a deck (PowerPoint/Gamma/Slides).

**TONO Y ESTILO:**
- Frases cortas, afirmativas, orientadas a beneficio + el "cómo" técnico que lo respalda.
- Nada de relleno ni promesas vagas; cada afirmación debe corresponder a una función real (lista abajo).
- Evita tecnicismos innecesarios, pero menciona los diferenciales técnicos (RLS, liquidación noche por noche, validaciones, cron, etc.) porque venden credibilidad.
- 60–110 palabras de monólogo por diapositiva.

**FORMATO DE SALIDA (por cada diapositiva):**
1. `Título de la diapositiva`
2. `📸 Captura sugerida:` (qué debe mostrar el screenshot)
3. `🎙️ Monólogo:` (el texto a narrar)
4. (opcional) `Bullets en pantalla:` 3–4 frases muy cortas para poner en la slide.

**INVENTARIO REAL DEL SISTEMA (no inventes funciones; usa solo estas):**
- **Visión:** una sola app web que unifica tarifario, contratos, gestión/ventas, inventario de vuelos y finanzas. Dos llaves de unión: número de contrato y record/PNR.
- **Roles + seguridad:** login (incl. Google), roles internos (superadmin, gerencia, administración, operaciones, venta, control_vuelo) y externos (agencia, freelance, cliente_final). Seguridad a nivel de base de datos con RLS.
- **Producto (costos netos):** destinos con IATA; proveedores; hoteles con temporadas, tarifa neta por categoría y régimen, Niño 1 y Niño 2, edades configurables (niño/infante) y acomodaciones (pax por habitación); servicios por persona o por grupo; carga masiva CSV.
- **Paquetes (armado):** tipo bloqueo/porción/servicios; suma de vuelos + hoteles + servicios; markup; "generar tarifario" liquida noche por noche mezclando temporadas, con motor de cálculo único.
- **Tarifario:** vista tabla horizontal (categorías, regímenes, acomodaciones, Niño 1/2, edad por hotel visible) + vista Booking (re-liquidación por fechas en vivo, elegir categoría y alimentación, niños e infantes según capacidad, carrito, tope de 8 habitaciones). Público sin login y tarifa neta con login.
- **Reservar → contrato:** reserva por habitaciones; validación de edades vs acomodación (bloquea si no cuadra); tipo de venta B2B/B2C; genera venta + número de contrato + descuenta sillas + PDF.
- **Contratos:** estados pendiente/confirmado; abonos con forma de pago; confirma por abono o rol alto; cron diario libera vencidas; documento visual claro.
- **Inventario de vuelos:** bloqueos con origen/destino del catálogo y ruta automática IATA; cupos, fechas, plazo de devolución; pasajeros por silla con estados; editar/liberar/mover pasajero entre records con registro de cambios; oculta salidas sin cupos.
- **Finanzas:** rentabilidad por contrato con provisiones colombianas; cartera; pagos a proveedores con CxP automáticas; flujo de caja presente/futuro (por viaje y por venta) con gráfico; punto de equilibrio con nómina 2026 (SS, parafiscales, prestaciones) y exoneración Art. 114-1; margen automático.
- **CRM:** base de contactos por categoría cruzada con compras; campañas de email segmentadas respetando consentimiento (Habeas Data, Ley 1581).
- **Cotizaciones + portal B2B:** cotización compartible por link, conversión a contrato; portal de agencias con tarifa neta y comisión.
- **Sitio web público + CMS:** sitio de marketing en el mismo proyecto; CMS por páginas/secciones con vista en vivo (solo superadmin); flyers que abren en la página; enlaces al tarifario.
- **Stack:** Next.js + Supabase (Postgres, RLS) + Vercel; multiusuario; migraciones versionadas.

**ESTRUCTURA SUGERIDA (16 diapositivas):** Portada → Visión/problema → Roles y
seguridad → Producto (netas) → Paquetes → Tarifario tabla → Tarifario Booking →
Reservar/contrato → Contratos → Inventario de vuelos → Finanzas (rentabilidad/flujo
de caja) → Punto de equilibrio → CRM/campañas → Cotizaciones/B2B → Sitio web/CMS →
Cierre (stack + diferenciales). Ajusta el número según las capturas que reciba el usuario.

**REGLAS:**
- Una diapositiva por captura que el usuario adjunte; si adjunta menos, condensa.
- No prometas funciones que no estén en el inventario.
- Cierra con una frase memorable que resuma el "de hojas sueltas a sistema integral".

**EJEMPLO (formato esperado de UNA diapositiva):**
> **Título:** Tarifario público — vista Booking
> **📸 Captura sugerida:** el motor de reservas con un hotel abierto eligiendo categoría/alimentación.
> **🎙️ Monólogo:** "Una vista tipo motor de reservas: el cliente pone fechas y habitaciones y el sistema re-liquida esas noches en vivo. Puede escoger categoría y alimentación —no solo lo más barato— y ve el precio cambiar al instante; agrega niños e infantes dentro de la capacidad real de la habitación. Incluso respeta topes de negocio, como el máximo de 8 habitaciones."
> **Bullets en pantalla:** Re-liquidación en vivo · Elige categoría y régimen · Niños e infantes validados · Carrito y reserva.

**ENTREGA:** Devuelve las 16 diapositivas en ese formato, listas para pegar como
notas del orador. Si el usuario te pasa capturas, asígnalas en orden a cada slide.
