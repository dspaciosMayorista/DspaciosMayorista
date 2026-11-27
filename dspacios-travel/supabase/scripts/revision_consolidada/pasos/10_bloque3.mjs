// Bloque 3 — #11 presencia reciente (modal paginado) · #13 alertas de fin de compra en el área de ALERTAS del tablero (con «Revisado»; ya NO en la campana; sin correo) · #36 estado de publicación del listado de Paquetes.
// Revisión del dueño (migración 344 + semilla semillas/rev2/b3.sql): B3-01 modal, B3-02 alertas + «Revisado», B3-03 destino por objeto (hotel, servicio, empaquetado, paquete), B3-04 sin campana en el CRM.
const campana = (page) => page.locator('button[aria-label^="Avisos"]:visible').first();
const panelCampana = (page) => page.locator("[role=region][aria-label=Avisos]");
const contador = async (page) => Number(((await campana(page).getAttribute("aria-label")) ?? "").match(/(\d+)/)?.[1] ?? -1);
// Cuenta SOLO las llamadas al servidor de la presencia (la campana también sondea con acciones de servidor cada 30 s: se distinguen por su cuerpo).
const llamadasPresencia = (page) => {
  const l = []; const f = (r) => { if (r.method() === "POST" && r.headers()["next-action"] && (r.postData() ?? "").includes('"grupo"')) l.push(r.postData()); };
  page.on("request", f); return { n: () => l.length, ultima: () => l[l.length - 1] ?? "", parar: () => page.off("request", f) };
};
const alertas = (page) => page.locator('[data-testid="alerta-compra"]');
const totalAlertas = async (page) => Number(((await page.locator('[data-testid="alertas-compra"] p').first().innerText().catch(() => "")).match(/\((\d+)\)/) ?? [])[1] ?? -1);
const hrefDe = (page, re) => alertas(page).locator("a").evaluateAll((as, src) => as.filter((a) => new RegExp(src).test(a.innerText.replace(/\s+/g, " "))).map((a) => a.getAttribute("href")), re.source);
const esperaAccion = async (c, ms = 1600) => { await c.espera(ms); };
const sqlNum = (c, q) => Number(c.sql(q).trim());
// Expectativa DERIVADA: cuántas vigencias sembradas terminan su compra entre hoy y hoy + 5 (día de negocio de la base). Cambia con los días (una vigencia vencida deja de contarse); NO se fija un número.
const VENTANA = "between public.fecha_negocio() and public.fecha_negocio() + 5";
const esperadasPaquetes = (c) => sqlNum(c, `select (select count(*) from public.armado_paquetes where id in (12001, 12004, 12011) and activo and fecha_compra_fin ${VENTANA})
  + (select count(*) from public.salidas_dinamicas where id = 12001 and activo and compra_fin ${VENTANA})
  + (select count(*) from public.empaquetados where id = 12001 and activo and compra_fin ${VENTANA})
  + (select count(*) from public.paquete_din where id = 12001 and activo and publicado and compra_fin ${VENTANA})`);
