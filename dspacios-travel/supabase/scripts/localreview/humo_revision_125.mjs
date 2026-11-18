// HUMO de #125 sobre la fuente INTEGRADA (build de producción local de la revisión consolidada, Edge real, login por el FORMULARIO real):
//   A) calculadora Mixta: la promoción que cruza dos bases muestra su plan por noche y «Calcular por noche sobre la base ganadora» la pasa al modo nuevo (1 acción, 0 refrescos extra)
//   B) hotel de una sola base: nada cambia          C) «Reglas por grupo»: seguir la base ganadora + un niño gratis con edad propia
//   D) Vista Booking (búsqueda) = cotización guardada = contrato: mismo total con el niño gratis (2 adultos + 1 niño de 8 años) y R1: dos promociones sucesivas para el MISMO niño
//   E) documentos del contrato (interno, público por enlace) con la línea firmada y el resumen; impresión a PDF; sin desborde horizontal a 390 px
// Los escenarios A–C modifican SOLO las vigencias «PRE BF» del hotel 912501 y la calculadora del hotel 912502 y las RESTAURAN a su estado de la semilla al terminar (SQL dirigido,
// nunca se borran hoteles, paquetes ni contratos). Los ejemplos E1–E3 los crea localreview.ps1 (preparar / ampliar125) con las acciones reales.
// Uso (desde dspacios-travel/): node supabase/scripts/localreview/humo_revision_125.mjs <carpeta_capturas> [url_app=http://127.0.0.1:3070]
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { lanzar, abrir, abrirConLogin, crearInforme, dinero, sinDesborde, texto, APP as APP_DEF } from "./revision_comun.mjs";

