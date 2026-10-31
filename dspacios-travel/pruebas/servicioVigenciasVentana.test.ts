import { test } from "node:test";
import assert from "node:assert/strict";
import { diasVentana, referenciaPublicacion, incluidoEnEstadia, type VigenciasServicio } from "../lib/calc/servicioVigencias.ts";

const sv: VigenciasServicio = {
  servicioId: 1, nombre: "Traslado", grupos: [], conFranjas: new Set(),
  temporadas: [{ nombre: "V1", fecha_inicio: "2026-01-01", fecha_fin: "2028-03-10", precio_persona: 50000 }],
};

test("ventana larga: la vigencia que termina el 2028-03-10 NO invalida el servicio: queda disponible solo hasta esa fecha (256)", () => {
  const r = referenciaPublicacion(sv, "persona", { desde: "2026-01-01", hasta: "2028-12-31" }, "2026-01-01");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.cobertura?.rangos, [{ desde: "2026-01-01", hasta: "2028-03-10" }]);
    assert.equal(r.cobertura?.parcial, true);
    assert.equal(r.cobertura?.primerSinCobertura, "2028-03-11");
  }
});

test("cobertura con una vigencia INVERTIDA (fin < inicio): se ignora y su tarifa no se usa (servicio 112)", () => {
  const conInvertida: VigenciasServicio = {
    servicioId: 112, nombre: "Servicio 112", grupos: [], conFranjas: new Set(),
    temporadas: [
      { nombre: "TEMP. 2026", fecha_inicio: "2025-12-01", fecha_fin: "2026-11-30", precio_persona: 87000 },
      { nombre: "TEMP. 2027", fecha_inicio: "2027-12-01", fecha_fin: "2027-11-30", precio_persona: 100000 }, // invertida: no cubre nada
    ],
  };
  const r = referenciaPublicacion(conInvertida, "persona", { desde: "2026-11-01", hasta: "2027-01-31" }, "2026-10-29");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.cobertura?.rangos, [{ desde: "2026-11-01", hasta: "2026-11-30" }]);
    assert.deepEqual(r.vigencias, ["TEMP. 2026"], "la vigencia invertida no aporta tarifa");
    assert.equal(r.netoPersona, 87000, "el mínimo no incluye los 100.000 de la vigencia inválida");
  }
  const ninguna = referenciaPublicacion(conInvertida, "persona", { desde: "2027-12-01", hasta: "2028-02-01" }, "2026-10-29");
  assert.equal(ninguna.ok, false, "solo la vigencia invertida toca esa ventana: no se ofrece");
  assert.equal(incluidoEnEstadia(conInvertida, "persona", "2027-12-05", "2027-12-08").ok, false, "un incluido no se hornea con una vigencia invertida");
});

test("sin ninguna fecha cubierta el opcional no se ofrece y dice que falta una vigencia confirmada", () => {
  const r = referenciaPublicacion(sv, "persona", { desde: "2029-01-01", hasta: "2029-02-01" }, "2026-01-01");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /no tiene ninguna vigencia de tarifa que cubra el viaje del paquete.*proveedor confirme/);
});

test("cobertura total: parcial=false", () => {
  const r = referenciaPublicacion(sv, "persona", { desde: "2026-01-01", hasta: "2026-03-01" }, "2026-01-01");
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.cobertura?.parcial, false);
});

test("ventana larga totalmente cubierta sí es válida (sin tope de 800 días)", () => {
  const r = referenciaPublicacion(sv, "persona", { desde: "2026-01-01", hasta: "2028-03-10" }, "2026-01-01");
  assert.equal(r.ok, true);
  assert.equal(diasVentana("2026-01-01", "2028-12-31").length, 1096);
});

test("fechas inválidas o invertidas se rechazan expresamente", () => {
  for (const [desde, hasta] of [["2026-13-40", "2026-02-01"], ["2026-02-01", "mañana"], ["2026-02-10", "2026-02-01"], ["2000-01-01", "2100-01-01"]]) {
    assert.throws(() => diasVentana(desde, hasta), RangeError);
    const r = referenciaPublicacion(sv, "persona", { desde, hasta }, "2026-01-01");
    assert.equal(r.ok, false, `${desde}→${hasta}`);
    assert.equal(incluidoEnEstadia(sv, "persona", desde, hasta).ok, false);
  }
});

test("fechas de calendario inexistentes (formato válido) se rechazan, no se normalizan", () => {
  for (const [desde, hasta] of [["2026-02-30", "2026-03-05"], ["2026-02-01", "2026-02-30"], ["2027-02-29", "2027-03-05"], ["2026-04-31", "2026-05-02"]]) {
    assert.throws(() => diasVentana(desde, hasta), RangeError, `${desde}→${hasta}`);
    const pub = referenciaPublicacion(sv, "persona", { desde, hasta }, "2026-01-01");
    assert.equal(pub.ok, false, `publicación ${desde}→${hasta}`);
    if (!pub.ok) assert.match(pub.error, /no se puede validar/);
    const inc = incluidoEnEstadia(sv, "persona", desde, hasta);
    assert.equal(inc.ok, false, `incluido ${desde}→${hasta}`);
    if (!inc.ok) assert.match(inc.error, /no se puede validar/);
  }
});

test("29 de febrero en año bisiesto es una fecha válida", () => {
  assert.deepEqual(diasVentana("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.equal(referenciaPublicacion(sv, "persona", { desde: "2028-02-28", hasta: "2028-03-01" }, "2026-01-01").ok, true);
});
