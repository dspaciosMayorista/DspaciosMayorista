// Simulación EN MEMORIA y ESTRICTA del contrato SQL de #63 (migración 227, E/F/G; 233/234: TRM condicional y moneda de la oferta) para las pruebas del orquestador TS
// (pruebas/salidaVinculada63*.react.ts). Cada función espeja lo que hace la base y RECHAZA lo que la base rechazaría:
//   · crear_cotizacion_oferta_63  → cotización + oferta privada (snapshot) o p63_oferta_cambio si T0 cambió;
//   · aceptar_oferta_63           → revalida revisiones/TRM/huellas, reserva el número, congela el snapshot; mismo reintento = mismo intento;
//   · registrar_financiero_contrato (contratos #63) → deriva TODO del snapshot, rechaza payload alterno / sin pendiente / sin hijos;
//   · revertir_contrato_incompleto → descarta el intento (tombstone) y reabre la oferta, salvo que ya esté completa;
//   · fencing del INSERT en ventas  → solo el intento vigente crea la cabecera, con los valores aceptados (incluido el plan B2B
//     congelado en el snapshot: aliado, modo de compra, comisión, estado y precio final);
//   · vigencias de compra (hotel / servicio) del snapshot → se validan con el reloj de negocio de la RPC (`opciones.hoyBogota`),
//     SIN que ninguna revisión se haya movido (cruce de medianoche);
//   · registrar_comision_b2b_reserva → recalcula con el % VIVO del aliado y se niega si no coincide con la cabecera.
// Lo que NO prueba (y prueba Postgres de verdad en supabase/scripts/test_227_salida_vinculada.sql): candados, carreras entre
// sesiones, triggers, ACL/RLS, reloj en SQL. Aquí se verifica que el TS NUNCA envíe ni escriba algo distinto de lo aceptado.
import { isDeepStrictEqual } from "node:util";
import type { crearBD, Fila, ManejadorRpc } from "./fechaNegocioArnes.ts";

type BD = ReturnType<typeof crearBD>;
const err = (message: string) => ({ __error: { code: "P0001", message } });
const vacio = (v: unknown) => v == null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

