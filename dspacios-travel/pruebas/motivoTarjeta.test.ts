import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clasificarMotivoTarjeta, motivosUnicos, MOTIVO_ERROR_TECNICO } from "@/lib/tarifario/motivoTarjeta.ts";

// #90 — Clasificador puro del motivo real de la tarjeta del tarifario: cada familia de
// mensaje de negocio conocido (ver computo.ts/cotizarTarjetaActions.ts) debe mapear a su
// motivo de negocio; cualquier mensaje NO reconocido (incluidos los que llevan `.message`
// crudo de Supabase) cae siempre al motivo técnico genérico — nunca se devuelve tal cual.

describe("clasificarMotivoTarjeta: cada familia conocida mapea a su motivo", () => {
  const CASOS: [string, string, string][] = [
    ["hueco de tarifa (tarifario)", "No se encontró la tarifa seleccionada en el tarifario.", "Sin tarifa vigente para alguna noche del rango: hueco entre temporadas, temporada sin doble, o una temporada cuya compra aún no abre o ya venció."],
    ["hueco de tarifa (por fechas)", "No hay tarifa para esas fechas / categoría / régimen.", "Sin tarifa vigente para alguna noche del rango: hueco entre temporadas, temporada sin doble, o una temporada cuya compra aún no abre o ya venció."],
    ["vigencia de compra vencida", "Esta tarifa ya no está vigente para compra (la vigencia del hotel venció). Pide regenerar el tarifario con vigencias vigentes antes de reservar.", "La vigencia de compra de la temporada aún no empieza / ya venció."],
    ["servicio incluido sin tarifa (comillas angulares)", "El servicio «Traslado aeropuerto»: no tiene tarifa publicada para esa fecha.", "Revisa el servicio «Traslado aeropuerto»: sin tarifa o vigencia para esa fecha, o hay que regenerar el tarifario."],
    ["servicio incluido no encontrado en el catálogo (comillas rectas)", 'El servicio incluido "City tour" no se encontró en el catálogo.', "Revisa el servicio «City tour»: sin tarifa o vigencia para esa fecha, o hay que regenerar el tarifario."],
    ["servicio incluido sin precio por persona publicado (pide regenerar)", "El servicio «Desayuno buffet» no tiene precio por persona publicado; regenera el tarifario del paquete.", "Revisa el servicio «Desayuno buffet»: sin tarifa o vigencia para esa fecha, o hay que regenerar el tarifario."],
    ["servicio incluido sin vigencias cargadas (liquidacionHotel.ts:252)", "No se cargaron las vigencias del servicio incluido «Traslado aeropuerto».", "Revisa el servicio «Traslado aeropuerto»: sin tarifa o vigencia para esa fecha, o hay que regenerar el tarifario."],
    ["paquete con tarifario pendiente de corrección", "Este paquete no está disponible por ahora: su tarifario está pendiente de corrección. Elige otra opción o contacta a la agencia.", "El tarifario del paquete debe regenerarse."],
    ["promoción sin composición que la respalde", "Este hotel tiene una promoción por anticipación o estadía que no se puede aplicar al precio publicado: regenera el tarifario del paquete antes de cotizar o reservar.", "El tarifario del paquete debe regenerarse."],
    ["sin habitación doble configurada", "sin tarifa doble", "Este hotel no tiene habitación doble configurada (la tarjeta cotiza con doble)."],
    ["salida dinámica no vigente", "Esta salida está fuera de su vigencia de compra.", "El vuelo/salida ya no es vendible (desactivado, vencido o destino no permitido)."],
    ["empaquetado desactivado", "Este empaquetado fue desactivado y ya no se puede reservar.", "El vuelo/salida ya no es vendible (desactivado, vencido o destino no permitido)."],
    ["destino aéreo no permitido", "El vuelo no corresponde a los destinos aéreos permitidos del paquete.", "El vuelo/salida ya no es vendible (desactivado, vencido o destino no permitido)."],
  ];
  for (const [nombre, entrada, esperado] of CASOS) {
    test(nombre, () => { assert.equal(clasificarMotivoTarjeta(entrada), esperado); });
  }

  test("un mensaje no reconocido (incluido uno con .message crudo de Supabase) cae a 'error técnico'", () => {
    assert.equal(clasificarMotivoTarjeta("No se pudo consultar el hotel: relation \"hoteles\" does not exist"), MOTIVO_ERROR_TECNICO);
    assert.equal(clasificarMotivoTarjeta("La moneda de la neta no coincide con la del hotel."), MOTIVO_ERROR_TECNICO);
    assert.equal(clasificarMotivoTarjeta(""), MOTIVO_ERROR_TECNICO);
  });

  test("nunca expone números ni texto con pinta de dato financiero", () => {
    for (const [, entrada] of CASOS) {
      const motivo = clasificarMotivoTarjeta(entrada);
      assert.doesNotMatch(motivo, /\$|\d{3,}/, `el motivo de "${entrada}" no debe traer montos`);
    }
  });
});

describe("motivosUnicos: deduplica conservando el orden de aparición", () => {
  test("combos con el mismo motivo real solo aparecen una vez", () => {
    const r = motivosUnicos([
      "No se encontró la tarifa seleccionada en el tarifario.",
      "No hay tarifa para esas fechas / categoría / régimen.",
      "Esta tarifa ya no está vigente para compra (la vigencia del hotel venció). Pide regenerar el tarifario con vigencias vigentes antes de reservar.",
    ]);
    assert.deepEqual(r, [
      "Sin tarifa vigente para alguna noche del rango: hueco entre temporadas, temporada sin doble, o una temporada cuya compra aún no abre o ya venció.",
      "La vigencia de compra de la temporada aún no empieza / ya venció.",
    ]);
  });

  test("sin combos fallidos, la lista es vacía", () => {
    assert.deepEqual(motivosUnicos([]), []);
  });
});
