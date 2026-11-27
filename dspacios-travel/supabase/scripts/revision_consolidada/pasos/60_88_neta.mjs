// #88 información del hotel del catálogo en «Dinámicos» (H88-*) · costo aéreo de un bloqueo desde la tarifa NETA (NETA-*).
// Datos: semillas/tras_perfiles/30_88_neta.sql (ids 91100–91299). Los pasos NETA-03…08 dependen unos de otros y escriben datos.
const PAQ88 = "Dinamico 88 - Hoteles del catalogo";
const dec = (s) => (s && s.startsWith("data:") ? Buffer.from(s.split(",")[1] ?? "", "base64").toString("utf8") : s ?? "");
const dig = (s) => Number(String(s ?? "").replace(/[^\d]/g, ""));
const escribirFecha = async (loc, ddmmaaaa) => { await loc.fill(ddmmaaaa); await loc.press("Tab"); };

// ───────────────────────────── #88 ─────────────────────────────
async function abrirDinamicos(c) {
  await c.ir("/tarifario?vista=dinamicos");
  const encabezado = c.page.locator("h2", { hasText: PAQ88 });
  if (!(await encabezado.count())) { await c.page.getByRole("button", { name: "Dinámicos" }).first().click().catch(() => {}); await c.espera(800); }
  await encabezado.first().waitFor({ timeout: 20000 }).catch(() => {});
}
const seccion = (c) => c.page.locator("section", { has: c.page.locator("h2", { hasText: PAQ88 }) }).first();
const tarjeta = (c, nombre, n = 0) => seccion(c).locator("article", { has: c.page.locator("h3", { hasText: new RegExp(`^${nombre}$`) }) }).nth(n);
async function datos(card) {
  return card.evaluate((el) => ({
    texto: el.innerText.replace(/\s+/g, " "),
    estrellas: el.querySelectorAll('span[title$=" estrellas"] svg').length,
    fotos: [...el.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? ""),
    mapa: el.querySelector('a[href*="google.com/maps"]')?.getAttribute("href") ?? null,
  }));
}
const desde = (t, valor) => new RegExp(`Desde por persona en doble\\s*\\$?\\s*${valor.toLocaleString("es-CO")}`).test(t);

