// #41 — duplicar un vuelo con nuevas fechas: solo configuración, nunca record, sillas ni reservas. Valores esperados escritos a mano.
import test from "node:test";
import assert from "node:assert/strict";
import { inicialBloqueoDesdeFila, inicialEmpaquetadoDesdeFila, validarOrdenFechasVuelo, idCopiaValido } from "../lib/vuelos/duplicarVuelo.ts";

const destinos = [{ id: 1, nombre: "BOGOTA", codigo_iata: "BOG" }, { id: 2, nombre: "CARTAGENA", codigo_iata: "CTG" }];
const bloqueo = {
  id: 41, record: "ABC123", aerolinea: "JETSMART", proveedor_id: 7, destino_id: 2, ruta: "BOG - CTG - BOG", origen: "bog", tarifa_neta: 450000, vuelo_ida: "JA101", fecha_ida: "2027-03-10T00:00:00",
  hora_salida_ida: "06:00", hora_llegada_ida: "07:30", vuelo_regreso: "JA102", fecha_regreso: "2027-03-13", hora_salida_reg: "18:00", hora_llegada_reg: "19:30", cupos_total: 25,
  tarifa_para_empaquetar: 520000, fee_infante: 60000, moneda: "COP", fecha_devolucion: "2027-02-01", fecha_emision: "2027-02-10", notas: "Grupo A", rangos_edad: [1, 2], modalidad_emision: "grupo",
  estado_emision: "emitido", estado_pago: "pagado",
  // lo operativo y de identidad que NUNCA debe viajar al formulario:
  sillas: [{ id: 1 }], contrato: "00-0451", created_at: "2026-01-01",
};

test("bloqueo: se copia la configuración, el record queda en blanco y no viaja nada operativo", () => {
  const i = inicialBloqueoDesdeFila(bloqueo, destinos);
  assert.equal(i.f.record, "", "el record debe ser uno nuevo");
  assert.deepEqual([i.proveedorId, i.destinoId, i.origenId, i.rangosSel, i.modalidadEmision, i.moneda], [7, 2, 1, [1, 2], "grupo", "COP"]);
  assert.deepEqual(
    [i.f.aerolinea, i.f.vueloIda, i.f.fechaIda, i.f.horaSalidaIda, i.f.vueloRegreso, i.f.fechaRegreso, i.f.cuposTotal, i.f.tarifaNeta, i.f.tarifaParaEmpaquetar, i.f.feeInfante, i.f.fechaDevolucion, i.f.fechaEmision, i.f.notas],
    ["JETSMART", "JA101", "2027-03-10", "06:00", "JA102", "2027-03-13", "25", "450000", "520000", "60000", "2027-02-01", "2027-02-10", "Grupo A"],
  );
  const json = JSON.stringify(i);
  for (const ajeno of ["ABC123", "emitido", "pagado", "sillas", "00-0451", "created_at"]) assert.ok(!json.includes(ajeno), `no debe viajar «${ajeno}»`);
});

test("bloqueo: campos ausentes dan valores neutros (sin inventar) y el origen se resuelve por IATA o por nombre", () => {
  const i = inicialBloqueoDesdeFila({ id: 1, record: "X", origen: "Cartagena" }, destinos);
  assert.equal(i.origenId, 2);
  assert.deepEqual([i.proveedorId, i.destinoId, i.rangosSel, i.modalidadEmision, i.moneda, i.f.fechaIda, i.f.tarifaNeta, i.f.cuposTotal, i.f.feeInfante], ["", "", [], "", "", "", "", "10", "0"]);
  assert.equal(inicialBloqueoDesdeFila({ origen: "ZZZ" }, destinos).origenId, "");
});

test("empaquetado «Promoción»: se copia la configuración y la ventana de compra; record vacío, sin vínculos con paquetes", () => {
  const e = {
    id: 9, record: null, aerolinea: "AVIANCA", proveedor_id: 3, destino_id: 1, origen: "CTG", vuelo_ida: "AV1", fecha_ida: "2027-05-01", fecha_regreso: "2027-05-05", tarifa_proveedor: 300000,
    tarifa_para_empaquetar: 350000, fee_infante: 0, moneda: "USD", compra_inicio: "2026-12-01", compra_fin: "2027-03-01", notas: "Promo", activo: true, estado_emision: "emitido", paquete_id: 55,
  };
  const i = inicialEmpaquetadoDesdeFila(e, destinos);
  assert.equal(i.f.record, "");
  assert.deepEqual([i.proveedorId, i.destinoId, i.origenId, i.moneda, i.f.fechaIda, i.f.fechaRegreso, i.f.compraInicio, i.f.compraFin, i.f.tarifaProveedor, i.f.tarifaParaEmpaquetar, i.f.feeInfante],
    [3, 1, 2, "USD", "2027-05-01", "2027-05-05", "2026-12-01", "2027-03-01", "300000", "350000", "0"]);
  const json = JSON.stringify(i);
  for (const ajeno of ["emitido", "55", "paquete"]) assert.ok(!json.includes(ajeno), `no debe viajar «${ajeno}»`);
  assert.equal(inicialEmpaquetadoDesdeFila({}, destinos).moneda, "COP");
});

test("orden de fechas: el regreso no puede ser anterior a la ida; vacías o iguales son válidas", () => {
  assert.deepEqual(validarOrdenFechasVuelo("2027-03-10", "2027-03-09"), { ok: false, error: "La fecha de regreso no puede ser anterior a la fecha de ida." });
  assert.deepEqual(validarOrdenFechasVuelo("2027-03-10", "2027-03-10"), { ok: true });
  assert.deepEqual(validarOrdenFechasVuelo("2027-03-10", "2027-03-13"), { ok: true });
  assert.deepEqual(validarOrdenFechasVuelo("", "2027-03-13"), { ok: true });
  assert.deepEqual(validarOrdenFechasVuelo("2027-03-10", null), { ok: true });
});

test("el identificador a duplicar viene de la URL: solo enteros positivos", () => {
  assert.equal(idCopiaValido("41"), 41);
  assert.equal(idCopiaValido(["7", "8"]), 7);
  for (const malo of ["0", "-1", "1.5", "abc", "1; drop", "", undefined, "9999999999999"]) assert.equal(idCopiaValido(malo as string | undefined), null, String(malo));
});
