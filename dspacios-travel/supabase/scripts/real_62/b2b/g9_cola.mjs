} catch (e) {
  registrar("EXCEPCIÓN no controlada durante el recorrido", String(e?.stack ?? e).split("\n").slice(0, 4).join(" ⏎ ") + " | causa=" + String(e?.cause?.code ?? e?.cause?.message ?? ""), "sin excepción", false);
} finally {
  await sinFallos().catch(() => undefined);
  await browser.close();
}

writeFileSync(join(SALIDA, "controles.json"), JSON.stringify({ ctrl, layout }, null, 2));
console.log("\ncontrol | observado | esperado | estado");
let fallos = 0;
for (const c of ctrl) { console.log(`${c.nombre} | ${c.observado} | ${c.esperado} | ${c.estado}`); if (c.estado === "FALLO") fallos++; }
// Desborde horizontal: se informa siempre. La barra superior del personal a 820 px ya desbordaba antes de este bloque (observación O3 del §9.6): se marca como previa, no se oculta.
const esBarra = (l) => l.vista === "intermedio" && l.fuera.join(",") === "BUTTON:Cerrar sesión";
// Tablas con scroll horizontal PROPIO (patrón existente del portal, min-w-[980px]): su última columna queda fuera de la pantalla angosta por diseño; se informa, no se oculta.
const esTablaConScroll = (l) => l.scroll <= l.ancho && l.fuera.length > 0 && l.fuera.every((x) => /^A:Contrato /.test(x)) && /cotizaciones/.test(l.nombre);
const malos = layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && !esBarra(l) && !esTablaConScroll(l));
for (const t of layout.filter(esTablaConScroll)) console.log("  (tabla con scroll propio, patrón existente) " + t.nombre + " " + t.vista + ": ancho=" + t.ancho + " scroll=" + t.scroll + " fuera=" + t.fuera.join(","));
for (const p of layout.filter((l) => (l.scroll > l.ancho || l.fuera.length) && esBarra(l))) console.log("  (previo: barra superior del personal) " + p.nombre + " " + p.vista + ": ancho=" + p.ancho + " scroll=" + p.scroll);
console.log(`\nLAYOUT: ${layout.length} capturas, ${malos.length} con desborde/elementos fuera de pantalla`);
for (const m of malos) console.log(`  ${m.nombre} ${m.vista}: ancho=${m.ancho} scroll=${m.scroll} fuera=${m.fuera.join(",")}`);
console.log(fallos === 0 && malos.length === 0 ? `\nRESULTADO: ${ctrl.length} controles, 0 FALLO` : `\nRESULTADO: ${fallos} FALLO(S) de ${ctrl.length}; layout con problemas: ${malos.length}`);
process.exit(fallos === 0 && malos.length === 0 ? 0 : 1);
