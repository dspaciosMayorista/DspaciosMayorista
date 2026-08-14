import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMoneda, formatFechaLarga } from "@/lib/utils";
import { ShareButtons } from "./ShareButtons";
import { GestionTabs } from "./GestionTabs";
import { EstadoVenta } from "./EstadoVenta";
import { EditarVentaForm } from "./EditarVentaForm";
import { ServiciosContratoEditor, type ServicioDispContrato } from "./ServiciosContratoEditor";
import { AdjuntosContrato, type Adjunto } from "./AdjuntosContrato";
import { VouchersPanel, type VoucherRow } from "./VouchersPanel";
import { type CuotaRow } from "./PlanCobroPanel";
import { EditarAsesorPasajeros, type PasajeroRow } from "./EditarAsesorPasajeros";
import { EliminarContrato } from "./EliminarContrato";
import { ContenidoContratoEditor } from "./ContenidoContratoEditor";
import { Eye } from "lucide-react";
import { fiscalFromParams } from "@/lib/calc/finanzas";
import { sumarRetencionesPorCuenta } from "@/lib/finanzas/retenciones";

export const dynamic = "force-dynamic";

export default async function ContratoDetallePage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero: raw } = await params;
  const numero = decodeURIComponent(raw);
  const sb = await createClient();

  const { data: { user } } = await sb.auth.getUser();
  const { data: perfil } = user
    ? await sb.from("usuarios").select("rol").eq("id", user.id).single()
    : { data: null };
  const verFinanzas = ["superadmin", "gerencia", "administracion", "operaciones"].includes(perfil?.rol ?? "");
  const esSuperadmin = perfil?.rol === "superadmin";

  // ¿Este contrato es MÍO? Se le pregunta a la base con la MISMA función que
  // usan las policies (`soy_asesor_del_contrato`), no se reimplementa aquí: si
  // algún día cambia la regla de propiedad, cambia en un solo lugar y la
  // pantalla la sigue. Deliberadamente NO se deduce de `share_token` (que la
  // vista entrega solo al dueño) ni comparando `venta.asesor` con el nombre del
  // perfil: lo primero convierte un dato de presentación en control de acceso,
  // y lo segundo es comparación de texto libre — homónimos, tildes y los
  // nombres en mayúsculas del importador de minorista la hacen poco fiable.
  // Es SECURITY DEFINER y devuelve solo un booleano sobre uno mismo.
  const { data: esAsesorDelContrato } = await sb.rpc("soy_asesor_del_contrato", { num: numero });

  // Un asesor consulta los contratos de toda su agencia (regla de negocio de la
  // migración 147) pero solo GESTIONA los suyos. Los roles administrativos
  // conservan su operación completa.
  const puedeEditar = verFinanzas || esAsesorDelContrato === true;
  const soloLectura = !puedeEditar;

  const [
    { data: venta },
    { data: abonos },
    { data: cxp },
    { data: b2b },
    { data: facturas },
    { data: asesores },
    { data: formasPagoRows },
    { data: adjuntos },
    { data: vouchers },
    { data: cuotas },
    { data: pasajerosC },
    { data: asesoresVenta },
    { data: destinos },
    { data: proveedoresCatalogo },
    { data: aliadosCatalogo },
  ] = await Promise.all([
    // Migración 144: quien NO tiene acceso financiero lee la vista sin
    // columnas de costo. El rol `venta` ya no puede leer la tabla base — ese
    // es el candado real; esto solo es la consulta que sí le funciona.
    (verFinanzas
      ? sb.from("ventas").select("*").eq("numero_contrato", numero).single()
      : sb.from("ventas_basica").select("*").eq("numero_contrato", numero).single()),
    // Detalle de pagos SOLO de contratos propios (o de un rol contable): la
    // policy de la migración 148 exige `soy_asesor_del_contrato`. En un
    // contrato ajeno esta consulta devuelve vacío por RLS; el total sale del
    // resumen de abajo.
    (puedeEditar
      ? sb.from("abonos").select("id, valor_abono, forma_pago, referencia, fecha_abono, trm, monto_cop").eq("numero_contrato", numero).order("fecha_abono", { ascending: false })
      : Promise.resolve({ data: [] as Pick<Database["public"]["Tables"]["abonos"]["Row"], "id" | "valor_abono" | "forma_pago" | "referencia" | "fecha_abono" | "trm" | "monto_cop">[] })),
    sb.from("cuentas_por_pagar").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("aliados_b2b").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("facturacion").select("*").eq("numero_contrato", numero).order("id"),
    sb.from("asesores").select("nombre, email, pct_comision_base"),
    sb.from("formas_pago").select("nombre").order("orden"),
    sb.from("contrato_adjuntos").select("id, tipo, nombre, path, size_bytes, subido_por, created_at").eq("numero_contrato", numero).order("created_at", { ascending: false }),
    sb.from("vouchers").select("id, tipo, proveedor, share_token, contenido").eq("numero_contrato", numero).order("id"),
    sb.from("cuotas").select("id, orden, tipo, fecha_limite, monto").eq("numero_contrato", numero).order("orden"),
    sb.from("contrato_pasajeros").select("id, nombre, tipo_id, identificacion, fecha_nacimiento, es_infante").eq("numero_contrato", numero).order("orden"),
    sb.from("usuarios").select("nombre, email").eq("rol", "venta").eq("activo", true).order("nombre"),
    sb.from("destinos").select("id, nombre, codigo_iata").order("nombre"),
    sb.from("proveedores").select("nombre").order("nombre"),
    sb.from("aliados").select("id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion").order("nombre"),
  ]);

  // Contenido del contrato (hoteles/vuelos/ítems/servicios) para el editor de
  // superadmin. Los contratos migrados llegan sin nada de esto, así que casi
  // siempre vienen vacíos: el editor es justo para poder completarlos.
  //
  // Solo se consulta si quien mira es superadmin, que es el único que ve el
  // editor (más abajo, `{esSuperadmin && <ContenidoContratoEditor .../>}`).
  // Antes se pedía siempre: para un asesor `contrato_servicios` ya devolvía
  // vacío por RLS (tiene el costo neto) y desde la 148 `contrato_vuelos`
  // también — cuatro consultas cuyo resultado nadie llegaba a mostrar.
  const [{ data: itemsC }, { data: hotelesC }, { data: vuelosC }, { data: serviciosC }] = esSuperadmin
    ? await Promise.all([
        sb.from("contrato_items").select("descripcion, adultos, ninos, tarifa_adulto, tarifa_nino").eq("numero_contrato", numero).order("orden"),
        sb.from("contrato_hoteles").select("nombre, categoria, proveedor, ciudad, alimentacion, acomodacion, detalle_acomodacion, fecha_ingreso, fecha_salida").eq("numero_contrato", numero).order("orden"),
        sb.from("contrato_vuelos").select("aerolinea, record, direccion, origen_codigo, destino_codigo, numero_vuelo, fecha_salida, hora_salida, hora_llegada, servicios").eq("numero_contrato", numero).order("orden"),
        sb.from("contrato_servicios").select("tipo, descripcion, proveedor, costo").eq("numero_contrato", numero).order("orden"),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];
  const formasPago = (formasPagoRows ?? []).map((f) => f.nombre);

  // Ítems de las facturas del contrato, agrupados por factura.
  const facturaIds = (facturas ?? []).map((f) => f.id);
  const itemsPorFactura: Record<number, { descripcion: string | null; valor: number; gravable: boolean }[]> = {};
  if (facturaIds.length) {
    const { data: fItems } = await sb
      .from("factura_items")
      .select("factura_id, descripcion, valor, gravable, orden")
      .in("factura_id", facturaIds)
      .order("orden");
    for (const it of fItems ?? []) {
      (itemsPorFactura[it.factura_id] ??= []).push({ descripcion: it.descripcion, valor: it.valor, gravable: it.gravable });
    }
  }
  const facturasConItems = (facturas ?? []).map((f) => ({ ...f, items: itemsPorFactura[f.id] ?? [] }));

  // Retenciones practicadas por CxP (se descuentan del saldo, igual que un abono).
  const cxpIds = (cxp ?? []).map((c) => c.id);
  const [{ data: retenciones }, { data: pagosCxp }] = cxpIds.length
    ? await Promise.all([
        sb.from("retenciones_cxp").select("cuenta_por_pagar_id, valor").in("cuenta_por_pagar_id", cxpIds),
        sb.from("cxp_pagos").select("id, cuenta_por_pagar_id, fecha, valor, trm").in("cuenta_por_pagar_id", cxpIds).order("fecha").order("id"),
      ])
    : [{ data: [] }, { data: [] }];
  const retenidoPorCuenta = sumarRetencionesPorCuenta(
    (retenciones ?? []).map((r) => ({ cuenta_por_pagar_id: r.cuenta_por_pagar_id as number, valor: Number(r.valor) || 0 }))
  );
  const pagosPorCuenta = new Map<number, { id: number; fecha: string; valor: number; trm: number | null }[]>();
  for (const p of pagosCxp ?? []) {
    const arr = pagosPorCuenta.get(p.cuenta_por_pagar_id) ?? [];
    arr.push({ id: p.id, fecha: p.fecha, valor: Number(p.valor) || 0, trm: p.trm });
    pagosPorCuenta.set(p.cuenta_por_pagar_id, arr);
  }
  const cxpConRetencion = (cxp ?? []).map((c) => ({
    ...c,
    retenido: retenidoPorCuenta[c.id] ?? 0,
    pagos: pagosPorCuenta.get(c.id) ?? [],
  }));

  const { data: paramsRows } = await sb.from("parametros_tributarios").select("parametro, valor");
  const fiscal = fiscalFromParams(paramsRows ?? []);

  if (!venta) notFound();

  // Datos financieros del contrato (costos, impuesto). Solo existen si quien
  // mira tiene acceso financiero: la consulta de arriba trae la vista
  // `ventas_basica` para los demás, que NO incluye estas columnas. Se separa en
  // su propia variable para que TypeScript impida leerlas por descuido — si un
  // día alguien las pinta sin gate, el build falla en vez de filtrarlas.
  const fin = verFinanzas
    ? (venta as Database["public"]["Tables"]["ventas"]["Row"])
    : null;

  // Servicios del paquete (para editar los add-ons de un contrato PENDIENTE).
  let serviciosDisp: ServicioDispContrato[] = [];
  let seleccionServicios: number[] = [];
  if (venta.estado === "pendiente" && venta.paquete_armado_id) {
    const [{ data: servFilas }, { data: itemsServ }] = await Promise.all([
      sb.from("tarifario_resultado").select("servicio_id, servicio_nombre, tipo_tarifa, pax_desde, pax_hasta, precio_pvp").eq("paquete_id", venta.paquete_armado_id).eq("modulo", "servicios"),
      sb.from("contrato_items").select("descripcion").eq("numero_contrato", numero),
    ]);
    const map = new Map<number, ServicioDispContrato>();
    for (const r of servFilas ?? []) {
      if (r.servicio_id == null) continue;
      let s = map.get(r.servicio_id);
      if (!s) { s = { servicioId: r.servicio_id, nombre: r.servicio_nombre ?? "—", modo: r.tipo_tarifa === "grupo" ? "grupo" : "persona", personaPvp: null, grupos: [] }; map.set(r.servicio_id, s); }
      if (s.modo === "grupo") s.grupos.push({ pax_desde: r.pax_desde ?? 1, pax_hasta: r.pax_hasta ?? 1, precio: r.precio_pvp });
      else s.personaPvp = r.precio_pvp;
    }
    serviciosDisp = [...map.values()];
    const nombresSel = new Set((itemsServ ?? []).filter((it) => it.descripcion?.startsWith("Servicio · ")).map((it) => it.descripcion!.replace(/^Servicio · /, "")));
    seleccionServicios = serviciosDisp.filter((s) => nombresSel.has(s.nombre)).map((s) => s.servicioId);
  }

  // Saldo en modo solo lectura: el asesor que cubre a un colega necesita saber
  // cuánto ha pagado el cliente, no CÓMO lo pagó. `abonos_resumen` es una vista
  // agregada — solo número de contrato y total —, así que no hay forma de pago,
  // referencia bancaria ni comprobante que pudieran llegar de más.
  const { data: resumenAbonos } = puedeEditar
    ? { data: null }
    : await sb.from("abonos_resumen").select("total_pagado").eq("numero_contrato", numero).maybeSingle();

  const totalPagado = puedeEditar
    ? (abonos ?? []).reduce((s, a) => s + (a.valor_abono ?? 0), 0)
    : Number(resumenAbonos?.total_pagado ?? 0);
  const saldo = Math.max(venta.precio_venta - totalPagado, 0);

  // Buscar el % de comisión del asesor (por email o por nombre de firma)
  const asesorNombre = venta.asesor_firma_nombre ?? venta.asesor ?? "";
  const asesorRow = (asesores ?? []).find(
    (a) => a.email === venta.asesor || a.nombre === asesorNombre
  );
  const asesorPct = asesorRow?.pct_comision_base ?? 0.08;

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link href="/dashboard/contratos" className="text-sm text-gray-400 hover:text-gray-600">
        ← Contratos
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold text-gray-900">{venta.numero_contrato}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {venta.cliente} · {venta.destino ?? "—"} · Viaje {formatFechaLarga(venta.fecha_salida)}
          </p>
          <div className="mt-2">
            <EstadoVenta numero={venta.numero_contrato} estado={venta.estado} plazo={venta.plazo} puedeConfirmar={verFinanzas} />
          </div>
        </div>
        {/* En solo lectura el documento sale incompleto por RLS (sin pasajeros,
            sin dirección del cliente, sin datos de firma), así que no se ofrece
            como "el contrato": se rotula por lo que de verdad es. */}
        <Link href={`/contrato/${encodeURIComponent(numero)}`} target="_blank">
          <Button style={{ backgroundColor: soloLectura ? "#6b7280" : "var(--brand-primary)" }}>
            {soloLectura ? "Vista comercial →" : "Ver / Imprimir contrato →"}
          </Button>
        </Link>
      </div>

      {/* Aviso de solo lectura. Va arriba del todo para que el asesor entienda
          por qué no ve los controles de siempre, en vez de creer que la
          pantalla se dañó. */}
      {soloLectura && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Solo lectura — contrato de otro asesor</p>
            <p className="mt-0.5 text-amber-800">
              Puedes consultar la información comercial para atender al cliente. La gestión
              (abonos, adjuntos, pasajeros y vouchers) la hace {venta.asesor ?? "el asesor del contrato"}.
            </p>
          </div>
        </div>
      )}

      {/* Totales */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl p-4 text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
          <div className="text-xs opacity-80">Precio de venta{venta.moneda && venta.moneda !== "COP" ? ` (${venta.moneda})` : ""}</div>
          <div className="text-xl font-bold">{formatMoneda(venta.precio_venta, venta.moneda)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Total pagado</div>
          <div className="text-xl font-bold" style={{ color: "var(--brand-success)" }}>{formatMoneda(totalPagado, venta.moneda)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs text-gray-400">Saldo pendiente</div>
          <div className="text-xl font-bold text-gray-800">{formatMoneda(saldo, venta.moneda)}</div>
        </div>
      </div>

      {/* Editar datos del contrato. Solo para quien de verdad puede: la policy
          de UPDATE sobre `ventas` excluye al rol `venta`, así que mostrarle el
          formulario solo servía para que guardar le fallara con un error de
          RLS. Además `cliente_direccion` y `observaciones` salieron de la vista
          `ventas_basica` en la migración 147 (datos sensibles), así que ni
          siquiera podría precargarlos. */}
      {fin && (
        <EditarVentaForm
          numero={venta.numero_contrato}
          inicial={{
            cliente: venta.cliente ?? "",
            clienteDocumento: venta.cliente_documento ?? "",
            clienteTelefono: venta.cliente_telefono ?? "",
            clienteEmail: venta.cliente_email ?? "",
            clienteDireccion: fin.cliente_direccion ?? "",
            destino: venta.destino ?? "",
            fechaSalida: venta.fecha_salida ?? "",
            fechaRegreso: venta.fecha_regreso ?? "",
            plazo: venta.plazo ?? "",
            tipoAsesor: venta.tipo_asesor ?? "interno",
            agenciaNombre: venta.agencia_nombre ?? "",
            agenciaAsesor: venta.agencia_asesor ?? "",
            freelanceNombre: venta.freelance_nombre ?? "",
            asesorNombre: venta.asesor_firma_nombre ?? "",
            planNombre: venta.plan_nombre ?? "",
            observaciones: fin.observaciones ?? "",
            precioVenta: String(venta.precio_venta ?? 0),
            pax: String(venta.pax ?? 1),
          }}
          destinos={destinos ?? []}
        />
      )}

      {/* Servicios adicionales (solo contrato pendiente, y solo quien gestiona) */}
      {venta.estado === "pendiente" && puedeEditar && (
        <ServiciosContratoEditor
          numero={venta.numero_contrato}
          pax={venta.pax ?? 0}
          serviciosDisp={serviciosDisp}
          seleccionInicial={seleccionServicios}
        />
      )}

      {/* Compartir */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 text-sm font-semibold text-gray-700">Compartir con el cliente</p>
        {venta.share_token ? (
          <ShareButtons token={venta.share_token} numero={venta.numero_contrato} cliente={venta.cliente} />
        ) : (
          // Migración 147: el enlace público solo se entrega para el contrato
          // PROPIO. Con el token de un contrato ajeno se podía abrir
          // /c/[token], que es pública y muestra los pasajeros con su
          // documento y fecha de nacimiento.
          <p className="text-xs text-gray-400">El enlace para el cliente solo lo genera el asesor del contrato.</p>
        )}
      </div>

      {/* Flujo de la venta */}
      <GestionTabs
        numero={numero}
        precioVenta={venta.precio_venta}
        impuesto={fin?.impuesto ?? 0}
        clienteNombre={venta.cliente ?? ""}
        clienteDocumento={venta.cliente_documento ?? ""}
        asesorNombre={asesorNombre}
        asesorPct={asesorPct}
        fiscal={fiscal}
        verFinanzas={verFinanzas}
        costos={{
          costo_hotel: fin?.costo_hotel ?? 0,
          costo_aereo: fin?.costo_aereo ?? 0,
          costo_receptivo: fin?.costo_receptivo ?? 0,
          costo_asistencia: fin?.costo_asistencia ?? 0,
          otros_costos: fin?.otros_costos ?? 0,
        }}
        abonos={abonos ?? []}
        cuotas={(cuotas ?? []) as unknown as CuotaRow[]}
        totalPagado={totalPagado}
        cuentasPorPagar={cxpConRetencion}
        comisionesB2B={b2b ?? []}
        facturas={facturasConItems}
        formasPago={formasPago}
        moneda={(venta.moneda as string) ?? "COP"}
        proveedoresCatalogo={(proveedoresCatalogo ?? []).map((p) => p.nombre)}
        aliadosCatalogo={aliadosCatalogo ?? []}
        puedeEditar={puedeEditar}
      />

      <AdjuntosContrato numeroContrato={numero} adjuntos={(adjuntos ?? []) as Adjunto[]} puedeEditar={puedeEditar} />

      <EditarAsesorPasajeros
        numero={numero}
        asesores={asesoresVenta ?? []}
        asesorActual={venta.asesor_firma_nombre ?? venta.asesor ?? ""}
        puedeAsesor={verFinanzas}
        pasajeros={(pasajerosC ?? []) as unknown as PasajeroRow[]}
        fechaSalida={venta.fecha_salida}
        pax={venta.pax ?? 0}
        titularNombre={venta.cliente ?? ""}
        puedeEditar={puedeEditar}
      />

      <VouchersPanel
        numero={numero}
        vouchers={(vouchers ?? []) as unknown as VoucherRow[]}
        puedeGenerar={(esSuperadmin || saldo <= 0) && puedeEditar}
        destinos={destinos ?? []}
        puedeEditar={puedeEditar}
      />

      {esSuperadmin && (
        <ContenidoContratoEditor
          numero={numero}
          moneda={venta.moneda ?? "COP"}
          precioVenta={venta.precio_venta ?? 0}
          items={(itemsC ?? []).map((i) => ({
            descripcion: i.descripcion ?? "", adultos: i.adultos ?? 0, ninos: i.ninos ?? 0,
            tarifaAdulto: i.tarifa_adulto ?? 0, tarifaNino: i.tarifa_nino ?? 0,
          }))}
          hoteles={(hotelesC ?? []).map((h) => ({
            nombre: h.nombre ?? "", categoria: h.categoria ?? "", proveedor: h.proveedor ?? "",
            ciudad: h.ciudad ?? "", alimentacion: h.alimentacion ?? "", acomodacion: h.acomodacion ?? "",
            detalleAcomodacion: h.detalle_acomodacion ?? "",
            fechaIngreso: h.fecha_ingreso ?? "", fechaSalida: h.fecha_salida ?? "",
          }))}
          vuelos={(vuelosC ?? []).map((v) => ({
            aerolinea: v.aerolinea ?? "", record: v.record ?? "", direccion: v.direccion ?? "",
            origenCodigo: v.origen_codigo ?? "", destinoCodigo: v.destino_codigo ?? "",
            numeroVuelo: v.numero_vuelo ?? "", fecha: v.fecha_salida ?? "",
            horaSalida: v.hora_salida ?? "", horaLlegada: v.hora_llegada ?? "", servicios: v.servicios ?? "",
          }))}
          servicios={(serviciosC ?? []).map((s) => ({
            tipo: s.tipo ?? "otro", descripcion: s.descripcion ?? "",
            proveedor: s.proveedor ?? "", costo: s.costo ?? 0,
          }))}
        />
      )}

      {esSuperadmin && <EliminarContrato numero={numero} />}
    </div>
  );
}