// Totales esperados del cotizador (1 habitación doble, 2 adultos, 3 noches) = 2 × «Desde».
async function cotizar(c, nombre, esperado) {
  const card = tarjeta(c, nombre);
  const [ida, reg] = c.sql("select to_char(public.fecha_negocio() + 30, 'DDMMYYYY') || '|' || to_char(public.fecha_negocio() + 33, 'DDMMYYYY')").split("|");
  await card.getByRole("button", { name: "Cotizar" }).click();
  // H88-01 (correcciones 2026-11-26): el cotizador se abre en una VENTANA (role=dialog), no dentro de la tarjeta.
  const ventana = c.page.locator('[data-testid="ventana-cotizador-dinamico"]');
  await ventana.waitFor({ timeout: 15000 });
  await escribirFecha(ventana.locator('input[aria-label="Fecha de ida"]').first(), ida);
  await escribirFecha(ventana.locator('input[aria-label="Fecha de regreso"]').first(), reg);
  const re = new RegExp(`Total estimado:\\s*\\$?\\s*${esperado.toLocaleString("es-CO").replace(/\./g, "\\.")}`);
  await c.page.waitForFunction((v) => new RegExp(v).test(document.querySelector('[data-testid="total-dinamico"]')?.textContent?.replace(/\s+/g, " ") ?? ""), re.source, { timeout: 25000 }).catch(() => {});
  const t = (await ventana.locator('[data-testid="total-dinamico"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  c.check(`cotizador de «${nombre}»: total ${esperado.toLocaleString("es-CO")}`, re.test(t), t.slice(-160));
  await c.page.keyboard.press("Escape");
  await ventana.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
}

export const pasos88 = [
  {
    id: "H88-01", entrega: "hotel88", rol: null, titulo: "Hotel vinculado al catálogo: fotos, estrellas, descripción y ubicación", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Sin iniciar sesión, abre el tarifario público en la pestaña «Dinámicos» y busca el paquete «Dinamico 88 - Hoteles del catalogo». Mira la tarjeta «Hotel Catalogo Uno» (hay 8 tarjetas en total). En una pantalla angosta (390 px) el contenido debe quedar dentro de la pantalla.",
    esperado: "La tarjeta muestra la galería del hotel del catálogo con contador «1 / 3» y la foto de portada primero (la imagen dice «UNO-2 PORTADA»), 4 estrellas, la descripción «Descripcion de CATALOGO UNO…», el bloque «Ubicación» con el enlace a Google Maps de «Bocagrande, Cartagena», y aparte la línea «Habitación Superior · PAM» (la categoría de la habitación no se mezcla con las estrellas). «Desde por persona en doble» = $500.000.",
    async verificar(c) {
      await abrirDinamicos(c);
      const n = await seccion(c).locator("article").count();
      c.check("el paquete tiene 8 tarjetas de hotel", n === 8, String(n));
      const d = await datos(tarjeta(c, "Hotel Catalogo Uno"));
      c.check("4 estrellas del catálogo", d.estrellas === 4, String(d.estrellas));
      c.check("descripción del catálogo", /Descripcion de CATALOGO UNO/.test(d.texto), d.texto.slice(0, 250));
      c.check("galería 1 / 3 con la portada primero", /1 \/ 3/.test(d.texto) && /UNO-2 PORTADA/.test(dec(d.fotos[0])), `${d.fotos.length} img · ${dec(d.fotos[0]).slice(-90)}`);
      c.check("ubicación con enlace al mapa", /ubicaci[oó]n/i.test(d.texto) && !!d.mapa && decodeURIComponent(d.mapa).includes("Bocagrande, Cartagena"), String(d.mapa));
      c.check("la categoría de la habitación va rotulada aparte", /Habitación Superior · PAM/.test(d.texto), d.texto.slice(0, 200));
      c.check("«Desde» $500.000", desde(d.texto, 500000), d.texto.slice(0, 300));
    },
  },
  {
    id: "H88-02", entrega: "hotel88", rol: null, titulo: "EXPLICACIÓN (pendiente de tu aceptación) — Dos hoteles con el mismo nombre: la aplicación los distingue por su identificador, no por el nombre", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Qué es esto: NO es una función de la aplicación. «Hotel Duplicado» es un caso de PRUEBA que preparamos a propósito: dos hoteles distintos del catálogo (dos fichas, cada una con su identificador interno) que por casualidad se llaman igual, como podría pasar con dos hoteles reales del mismo nombre (por ejemplo «Hotel Caribe» en dos barrios). La aplicación no tiene ningún botón para «duplicar un hotel». Qué hacer: abre «Dinámicos», busca el paquete «Dinamico 88 - Hoteles del catalogo» y compara las dos tarjetas «Hotel Duplicado», una al lado de la otra. Cada tarjeta guarda en el paquete el identificador de SU ficha (no el nombre) y con ese identificador lee en vivo las estrellas, descripción, ubicación y fotos del catálogo; por eso un nombre repetido nunca mezcla los datos. (Es distinto de «duplicar un PAQUETE»: el botón «Duplicar» de la lista de Paquetes copia la configuración del paquete y sigue apuntando a las MISMAS fichas de hotel; no crea hoteles nuevos ni copia sus datos.)",
    esperado: "La primera: 4 estrellas, «Descripcion del catalogo del Duplicado A…», portada «DUP-A-1 PORTADA», contador «1 / 2», «Habitación Estandar · PC», Desde $600.000. La segunda: 5 estrellas, «Descripcion del catalogo del Duplicado B…», portada «DUP-B-1 PORTADA» (una sola foto, sin contador), «Habitación Superior · PAM», Desde $700.000. Ninguna mezcla datos de la otra. Si cambias la descripción de una de las dos fichas en Producto → Hoteles y recargas esta página, solo cambia su tarjeta (la otra queda igual). Esto es una EXPLICACIÓN de cómo funciona: no la cuentes como aceptada hasta que tú lo decidas.",
    async verificar(c) {
      await abrirDinamicos(c);
      const a = await datos(tarjeta(c, "Hotel Duplicado", 0)), b = await datos(tarjeta(c, "Hotel Duplicado", 1));
      c.check("A: 4 estrellas y su descripción", a.estrellas === 4 && /Duplicado A/.test(a.texto) && !/Duplicado B/.test(a.texto), `${a.estrellas} · ${a.texto.slice(0, 160)}`);
      c.check("A: portada propia y contador 1 / 2", /DUP-A-1 PORTADA/.test(dec(a.fotos[0])) && /1 \/ 2/.test(a.texto), dec(a.fotos[0]).slice(-80));
      c.check("A: categoría/régimen y «Desde»", /Habitación Estandar · PC/.test(a.texto) && desde(a.texto, 600000), a.texto.slice(0, 220));
      c.check("B: 5 estrellas y su descripción", b.estrellas === 5 && /Duplicado B/.test(b.texto) && !/Duplicado A/.test(b.texto), `${b.estrellas} · ${b.texto.slice(0, 160)}`);
      c.check("B: una sola foto propia, sin contador", /DUP-B-1 PORTADA/.test(dec(b.fotos[0])) && !/\d \/ \d/.test(b.texto), dec(b.fotos[0]).slice(-80));
      c.check("B: categoría/régimen y «Desde»", /Habitación Superior · PAM/.test(b.texto) && desde(b.texto, 700000), b.texto.slice(0, 220));
      c.check("cada ubicación es la de su hotel", decodeURIComponent(a.mapa ?? "").includes("Bocagrande A") && decodeURIComponent(b.mapa ?? "").includes("Getsemani B"), `${a.mapa} | ${b.mapa}`);
    },
  },
  {
    id: "H88-03", entrega: "hotel88", rol: null, titulo: "EXPLICACIÓN (pendiente de tu aceptación) — Cuándo se ve el dato nuevo del catálogo: la ficha gana a la copia vieja guardada en el paquete", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Mira las tarjetas «Hotel Sin Estrellas» y «Hotel Copia Antigua». Cómo funciona: cuando armas un paquete dinámico y eliges un hotel del catálogo, el sistema guarda en el paquete una COPIA de sus estrellas, descripción y ubicación (para poder editar el paquete y para los hoteles escritos a mano). Pero la página pública NO muestra esa copia cuando el hotel está vinculado a una ficha: lee la ficha del catálogo en el momento de abrir la página, usando el identificador guardado. Por eso «Hotel Copia Antigua» (copia de 2 estrellas y «Descripcion VIEJA») muestra lo ACTUAL de la ficha (3 estrellas, «Descripcion ACTUAL»). Lo que cambies en Producto → Hoteles aparece en la siguiente carga de la página: no hay espera programada ni nada que actualizar a mano en el paquete (la copia guardada solo se renueva cuando alguien guarda el paquete y no afecta lo que se ve). Un hotel escrito a mano en el paquete (sin ficha) sí muestra exactamente lo que se escribió. Si la ficha no tiene un dato (por ejemplo, sin fotos), se usa lo guardado en el paquete, y si tampoco hay, no se muestra nada (nunca se inventa).",
    esperado: "«Hotel Sin Estrellas» no muestra estrellas: en su lugar aparece la etiqueta de clasificación «Posada»; tiene 2 fotos («1 / 2», portada «POSADA-1 PORTADA»), su descripción y «Habitación Estandar · PA». «Hotel Copia Antigua» muestra 3 estrellas y «Descripcion ACTUAL del catalogo» (el paquete tenía guardada una copia vieja de 2 estrellas y «Descripcion VIEJA», que NO deben verse), con la ubicación «Manga ACTUAL, Cartagena». Como su ficha del catálogo no tiene fotos, muestra la foto propia del paquete («COPIA-GUARDADA») sin contador. Es una EXPLICACIÓN de cómo funciona: no la cuentes como aceptada hasta que tú lo decidas.",
    async verificar(c) {
      await abrirDinamicos(c);
      const s = await datos(tarjeta(c, "Hotel Sin Estrellas"));
      c.check("sin estrellas pintadas", s.estrellas === 0, String(s.estrellas));
      c.check("clasificación «Posada»", /posada/i.test(s.texto), s.texto.slice(0, 200));
      c.check("2 fotos con su portada y la descripción de la posada", /1 \/ 2/.test(s.texto) && /POSADA-1 PORTADA/.test(dec(s.fotos[0])) && /casa colonial/.test(s.texto), dec(s.fotos[0]).slice(-80));
      c.check("«Habitación Estandar · PA» aparte", /Habitación Estandar · PA\b/.test(s.texto), s.texto.slice(0, 200));
      const k = await datos(tarjeta(c, "Hotel Copia Antigua"));
      c.check("3 estrellas del catálogo (no las 2 guardadas)", k.estrellas === 3, String(k.estrellas));
      c.check("descripción ACTUAL, no la vieja", /Descripcion ACTUAL del catalogo/.test(k.texto) && !/VIEJA/.test(k.texto), k.texto.slice(0, 250));
      c.check("ubicación actual del catálogo", decodeURIComponent(k.mapa ?? "").includes("Manga ACTUAL"), String(k.mapa));
      c.check("foto propia del paquete porque el catálogo no tiene", k.fotos.length === 1 && /COPIA-GUARDADA/.test(dec(k.fotos[0])) && !/\d \/ \d/.test(k.texto), `${k.fotos.length} · ${dec(k.fotos[0]).slice(-60)}`);
    },
  },
  {
    id: "H88-04", entrega: "hotel88", rol: null, titulo: "Hoteles manuales y con datos faltantes: tarjetas limpias", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Mira las tarjetas «Hotel Vacio» (vinculado a una ficha sin datos), «Hotel Manual Pleno» y «Hotel Manual Pelado» (hoteles escritos a mano, sin ficha).",
    esperado: "«Hotel Vacio» y «Hotel Manual Pelado»: sin estrellas, sin etiqueta de clasificación, sin descripción, sin el bloque «Ubicación» ni enlace de mapa, y con la imagen genérica de hotel; solo nombre, «Desde» ($450.000 y $350.000) y «Cotizar». «Hotel Manual Pleno» muestra exactamente lo que se escribió en el paquete: 3 estrellas, «Descripcion MANUAL escrita a mano en el paquete.», su foto («MANUAL-FOTO»), ubicación «Baru, Cartagena» y Desde $550.000. No hay espacios vacíos ni títulos huérfanos.",
    async verificar(c) {
      await abrirDinamicos(c);
      for (const [nombre, valor] of [["Hotel Vacio", 450000], ["Hotel Manual Pelado", 350000]]) {
        const d = await datos(tarjeta(c, nombre));
        c.check(`${nombre}: sin estrellas, ubicación ni mapa`, d.estrellas === 0 && !/ubicaci[oó]n/i.test(d.texto) && !d.mapa, d.texto.slice(0, 200));
        c.check(`${nombre}: imagen genérica y «Desde» ${valor.toLocaleString("es-CO")}`, d.fotos.length === 1 && /hotel-predeterminado/.test(d.fotos[0]) && desde(d.texto, valor), `${d.fotos[0]} · ${d.texto.slice(0, 160)}`);
        c.check(`${nombre}: sin descripción ni clasificación`, !/Ver más/.test(d.texto) && d.texto.replace(nombre, "").replace(/Desde por persona en doble\s*\$?\s*[\d.]+/, "").replace(/Cotizar/, "").trim() === "", d.texto);
      }
      const m = await datos(tarjeta(c, "Hotel Manual Pleno"));
      c.check("manual con datos: 3 estrellas, descripción, foto y mapa", m.estrellas === 3 && /Descripcion MANUAL escrita a mano/.test(m.texto) && /MANUAL-FOTO/.test(dec(m.fotos[0])) && decodeURIComponent(m.mapa ?? "").includes("Baru, Cartagena"), `${m.estrellas} · ${m.texto.slice(0, 200)}`);
      c.check("manual con datos: «Desde» $550.000", desde(m.texto, 550000), m.texto.slice(0, 200));
    },
  },
  {
    id: "H88-05", entrega: "hotel88", rol: null, titulo: "Los precios no cambian: «Desde» y total de la cotización", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Revisa el «Desde por persona en doble» de las 8 tarjetas y cotiza en 3 de ellas (pulsa «Cotizar», escribe fecha de ida 30 días después de hoy y de regreso 3 noches después; se deja 1 habitación doble, sin menores). No pulses «Continuar al checkout».",
    esperado: "Los «Desde» son: Catalogo Uno 500.000 · Duplicado A 600.000 · Duplicado B 700.000 · Sin Estrellas 400.000 · Copia Antigua 520.000 · Vacio 450.000 · Manual Pleno 550.000 · Manual Pelado 350.000. «Total estimado» (2 personas en doble) = 1.000.000 en «Hotel Catalogo Uno», 1.040.000 en «Hotel Copia Antigua» y 1.100.000 en «Hotel Manual Pleno». La información del catálogo no altera ningún precio. En el celular (390 px) los controles y los totales caben en la pantalla.",
    async verificar(c) {
      await abrirDinamicos(c);
      const esperados = [["Hotel Catalogo Uno", 500000, 0], ["Hotel Duplicado", 600000, 0], ["Hotel Duplicado", 700000, 1], ["Hotel Sin Estrellas", 400000, 0], ["Hotel Copia Antigua", 520000, 0], ["Hotel Vacio", 450000, 0], ["Hotel Manual Pleno", 550000, 0], ["Hotel Manual Pelado", 350000, 0]];
      for (const [nombre, valor, i] of esperados) c.check(`«Desde» de ${nombre}${i ? " (B)" : ""} = ${valor.toLocaleString("es-CO")}`, desde((await datos(tarjeta(c, nombre, i))).texto, valor), "");
      await cotizar(c, "Hotel Catalogo Uno", 1000000);
      await cotizar(c, "Hotel Copia Antigua", 1040000);
      await cotizar(c, "Hotel Manual Pleno", 1100000);
    },
  },
  {
    id: "H88-06", entrega: "hotel88", rol: null, titulo: "Cotizar se abre en una ventana: la tarjeta ya no se estira", ruta: "/tarifario?vista=dinamicos", solo_lectura: true,
    accion: "Antes: al pulsar «Cotizar» el formulario se desplegaba DENTRO de la tarjeta y la estiraba (y empujaba a las demás). Ahora: en «Dinamico 88 - Hoteles del catalogo» pulsa «Cotizar» en «Hotel Catalogo Uno». Revísalo en pantalla de escritorio, a ancho intermedio (unos 768 px) y en celular (390 px). Ciérrala con la tecla Escape y con el botón «Cerrar» (ábrela otra vez para probar los dos). No pulses «Continuar al checkout».",
    esperado: "Se abre una ventana centrada con el título «Cotizar · Hotel Catalogo Uno» y debajo el nombre del paquete, destino y noches; el resto de la página se ve atenuado y no se desplaza. Dentro están las mismas secciones de siempre (Hotel, Alimentación, Habitaciones, Viajeros, Fechas) y «Total estimado». La tarjeta y la grilla de atrás NO cambian de tamaño. En celular la ventana ocupa casi todo el ancho sin cortarse; si el contenido es largo, se desplaza dentro de la ventana. Escape y «Cerrar» la cierran; si la vuelves a abrir en el mismo hotel, conserva lo que habías puesto (habitaciones, fechas) mientras no cierres la pestaña.",
    async verificar(c) {
      await abrirDinamicos(c);
      const card = tarjeta(c, "Hotel Catalogo Uno");
      const antes = await card.boundingBox();
      await card.getByRole("button", { name: "Cotizar" }).click();
      const ventana = c.page.locator('[data-testid="ventana-cotizador-dinamico"]');
      await ventana.waitFor({ timeout: 15000 });
      const despues = await card.boundingBox();
      c.check("la tarjeta no cambia de tamaño al abrir", !!antes && !!despues && Math.abs(antes.height - despues.height) < 1 && Math.abs(antes.width - despues.width) < 1, JSON.stringify({ antes, despues }));
      c.check("el cotizador NO está dentro de la tarjeta", (await card.locator('[data-testid="cotizador-dinamico"]').count()) === 0, "");
      c.check("título de la ventana", /Cotizar · Hotel Catalogo Uno/.test(await ventana.innerText()), "");
      const caja = await ventana.boundingBox(); const vp = c.page.viewportSize();
      c.check("la ventana cabe en la pantalla", !!caja && !!vp && caja.x >= 0 && caja.x + caja.width <= vp.width + 1 && caja.y >= 0 && caja.y + caja.height <= vp.height + 1, JSON.stringify({ caja, vp }));
      await c.page.keyboard.press("Escape");
      await ventana.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
      c.check("Escape cierra la ventana", (await ventana.count()) === 0, "");
    },
  },
  {
    id: "H88-07", entrega: "hotel88", rol: null, titulo: "Hotel del catálogo en un paquete común (no dinámico): mismos datos, por identificador", ruta: "/tarifario", solo_lectura: true,
    accion: "Requiere la semilla de correcciones «rev2/h88.sql» (la carga quien prepara la revisión; avisa si no ves estos datos). Sin iniciar sesión, abre /tarifario y busca la tarjeta «Hotel Caribe Plaza» de los paquetes de Cartagena (porción terrestre). En la base existe además OTRO hotel con el mismo nombre (el «gemelo») que NO está en ningún paquete y tiene otros datos.",
    esperado: "La tarjeta de «Hotel Caribe Plaza» muestra los datos de SU ficha: 4 estrellas, «Descripcion de CATALOGO CARIBE PLAZA (paquete comun)…», ubicación «Bocagrande, Cartagena» y la galería de 2 fotos con «CARIBE-2 PORTADA» primero. No aparece nada del gemelo («2 estrellas», «Descripcion del GEMELO», «Barrio Gemelo», «GEMELO-1»). Los precios no cambian respecto a antes de cargar la semilla.",
    async verificar(c) {
      await c.ir("/tarifario");
      // Comprobación mínima y sin supuestos sobre el diseño de la tarjeta: ningún dato del gemelo aparece en la página (el gemelo no está en ningún paquete).
      // Las tarjetas de porción terrestre solo se pintan tras elegir destino y fechas; los datos del hotel viajan, ya resueltos por identificador, en la propia página (carga del servidor). Se comprueban ahí.
      await c.espera(1500);
      const html = await c.page.content();
      c.check("la página trae «Hotel Caribe Plaza» con los datos de SU ficha (descripción y ubicación del catálogo)", /Hotel Caribe Plaza/.test(html) && /Descripcion de CATALOGO CARIBE PLAZA/.test(html) && /Bocagrande, Cartagena/.test(html), String(html.length));
      c.check("ningún dato del hotel gemelo en la página", !/Descripcion del GEMELO|Barrio Gemelo/i.test(html) && !/GEMELO-1/.test(html), "");
    },
  },
];

// ───────────────────────────── NETA ─────────────────────────────
const RESERVA = (paquete, hotel, bloqueo) => `/dashboard/reservar/nuevo?paquete=${paquete}&hotel=${hotel}&bloqueo=${bloqueo}&modulo=bloqueo`;
const contratoDe = (c, bloqueo) => c.sql(`select numero_contrato from public.sillas where bloqueo_id = ${bloqueo} and numero_contrato is not null order by id limit 1`);
const previstas = (c, n) => c.sql(`select coalesce(string_agg((payload->>'tipo_proveedor') || '|' || trim_scale((payload->>'valor_total')::numeric)::text || '|' || (payload->>'moneda') || '|' || coalesce(trim_scale((payload->>'valor_cop_costo')::numeric)::text, '-') || '|' || coalesce(trim_scale((payload->>'trm_costo')::numeric)::text, '-'), ';' order by payload->>'tipo_proveedor'), '') from public.contrato_obligaciones_previstas where numero_contrato = '${n}' and clase = 'cxp'`);
const cxp = (c, n) => c.sql(`select coalesce(string_agg(tipo_proveedor || '|' || trim_scale(valor_total::numeric)::text || '|' || moneda || '|' || coalesce(trim_scale(valor_cop_costo::numeric)::text, '-') || '|' || coalesce(trim_scale(trm_costo::numeric)::text, '-'), ';' order by tipo_proveedor), '') from public.cuentas_por_pagar where numero_contrato = '${n}'`);
const errores = (c) => c.page.locator("p.bg-red-50, li.text-red-600, [role=alert], .bg-red-50").allInnerTexts().then((a) => a.join(" | ").slice(0, 300)).catch(() => "");
// Solo lo que toca la reserva del bloqueo NTB302 (91202): el ensayo corre junto a otras entregas, así que no se cuentan tablas enteras.
const conteos = (c) => c.sql("select (select count(*) from public.cotizaciones where payload->>'bloqueoId' = '91202') || '|' || (select count(*) from public.sillas where bloqueo_id = 91202 and (numero_contrato is not null or estado <> 'disponible')) || '|' || (select count(*) from public.ventas v where exists (select 1 from public.sillas s where s.numero_contrato = v.numero_contrato and s.bloqueo_id = 91202)) || '|' || (select count(*) from public.cuentas_por_pagar x where x.proveedor = 'Aerolinea Neta SAS' and x.valor_total = 680500) || '|' || (select count(*) from public.contrato_obligaciones_previstas o where o.payload->>'proveedor' = 'Aerolinea Neta SAS' and (o.payload->>'valor_total')::numeric = 680500)");

/** Llena «Reservar» (hotel + bloqueo) por el formulario real hasta «Generar cotización». `infante` agrega 1 infante sin silla (3er pasajero). Devuelve el id de la cotización. */
async function reservarForm(c, { infante, prefijoDoc, bloqueo }) {
  const p = c.page;
  p.on("dialog", (d) => d.accept().catch(() => {}));
  await p.locator('div:has(> label:has-text("Doble · 2 pax")) input').first().fill("1");
  if (infante) await p.locator('div:has(> label:has-text("Infantes (menores de 2")) input').first().fill("1");
  const nombres = p.locator('div:has(> label:text-is("Nombres *")) input'), apellidos = p.locator('div:has(> label:text-is("Apellidos *")) input');
  const filas = infante ? [["Ana", "Revision"], ["Luis", "Revision"], ["Bebe", "Revision"]] : [["Ana", "Revision"], ["Luis", "Revision"]];
  await nombres.nth(0).fill("Ana"); await apellidos.nth(0).fill("Revision");   // cliente (titular)
  const selAsesor = p.locator('div:has(> label:has-text("Asesor interno")) select').first();
  // La cuenta de venta ve «Rev Venta»; otras cuentas (p. ej. administración) eligen el primer asesor de su lista.
  if (await selAsesor.locator("option", { hasText: "Rev Venta" }).count()) await selAsesor.selectOption({ label: "Rev Venta" }); else await selAsesor.selectOption({ index: 1 });
  for (let i = 0; i < filas.length; i++) { await nombres.nth(i + 1).fill(filas[i][0]); await apellidos.nth(i + 1).fill(filas[i][1]); }
  const numeros = p.locator('div:has(> label:text-is("Número doc")) input');
  for (let i = 0; i < filas.length; i++) await numeros.nth(i).fill(`${prefijoDoc}${i + 1}`);
  const nac = p.locator('input[aria-label="Fecha nacimiento"]');
  await escribirFecha(nac.nth(0), "15031985"); await escribirFecha(nac.nth(1), "20081983");
  if (infante) {
    const ida = c.sql(`select to_char((fecha_ida - interval '8 months')::date, 'DDMMYYYY') from public.bloqueos_vuelo where id = ${bloqueo}`);
    await p.locator('div:has(> label:text-is("Tipo doc")) select').nth(2).selectOption("RC");
    await escribirFecha(nac.nth(2), ida);
    await p.locator('div:has(> label:has-text("Adulto responsable")) select').first().selectOption({ index: 1 });
  }
  await p.getByRole("button", { name: "Generar cotización" }).click();
  await p.waitForURL(/\/dashboard\/cotizaciones\/\d+/, { timeout: 45000 }).catch(() => {});
  return Number((p.url().match(/cotizaciones\/(\d+)/) ?? [])[1] ?? 0);
}
/** En la cotización: opcionalmente TRM, y «Confirmar → generar contrato». Espera la ficha del contrato o el mensaje de error. */
async function generarContrato(c, { usd, antes } = {}) {
  const p = c.page;
  p.on("dialog", (d) => d.accept().catch(() => {}));
  if (usd) {
    await antes?.();
    if (await p.locator('input[aria-label="TRM provisional"]').count()) await p.locator('input[aria-label="TRM provisional"]').fill("4000");
    if (await p.locator('input[aria-label="TRM de costos"]').count()) await p.locator('input[aria-label="TRM de costos"]').fill("3900");
    if (await p.locator('select[aria-label="Moneda de cobro"]').count()) await p.locator('select[aria-label="Moneda de cobro"]').selectOption("USD");
    if (await p.locator('input[aria-label="TRM de cobro"]').count()) await p.locator('input[aria-label="TRM de cobro"]').fill("4000");
  }
  await p.getByRole("button", { name: /Confirmar → generar contrato/ }).click();
  await Promise.race([p.waitForURL(/\/dashboard\/contratos\/[^/?]+/, { timeout: 60000 }), p.locator("p.bg-red-50").first().waitFor({ timeout: 60000 })]).catch(() => {});
  await c.espera(800);
}

export const pasosNeta = [
  {
    id: "NETA-01", entrega: "neta", rol: "operaciones", titulo: "El bloqueo guarda DOS tarifas distintas: neta (pago a la aerolínea) y para empaquetar (reventa)", ruta: "/dashboard/vuelos/91201", solo_lectura: true,
    accion: "Abre el bloqueo NTA301 (/dashboard/vuelos/91201). Lee el encabezado y despliega «Editar bloqueo (no cambia cupos)» (no guardes nada).",
    esperado: "El encabezado dice «Tarifa empaquetar $349.000 · Fee infante $80.500 · Moneda COP». En el editor, «Tarifa neta (pago aerolínea)» = 300000 y «Tarifa empaquetar (reventa)» = 349000. La neta de 300.000 es lo que se le paga a la aerolínea por silla; 349.000 es solo la base del precio de venta.",
    async verificar(c) {
      await c.ir("/dashboard/vuelos/91201"); const t = await c.texto();
      c.check("encabezado: reventa y fee de infante", /Tarifa empaquetar\s*\$?\s*349\.000/.test(t) && /Fee infante\s*\$?\s*80\.500/.test(t) && /Moneda COP/.test(t), t.slice(0, 260));
      await c.page.getByRole("button", { name: /Editar bloqueo/ }).click(); await c.espera(400);
      const neta = await c.page.locator('div:has(> label:text-is("Tarifa neta (pago aerolínea)")) input').first().inputValue();
      const rev = await c.page.locator('div:has(> label:text-is("Tarifa empaquetar (reventa)")) input').first().inputValue();
      c.check("neta 300000 y reventa 349000 en el editor", dig(neta) === 300000 && dig(rev) === 349000, `${neta} / ${rev}`);
    },
  },
  {
    id: "NETA-02", entrega: "neta", rol: null, titulo: "El precio comercial público sigue saliendo de la tarifa para empaquetar", ruta: "/tarifario", solo_lectura: true,
    accion: "Sin iniciar sesión, abre el tarifario público (en el celular, pulsa primero «Buscar»). En «Buscar vuelo + hotel (paquete)» elige Origen «BOGOTÁ», Destino «CARTAGENA NETA» y, en «Salida (vuelo)», la PRIMERA salida de la lista (la del bloqueo NTA301, sale en unos 60 días). Mira la tarjeta «Hotel Neta Peso» (paquete «Paquete bloqueo Neta COP»).",
    esperado: "Aparece 1 hotel disponible, «Hotel Neta Peso», con «DESDE $ 699.000 por persona»: el precio comercial configurado (calculado sobre la reventa 349.000 + hotel + margen). No aparece la neta (300.000) ni la reventa cruda (349.000) como precio al público.",
    async verificar(c) {
      await c.ir("/tarifario"); const p = c.page;
      const sel = (txt) => p.locator("select").filter({ has: p.locator("option", { hasText: txt }) }).first();
      if (!(await sel("BOGOTÁ").isVisible().catch(() => false))) { await p.getByRole("button", { name: "Buscar", exact: true }).first().click().catch(() => {}); await c.espera(600); }
      await sel("BOGOTÁ").selectOption({ index: 1 }); await c.espera(500);
      await sel("CARTAGENA NETA").selectOption({ index: 1 }); await c.espera(500);
      await sel("cupos").selectOption({ index: 1 }); await c.espera(2500);
      const t = await c.texto();
      const i = t.indexOf("Hotel Neta Peso");
      c.check("el hotel aparece en el tarifario público", i >= 0, t.slice(0, 160));
      const ventana = i >= 0 ? t.slice(i, i + 700) : "";
      c.check("precio comercial $699.000", /DESDE\s*\$?\s*699\.000/i.test(ventana), ventana.slice(0, 300));
      c.check("no se muestra la neta ni la reventa cruda", !/300\.000|349\.000/.test(ventana), ventana.slice(0, 300));
    },
  },
  {
    id: "NETA-03", entrega: "neta", rol: "venta", titulo: "Reservar con la neta: cotización y contrato (2 adultos, bloqueo con neta)", ruta: RESERVA(91201, 91201, 91201),
    accion: "Con la cuenta de venta abre la reserva del bloqueo NTA301 (Reservar → Vista tabla → Paquetes → «Hotel Neta Peso» → Reservar, o el enlace de arriba). 1) En «Doble · 2 pax» escribe 1. 2) Cliente: Nombres «Ana», Apellidos «Revision». 3) Asesor interno: «Rev Venta». 4) Pasajeros 1 y 2: Ana Revision (documento 91000001, nacimiento 15/03/1985) y Luis Revision (documento 91000002, nacimiento 20/08/1983). 5) Pulsa «Generar cotización». 6) En la cotización pulsa «Confirmar → generar contrato».",
    esperado: "Antes de guardar, el encabezado muestra «6 cupo(s) disponible(s)» y el total del formulario es $1.398.000 (2 × 699.000). Se crea el contrato en estado Pendiente con precio de venta 1.398.000. Como asesor de ventas NO ves costos del contrato (ninguna cifra «Costo aéreo» ni 600.000 en pantalla). Quedan 2 sillas tomadas del bloqueo.",
    async verificar(c) {
      await c.ir(RESERVA(91201, 91201, 91201)); const t0 = await c.texto();
      c.check("6 cupos disponibles", /6 cupo\(s\) disponible\(s\)/.test(t0), t0.slice(0, 250));
      const antes = conteos(c);
      const id = await reservarForm(c, { infante: false, prefijoDoc: "9100001", bloqueo: 91201 });
      c.check("se creó la cotización", id > 0, c.page.url() + " " + await errores(c));
      await generarContrato(c);
      const n = contratoDe(c, 91201);
      c.check("contrato creado y abierto", !!n && c.page.url().includes("/dashboard/contratos/"), `${n} · ${c.page.url()}`);
      const [precio, estado, aereo, hotel, asesor] = c.sql(`select trim_scale(precio_venta::numeric) || '|' || estado || '|' || trim_scale(costo_aereo::numeric) || '|' || trim_scale(costo_hotel::numeric) || '|' || asesor from public.ventas where numero_contrato = '${n}'`).split("|");
      c.check("precio de venta 1.398.000 (precio comercial, sin cambio)", Number(precio) === 1398000 && estado === "pendiente" && asesor === "Rev Venta", `${precio} ${estado} ${asesor}`);
      c.check("costo aéreo del contrato = 2 × neta 300.000 = 600.000 (no 698.000)", Number(aereo) === 600000, aereo);
      c.check("costo del hotel 420.000", Number(hotel) === 420000, hotel);
      c.check("2 sillas tomadas del bloqueo", c.sql(`select count(*) from public.sillas where bloqueo_id = 91201 and numero_contrato = '${n}'`) === "2", "");
      c.check("exactamente 1 contrato nuevo para este bloqueo", c.sql("select count(distinct numero_contrato) from public.sillas where bloqueo_id = 91201 and numero_contrato is not null") === "1", "");
      const tc = await c.texto();
      c.check("el asesor de ventas no ve costos", !/Costo a[eé]reo/i.test(tc) && !/600\.000/.test(tc), tc.slice(0, 200));
    },
  },
  {
    id: "NETA-04", entrega: "neta", rol: "administracion", titulo: "Costo aéreo y obligación pendiente = 600.000; al confirmar nace UNA cuenta por pagar", ruta: "/dashboard/contratos",
    accion: "Con administración abre el contrato recién creado (el más reciente de «Rev Venta»; el ensayo lo abre directo). 1) Pestaña «Costos»: lee «Costo aéreo» y «Costo hotel». 2) Arriba, en «Obligaciones previstas — aún no exigibles», lee las filas. 3) Pestaña «Proveedores»: aún no hay cuentas por pagar. 4) Pulsa «Confirmar venta». 5) Vuelve a «Proveedores» y recarga la página.",
    esperado: "Costos: «Costo aéreo» 600000 y «Costo hotel» 420000. Obligaciones previstas: aéreo $600.000 (proveedor «Aerolinea Neta SAS») y hotel $420.000, «Total previsto» $1.020.000, mientras el contrato está Pendiente. Tras confirmar, el contrato queda Confirmado y las previstas nacen como cuentas por pagar: exactamente una de aéreo por 600.000 y una de hotel por 420.000 (2 en total); al recargar no se duplican.",
    async verificar(c) {
      const n = contratoDe(c, 91201);
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=costos`);
      const aereo = await c.page.locator('div:has(> label:text-is("Costo aéreo")) input').first().inputValue();
      const hotel = await c.page.locator('div:has(> label:text-is("Costo hotel")) input').first().inputValue();
      c.check("pestaña Costos: aéreo 600000 y hotel 420000", dig(aereo) === 600000 && dig(hotel) === 420000, `${aereo} / ${hotel}`);
      const t = await c.texto();
      c.check("obligaciones previstas: aéreo 600.000, hotel 420.000, total 1.020.000", /Obligaciones previstas/.test(t) && /Aerolinea Neta SAS/.test(t) && /600\.000/.test(t) && /420\.000/.test(t) && /Total previsto\s*\$?\s*1\.020\.000/.test(t), t.slice(0, 300));
      c.check("pendiente: previstas 600000 + 420000 y ninguna cuenta por pagar", previstas(c, n) === "aereo|600000|COP|-|-;hotel|420000|COP|-|-" && cxp(c, n) === "", `${previstas(c, n)} // ${cxp(c, n)}`);
      await c.page.getByRole("button", { name: "Confirmar venta" }).click();
      await c.page.getByText(/Confirmado/).first().waitFor({ timeout: 45000 }).catch(() => {}); await c.espera(1500);
      c.check("al confirmar nacen 2 cuentas por pagar: aéreo 600.000 y hotel 420.000", cxp(c, n) === "aereo|600000|COP|-|-;hotel|420000|COP|-|-", cxp(c, n));
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=proveedores`);
      c.check("sin duplicados tras recargar (2 cuentas)", c.sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = '${n}'`) === "2", "");
      c.check("devengo contable del aéreo = 600.000", c.sql(`select trim_scale(coalesce(sum(l.debe), 0)::numeric) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id join public.cuentas_por_pagar x on a.referencia = 'cxp:' || x.id where a.origen = 'cxp' and x.numero_contrato = '${n}' and x.tipo_proveedor = 'aereo'`) === "600000", "");
      c.check("los previstos quedaron materializados (no se cuentan dos veces)", c.sql(`select count(*) from public.contrato_obligaciones_previstas where numero_contrato = '${n}' and clase = 'cxp' and materializada_en is null`) === "0", "");
    },
  },
  {
    id: "NETA-05", entrega: "neta", rol: "venta", titulo: "Bloqueo en dólares: neta USD 100, reventa USD 120, TRM de costos 3.900 (provisional)", ruta: RESERVA(91202, 91202, 91203),
    accion: "Con la cuenta de venta abre la reserva del bloqueo NTU303 (en dólares, paquete «Paquete bloqueo Neta USD»). 1) «Doble · 2 pax» = 1. 2) Cliente Ana Revision; asesor «Rev Venta»; pasajeros Ana Revision (documento 91000031, nacimiento 15/03/1985) y Luis Revision (91000032, 20/08/1983). 3) «Generar cotización». 4) En la cotización, lee el recuadro «TRM de costos (COP por USD)» (su ayuda dice que es PROVISIONAL: se corrige en la ficha del contrato mientras esté pendiente y se congela al confirmar). Escribe 3900 en «TRM de costos»; si se piden, TRM provisional 4000 y moneda de cobro USD. 5) «Confirmar → generar contrato».",
    esperado: "El recuadro «TRM de costos» explica que es provisional y que se puede corregir mientras el contrato esté pendiente (ya no dice «no cambia después»). El contrato queda Pendiente, en USD, con precio de venta USD 450 (2 × 225). Costo aéreo = USD 200 (2 × neta 100; con la reventa 120 habría sido 240). La obligación prevista de aéreo es de USD 200 con su equivalente en pesos provisional a la TRM de costos 3.900 = COP 780.000 (200 × 3.900). Todavía no hay cuentas por pagar. Como asesor de ventas no ves costos.",
    async verificar(c) {
      await c.ir(RESERVA(91202, 91202, 91203));
      const id = await reservarForm(c, { infante: false, prefijoDoc: "9100003", bloqueo: 91203 });
      c.check("se creó la cotización USD", id > 0, c.page.url() + " " + await errores(c));
      await generarContrato(c, {
        usd: true,
        antes: async () => {
          const caja = c.page.locator('[data-testid="trm-costo"]');
          const t = (await caja.innerText().catch(() => "")).replace(/\s+/g, " ");
          c.check("el recuadro «TRM de costos» dice que es provisional y que se corrige en la ficha mientras esté pendiente", /provisional/i.test(t) && /ficha del contrato/i.test(t) && /pendiente/i.test(t) && !/no cambia despu/i.test(t), t.slice(0, 300));
        },
      });
      const n = contratoDe(c, 91203);
      c.check("contrato USD creado", !!n, `${n} · ${c.page.url()} ${await errores(c)}`);
      const [moneda, precio, aereo] = c.sql(`select moneda || '|' || trim_scale(precio_venta::numeric) || '|' || trim_scale(costo_aereo::numeric) from public.ventas where numero_contrato = '${n}'`).split("|");
      c.check("moneda USD, precio USD 450 y costo aéreo USD 200 (no 240)", moneda === "USD" && Number(precio) === 450 && Number(aereo) === 200, `${moneda} ${precio} ${aereo}`);
      c.check("obligación prevista aérea: USD 200 = COP 780.000 a TRM 3.900", /aereo\|200\|USD\|780000\|3900/.test(previstas(c, n)), previstas(c, n));
      c.check("pendiente: ninguna cuenta por pagar todavía", cxp(c, n) === "", cxp(c, n));
      const tc = await c.texto();
      c.check("el asesor de ventas no ve costos ni la TRM de costos", !/Costo a[eé]reo/i.test(tc) && !/Obligaciones previstas/.test(tc) && !/Corregir la TRM/.test(tc), tc.slice(0, 200));
    },
  },
  {
    id: "NETA-06", entrega: "neta", rol: "administracion", titulo: "Contrato en dólares: los costos se ven EN USD, con su equivalente en pesos provisional", ruta: "/dashboard/contratos",
    accion: "Con administración abre el contrato en USD recién creado (bloqueo NTU303; el ensayo lo abre directo; NO lo confirmes todavía). 1) Pestaña «Costos»: lee el recuadro azul y «Costo aéreo». 2) Arriba, lee «Obligaciones previstas — aún no exigibles»: la fila del aéreo, el equivalente en pesos y los totales. 3) En otra ventana (por ejemplo de incógnito) inicia sesión con la cuenta de venta y abre el mismo contrato.",
    esperado: "Costos: un recuadro azul dice «Los costos de este contrato están en USD (la moneda de la oferta), no en pesos» y «TRM de costos $3.900 (provisional)»; «Costo aéreo» = USD $200.00 (no «$ 200»). Obligaciones previstas: el aéreo dice «USD $200.00» y debajo «≈ $ 780.000 a TRM de costos $3.900 (provisional)» (200 × 3.900); los totales dicen «Total previsto en USD» con «≈ … (provisional)» y los dólares NO se suman con pesos. La nota aclara que es distinta de la TRM del pago real al proveedor y de la TRM de cobro. Todavía no hay cuentas por pagar. Con la cuenta de venta no aparece ninguno de estos paneles.",
    async verificar(c) {
      const n = contratoDe(c, 91203);
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=costos`);
      const aereoUi = await c.page.locator('div:has(> label:text-is("Costo aéreo")) input').first().inputValue();
      c.check("pestaña Costos: costo aéreo 200", dig(aereoUi) === 200, aereoUi);
      const t = await c.texto();
      c.check("recuadro azul: costos en USD y TRM de costos $3.900 (provisional)", /Los costos de este contrato están en USD/.test(t) && /TRM de costos \$3\.900 \(provisional\)/.test(t), t.slice(0, 400));
      c.check("«Costo aéreo» rotulado USD $200.00 (no en pesos)", /Costo a[eé]reo\s*USD \$200\.00/.test(t), t.slice(0, 400));
      c.check("obligaciones previstas: aéreo USD $200.00 con ≈ $ 780.000 a TRM de costos $3.900 (provisional)", /Obligaciones previstas/.test(t) && /Aerolinea Neta SAS[^]*USD \$200\.00/.test(t) && /≈ \$\s*780\.000 a TRM de costos \$3\.900 \(provisional\)/.test(t), t.slice(0, 500));
      c.check("totales por moneda: «Total previsto en USD» con equivalente provisional", /Total previsto en USD/.test(t) && /≈ \$\s*[\d.]+ \(provisional\)/.test(t), "");
      c.check("la nota distingue la TRM de costos de la TRM del pago real", /distinta de la TRM del pago real/.test(t), "");
      c.check("pendiente: previsión USD 200 = COP 780.000 a 3.900 y ninguna cuenta por pagar", /aereo\|200\|USD\|780000\|3900/.test(previstas(c, n)) && cxp(c, n) === "", `${previstas(c, n)} // ${cxp(c, n)}`);
      // Otra sesión (venta): no ve costos ni previstas ni el editor.
      const ctx = await c.page.context().browser().newContext({ viewport: { width: c.ancho, height: 900 }, locale: "es-CO", timezoneId: "America/Bogota" });
      const pv = await ctx.newPage();
      try {
        await pv.goto(`${c.APP}/login`, { waitUntil: "domcontentloaded" }); await pv.waitForLoadState("networkidle").catch(() => {});
        await pv.fill('input[name="email"]', `venta${c.cuentas}`); await pv.fill('input[name="password"]', c.clave);
        await Promise.all([pv.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).catch(() => null), pv.click('button[type="submit"]')]);
        await pv.goto(`${c.APP}/dashboard/contratos/${encodeURIComponent(n)}`, { waitUntil: "domcontentloaded" }); await pv.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await pv.waitForTimeout(1200);
        const tv = (await pv.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        c.check("venta: sin «Obligaciones previstas», sin TRM de costos y sin el botón de corregir", !/Obligaciones previstas/.test(tv) && !/TRM de costos/.test(tv) && !/Corregir la TRM/.test(tv), tv.slice(0, 200));
      } finally { await ctx.close(); }
    },
  },
  {
    id: "NETA-06b", entrega: "neta", rol: "administracion", titulo: "Corregir la TRM de costos PROVISIONAL después de guardar (3.900 → 4.100) y confirmar", ruta: "/dashboard/contratos",
    accion: "Con administración, en el mismo contrato en USD pendiente (NETA-05/06). 1) Abre el contrato en DOS pestañas del navegador (A y B). 2) En la pestaña A pulsa «Corregir la TRM de costos de este contrato», escribe 4100, motivo «TRM acordada con la aerolínea» y «Guardar TRM». 3) En la pestaña B (que todavía muestra 3.900, NO la recargues) pulsa «Corregir…», escribe 4300 y «Guardar TRM». 4) En la pestaña A, pulsa «Confirmar venta» y luego abre la pestaña «Proveedores» y la pestaña «Costos».",
    esperado: "Pestaña A: aparece «TRM de costos actualizada a $4.100» y el aéreo queda «USD $200.00 · ≈ $ 820.000 a TRM de costos $4.100 (provisional)» (200 × 4.100); el precio USD 450, el costo en dólares y las cuentas por pagar (ninguna) no cambian. Pestaña B: dice «La TRM de costos cambió mientras la editabas. Recarga la página y revisa el valor actual…» y NO cambia nada (sigue 4.100). Al confirmar nace UNA cuenta por pagar aérea de USD $200.00 con «≈ $ 820.000 a TRM de costos $4.100 (congelada)», el devengo contable es 820.000 pesos, el panel de previstas y el botón de corregir desaparecen y «Costos» dice que la TRM «quedó congelada al confirmar». Un cambio de TRM no toca otros contratos ni cuentas por pagar existentes.",
    async verificar(c) {
      const n = contratoDe(c, 91203);
      const url = `${c.APP}/dashboard/contratos/${encodeURIComponent(n)}`;
      const otrosAntes = c.sql(`select md5(coalesce((select string_agg(x::text, '|' order by id) from public.cuentas_por_pagar x where numero_contrato <> '${n}'), ''))`);
      const ventaAntes = c.sql(`select md5(v::text) from public.ventas v where numero_contrato = '${n}'`);
      // Pestaña B: se carga ANTES de editar en A (queda con la TRM 3.900 en pantalla).
      const b = await c.page.context().newPage();
      try {
        await b.goto(url, { waitUntil: "domcontentloaded" }); await b.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await b.getByRole("button", { name: "Corregir la TRM de costos de este contrato" }).waitFor({ timeout: 20000 });
        // Pestaña A: la corrección real por la pantalla.
        await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}`);
        const a = c.page;
        await a.getByRole("button", { name: "Corregir la TRM de costos de este contrato" }).click();
        await a.locator('input[aria-label="Nueva TRM de costos"]').fill("4100");
        await a.locator('input[aria-label="Motivo de la corrección"]').fill("TRM acordada con la aerolínea");
        await a.getByRole("button", { name: "Guardar TRM" }).click();
        await a.getByText(/TRM de costos actualizada a \$4\.100/).first().waitFor({ timeout: 30000 }).catch(() => {});
        await c.espera(1500);
        const t = await c.texto();
        c.check("A: «TRM de costos actualizada a $4.100»", /TRM de costos actualizada a \$4\.100/.test(t), t.slice(0, 300));
        c.check("A: el aéreo muestra ≈ $ 820.000 a TRM de costos $4.100 (provisional)", /≈ \$\s*820\.000 a TRM de costos \$4\.100 \(provisional\)/.test(t), t.slice(0, 500));
        c.check("la previsión guardó USD 200 = COP 820.000 a 4.100", /aereo\|200\|USD\|820000\|4100/.test(previstas(c, n)), previstas(c, n));
        c.check("historial: 3.900 → 4.100 con 780.000 → 820.000 y el motivo", c.sql(`select count(*) from public.contrato_trm_costo_historial where numero_contrato = '${n}' and trm_anterior = 3900 and trm_nueva = 4100 and valor_cop_anterior = 780000 and valor_cop_nuevo = 820000 and nota = 'TRM acordada con la aerolínea'`) === "1", "");
        c.check("precio y costos de la venta no cambian y todavía no hay cuentas por pagar", c.sql(`select md5(v::text) from public.ventas v where numero_contrato = '${n}'`) === ventaAntes && cxp(c, n) === "", "");
        // Pestaña B, con la TRM vieja a la vista: se rechaza (compara-y-cambia).
        await b.getByRole("button", { name: "Corregir la TRM de costos de este contrato" }).click();
        await b.locator('input[aria-label="Nueva TRM de costos"]').fill("4300");
        await b.getByRole("button", { name: "Guardar TRM" }).click();
        await b.getByText(/cambió mientras la editabas/).first().waitFor({ timeout: 30000 }).catch(() => {});
        const tb = (await b.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
        c.check("B: «La TRM de costos cambió mientras la editabas»", /La TRM de costos cambió mientras la editabas/.test(tb), tb.slice(0, 200));
        c.check("B no cambió nada: sigue 4.100 y un solo cambio en el historial", /aereo\|200\|USD\|820000\|4100/.test(previstas(c, n)) && c.sql(`select count(distinct trm_nueva) from public.contrato_trm_costo_historial where numero_contrato = '${n}'`) === "1", previstas(c, n));
      } finally { await b.close().catch(() => {}); }
      // Confirmar: la CxP nace con la TRM corregida y queda congelada.
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}`);
      await c.page.getByRole("button", { name: "Confirmar venta" }).click();
      await c.page.getByText(/Confirmado/).first().waitFor({ timeout: 45000 }).catch(() => {}); await c.espera(1500);
      c.check("al confirmar nace UNA cuenta por pagar aérea: USD 200, equivalente 820.000, TRM 4.100", /(^|;)aereo\|200\|USD\|820000\|4100(;|$)/.test(cxp(c, n)) && c.sql(`select count(*) from public.cuentas_por_pagar where numero_contrato = '${n}' and tipo_proveedor = 'aereo'`) === "1", cxp(c, n));
      c.check("devengo contable del aéreo = 820.000", c.sql(`select trim_scale(coalesce(sum(l.debe), 0)::numeric) from public.asientos_contables a join public.asiento_lineas l on l.asiento_id = a.id join public.cuentas_por_pagar x on a.referencia = 'cxp:' || x.id where a.origen = 'cxp' and x.numero_contrato = '${n}' and x.tipo_proveedor = 'aereo'`) === "820000", "");
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=proveedores`);
      const tp = await c.texto();
      c.check("Proveedores: USD $200.00 con ≈ $ 820.000 a TRM de costos $4.100 (congelada)", /USD \$200\.00/.test(tp) && /≈ \$\s*820\.000 a TRM de costos \$4\.100 \(congelada\)/.test(tp), tp.slice(0, 400));
      c.check("ya no hay panel de previstas ni botón de corregir", !/Obligaciones previstas/.test(tp) && !/Corregir la TRM/.test(tp), "");
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=costos`);
      c.check("Costos: la TRM «quedó congelada al confirmar»", /quedó congelada al confirmar/.test(await c.texto()), "");
      c.check("ningún otro contrato ni cuenta por pagar cambió", c.sql(`select md5(coalesce((select string_agg(x::text, '|' order by id) from public.cuentas_por_pagar x where numero_contrato <> '${n}'), ''))`) === otrosAntes, "");
    },
  },
  {
    id: "NETA-06c", entrega: "neta", rol: "administracion", titulo: "Agregar un servicio en dólares DESPUÉS de crear el contrato: nace en USD con su TRM de costos provisional", ruta: RESERVA(91202, 91202, 91203),
    accion: "Con administración crea OTRO contrato en USD como en NETA-05 (bloqueo NTU303, «Doble · 2 pax» = 1, TRM de costos 3.900). En la copia de ensayo el coordinador deja ese contrato enlazado a su paquete y con un servicio opcional en dólares «Tour USD Rev349» (neta USD 50 por persona) para que aparezca el cuadro «Servicios adicionales (contrato pendiente)». 1) En ese cuadro, los importes dicen «USD $…» (no «$ …» como si fueran pesos). 2) Marca «Tour USD Rev349» y pulsa «Guardar servicios». 3) Arriba, en «Obligaciones previstas», lee la fila del tour. 4) Pulsa «Corregir la TRM de costos de este contrato», escribe 4100 y «Guardar TRM». 5) Pulsa «Confirmar venta» y abre la pestaña «Proveedores».",
    esperado: "Paso 1: los precios del cuadro llevan «USD $». Paso 2: «✓ Servicios actualizados». Paso 3: el tour dice «USD $100.00» (50 × 2 pax) y debajo «≈ $ 390.000 a TRM de costos $3.900 (provisional)»: hereda la TRM de costos del contrato, igual que el aéreo y el hotel; no queda como «pesos» ni sin TRM. Paso 4: «TRM de costos actualizada a $4.100 (3 obligación(es))» y el tour queda «≈ $ 410.000 … (provisional)»; el valor en dólares no cambia. Paso 5: nacen las cuentas por pagar con el tour «USD $100.00 · ≈ $ 410.000 a TRM de costos $4.100 (congelada)»; nada de otros contratos cambia. Si el contrato no tuviera una TRM única que heredar, el tour diría «TRM de costos pendiente» y aparecería «Fijar TRM de costos» (solo para ese servicio agregado).",
    async verificar(c) {
      // La reserva la hace la cuenta de VENTA (a administración el formulario no le ofrece asesores: hallazgo preexistente de INT-04); la gestión posterior la hace administración.
      const pv = await c.paginaDe("venta");
      const cv = { ...c, page: pv, ir: async (r) => { await pv.goto(`${c.APP}${r}`, { waitUntil: "domcontentloaded" }); await pv.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); await pv.waitForTimeout(600); }, texto: () => pv.evaluate(() => document.body.innerText.replace(/s+/g, " ")) };
      await cv.ir(RESERVA(91202, 91202, 91203));
      const id = await reservarForm(cv, { infante: false, prefijoDoc: "9100006", bloqueo: 91203 });
      c.check("se creó la cotización USD", id > 0, pv.url() + " " + await errores(cv));
      await generarContrato(cv, { usd: true });
      await pv.close().catch(() => {});
      const n = c.sql("select numero_contrato from public.sillas where bloqueo_id = 91203 and numero_contrato is not null order by id desc limit 1");
      c.check("contrato USD creado", !!n, n);
      c.sql(`update public.ventas set paquete_armado_id = 91202 where numero_contrato = '${n}' and paquete_armado_id is null`);
      // Preparación SOLO de la copia de ensayo (nunca de la base del dueño): servicio USD opcional agregado al paquete USD de NETA-05 DESPUÉS de crear el contrato (agregarlo antes invalida la tarifa publicada del paquete: «No se encontró la tarifa seleccionada»).
      c.sql(`insert into public.servicios_adicionales (id, nombre, proveedor_id, destino_id, liquidacion, categoria, moneda, tipo_tarifa, precio_persona, activo)
             select 91301, 'Tour USD Rev349', coalesce((select proveedor_id from public.hoteles where id = 91202), (select min(id) from public.proveedores)), (select destino_id from public.hoteles where id = 91202), 'paquete', 'tour_traslado', 'USD', 'persona', 50, true
             where not exists (select 1 from public.servicios_adicionales where id = 91301)`);
      c.sql(`insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) select 91202, 91301, 'persona', false where not exists (select 1 from public.armado_servicios where paquete_id = 91202 and servicio_id = 91301)`);
      // El cuadro «Servicios adicionales» lee los servicios PUBLICADOS del paquete: se agrega su fila publicada (lo que dejaría «Generar tarifario» tras agregar el servicio).
      c.sql(`insert into public.tarifario_resultado (paquete_id, paquete_nombre, modulo, servicio_id, servicio_nombre, destino_id, destino_nombre, base_comisionable, impuesto, precio_pvp, paquete_activo, tipo_tarifa, recargo_individual, moneda)
             select p.id, p.nombre, 'servicios', 91301, 'Tour USD Rev349', p.destino_id, (select nombre from public.destinos where id = p.destino_id), 60, 0, 60, true, 'persona', 0, 'USD' from public.armado_paquetes p where p.id = 91202 and not exists (select 1 from public.tarifario_resultado where paquete_id = 91202 and servicio_id = 91301)`);
      c.sql(`delete from public.servicio_temporadas where servicio_id = 91301`);
      c.sql(`insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, prioridad, precio_persona) select 91301, 'ANUAL REV349', fecha_salida - 30, fecha_regreso + 30, 1, 50 from public.ventas where numero_contrato = '${n}'`);
      // Agregar el servicio al paquete invalida su tarifario (comportamiento real); aquí se simula el «Generar tarifario» + publicación que haría el coordinador.
      c.sql(`update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true, tarifario_generacion_publicada = 1 where id = 91202`);
      const otrosAntes = c.sql(`select md5(coalesce((select string_agg(x::text, '|' order by id) from public.cuentas_por_pagar x where numero_contrato <> '${n}'), ''))`);
      const baseAntes = c.sql(`select md5(coalesce(string_agg(p::text, '|' order by id), '')) from public.contrato_obligaciones_previstas p where numero_contrato = '${n}' and payload->>'servicio_id' is null`);
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}`);
      const p = c.page;
      const hayEditor = await p.getByText("Servicios adicionales (contrato pendiente)").first().isVisible().catch(() => false);
      c.check("aparece el cuadro «Servicios adicionales (contrato pendiente)»", hayEditor, (await c.texto()).slice(0, 200));
      if (!hayEditor) return;
      const cuadro = (await p.locator("div", { has: p.getByText("Servicios adicionales (contrato pendiente)") }).last().innerText()).replace(/\s+/g, " ");
      c.check("los importes del cuadro llevan «USD $» (no pesos)", /USD \$/.test(cuadro), cuadro.slice(0, 300));
      await p.locator("label", { hasText: "Tour USD Rev349" }).locator('input[type="checkbox"]').check();
      await p.getByRole("button", { name: "Guardar servicios" }).click();
      await p.getByText(/Servicios actualizados/).first().waitFor({ timeout: 45000 }).catch(() => {});
      await c.espera(1500);
      c.check("«✓ Servicios actualizados»", /Servicios actualizados/.test(await c.texto()), (await c.texto()).slice(0, 200));
      c.check("la previsión del tour nació en USD con la TRM 3.900: USD 100 = COP 390.000", /receptivo\|100\|USD\|390000\|3900/.test(previstas(c, n)), previstas(c, n));
      c.check("hotel y aéreo no cambiaron (mismas filas, mismos valores)", c.sql(`select md5(coalesce(string_agg(p::text, '|' order by id), '')) from public.contrato_obligaciones_previstas p where numero_contrato = '${n}' and payload->>'servicio_id' is null`) === baseAntes, "");
      let t = await c.texto();
      c.check("panel de previstas: tour «USD $100.00» con ≈ $ 390.000 a TRM de costos $3.900 (provisional)", /Tour USD Rev349[^]*USD \$100\.00/.test(t) && /≈ \$\s*390\.000 a TRM de costos \$3\.900 \(provisional\)/.test(t), t.slice(0, 500));
      await p.getByRole("button", { name: "Corregir la TRM de costos de este contrato" }).click();
      await p.locator('input[aria-label="Nueva TRM de costos"]').fill("4100");
      await p.getByRole("button", { name: "Guardar TRM" }).click();
      await p.getByText(/TRM de costos actualizada a \$4\.100/).first().waitFor({ timeout: 30000 }).catch(() => {});
      await c.espera(1500);
      c.check("TRM 4.100: el tour queda USD 100 = COP 410.000 y el valor en dólares no cambia", /receptivo\|100\|USD\|410000\|4100/.test(previstas(c, n)), previstas(c, n));
      await p.getByRole("button", { name: "Confirmar venta" }).click();
      await p.getByText(/Confirmado/).first().waitFor({ timeout: 45000 }).catch(() => {}); await c.espera(1500);
      c.check("al confirmar nace la CxP del tour: USD 100, equivalente 410.000, TRM 4.100", /(^|;)receptivo\|100\|USD\|410000\|4100(;|$)/.test(cxp(c, n)), cxp(c, n));
      await c.ir(`/dashboard/contratos/${encodeURIComponent(n)}?tab=proveedores`);
      t = await c.texto();
      c.check("Proveedores: tour USD $100.00 con ≈ $ 410.000 a TRM de costos $4.100 (congelada)", /USD \$100\.00/.test(t) && /≈ \$\s*410\.000 a TRM de costos \$4\.100 \(congelada\)/.test(t), t.slice(0, 400));
      c.check("ninguna cuenta por pagar de otro contrato cambió", c.sql(`select md5(coalesce((select string_agg(x::text, '|' order by id) from public.cuentas_por_pagar x where numero_contrato <> '${n}'), ''))`) === otrosAntes, "");
    },
  },
  {
    id: "NETA-07", entrega: "neta", rol: "venta", titulo: "Bloqueo SIN neta: se rechaza con un mensaje claro y no deja nada a medias", ruta: RESERVA(91201, 91201, 91202),
    accion: "Con la cuenta de venta abre la reserva del bloqueo NTB302 (no tiene tarifa neta cargada; el precio público sí existe). 1) «Doble · 2 pax» = 1 e «Infantes (menores de 2 años, sin silla)» = 1. 2) Cliente Ana Revision; asesor «Rev Venta». 3) Pasajeros: Ana Revision (documento 91000021, nac. 15/03/1985), Luis Revision (91000022, nac. 20/08/1983) y el bebé Bebe Revision (RC 91000023, nacido unos 8 meses antes de la salida), con «Adulto responsable» = el primer adulto. 4) Pulsa «Generar cotización».",
    esperado: "En rojo aparece «El bloqueo NTB302 no tiene tarifa neta cargada; cárgala en Vuelos antes de reservar.» y el formulario se queda donde está. NO se crea cotización, ni contrato, ni se toma ninguna silla del bloqueo, ni nace obligación o cuenta por pagar: el sistema no cae a la tarifa de reventa 349.000 ni a 0. (El precio público de ese hotel sigue visible: solo se frena la reserva.)",
    async verificar(c) {
      await c.ir(RESERVA(91201, 91201, 91202));
      const antes = conteos(c), cot0 = c.sql("select count(*) from public.cotizaciones");
      const id = await reservarForm(c, { infante: true, prefijoDoc: "9100002", bloqueo: 91202 });
      const t = await c.texto();
      c.check("mensaje claro: el bloqueo no tiene tarifa neta cargada", id === 0 && /no tiene tarifa neta cargada/i.test(t) && /cárgala en Vuelos/i.test(t), (await errores(c)) + " " + c.page.url());
      c.check("el formulario no avanzó a ninguna cotización", !c.page.url().includes("/dashboard/cotizaciones/"), c.page.url());
      c.check("ni cotización, ni contrato, ni previstas, ni cuentas por pagar, ni sillas tomadas nuevos", conteos(c) === antes && c.sql("select count(*) from public.cotizaciones") === cot0, `${antes} → ${conteos(c)}`);
      c.check("ninguna silla del bloqueo NTB302 tomada", c.sql("select count(*) from public.sillas where bloqueo_id = 91202 and (numero_contrato is not null or estado <> 'disponible')") === "0", "");
    },
  },
  {
    id: "NETA-08", entrega: "neta", rol: "operaciones", titulo: "Cargar la neta en el bloqueo (formulario real de edición)", ruta: "/dashboard/vuelos/91202",
    accion: "Con operaciones abre el bloqueo NTB302 (/dashboard/vuelos/91202), despliega «Editar bloqueo (no cambia cupos)», escribe 300000 en «Tarifa neta (pago aerolínea)» y pulsa «Guardar cambios». (Antes de publicar, el dueño revisa además cuáles bloqueos REALES activos siguen sin neta: es un diagnóstico de solo lectura, supabase/scripts/diagnostico_bloqueo_costo_neta.sql, que el ejecutor corre cuando el dueño lo pida; no hay pantalla para eso.)",
    esperado: "Aparece «Guardado.». El bloqueo conserva «Tarifa empaquetar (reventa)» 349000 y el fee de infante 80.500; la neta queda en 300.000. El tarifario del paquete se regenera solo y el precio comercial no cambia ($699.000 en doble).",
    async verificar(c) {
      await c.ir("/dashboard/vuelos/91202");
      const neta0 = await (async () => { await c.page.getByRole("button", { name: /Editar bloqueo/ }).click(); await c.espera(300); return c.page.locator('div:has(> label:text-is("Tarifa neta (pago aerolínea)")) input').first().inputValue(); })();
      c.check("antes: sin neta cargada (0)", dig(neta0) === 0, neta0);
      await c.page.locator('div:has(> label:text-is("Tarifa neta (pago aerolínea)")) input').first().fill("300000");
      await c.page.getByRole("button", { name: "Guardar cambios" }).click();
      await c.page.getByText("Guardado.").first().waitFor({ timeout: 30000 }).catch(() => {}); await c.espera(2500);
      c.check("neta 300.000, reventa 349.000 y fee 80.500 intactos", c.sql("select trim_scale(tarifa_neta::numeric) || '|' || trim_scale(tarifa_para_empaquetar::numeric) || '|' || trim_scale(fee_infante::numeric) from public.bloqueos_vuelo where id = 91202") === "300000|349000|80500", c.sql("select tarifa_neta || '|' || tarifa_para_empaquetar from public.bloqueos_vuelo where id = 91202"));
      const est = c.sql("select tarifario_estado from public.armado_paquetes where id = 91201");
      c.check("el tarifario del paquete sigue publicado (listo)", est === "listo", est);
      c.check("precio comercial en doble sin cambio: 699.000", c.sql("select trim_scale(precio_pvp::numeric) from public.tarifario_resultado_publicable where paquete_id = 91201 and bloqueo_id = 91202 and acomodacion = 'doble' limit 1") === "699000", c.sql("select string_agg(acomodacion::text || '=' || precio_pvp::text, ',') from public.tarifario_resultado_publicable where paquete_id = 91201 and bloqueo_id = 91202"));
    },
  },
  {
    id: "NETA-09", entrega: "neta", rol: "venta", titulo: "Reintento con la neta cargada: la reserva avanza, con el costo de la neta y el infante sin silla", ruta: RESERVA(91201, 91201, 91202),
    accion: "Con la cuenta de venta repite exactamente la reserva del paso de rechazo (bloqueo NTB302: 1 doble + 1 infante; cliente Ana Revision; asesor «Rev Venta»; pasajeros Ana y Luis Revision con documentos 91000021/22 y nacimientos 15/03/1985 y 20/08/1983; bebé Bebe Revision, RC 91000023, nacido unos 8 meses antes de la salida, con «Adulto responsable» el primer adulto). Pulsa «Generar cotización» y luego «Confirmar → generar contrato».",
    esperado: "Ahora la cotización se genera y se crea el contrato: 2 adultos con silla + 1 infante sin silla. Costo aéreo = 2 × 300.000 + fee de infante 80.500 = 680.500 (el infante no paga tarifa ni ocupa silla). Solo 2 sillas tomadas, una sola obligación aérea prevista de 680.500 y exactamente 1 cotización y 1 contrato nuevos: no queda nada del intento fallido.",
    async verificar(c) {
      const antes = Number(c.sql("select count(*) from public.ventas"));
      await c.ir(RESERVA(91201, 91201, 91202));
      const id = await reservarForm(c, { infante: true, prefijoDoc: "9100002", bloqueo: 91202 });
      c.check("ahora sí se genera la cotización", id > 0, c.page.url() + " " + (await errores(c)));
      await generarContrato(c);
      const n = contratoDe(c, 91202);
      c.check("contrato creado", !!n && c.page.url().includes("/dashboard/contratos/"), `${n} · ${c.page.url()}`);
      c.check("exactamente 1 contrato nuevo para este bloqueo (nada del intento fallido)", c.sql("select count(distinct numero_contrato) from public.sillas where bloqueo_id = 91202 and numero_contrato is not null") === "1", "");
      c.check("costo aéreo = 2 × 300.000 + 80.500 = 680.500", Number(c.sql(`select costo_aereo::numeric from public.ventas where numero_contrato = '${n}'`)) === 680500, c.sql(`select costo_aereo from public.ventas where numero_contrato = '${n}'`));
      c.check("2 sillas tomadas (el infante no ocupa silla)", c.sql("select count(*) from public.sillas where bloqueo_id = 91202 and numero_contrato is not null") === "2", "");
      c.check("una sola obligación aérea prevista de 680.500", /aereo\|680500\|COP/.test(previstas(c, n)) && c.sql(`select count(*) from public.contrato_obligaciones_previstas where numero_contrato = '${n}' and payload->>'tipo_proveedor' = 'aereo'`) === "1", previstas(c, n));
      c.check("ninguna cuenta por pagar mientras esté pendiente", cxp(c, n) === "", cxp(c, n));
    },
  },
];

export const pasos = [...pasos88, ...pasosNeta];