function fechaNegocioHoy(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

export function derivado63(a: Fila): { costos: Fila; cxp: Fila[] } {
  const fin = (a.snapshot as { financiero: { costos: Fila; cxp: Fila[] } }).financiero;
  const prov = a.trm_provisional == null ? null : Number(a.trm_provisional);
  return {
    costos: fin.costos,
    // 234 (espejo de p63_financiero_derivado): una obligación en USD sin TRM toma la TRM PROVISIONAL congelada al aceptar y su equivalente COP.
    cxp: fin.cxp.map((o) => {
      const sinTrm = prov != null && (o.moneda ?? "COP") === "USD" && (o.trm == null || o.trm === "");
      const base = sinTrm ? { ...o, trm: prov, valor_cop: Math.round(Number(o.valor_total) * prov * 100) / 100 } : o;
      return { ...base, fecha_obligacion: a.fecha_negocio };
    }),
  };
}

export type OpcionesRpc63 = {
  /** Se invoca justo antes de materializar los pasajeros (entre la aceptación y la escritura financiera): simula un cambio de catálogo. */
  alMaterializar?: () => void | Promise<void>;
  /** Si devuelve un mensaje, `crear_pasajeros_contrato_con_sillas` falla con él (simula un corte a mitad de camino). */
  fallaPasajeros?: () => string | null;
  /** Fecha de negocio (Bogotá) que ve la RPC al aceptar: permite simular el cruce de medianoche sin mover ninguna revisión. */
  hoyBogota?: () => string;
  /** Se invoca al entrar `registrar_comision_b2b_reserva` (después de crear la cabecera): simula un cambio del % del aliado POSTERIOR a la aceptación. */
  alComision?: () => void;
};

export function crearRpcs63(ref: { bd?: BD }, op: OpcionesRpc63 = {}): Record<string, ManejadorRpc> {
  const bd = () => ref.bd as BD;
  const ofertas = () => bd().filas("p63_oferta");
  const aceptaciones = () => bd().filas("p63_aceptacion");
  const siguienteNumero = () => {
    const a = (globalThis as unknown as { __arnesFechas: { seq?: number } }).__arnesFechas;
    a.seq = (a.seq ?? 450) + 1;
    return `DTM-${String(a.seq).padStart(4, "0")}`;
  };
  const paqueteDe = (id: unknown) => bd().filas("armado_paquetes").find((p) => p.id === id);
  const revisiones = (p: Fila) => ({
    rev_fuente: Number(p.tarifario_revision_fuente ?? 0),
    rev_publicada: (p.tarifario_revision_publicada ?? null) as number | null,
    gen_publicada: (p.tarifario_generacion_publicada ?? null) as number | null,
    rev_costos: Number(p.p63_rev_costos ?? 0),
  });

  return {
    crear_cotizacion_oferta_63: (args) => {
      const snap = args.p_snapshot as { paquete_id: number; salida_id: number | null; trm: number; moneda?: string; financiero: unknown; cabecera: Record<string, unknown> };
      const t0 = args.p_t0 as Record<string, unknown>;
      const p = paqueteDe(snap.paquete_id);
      if (!p || p.modo_oferta !== "cop_trm_63" || Number(p.trm_oferta) !== Number(snap.trm)) return err("p63_oferta_cambio: el modo o la TRM del paquete cambiaron mientras se cotizaba");
      // 234: la oferta se cotiza en la moneda ELEGIDA del paquete (COP si nunca eligió); snapshot, cabecera y cotización coinciden; en USD la TRM es obligatoria.
      const monOferta = snap.moneda || "COP";
      if (!["COP", "USD"].includes(monOferta) || (p.moneda_publicacion ?? "COP") !== monOferta) return err("p63_oferta_cambio: la moneda de publicación del paquete cambió mientras se cotizaba");
      if ((snap.cabecera?.moneda ?? "") !== monOferta) return err("p63_invalida: la moneda de la cabecera de la oferta no es la de la oferta");
      if (!isDeepStrictEqual(revisiones(p), { rev_fuente: Number(t0.rev_fuente), rev_publicada: t0.rev_publicada ?? null, gen_publicada: t0.gen_publicada ?? null, rev_costos: Number(t0.rev_costos) })) {
        return err("p63_oferta_cambio: la configuración del paquete cambió mientras se cotizaba");
      }
      if (!snap.financiero || !snap.cabecera || !args.p_huella || !args.p_huella_financiera) return err("p63_invalida: snapshot incompleto");
      const cot = args.p_cotizacion as Fila;
      if ((cot.moneda ?? null) !== monOferta) return err("p63_invalida: la moneda de la cotización no es la de la oferta");
      // La cotización y su oferta nacen JUNTAS (una transacción): si algo faltara, ninguna de las dos.
      const id = (bd().filas("cotizaciones").reduce((m, c) => Math.max(m, Number(c.id) || 0), 0)) + 1;
      bd().filas("cotizaciones").push({ id, codigo: `COT-${id}`, estado: "abierta", created_at: new Date().toISOString(), ...cot });
      ofertas().push({
        id, cotizacion_id: id, tenant: args.p_tenant, paquete_id: snap.paquete_id, salida_id: snap.salida_id, trm: snap.trm, ...revisiones(p),
        huella: args.p_huella, huella_financiera: args.p_huella_financiera, snapshot: snap, estado: "abierta",
      });
      return id;
    },

    aceptar_oferta_63: (args) => {
      const of = ofertas().find((o) => o.cotizacion_id === args.p_cotizacion);
      if (!of) return err("p63_sin_oferta: la cotización no tiene una oferta en COP con TRM");
      if (of.tenant !== args.p_tenant || args.p_tenant !== "mayorista") return err("p63_no_autorizado: la oferta no pertenece a la agencia indicada");
      const vigente = aceptaciones().find((a) => a.oferta_id === of.id && a.estado !== "descartada");
      if (vigente) {
        if (vigente.estado === "preparada") {
          return { estado: "preparada", aceptacion_id: vigente.id, numero_contrato: vigente.numero_contrato, fecha_negocio: vigente.fecha_negocio, snapshot: vigente.snapshot, financiero: derivado63(vigente) };
        }
        return { estado: vigente.estado, aceptacion_id: vigente.id, numero_contrato: vigente.numero_contrato };
      }
      if (of.estado !== "abierta") return err("p63_oferta_cerrada: la oferta ya fue convertida");
      const p = paqueteDe(of.paquete_id);
      if (!p || p.activo === false || p.modo_oferta !== "cop_trm_63") return err("p63_oferta_cambio: el paquete ya no está activo en modo COP con TRM");
      if (Number(p.trm_oferta) !== Number(of.trm)) return err("p63_oferta_cambio: la TRM del paquete cambió desde la cotización");
      // 234: la moneda de la oferta es la que se cotizó; si el paquete cambió de moneda de publicación, no se acepta.
      if ((p.moneda_publicacion ?? "COP") !== (((of.snapshot as { moneda?: string }).moneda) || "COP")) return err("p63_oferta_cambio: la moneda de publicación del paquete cambió desde la cotización");
      const v = revisiones(p);
      if (p.tarifario_snapshot_publicable === false || v.rev_publicada !== of.rev_publicada || v.gen_publicada !== of.gen_publicada) return err("p63_oferta_cambio: el tarifario publicado del paquete cambió desde la cotización");
      if (v.rev_fuente !== of.rev_fuente || v.rev_costos !== of.rev_costos) return err("p63_oferta_cambio: una fuente, un costo, un proveedor o una retención del paquete cambió desde la cotización");
      if (args.p_huella !== of.huella || args.p_huella_financiera !== of.huella_financiera) return err("p63_oferta_cambio: el precio, el vuelo o los costos recalculados ya no coinciden con lo cotizado");
      const hoy = op.hoyBogota?.() ?? fechaNegocioHoy();
      const vigencias = ((of.snapshot as { vigencias?: { origen: string; ref: string; compra_inicio: string | null; compra_fin: string | null }[] }).vigencias ?? []);
      for (const v of vigencias) {
        if ((v.compra_inicio && hoy < v.compra_inicio) || (v.compra_fin && hoy > v.compra_fin)) {
          return err(`p63_oferta_cambio: la tarifa "${v.ref}" de ${v.origen} ya no está en su vigencia de compra`);
        }
      }
      // 234: una oferta en USD SIN TRM congela, AL ACEPTAR, la TRM provisional INGRESADA (p_trm_provisional): es OBLIGATORIA y no hay respaldo
      // en trm_referencia (ni con la llamada de cinco argumentos, donde vale NULL). Sin ella no se contrata (antes de reservar número).
      let trmProvisional: number | null = null;
      if (of.trm == null && (((of.snapshot as { moneda?: string }).moneda) || "COP") === "USD") {
        if (args.p_trm_provisional == null) return err("p63_trm_requerida: la oferta está en USD sin TRM: quien la convierte a contrato debe ingresar la TRM provisional");
        const n = Number(args.p_trm_provisional);
        if (!Number.isFinite(n) || n <= 0 || n >= 100000000000 || Math.round(n * 10000) / 10000 <= 0) return err("p63_trm_invalida: la TRM provisional debe ser un número positivo");
        trmProvisional = Math.round(n * 10000) / 10000;
      }
      const id = aceptaciones().reduce((m, a) => Math.max(m, Number(a.id) || 0), 0) + 1;
      const fila: Fila = {
        id, oferta_id: of.id, cotizacion_id: of.cotizacion_id, tenant: args.p_tenant, numero_contrato: siguienteNumero(), usuario_id: args.p_usuario,
        fecha_negocio: hoy, snapshot: of.snapshot, estado: "preparada", error: null, trm_provisional: trmProvisional,
      };
      aceptaciones().push(fila);
      of.estado = "aceptada";
      return { estado: "preparada", aceptacion_id: id, numero_contrato: fila.numero_contrato, fecha_negocio: fila.fecha_negocio, snapshot: fila.snapshot, financiero: derivado63(fila) };
    },

    registrar_comision_b2b_reserva: (args) => {
      op.alComision?.();
      const v = bd().filas("ventas").find((x) => x.numero_contrato === args.p_numero);
      if (!v) return err("El contrato no existe.");
      if (bd().filas("aliados_b2b").some((x) => x.numero_contrato === args.p_numero)) return err(`El contrato ${String(args.p_numero)} ya tiene comisión B2B.`);
      const al = bd().filas("aliados").find((x) => x.id === args.p_aliado_id);
      const pct = Number(al?.pct_comision ?? 0);
      const neta = v.modo_compra === "neta";
      const bruto = Number(v.precio_venta) + (neta ? Number(v.comision_b2b) : 0);
      const esperado = Math.round((bruto - Number(v.impuesto)) * pct);
      if (v.modo_compra && esperado !== Number(v.comision_b2b)) return err("registrar_comision_b2b_reserva: la comisión recalculada no coincide con la de la venta");
      const fila = { id: 501 + bd().filas("aliados_b2b").length, numero_contrato: v.numero_contrato, tenant: v.tenant, aliado_id: args.p_aliado_id, precio_venta: bruto, pct_comision: pct };
      bd().filas("aliados_b2b").push(fila);
      return fila.id;
    },

    crear_pasajeros_contrato_con_sillas: async () => {
      await op.alMaterializar?.();
      const falla = op.fallaPasajeros?.();
      return falla ? err(falla) : [];
    },

    registrar_financiero_contrato: (args) => {
      const numero = String(args.p_numero_contrato);
      const v = bd().filas("ventas").find((f) => f.numero_contrato === numero && f.tenant === args.p_tenant);
      if (!v) throw new Error(`registrar_financiero_contrato: el contrato ${numero} no existe en la agencia ${String(args.p_tenant)}`);
      // K15: lo primero es "ya completo".
      if (v.financiero_estado !== "pendiente") {
        bd().tablas.set("contrato_financiero_pendiente", bd().filas("contrato_financiero_pendiente").filter((p) => p.numero_contrato !== numero));
        return { creadas: [], eliminadas: [], ya_completo: true, estado: v.financiero_estado };
      }
      const costos = args.p_costos as Fila;
      const cxp = (args.p_cxp as Fila[] | undefined) ?? [];
      const a = v.aceptacion_63_id != null ? aceptaciones().find((x) => x.id === v.aceptacion_63_id) : null;
      if (v.aceptacion_63_id != null) {
        if (!a || a.estado !== "materializando") return err("registrar_financiero_contrato: la aceptación #63 no está vigente");
        const der = derivado63(a);
        if ((!vacio(costos) && !isDeepStrictEqual(costos, der.costos)) || (!vacio(cxp) && !isDeepStrictEqual(cxp, der.cxp))) {
          return err("p63_payload_alterno: el payload financiero recibido no es el de la oferta aceptada");
        }
        const pend = bd().filas("contrato_financiero_pendiente").find((p) => p.numero_contrato === numero);
        if (!pend || !isDeepStrictEqual(pend.costos, der.costos) || !isDeepStrictEqual(pend.cxp, der.cxp)) return err("p63_sin_pendiente: el payload aceptado no está guardado como pendiente");
        const cab = (a.snapshot as { cabecera: Record<string, number> }).cabecera;
        const cuenta = (t: string) => bd().filas(t).filter((f) => f.numero_contrato === numero).length;
        if (cuenta("contrato_vuelos") !== cab.n_tramos || cuenta("contrato_items") !== cab.n_items || cuenta("contrato_hoteles") !== cab.n_hoteles) {
          return err("p63_pendiente: los pasos previos del contrato no están completos");
        }
        Object.assign(v, der.costos, { financiero_estado: "completo", financiero_registrado_en: new Date().toISOString() });
        const creadas = der.cxp.map((c) => {
          const { valor_cop, trm, obligacion, ...resto } = c as Fila;
          const id = bd().filas("cuentas_por_pagar").length + 1;
          bd().filas("cuentas_por_pagar").push({
            id, numero_contrato: numero, tenant: args.p_tenant, ...resto, moneda: (c as Fila).moneda ?? "COP",
            valor_cop_63: valor_cop, trm_63: trm, aceptacion_63_id: a.id, obligacion_63: obligacion,
          });
          return { id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, servicio_id: c.servicio_id ?? null, valor_total: c.valor_total };
        });
        a.estado = "completa";
        bd().tablas.set("contrato_financiero_pendiente", bd().filas("contrato_financiero_pendiente").filter((p) => p.numero_contrato !== numero));
        return { creadas, eliminadas: [] };
      }
      // Contrato de siempre: la 210 (sin marcas #63).
      Object.assign(v, costos, { financiero_estado: "completo" });
      const creadas = cxp.map((c) => {
        const id = bd().filas("cuentas_por_pagar").length + 1;
        const { valor_cop: _vc, trm: _t, obligacion: _o, ...resto } = c;
        void _vc; void _t; void _o;
        bd().filas("cuentas_por_pagar").push({ id, numero_contrato: numero, tenant: args.p_tenant, moneda: "COP", ...resto });
        return { id, tipo_proveedor: c.tipo_proveedor, proveedor: c.proveedor, servicio: c.servicio, servicio_id: c.servicio_id ?? null, valor_total: c.valor_total };
      });
      bd().tablas.set("contrato_financiero_pendiente", bd().filas("contrato_financiero_pendiente").filter((p) => p.numero_contrato !== numero));
      return { creadas, eliminadas: [] };
    },

    revertir_contrato_incompleto: (args) => {
      const numero = String(args.p_numero_contrato);
      const v = bd().filas("ventas").find((f) => f.numero_contrato === numero);
      if (!v) return { estado: "no_existe" };
      if (v.financiero_estado === "completo" && v.financiero_registrado_en) return { estado: "ya_completo" };
      for (const t of ["ventas", "contrato_items", "contrato_hoteles", "contrato_vuelos", "contrato_pasajeros", "contrato_servicios", "aliados_b2b", "cuentas_por_pagar", "contrato_financiero_pendiente"]) {
        bd().tablas.set(t, bd().filas(t).filter((f) => f.numero_contrato !== numero));
      }
      const a = v.aceptacion_63_id != null ? aceptaciones().find((x) => x.id === v.aceptacion_63_id) : null;
      if (a && a.estado !== "completa") {
        a.estado = "descartada";
        const of = ofertas().find((o) => o.id === a.oferta_id);
        if (of && of.estado === "aceptada") of.estado = "abierta";
      }
      return { estado: "revertido" };
    },
  };
}

/** Espeja `trg_ventas_aceptacion_63_ins`: un número reservado solo lo crea el intento vigente, con los valores aceptados. */
export function instalarFencing63(bd: BD) {
  const from0 = bd.sb.from.bind(bd.sb);
  bd.sb.from = ((tabla: string) => {
    const b = from0(tabla) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (tabla !== "ventas") return b;
    const insertar = b.insert.bind(b);
    b.insert = (payload: unknown) => {
      const fila = (Array.isArray(payload) ? payload[0] : payload) as Fila;
      const rechazo = (message: string) => ({ then: (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message } }).then(res) });
      const a = bd.filas("p63_aceptacion").find((x) => x.numero_contrato === fila.numero_contrato);
      if (!a) return fila.aceptacion_63_id != null ? rechazo("p63_cabecera: la aceptación no existe") : insertar(payload);
      if (fila.aceptacion_63_id !== a.id) return rechazo("p63_cabecera: el número está reservado por una aceptación #63");
      if (a.estado !== "preparada") return rechazo(`p63_cabecera: el intento no está vigente (estado ${String(a.estado)})`);
      const c = (a.snapshot as { cabecera: Record<string, unknown> }).cabecera;
      const dif: string[] = [];
      for (const k of ["tipo_paquete", "moneda", "fecha_salida", "fecha_regreso", "pax", "destino", "hotel", "plan_nombre", "aerolinea", "paquete_armado_id"]) {
        if ((fila[k] ?? null) !== (c[k] ?? null)) dif.push(k);
      }
      if (Number(fila.impuesto ?? 0) !== Number(c.impuesto ?? 0)) dif.push("impuesto");
      if (Number(fila.costo_aereo ?? 0) !== Number(c.costo_aereo ?? 0)) dif.push("costo_aereo");
      // Plan B2B ACEPTADO (snapshot.b2b): la cabecera se contrasta contra ESE valor, no contra un recálculo con el % de hoy.
      if ((fila.tipo_asesor ?? null) !== (c.tipo_asesor ?? null)) dif.push("tipo_asesor");
      if ((fila.canal ?? null) !== (c.canal ?? null)) dif.push("canal");
      const b2b = (a.snapshot as { b2b?: Record<string, unknown> | null }).b2b ?? null;
      if (b2b) {
        if ((fila.aliado_id ?? null) !== (b2b.aliado_id ?? null)) dif.push("aliado");
        if ((fila.modo_compra ?? null) !== (b2b.modo_compra ?? null)) dif.push("modo_compra");
        if ((fila.comision_b2b ?? null) !== (b2b.comision ?? null)) dif.push("comision_b2b");
        if ((fila.comision_estado ?? null) !== (b2b.comision_estado ?? null)) dif.push("comision_estado");
        if (Number(fila.precio_venta) !== Number(b2b.precio_final)) dif.push("precio_venta");
      } else {
        if (fila.aliado_id != null || fila.modo_compra != null || fila.comision_b2b != null || fila.comision_estado != null) dif.push("b2b");
        if (Number(fila.precio_venta) !== Number(c.precio_venta)) dif.push("precio_venta");
      }
      if (dif.length) return rechazo(`p63_cabecera: la cabecera no coincide con lo aceptado (${dif.join(" ")})`);
      a.estado = "materializando";
      return insertar(payload);
    };
    return b;
  }) as unknown as typeof bd.sb.from;
}