const SALIDA = process.argv[2]; mkdirSync(SALIDA, { recursive: true });
const APP = process.argv[3]?.startsWith("http") ? process.argv[3] : APP_DEF;
// Este recorrido MODIFICA las vigencias «PRE BF» y la calculadora de hoteles sintéticos (y sus acciones regeneran el tarifario del paquete 912501). Restaurar esas filas con SQL NO devuelve el tarifario ya
// publicado a su estado anterior (hallazgo de la re-auditoría: quedó obsoleto en la base del dueño). Por eso solo corre contra una COPIA desechable (REV_DB_VERIF), nunca contra rev_revision.
if (!process.env.REV_DB_VERIF) { console.error("Solo contra una copia desechable de la base de revisión: define REV_DB_VERIF=<base> (ver localreview.ps1, REV_DB_VERIF). No se ejecuta contra rev_revision."); process.exit(2); }
const informe = crearInforme("#125 integrado");
const ok = informe.ok;
const psql = (q) => execSync(`docker exec -i -e PGPASSWORD=postgres pg304 psql -h 127.0.0.1 -U supabase_admin -d ${process.env.REV_DB_VERIF ?? "rev_revision"} -X -q -t -A -c "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const H1 = 912501, H2 = 912502, PRE_BF = 91250103, UNICA = 91250202;
const estado = (id) => JSON.parse(psql(`select json_build_object('sigue', promo_sigue_base, 'nino', nino_gratis, 'emin', nino_gratis_edad_min, 'emax', nino_gratis_edad_max, 'base', promo_base_id, 'reglas', (select count(*) from public.hotel_promocion_reglas r where r.promocion_id = t.id)) from public.hotel_temporadas t where id = ${id}`));
const restaurarH1 = () => {
  psql(`delete from public.hotel_promocion_reglas where promocion_id = ${PRE_BF}`);
  psql(`update public.hotel_temporadas set promo_sigue_base = false, nino_gratis = false, nino_gratis_edad_min = null, nino_gratis_edad_max = null, promo_base_id = null, tipo = 'descuento_pct', descuento_valor = 10, prioridad = 5 where id = ${PRE_BF}`);
};
// Copia exacta de la calculadora del hotel de una sola base antes de «Guardar calculadora» (la acción sube su versión): se restaura al final.
const copiaH2 = psql(`select encode(convert_to(params::text, 'UTF8'), 'base64') from public.hotel_calculadora where hotel_id = ${H2}`).replace(/\s+/g, "");
const restaurarH2 = () => psql(`update public.hotel_calculadora set params = convert_from(decode('${copiaH2}', 'base64'), 'UTF8')::jsonb where hotel_id = ${H2}`);
const datosContrato = (cliente) => JSON.parse(psql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select numero_contrato, precio_venta, costo_hotel, contrato_uid, share_token from public.ventas where cliente ilike '%${cliente}%') t`));
// Esquema real de public.cotizaciones: id, codigo, estado, cliente (nombre), precio_venta, numero_contrato, share_token… (no existen total_cliente ni titular_nombre).
const datosCot = (cliente) => JSON.parse(psql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select id, codigo, estado, precio_venta, share_token from public.cotizaciones where cliente ilike '%${cliente}%') t`).replace(/\n/g, " "));
const lineaFirmada = (numero) => JSON.parse(psql(`select coalesce(json_agg(row_to_json(t)), '[]') from (select descripcion, tarifa_adulto from public.contrato_items where numero_contrato = '${numero}' and descripcion like 'Niño gratis%') t`))[0];

const navegador = await lanzar();
const VISTAS = ["escritorio", "movil"];
const medir = (c) => ({ acciones: c.acciones, rest: c.rest });

try {
  for (const vista of VISTAS) {
    console.log(`\n######## ${vista}`);
    const { ctx, page, cuenta } = await abrirConLogin(navegador, "superadmin@revision.test", vista);
    const rsc = { n: 0 }; page.on("request", (r) => { if (r.headers()["rsc"] === "1") rsc.n++; });
    const reset = () => { cuenta.acciones = 0; cuenta.rest = 0; rsc.n = 0; };
    const abrirCalc = async (h) => { await page.goto(`${APP}/dashboard/producto/hoteles/${h}?tab=temporadas`, { waitUntil: "networkidle" }); await page.getByRole("button", { name: /Tarifa por fórmula/ }).click(); await page.waitForTimeout(600); };

    console.log("\n-- A. Mixta: la promoción que CRUZA dos bases muestra su plan por noche y se pasa al modo nuevo");
    restaurarH1(); await abrirCalc(H1);
    const cruce = page.locator('[data-cruce-promo="PRE BF"]').first();
    await cruce.waitFor({ timeout: 30000 });
    const txt = (await cruce.innerText()).replace(/\s+/g, " ");
    ok(await cruce.locator("[data-tramo-plan='ok']").count() === 2, `${vista}: dos tramos (BASE A y BASE B), ambos en estado ok`);
    ok(/BASE A/.test(txt) && /BASE B/.test(txt) && /90\.000/.test(txt) && /135\.000/.test(txt), `${vista}: el plan nombra cada base y muestra 90.000 y 135.000`);
    ok(await sinDesborde(page), `${vista}: sin desborde horizontal`);
    await page.screenshot({ path: join(SALIDA, `${vista}-A-plan-cruce.png`) });
    page.once("dialog", (d) => d.accept());
    reset();
    await cruce.getByRole("button", { name: /Calcular por noche sobre la base ganadora/ }).click();
    await page.locator('[data-cruce-promo="PRE BF"][data-activa]').waitFor({ timeout: 30000 });
    const a = estado(PRE_BF);
    ok(a.sigue === true && a.base === null && a.reglas === 1, `${vista}: la promoción quedó en modo seguir-base con una regla (${JSON.stringify(a)})`);
    ok(cuenta.acciones === 1 && rsc.n === 0, `${vista}: «Calcular por noche…» = ${cuenta.acciones} acción de servidor y ${rsc.n} refresco RSC (esperado 1 y 0)`);
    ok(/Se calcula por noche sobre la base ganadora/.test(await cruce.innerText()), `${vista}: el panel dice que se calcula por noche`);
    // Reposo: con la calculadora abierta y sin tocar nada, ninguna solicitud (sin sondeos, efectos que se repiten ni reintentos).
    const peticiones = { n: 0 }; const contar = () => { peticiones.n++; }; page.on("request", contar);
    await page.waitForTimeout(10000); page.off("request", contar);
    ok(peticiones.n === 0, `${vista}: reposo de 10 s en la calculadora = ${peticiones.n} solicitudes (esperado 0)`);

    console.log("\n-- B. Hotel de una sola base: la promoción de siempre no cambia");
    await abrirCalc(H2);
    ok(await page.locator("[data-cruce-promo]").count() === 0, `${vista}: sin panel de cruce (una sola base)`);
    const u = estado(UNICA);
    ok(u.sigue === false && u.nino === false && u.reglas === 0, `${vista}: PROMO UNICA intacta (${JSON.stringify(u)})`);
    await page.getByRole("button", { name: "Guardar calculadora" }).waitFor({ timeout: 30000 });
    reset();
    await page.getByRole("button", { name: "Guardar calculadora" }).click();
    await page.getByText(/Calculadora guardada/).first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(900);
    ok(cuenta.acciones === 1, `${vista}: «Guardar calculadora» = ${cuenta.acciones} acción (#124 + #125 conviven; sin reintentos)  ·  refrescos RSC ${rsc.n}`);
    restaurarH2();

    console.log("\n-- C. «Reglas por grupo»: seguir la base ganadora + un niño gratis con edad propia");
    restaurarH1(); await page.goto(`${APP}/dashboard/producto/hoteles/${H1}?tab=temporadas`, { waitUntil: "networkidle" });
    await page.locator("li", { has: page.locator("b", { hasText: /^PRE BF$/ }) }).getByRole("button", { name: "Reglas por grupo" }).first().click();
    const dlg = page.getByRole("dialog", { name: /Reglas por grupo de PRE BF/ });
    await dlg.waitFor({ timeout: 30000 });
    await dlg.locator("select").first().selectOption({ label: "Seguir la base ganadora cada noche (varias temporadas)" });
    await dlg.locator("[data-modo-sigue]").waitFor({ timeout: 10000 });
    ok(await dlg.locator("[data-plan-seccion] [data-tramo-plan]").count() >= 1, `${vista}: la vista previa con fechas aparece en el diálogo`);
    await dlg.locator("[data-modo-sigue] input[type=radio]").nth(0).check();
    await dlg.locator("[data-nino-gratis] input[type=checkbox]").first().check();
    const edades = dlg.locator("[data-nino-edad] input");
    await edades.nth(0).fill("3"); await edades.nth(1).fill("12");
    ok(await sinDesborde(page), `${vista}: diálogo sin desborde horizontal`);
    await page.screenshot({ path: join(SALIDA, `${vista}-C-dialogo.png`) });
    reset();
    await dlg.getByRole("button", { name: "Guardar reglas" }).click();
    await dlg.waitFor({ state: "detached", timeout: 30000 });
    const c = estado(PRE_BF);
    ok(c.sigue === true && c.nino === true && c.emin === 3 && c.emax === 12 && c.reglas === 1, `${vista}: guardado seguir-base + niño gratis 3–12 (${JSON.stringify(c)})`);
    ok(cuenta.acciones === 1, `${vista}: «Guardar reglas» = ${cuenta.acciones} acción de servidor (refrescos RSC ${rsc.n})`);
    restaurarH1();

    console.log("\n-- D. Búsqueda (Vista Booking) = cotización guardada = contrato (2 adultos + 1 niño de 8 años, 4→9 dic 2026, «Hotel PRE BF 125 ACTIVO»)");
    const e1 = datosContrato("Ejemplo 125 PRE BF")[0];
    ok(!!e1, `${vista}: existe el contrato E1 (${e1?.numero_contrato ?? "falta: corre localreview.ps1 ampliar125"})`);
    await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Vista Booking" }).click();
    await page.getByRole("button", { name: /Porción terrestre/ }).first().click();
    await page.locator('button[role="combobox"]').first().click();
    await page.getByRole("option", { name: "DEMO 125" }).click();
    const campo = (et) => page.locator(`label:text-is("${et}")`).locator("xpath=..").locator("input").first();
    await page.getByRole("textbox", { name: "Ida", exact: true }).fill("04/12/2026"); await page.getByRole("textbox", { name: "Ida", exact: true }).blur();
    await page.getByRole("textbox", { name: "Regreso", exact: true }).fill("09/12/2026"); await page.getByRole("textbox", { name: "Regreso", exact: true }).blur();
    await campo("Adultos").fill("2"); await campo("Habitaciones").fill("1");
    await page.getByLabel(/Menores \(0–17 años\)/).fill("1"); await campo("Edad menor 1").fill("8");
    reset();
    await page.getByRole("button", { name: /Buscar hoteles/ }).click();
    await page.waitForSelector('button:has-text("Buscar hoteles")', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const t = await texto(page);
    ok(/Hotel PRE BF 125 ACTIVO/.test(t), `${vista}: la búsqueda muestra «Hotel PRE BF 125 ACTIVO»`);
    ok(e1 && new RegExp(dinero(Number(e1.precio_venta)).replace(/\./g, "\\.")).test(t), `${vista}: el total de la tarjeta coincide con el precio del contrato ${e1?.numero_contrato}: $${e1 ? dinero(Number(e1.precio_venta)) : "?"}`);
    ok(cuenta.acciones <= 2, `${vista}: un clic en Buscar = ${cuenta.acciones} llamadas al servidor (persona + unidad; sin sondeos)`);
    { const q = { n: 0 }; const f = () => { q.n++; }; page.on("request", f); await page.waitForTimeout(10000); page.off("request", f);
      ok(q.n === 0, `${vista}: reposo de 10 s con los resultados de la búsqueda = ${q.n} solicitudes (esperado 0)`); }
    await page.screenshot({ path: join(SALIDA, `${vista}-D-busqueda.png`), fullPage: false });
    ok(await sinDesborde(page), `${vista}: la búsqueda no desborda horizontalmente`);

    // I1 (re-auditoría integrada): la tarjeta muestra lo que SE PAGA por pasajero, explica el niño gratis y sus líneas SUMAN el total mostrado.
    {
      const tarjeta = page.locator('[data-testid="desglose-tarifas"]', { hasText: "Niño gratis por habitación" }).first();
      ok(await tarjeta.count() === 1, `${vista}: la tarjeta del hotel con niño gratis muestra su explicación`);
      const lectura = await tarjeta.evaluate((raiz) => {
        const num = (s) => Number((s ?? "").replace(/[^\d-]/g, ""));
        const filas = [...raiz.querySelectorAll("[data-clase]")].map((d) => {
          const dds = [...d.querySelectorAll("dd")].filter((x) => !x.hasAttribute("data-nino-gratis"));
          return { clase: d.getAttribute("data-clase"), dt: (d.querySelector("dt")?.textContent ?? "").replace(/\s+/g, " ").trim(), porPersona: num(dds[0]?.textContent), subtotal: num(dds[1]?.textContent), expl: (d.querySelector("[data-nino-gratis]")?.textContent ?? "").replace(/\s+/g, " ").trim() };
        });
        const total = num([...raiz.querySelectorAll("dt")].find((x) => /Total de la reserva/.test(x.textContent ?? ""))?.nextElementSibling?.textContent);
        return { filas, total };
      });
      const adulto = lectura.filas.find((f) => f.clase === "adulto"), nino = lectura.filas.find((f) => f.clase === "nino");
      ok(adulto?.subtotal === 1464000 && adulto?.porPersona === 732000, `${vista}: tarjeta · adultos 2 × $732.000 = $1.464.000 (leído: ${adulto?.porPersona} c/u, ${adulto?.subtotal})`);
      ok(nino?.subtotal === 0 && nino?.porPersona === 0 && /8 años/.test(nino?.dt ?? ""), `${vista}: tarjeta · el niño de 8 años paga $0 (leído: ${nino?.dt} → ${nino?.subtotal})`);
      ok(/Niño gratis por habitación · PRE BF · tarifa \$ ?366\.000 − \$ ?366\.000/.test(nino?.expl ?? ""), `${vista}: tarjeta · explicación compacta «${nino?.expl}»`);
      ok(lectura.filas.reduce((s, f) => s + f.subtotal, 0) === lectura.total && lectura.total === 1464000, `${vista}: tarjeta · la suma de lo mostrado por pasajero (${lectura.filas.reduce((s, f) => s + f.subtotal, 0)}) = total mostrado (${lectura.total}) = precio del contrato`);
    }

    // I1: Vista tabla — estadía y noche adicional (referencia) por pasajero.
    await page.goto(`${APP}/tarifario`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Vista tabla" }).click();
    await page.getByRole("button", { name: /Porción terrestre/ }).first().click();
    await page.locator('button[role="combobox"]').first().click();
    await page.getByRole("option", { name: "DEMO 125" }).click();
    await page.getByRole("textbox", { name: "Ida", exact: true }).fill("04/12/2026"); await page.getByRole("textbox", { name: "Ida", exact: true }).blur();
    await page.getByRole("textbox", { name: "Regreso", exact: true }).fill("09/12/2026"); await page.getByRole("textbox", { name: "Regreso", exact: true }).blur();
    await campo("Adultos").fill("2"); await campo("Habitaciones").fill("1");
    await page.getByLabel(/Menores \(0–17 años\)/).fill("1"); await campo("Edad menor 1").fill("8");
    reset();
    await page.getByRole("button", { name: /Buscar hoteles/ }).click();
    await page.waitForSelector('section[aria-labelledby="sec-estadia"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    ok(cuenta.acciones === 1, `${vista}: Vista tabla · un clic en Buscar = ${cuenta.acciones} llamada al servidor (esperado 1)`);
    {
      const monto = (s) => { const m = /\$\s?(-?[\d.]+)/.exec(s ?? ""); return m ? Number(m[1].replace(/\./g, "")) : NaN; };
      const celda = async (sec, etiqueta) => ((await page.locator(`section[aria-labelledby="${sec}"] tbody tr`, { hasText: "Hotel PRE BF 125 ACTIVO" }).first().locator(`td[data-label="${etiqueta}"]`).innerText()) ?? "").replace(/\s+/g, " ").trim();
      const menores = await celda("sec-estadia", "Menores");
      ok(/Niño 1 · 8 años/.test(menores) && monto(menores) === 0, `${vista}: tabla · estadía: el niño paga $0 («${menores}»)`);
      ok(/Niño gratis por habitación · PRE BF · tarifa \$ ?366\.000 − \$ ?366\.000/.test(menores), `${vista}: tabla · estadía: explicación del niño gratis`);
      const adultoE = monto(await celda("sec-estadia", "Adulto")), totalE = monto(await celda("sec-estadia", "Total de la reserva"));
      ok(adultoE === 732000 && totalE === 1464000 && 2 * adultoE + monto(menores) === totalE, `${vista}: tabla · estadía: 2 × $${dinero(adultoE)} + $0 = $${dinero(totalE)}`);
      // Noche adicional (09/12, fuera de la promoción 4–8 dic): el niño paga la noche completa y las líneas suman el total de la noche.
      const mN = await celda("sec-noche", "Menores"), aN = monto(await celda("sec-noche", "Adulto")), tN = monto(await celda("sec-noche", "Total de la noche"));
      ok(!/Niño gratis por habitación/.test(mN) && monto(mN) > 0, `${vista}: tabla · noche adicional (fuera de la promoción): el niño paga su noche, sin explicación (${mN})`);
      ok(2 * aN + monto(mN) === tN && tN > 0, `${vista}: tabla · noche adicional: 2 × $${dinero(aN)} + $${dinero(monto(mN))} = $${dinero(tN)} (referencia, suma el total de la noche)`);
      ok(await sinDesborde(page), `${vista}: tabla · sin desborde horizontal`);
      await page.screenshot({ path: join(SALIDA, `${vista}-D-tabla.png`), fullPage: true });
    }

    await ctx.close();
  }

  console.log("\n-- E. Dónde se ve la línea firmada del niño gratis: documento del contrato (interno y por enlace), cotización (ficha y enlace público) — y qué muestra la ficha interna");
  // La ficha interna del contrato (/dashboard/contratos/<n>) es una vista de OPERACIÓN y FINANZAS (resumen, costo del hotel por pagar, condiciones, pasajeros, abonos, vouchers). Sus líneas de detalle
  // (contrato_items) solo se consultan para superadmin y solo alimentan el editor de contenido; NO se muestran como texto. La línea firmada vive en el documento del contrato y en la cotización.
  const ESPERADO = [
    { cliente: "Ejemplo 125 PRE BF", linea: "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))", condonado: 366000, total: 1464000, costoHotel: 1170000 },
    { cliente: "Ejemplo 125 sucesivas", linea: "Niño gratis por habitación · PROMO UNO, PROMO DOS (hab. 1: niño de 8 años (Niño 1))", condonado: 101000, total: 360000, costoHotel: 360000 },
  ];
  const monto = (n) => new RegExp(`-\\$ ${dinero(n).replace(/\./g, "\\.")}`);
  const pesos = (n) => new RegExp(`\\$ ${dinero(n).replace(/\./g, "\\.")}`);
  for (const vista of VISTAS) {
    const { ctx, page } = await abrirConLogin(navegador, "administracion@revision.test", vista);
    for (const e of ESPERADO) {
      const v = datosContrato(e.cliente)[0];
      ok(!!v, `${vista}: contrato de «${e.cliente}» existe (${v?.numero_contrato ?? "falta"})`);
      if (!v) continue;
      // Lo guardado debe coincidir con lo esperado a mano (el documento se compara después contra lo guardado Y contra la constante).
      const fila = lineaFirmada(v.numero_contrato);
      ok(fila?.descripcion === e.linea && Math.abs(Number(fila.tarifa_adulto)) === e.condonado, `${vista}: ${v.numero_contrato} guardado: «${fila?.descripcion}» por ${fila?.tarifa_adulto} (esperado ${e.condonado})`);
      ok(Number(v.precio_venta) === e.total && Number(v.costo_hotel) === e.costoHotel, `${vista}: ${v.numero_contrato} precio ${v.precio_venta} (esperado ${e.total}) y costo del hotel ${v.costo_hotel} (esperado ${e.costoHotel}: solo los adultos)`);

      // 1) Ficha interna: control de operación/finanzas. El costo del hotel por pagar es solo el de los adultos (el niño gratis no genera costo) — comprobación ADICIONAL, no sustituta de la línea.
      await page.goto(`${APP}/dashboard/contratos/${v.numero_contrato}`, { waitUntil: "networkidle" });
      const ti = await texto(page);
      ok(new RegExp(`Total previsto \\$ ${dinero(e.costoHotel).replace(/\./g, "\\.")}`).test(ti), `${vista}: ficha interna ${v.numero_contrato}: costo del hotel por pagar $${dinero(e.costoHotel)} (solo adultos)`);
      ok(pesos(e.total).test(ti), `${vista}: ficha interna ${v.numero_contrato}: total del contrato $${dinero(e.total)}`);
      ok(await sinDesborde(page), `${vista}: ficha ${v.numero_contrato} sin desborde horizontal`);

      // 2) Documento del contrato (el que se imprime): descripción del beneficio, promociones, monto firmado y total.
      const revisarDocumento = async (etiqueta, url) => {
        await page.goto(`${APP}${url}`, { waitUntil: "networkidle" });
        const td = await texto(page);
        // 2026-11-18 (owner review, item 5): the CLIENT document folds the benefit into the child's tariff — one «Niño gratis» row at $0, no negative renglón, no promotion names or calculation text.
        // (The signed line itself stays in contrato_items — asserted above — and in the internal quotation ficha below.)
        ok(/Niño gratis · /.test(td) && !td.includes("Niño gratis por habitación") && !/PROMO (UNO|DOS)|· PRE BF/.test(td), `${vista}: ${etiqueta} ${v.numero_contrato}: fila «Niño gratis» sin nombres de promoción ni cálculo`);
        ok(!monto(e.condonado).test(td) && pesos(e.total).test(td), `${vista}: ${etiqueta} ${v.numero_contrato}: ningún renglón negativo (-$${dinero(e.condonado)}) y total $${dinero(e.total)}`);
        ok(await sinDesborde(page), `${vista}: ${etiqueta} ${v.numero_contrato} sin desborde horizontal`);
        return td;
      };
      await revisarDocumento("documento imprimible (interno)", `/contrato/${v.numero_contrato}`);
      await page.screenshot({ path: join(SALIDA, `${vista}-E-${v.numero_contrato}.png`), fullPage: true });
      if (vista === "escritorio") {
        const pdf = await page.pdf({ format: "Letter", printBackground: true });
        const paginas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        ok(pdf.length > 5000 && paginas >= 1, `${vista}: PDF de ${v.numero_contrato}: ${paginas} página(s), ${Math.round(pdf.length / 1024)} KB`);
      }
      await revisarDocumento("documento por enlace", `/contrato/${v.numero_contrato}?token=${v.share_token}`);

      // 3) Cotización: ficha interna (línea + composición) y enlace público del cliente (/cot/<token>, SIN sesión).
      const cot = datosCot(e.cliente)[0];
      ok(!!cot, `${vista}: cotización de «${e.cliente}» existe (${cot?.codigo ?? "falta"}; ${cot?.estado ?? ""})`);
      if (cot) {
        ok(Number(cot.precio_venta) === e.total, `${vista}: ${cot.codigo} guardada por $${dinero(Number(cot.precio_venta))} (esperado ${dinero(e.total)}, igual que el contrato)`);
        await page.goto(`${APP}/dashboard/cotizaciones/${cot.id}`, { waitUntil: "networkidle" });
        const tc = await texto(page);
        ok(tc.includes(e.linea) && monto(e.condonado).test(tc), `${vista}: ficha de ${cot.codigo}: línea «${e.linea}» por -$${dinero(e.condonado)}`);
        ok(/Composición del precio/.test(tc) && tc.includes(`Niño gratis por habitación · ${e.linea.split("· ")[1]}`), `${vista}: ficha de ${cot.codigo}: la composición del precio lleva el beneficio con sus promociones`);
      }
    }
    // Cotización ABIERTA E3 (dos niños de 8 y 5 años): UN solo niño gratis por habitación; el otro paga su tarifa. Se mira en la ficha y en el enlace público (sin sesión).
    const abierta = datosCot("Ejemplo 125 abierta")[0];
    ok(!!abierta, `${vista}: cotización abierta E3 existe (${abierta?.codigo ?? "falta"}; ${abierta?.estado ?? ""})`);
    if (abierta) {
      const LINEA = "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))";
      ok(Number(abierta.precio_venta) === 1757000, `${vista}: ${abierta.codigo} guardada por $${dinero(Number(abierta.precio_venta))} (esperado 1.757.000 = 2 adultos 1.464.000 + Niño 2 de 5 años 293.000; el Niño 1 es gratis)`);
      await page.goto(`${APP}/dashboard/cotizaciones/${abierta.id}`, { waitUntil: "networkidle" });
      const tc = await texto(page);
      ok(tc.includes(LINEA) && monto(366000).test(tc) && pesos(1757000).test(tc), `${vista}: ficha de ${abierta.codigo}: «${LINEA}» -$366.000 y total $1.757.000`);
      ok(await sinDesborde(page), `${vista}: ficha de ${abierta.codigo} sin desborde horizontal`);
    }
    await ctx.close();

    // Enlaces públicos de cotización SIN sesión: lo que ve el cliente.
    const publico = await abrir(navegador, { vista });
    for (const [cliente, linea] of [["Ejemplo 125 PRE BF", ESPERADO[0].linea], ["Ejemplo 125 abierta", "Niño gratis por habitación · PRE BF (hab. 1: niño de 8 años (Niño 1))"]]) {
      const cot = datosCot(cliente)[0];
      if (!cot) { ok(false, `${vista}: falta la cotización de «${cliente}»`); continue; }
      await publico.page.goto(`${APP}/cot/${cot.share_token}`, { waitUntil: "networkidle" });
      const tp = await texto(publico.page);
      // 2026-11-18 (owner review, item 5): the public quotation shows the folded row, not the signed line (`linea` is kept only for the internal ficha assertions above).
      ok(/Niño gratis · /.test(tp) && !tp.includes(linea) && !monto(366000).test(tp), `${vista}: enlace público /cot/… de ${cot.codigo} (sin sesión): fila «Niño gratis», sin la línea firmada ni renglón negativo -$366.000`);
      ok(tp.split("Niño gratis · ").length - 1 === 1, `${vista}: enlace público de ${cot.codigo}: exactamente UNA fila de niño gratis (no una por niño)`);
      ok(await sinDesborde(publico.page), `${vista}: enlace público de ${cot.codigo} sin desborde horizontal`);
    }
    await publico.ctx.close();
  }
} finally {
  restaurarH1(); restaurarH2();
  await navegador.close();
}
process.exit(informe.cerrar());