const esperadasOtras = (c) => sqlNum(c, `select (select count(*) from public.hotel_temporadas where id in (120401, 120402) and compra_fin ${VENTANA}) + (select count(*) from public.servicio_temporadas where id = 120501 and compra_fin ${VENTANA})`);
const REV = "a.tipo = 'compra_por_vencer' and a.archivado_en is null and a.revisado_en is null";   // alertas ACTIVAS (alias a)
export const pasos = [
  {
    id: "B3-01", entrega: "bloque3", rol: "superadmin", titulo: "Presencia reciente: recuadro compacto y ventana con pestañas, búsqueda y páginas", ruta: "/dashboard", solo_lectura: true,
    accion: "1) Entra al tablero y baja hasta «Presencia reciente»: es una sola línea con conteos y el botón «Ver presencia». 2) Pulsa «Ver presencia». 3) En «Personal interno» mira «1–20 de N» y pulsa «Siguiente» (pasa a «21–40 de N»). 4) Pulsa la pestaña «Aliados B2B». 5) Escribe «Aliado Rev2 5» en la búsqueda (todavía no cambia nada) y pulsa «Buscar». 6) Vuelve a «Personal interno», borra el texto, busca «Rev Superadmin» y pulsa «Buscar». 7) Cierra con Escape.",
    esperado: "La tarjeta del tablero no lista personas (solo «En los últimos 10 min: N del personal · N aliados · N sin observación todavía» y el botón). La ventana muestra como mucho 20 personas por página con «Página 1 de …», «Personal interno (N)» con N ≥ 45 y «Aliados B2B (N)» con N ≥ 25. Teclear no consulta nada; «Buscar» sí: «Aliado Rev2 5» deja exactamente 10 aliados («Aliado Rev2 50» … «Aliado Rev2 59»). Con la búsqueda anterior aún escrita, «Personal interno» dice «Ninguna persona coincide con la búsqueda». «Rev Superadmin» (tú) figura con «Actividad observada en los últimos 10 min». Cada persona muestra su última observación con fecha y hora de Bogotá o «Sin actividad observada todavía»; el pie dice que es la última actividad observada y no una conexión continua; no aparece «en línea» ni «conectado» ni la cuenta desactivada. En el celular la ventana cabe en la pantalla. Quieto, sin teclear, no hay más consultas.",
    async verificar(c) {
      await c.ir("/dashboard");
      const tarjeta = await c.page.locator('[data-testid="actividad-reciente"]').innerText();
      c.check("la tarjeta es compacta: conteos y botón, sin lista de personas", /En los últimos 10 min: \d+ del personal · \d+ aliados? · \d+ sin observación todavía/.test(tarjeta) && (await c.page.locator('[data-testid="actividad-fila"]').count()) === 0 && (await c.page.locator('[data-testid="presencia-abrir"]').count()) === 1, tarjeta.slice(0, 260));
      const A = llamadasPresencia(c.page);
      c.check("al cargar el tablero la presencia no pide ningún detalle por persona", A.n() === 0, String(A.n()));
      await c.page.locator('[data-testid="presencia-abrir"]').click(); await esperaAccion(c, 1800);
      const modal = c.page.locator('[data-testid="presencia-modal"]');
      const caja = await modal.boundingBox();
      c.check("la ventana cabe en la pantalla", !!caja && caja.x >= -1 && caja.x + caja.width <= c.ancho + 1, JSON.stringify(caja));
      c.check("abrir hace UNA consulta (grupo interno, página 0)", A.n() === 1 && /"grupo":"interno"/.test(A.ultima()) && /"pagina":0/.test(A.ultima()), A.ultima());
      const filas1 = await c.page.locator('[data-testid="actividad-fila"]').count();
      const rango1 = await c.page.locator('[data-testid="presencia-rango"]').innerText();
      const totalInterno = Number((rango1.match(/de (\d+)/) ?? [])[1] ?? -1);
      c.check("página de 20 personas como máximo, rango «1–20 de N» con N ≥ 45", filas1 === 20 && /^1–20 de \d+/.test(rango1) && totalInterno >= 45, `${filas1} · ${rango1}`);
      const pestanas = await c.page.locator('[role=tablist][aria-label="Grupo de presencia"]').innerText();
      c.check("dos pestañas con su total", /Personal interno \(\d+\)/.test(pestanas) && /Aliados B2B \(\d+\)/.test(pestanas) && Number((pestanas.match(/Aliados B2B \((\d+)\)/) ?? [])[1]) >= 25, pestanas);
      await c.page.locator('[data-testid="presencia-siguiente"]').click(); await esperaAccion(c);
      c.check("«Siguiente» hace UNA consulta y muestra «21–40 de N»", A.n() === 2 && /^21–40 de \d+/.test(await c.page.locator('[data-testid="presencia-rango"]').innerText()), A.ultima());
      await c.page.locator('[data-testid="presencia-tab-aliado"]').click(); await esperaAccion(c);
      const aliados1 = await c.page.locator('[data-testid="actividad-fila"]').count();
      c.check("pestaña «Aliados B2B»: UNA consulta, empieza en la página 1 y solo hay agencias/freelancers", A.n() === 3 && /"grupo":"aliado"/.test(A.ultima()) && /"pagina":0/.test(A.ultima()) && aliados1 > 0 && (await c.page.locator('[data-testid="actividad-fila"][data-rol="agencia"], [data-testid="actividad-fila"][data-rol="freelance"]').count()) === aliados1, `${aliados1} · ${A.ultima()}`);
      const caja1 = c.page.locator('[data-testid="presencia-buscar"]');
      await caja1.pressSequentially("Aliado Rev2 5", { delay: 25 }); await c.espera(900);
      c.check("teclear NO consulta nada", A.n() === 3, String(A.n()));
      await modal.getByRole("button", { name: "Buscar", exact: true }).click(); await esperaAccion(c);
      const textos = await c.page.locator('[data-testid="actividad-fila"]').evaluateAll((fs) => fs.map((f) => f.innerText.replace(/\s+/g, " ")));
      c.check("«Buscar» hace UNA consulta y deja exactamente los 10 aliados «Aliado Rev2 50…59»", A.n() === 4 && textos.length === 10 && textos.every((x) => /Aliado Rev2 5\d/.test(x)), `${A.n()} · ${textos.length} · ${textos.slice(0, 2).join(" | ")}`);
      await c.page.locator('[data-testid="presencia-tab-interno"]').click(); await esperaAccion(c);
      c.check("con la búsqueda aún escrita, «Personal interno» no encuentra a nadie y lo dice", /Ninguna persona coincide con la búsqueda/.test(await c.page.locator('[data-testid="presencia-lista"]').innerText()) && (await c.page.locator('[data-testid="actividad-fila"]').count()) === 0);
      await c.page.locator('[data-testid="presencia-buscar"]').fill("Rev Superadmin");
      await modal.getByRole("button", { name: "Buscar", exact: true }).click(); await esperaAccion(c);
      const yo = await c.page.locator('[data-testid="actividad-fila"]').first().innerText().catch(() => "");
      c.check("tu cuenta figura con «Actividad observada en los últimos 10 min» y hora de Bogotá", /Rev Superadmin/.test(yo) && /Actividad observada en los últimos 10 min/.test(yo) && /Última observación: .*\(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}\)/.test(yo), yo.slice(0, 260));
      const antes = A.n(); await c.espera(3500);
      c.check("quieto no hay más consultas (sin sondeo)", A.n() === antes, `${antes} → ${A.n()}`);
      const t = await modal.innerText();
      c.check("define la ventana y no afirma conexión continua", /Se considera reciente lo observado en los últimos 10 min/.test(t) && /no una conexión continua/.test(t) && !/(está en l[ií]nea|conectado)/i.test(t));
      await c.page.locator('[data-testid="presencia-buscar"]').fill("Rev Cuenta Inactiva");
      await modal.getByRole("button", { name: "Buscar", exact: true }).click(); await esperaAccion(c);
      c.check("la cuenta desactivada no aparece", (await c.page.locator('[data-testid="actividad-fila"]').count()) === 0);
      await c.page.keyboard.press("Escape"); await c.espera(500);
      c.check("Escape cierra la ventana", (await c.page.locator('[data-testid="presencia-modal"]').count()) === 0);
      A.parar();
    },
  },
  {
    id: "B3-02", entrega: "bloque3", rol: "gerencia", titulo: "Alertas de fin de compra en el área de ALERTAS del tablero (ya no en la campana)", ruta: "/dashboard", solo_lectura: true,
    accion: "Con la sesión de gerencia, abre el tablero y mira el área «Alertas». Después pulsa la campana de arriba a la derecha.",
    esperado: "Junto a «Cupos críticos» y «Pagos por vencer (15d)» hay un chip rojo «Vigencias de compra por terminar» con un número (el día de la siembra eran 9: 6 de paquetes y vuelos, 2 de hoteles, 1 de servicio; el número exacto depende de la fecha de hoy, porque una vigencia que ya venció deja de contarse — el ensayo lo calcula con las fechas de la semilla) y debajo la lista «Vigencias de compra por terminar (N)». Cada fila dice «Compra por vencer · <tipo>: <nombre> · Vence hoy / mañana / en N días (dd/mm/aaaa)» y trae el botón «Revisado». La campana NO tiene ningún aviso «Compra por vencer» (puede tener otros avisos). No se envió ningún correo.",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1500);
      const area = await c.texto();
      c.check("el chip «Vigencias de compra por terminar» está en el área de Alertas junto a los demás", /alertas[\s\S]{0,400}Vigencias de compra por terminar/i.test(area) && /Pagos por vencer \(15d\)/.test(area));
      const n = await totalAlertas(c.page);
      const activas = sqlNum(c, `select count(*) from public.avisos a join public.usuarios u on u.id = a.usuario_id where u.email = 'gerencia@consolidada.test' and ${REV}`);
      const esperadas = esperadasPaquetes(c) + esperadasOtras(c);   // 9 el día de la siembra; hoy lo que digan las fechas de las semillas
      c.check("la lista muestra EXACTAMENTE las vigencias sembradas que terminan en la ventana de 5 días (derivado de las fechas de la semilla y del día de negocio)", n === esperadas && n === activas && (await alertas(c.page).count()) === Math.min(n, 20), `${n} en pantalla · ${activas} avisos activos · ${esperadas} esperadas por fecha`);
      const textos = await alertas(c.page).locator("a").evaluateAll((as) => as.map((a) => a.innerText.replace(/\s+/g, " ")));
      c.check("cada alerta nombra el tipo de vigencia y el plazo a hoy", textos.every((x) => /^Compra por vencer · (paquete|salida dinámica|empaquetado|paquete dinámico total|vigencia de hotel|vigencia de servicio): /.test(x) && /Vence hoy|Vence mañana|Vence en \d+ días|Venció/.test(x)), textos.slice(0, 3).join(" | "));
      c.check("cada alerta tiene su botón «Revisado»", (await alertas(c.page).getByRole("button", { name: /revisado/i }).count()) === (await alertas(c.page).count()));
      await campana(c.page).click(); await c.espera(900);
      const panel = await panelCampana(c.page).innerText().catch(() => "");
      c.check("la campana NO contiene avisos de compra por vencer", !/Compra por vencer/.test(panel), panel.slice(0, 200));
    },
  },
  {
    id: "B3-02b", entrega: "bloque3", rol: "gerencia", titulo: "«Revisado» saca la alerta de tu vista, solo de la tuya, y no vuelve", ruta: "/dashboard",
    accion: "Con gerencia, en la lista de alertas, pulsa «Revisado» en la alerta «paquete dinámico total: Paquete dinámico total — Punta Cana…». Recarga el tablero. Después entra con la cuenta de operaciones y mira la misma lista.",
    esperado: "Esa alerta desaparece al instante y el número baja en 1; tras recargar sigue sin aparecer (aunque corra la revisión diaria que crea avisos). Las demás alertas siguen. Con operaciones la alerta del paquete dinámico total SIGUE ahí: la revisión es de cada persona. En la campana no cambia nada (no era un aviso leído).",
    async verificar(c) {
      // La semilla fija la compra de este paquete dinámico total en «día de siembra + 1»; si el ensayo corre días después ya venció y no habría alerta que revisar. Se reafirma la fecha de la semilla con el día de negocio de hoy (solo la copia de ensayo) y corre la revisión diaria.
      c.sql(`update public.paquete_din set compra_fin = public.fecha_negocio() + 1 where id = 12001; select public.generar_avisos_compra()`);
      await c.ir("/dashboard"); await c.espera(1200);
      const antes = await totalAlertas(c.page);
      const filtro = alertas(c.page).filter({ hasText: "paquete dinámico total: Paquete dinámico total" });
      const operAntes = sqlNum(c, `select count(*) from public.avisos a join public.usuarios u on u.id = a.usuario_id where u.email = 'operaciones@consolidada.test' and ${REV}`);
      if ((await filtro.count()) === 0) { c.check("la alerta del paquete dinámico total ya estaba revisada (repetición del paso)", sqlNum(c, `select count(*) from public.avisos a join public.usuarios u on u.id = a.usuario_id where u.email = 'gerencia@consolidada.test' and a.tipo = 'compra_por_vencer' and a.ventana_tipo = 'paquete_total' and a.revisado_en is not null and a.archivado_en is null`) >= 1); return; }
      await filtro.first().getByRole("button", { name: /revisado/i }).click(); await c.espera(1800);
      c.check("la alerta desaparece y el número baja en 1", (await filtro.count()) === 0 && (await totalAlertas(c.page)) === antes - 1, `${antes} → ${await totalAlertas(c.page)}`);
      c.check("en la base queda revisada pero NO leída ni archivada (es otra cosa que «leído»)", sqlNum(c, `select count(*) from public.avisos a join public.usuarios u on u.id = a.usuario_id where u.email = 'gerencia@consolidada.test' and a.tipo = 'compra_por_vencer' and a.ventana_tipo = 'paquete_total' and a.revisado_en is not null and a.leido_en is null and a.archivado_en is null`) === 1);
      c.sql(`select public.generar_avisos_compra()`);   // la corrida diaria
      await c.ir("/dashboard"); await c.espera(1200);
      c.check("tras recargar y tras la corrida diaria NO vuelve (ni se duplica)", (await filtro.count()) === 0 && (await totalAlertas(c.page)) === antes - 1, `${antes} → ${await totalAlertas(c.page)}`);
      c.check("la revisión es por persona: operaciones conserva su alerta", sqlNum(c, `select count(*) from public.avisos a join public.usuarios u on u.id = a.usuario_id where u.email = 'operaciones@consolidada.test' and ${REV}`) === operAntes);
    },
  },
  {
    id: "B3-02c", entrega: "bloque3", rol: "gerencia", titulo: "Si cambia la fecha de fin de la vigencia, aparece una alerta NUEVA aunque la anterior estuviera revisada", ruta: "/dashboard",
    accion: "Con superadmin, en Paquetes totales, cambia la fecha límite de compra del «Paquete dinámico total — Punta Cana…» a un día después y guarda. Pide al coordinador que corra la revisión diaria de avisos (en esta revisión no corre sola). Con gerencia, recarga el tablero.",
    esperado: "La alerta anterior (la que revisaste) ya no existe y aparece una alerta nueva del mismo paquete dinámico total con «Vence en 2 días», SIN revisar, con su botón «Revisado». El número de alertas vuelve a ser el de antes de revisar.",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1000);
      const antes = await totalAlertas(c.page);
      const q = `update public.paquete_din set compra_fin = public.fecha_negocio() + 2 where id = 12001`;
      c.sql(q);
      c.check("al cambiar la fecha la alerta revisada se archiva al instante (disparador)", sqlNum(c, `select count(*) from public.avisos where tipo = 'compra_por_vencer' and ventana_tipo = 'paquete_total' and ventana_id = 12001 and archivado_en is null`) === 0);
      c.sql(`select public.generar_avisos_compra()`);
      await c.ir("/dashboard"); await c.espera(1200);
      const nueva = alertas(c.page).filter({ hasText: "paquete dinámico total: Paquete dinámico total" });
      c.check("aparece la alerta nueva con la fecha nueva y su botón «Revisado»", (await nueva.count()) === 1 && /Vence en 2 días/.test(await nueva.first().innerText()) && (await nueva.first().getByRole("button", { name: /revisado/i }).count()) === 1);
      c.check("el número de alertas vuelve a ser el de antes de revisar", (await totalAlertas(c.page)) === antes + 1, `${antes} → ${await totalAlertas(c.page)}`);
      c.sql(`update public.paquete_din set compra_fin = public.fecha_negocio() + 1 where id = 12001; select public.generar_avisos_compra()`);   // se deja la semilla como estaba (fecha +1)
    },
  },
  {
    id: "B3-03", entrega: "bloque3", rol: "gerencia", titulo: "Cada alerta abre el objeto que posee la vigencia: empaquetado y paquete", ruta: "/dashboard",
    accion: "Con gerencia, en la lista de alertas pulsa la de «empaquetado: MDE - CTG - MDE …»; vuelve y pulsa la de «paquete: Cartagena 4 noches…».",
    esperado: "La de empaquetado abre la pantalla de ese empaquetado (/dashboard/vuelos/empaquetados/…). La de paquete abre ESE paquete en su pestaña de Configuración (/dashboard/paquetes/…?tab=config), porque su fecha de compra es del paquete. Ninguna de hotel o servicio abre un paquete.",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1200);
      const hrefs = await alertas(c.page).locator("a").evaluateAll((as) => as.map((a) => [a.innerText.replace(/\s+/g, " "), a.getAttribute("href")]));
      const de = (re) => hrefs.filter(([t]) => re.test(t)).map(([, h]) => h);
      c.check("las alertas de hotel y de servicio no apuntan a un paquete", [...de(/vigencia de hotel|vigencia de servicio/)].every((h) => !/\/paquetes/.test(h ?? "")) && de(/vigencia de hotel|vigencia de servicio/).length >= 3, JSON.stringify(de(/vigencia de/)));
      await alertas(c.page).locator("a", { hasText: "MDE - CTG - MDE" }).first().click();
      await c.page.waitForURL(/\/dashboard\/vuelos\/empaquetados\/\d+/, { timeout: 30000 }).catch(() => {});
      c.check("la de empaquetado abre el empaquetado", /\/dashboard\/vuelos\/empaquetados\/\d+/.test(c.page.url()), c.page.url());
      await c.ir("/dashboard"); await c.espera(1000);
      await alertas(c.page).locator("a", { hasText: /paquete: Cartagena 4 noches/ }).first().click();
      await c.page.waitForURL(/\/dashboard\/paquetes\/\d+\?tab=config/, { timeout: 30000 }).catch(() => {});
      c.check("la de paquete abre ESE paquete en Configuración", /\/dashboard\/paquetes\/\d+\?tab=config/.test(c.page.url()), c.page.url());
    },
  },
  {
    id: "B3-03b", entrega: "bloque3", rol: "gerencia", titulo: "Alerta de vigencia de HOTEL: abre ese hotel y esa vigencia (aunque dos hoteles se llamen igual)", ruta: "/dashboard",
    accion: "Con gerencia, en la lista de alertas hay DOS con el texto «vigencia de hotel: Hotel Caribe Plaza · ALTA DICIEMBRE REV2». Pulsa la primera, mira la pantalla y vuelve; pulsa la segunda.",
    esperado: "Cada una abre un hotel distinto (dos hoteles llamados «Hotel Caribe Plaza», uno es el de la semilla de paquetes y otro el de esta revisión), en la pestaña «Temporadas», con la vigencia «ALTA DICIEMBRE REV2» resaltada en amarillo y a la vista. Ninguna abre un paquete.",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1200);
      const hrefs = await hrefDe(c.page, /vigencia de hotel: Hotel Caribe Plaza · ALTA DICIEMBRE REV2/);
      c.check("hay DOS alertas con el mismo texto y destinos DISTINTOS (hotel y vigencia por id guardado)", hrefs.length === 2 && new Set(hrefs).size === 2 && hrefs.includes("/dashboard/producto/hoteles/12042?tab=temporadas&vigencia=120401") && hrefs.includes("/dashboard/producto/hoteles/12041?tab=temporadas&vigencia=120402"), JSON.stringify(hrefs));
      for (const [hotel, vig] of [[12042, 120401], [12041, 120402]]) {
        await c.ir(`/dashboard/producto/hoteles/${hotel}?tab=temporadas&vigencia=${vig}`); await c.espera(1200);
        const fila = c.page.locator(`#vigencia-${vig}`);
        c.check(`hotel ${hotel}: la vigencia ${vig} existe, está resaltada y visible en «Temporadas»`, (await fila.count()) === 1 && (await fila.getAttribute("data-destacada")) === "true" && (await fila.isVisible()) && /ALTA DICIEMBRE REV2/.test(await fila.innerText()), c.page.url());
        c.check(`hotel ${hotel}: la otra vigencia homónima no se resalta`, (await c.page.locator('[data-destacada="true"]').count()) === 1);
      }
      await c.ir("/dashboard"); await c.espera(1000);
      await alertas(c.page).locator("a", { hasText: "vigencia de hotel: Hotel Caribe Plaza · ALTA DICIEMBRE REV2" }).first().click();
      await c.page.waitForURL(/\/dashboard\/producto\/hoteles\/\d+\?tab=temporadas&vigencia=\d+/, { timeout: 30000 }).catch(() => {});
      c.check("al pulsar la alerta se llega a un hotel (no a un paquete)", /\/dashboard\/producto\/hoteles\/\d+\?tab=temporadas&vigencia=\d+/.test(c.page.url()), c.page.url());
    },
  },
  {
    id: "B3-03c", entrega: "bloque3", rol: "gerencia", titulo: "Alerta de vigencia de SERVICIO: abre ese servicio y esa temporada", ruta: "/dashboard",
    accion: "Con gerencia, en la lista de alertas pulsa la de «vigencia de servicio: Tour Islas del Rosario REV2 · NAVIDAD REV2».",
    esperado: "Se abre Producto → Servicios con «Tour Islas del Rosario REV2» ya en edición y su temporada «NAVIDAD REV2» resaltada en amarillo y a la vista. No se abre un paquete.",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1200);
      await alertas(c.page).locator("a", { hasText: "vigencia de servicio: Tour Islas del Rosario REV2 · NAVIDAD REV2" }).first().click();
      await c.page.waitForURL(/\/dashboard\/producto\/servicios\?servicio=12051&vigencia=120501/, { timeout: 30000 }).catch(() => {});
      await c.espera(1800);
      c.check("la alerta lleva a Servicios con el servicio y la vigencia por id", /\/dashboard\/producto\/servicios\?servicio=12051&vigencia=120501/.test(c.page.url()), c.page.url());
      const fila = c.page.locator("#vigencia-120501");
      c.check("la temporada «NAVIDAD REV2» está resaltada y visible", (await fila.count()) === 1 && (await fila.getAttribute("data-destacada")) === "true" && (await fila.isVisible()) && /NAVIDAD REV2/.test(await fila.innerText()));
      c.check("el servicio está abierto en edición", /Editar servicio/.test(await c.texto()) && (await c.page.locator("input").evaluateAll((is) => is.some((i) => i.value === "Tour Islas del Rosario REV2"))));
    },
  },
  {
    id: "B3-04", entrega: "bloque3", rol: "gerencia", titulo: "Sin campana general en el CRM (el lugar queda para notificaciones del CRM)", ruta: "/crm", solo_lectura: true,
    accion: "Abre el CRM y mira la barra superior; recorre el menú.",
    esperado: "No hay campana junto a «← PORTAL». El menú del CRM sigue completo (incluye «Referidos» y «Clientes de aliados») y «← PORTAL» funciona.",
    async verificar(c) {
      await c.ir("/crm"); await c.espera(1500);
      c.check("no hay campana general de avisos en el CRM", (await campana(c.page).count()) === 0);
      const t = await c.texto();
      c.check("el menú y «← PORTAL» siguen", /Referidos/.test(t) && /Clientes de aliados/.test(t) && /PORTAL/.test(t), t.slice(0, 200));
    },
  },
  {
    id: "B3-05", entrega: "bloque3", rol: "venta", titulo: "Quien no escribe paquetes no recibe estas alertas", ruta: "/dashboard", solo_lectura: true,
    accion: "Con la cuenta de venta, abre el tablero y mira «Alertas»; luego abre la campana.",
    esperado: "Ni el chip ni la lista «Vigencias de compra por terminar» (la campana puede tener otros avisos, nunca de compra por vencer).",
    async verificar(c) {
      await c.ir("/dashboard"); await c.espera(1500);
      c.check("sin chip ni lista de alertas de compra", !/Vigencias de compra por terminar/.test(await c.texto()) && (await alertas(c.page).count()) === 0);
      if ((await campana(c.page).count()) > 0) { await campana(c.page).click().catch(() => {}); await c.espera(500); }
      const panel = await panelCampana(c.page).innerText().catch(() => "");
      c.check("ningún aviso de compra por vencer en la campana", !/Compra por vencer/.test(panel), panel.slice(0, 120));
    },
  },
  {
    id: "B3-06", entrega: "bloque3", rol: "operaciones", titulo: "Listado de Paquetes: estado real de publicación y vigencias por vencer", ruta: "/dashboard/paquetes?tipo=porcion_terrestre", solo_lectura: true,
    accion: "Abre el listado de Paquetes (pestaña Porción terrestre) y recórrelo.",
    esperado: "Cada paquete muestra su estado real junto a Activo/Inactivo: «Tarifas publicadas», «Pendiente de generar», «Error de generación», «Cotización por unidad», «Bajo solicitud», «Publicado, no visible» (inactivo). Arriba, un panel «N vigencias de compra terminan en los próximos 5 días» (N depende del día: el ensayo lo calcula con las fechas de la semilla) con enlaces a donde se corrige cada fecha.",
    async verificar(c) {
      await c.ir("/dashboard/paquetes?tipo=porcion_terrestre"); const t = await c.texto();
      for (const e of ["Tarifas publicadas", "Pendiente de generar", "Error de generación", "Cotización por unidad", "Bajo solicitud", "Publicado, no visible"]) c.check(`estado «${e}» visible`, t.includes(e), "");
      const nVig = Number((t.match(/(\d+) vigencias? de compra terminan/) ?? [])[1] ?? 0);
      c.check("panel de vigencias por vencer: el número es el derivado de las fechas de la semilla y del día de negocio", nVig === esperadasPaquetes(c), `${nVig} en pantalla · ${esperadasPaquetes(c)} esperadas por fecha`);
      // «Sin publicar» solo es verdad para una copia que nadie ha publicado (la copia «(copia)» que crea B95-xx); ningún otro paquete debe llevarlo.
      const sinPublicar = t.split("Sin publicar").length - 1, copias = (t.match(/\(copia\)[^]{0,80}?Sin publicar/g) ?? []).length;
      c.check("ningún paquete publicado se rotula «Sin publicar» (solo las copias sin publicar)", sinPublicar === copias, `${sinPublicar} rótulos, ${copias} de copias`);
    },
  },
];
