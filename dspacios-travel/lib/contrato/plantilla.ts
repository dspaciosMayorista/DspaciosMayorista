// ─────────────────────────────────────────────────────────────────────────
// Plantilla del Contrato de Servicios Turísticos — PARTE FIJA
// ─────────────────────────────────────────────────────────────────────────
// Texto legal transcrito literalmente del contrato real (ref. 00-00481).
// Vive como constante/plantilla, NO en base de datos (ver ANEXO §D), para
// poder versionarlo si cambia el clausulado.
//
// Aquí solo está lo CONSTANTE de todos los contratos:
//   - datos de la empresa,
//   - encabezado legal + las 18 cláusulas,
//   - constancia, firma y copyright.
// Los campos DINÁMICOS (cliente, vuelos, hoteles, pasajeros, valores, asesor
// que firma, fechas) se inyectan al generar cada PDF desde la venta.
// ─────────────────────────────────────────────────────────────────────────

/** Versión del clausulado. Subir cuando cambie el texto legal. */
export const VERSION_PLANTILLA = "2025.1";

/** Datos de la empresa — fijos en todos los contratos (ANEXO §A). */
export const EMPRESA = {
  razonSocial: "D’Spacios Travel S.A.S.",
  nit: "901.654.224",
  rnt: "147090",
  sitio: "Dspaciostravel.com",
  correo: "contacto@dspaciostravel.com",
  ciudadEmision: "Medellín, Antioquia",
  cuentaBancaria: {
    banco: "Bancolombia",
    tipo: "cuenta corriente",
    numero: "277-000056-23",
    titular: "D’Spacios Travel S.A.S.",
  },
} as const;

/** Título del bloque legal. */
export const CONTRATO_TITULO = "CONTRATO DE PRESTACIÓN DE SERVICIOS TURÍSTICOS";

/** Párrafo introductorio fijo, justo antes de las cláusulas. */
export const CONTRATO_INTRO =
  "Entre el CLIENTE, identificado con los datos descritos en la sección correspondiente, y " +
  "D’Spacios Travel S.A.S., sociedad legalmente constituida y registrada en Colombia, se celebra " +
  "el presente contrato de prestación de servicios turísticos, el cual se regirá por las siguientes " +
  "cláusulas y condiciones:";

export interface ClausulaContrato {
  numero: number;
  titulo: string;
  /** Cada elemento es un párrafo o ítem literal, en orden. */
  parrafos: string[];
}

/** Las 18 cláusulas — texto fijo transcrito del contrato 00-00481. */
export const CLAUSULAS: ClausulaContrato[] = [
  {
    numero: 1,
    titulo: "Objeto del Contrato",
    parrafos: [
      "El presente contrato tiene por objeto regular la prestación de servicios turísticos por parte de D’SPACIOS TRAVEL al CLIENTE, que incluyen, según el caso, reservas aéreas, hoteleras, terrestres, navieras, excursiones y demás servicios complementarios contratados. Los servicios serán prestados por proveedores debidamente habilitados, y D’SPACIOS TRAVEL actuará como intermediario entre el CLIENTE y dichos proveedores.",
    ],
  },
  {
    numero: 2,
    titulo: "Obligaciones de D’Spacios Travel",
    parrafos: [
      "a) Entregar los servicios turísticos contratados, o en su defecto, otros de igual o superior categoría, cuando el CLIENTE haya efectuado el pago total del plan.",
      "b) Gestionar reembolsos o cambios únicamente en los casos en que los proveedores lo permitan, aplicando las penalidades correspondientes.",
      "c) Reembolsar los valores recibidos al CLIENTE únicamente cuando D’SPACIOS TRAVEL cancele el viaje por fuerza mayor o caso fortuito, o bien ofrecer un servicio equivalente.",
      "d) Mantener la confidencialidad de los datos personales del CLIENTE conforme a la normatividad vigente.",
    ],
  },
  {
    numero: 3,
    titulo: "Obligaciones del Cliente",
    parrafos: [
      "a) No responsabilizar a D’SPACIOS TRAVEL por gastos, servicios o consumos no incluidos en este contrato.",
      "b) Efectuar los pagos en pesos colombianos; para planes internacionales, el cálculo se hará con base en la TRM vigente al día del pago total.",
      "c) Cumplir con las políticas, reglamentos y condiciones de los proveedores (aerolíneas, hoteles, navieras, transportes, tours, etc.).",
      "d) Realizar abonos periódicos o quincenales desde la firma del contrato para garantizar la reserva.",
      "e) Tener totalmente cancelado el plan turístico al menos 30 días antes de la salida (temporada baja) o 60 días antes (temporada alta o cruceros).",
      "f) Solicitar cambios de fecha con al menos 30 días de anticipación, asumiendo las penalidades o diferencias tarifarias que impongan los proveedores.",
      "g) Suministrar correctamente los nombres y datos personales conforme a documentos oficiales.",
    ],
  },
  {
    numero: 4,
    titulo: "Precio y Formas de Pago",
    parrafos: [
      "a) El CLIENTE pagará el valor total del plan en la cuenta corriente Bancolombia No. 277-000056-23 a nombre de D’SPACIOS TRAVEL S.A.S.",
      "b) El abono inicial deberá cubrir el valor de los tiquetes aéreos (si aplica) o el 30% del valor total del contrato.",
      "c) El saldo restante deberá cancelarse exclusivamente en la cuenta indicada, de acuerdo con las fechas pactadas.",
      "d) El CLIENTE reconoce que los pagos efectuados por fuera de las cuentas oficiales de la agencia no serán válidos ni reconocidos por D’SPACIOS TRAVEL.",
    ],
  },
  {
    numero: 5,
    titulo: "Penalidades por cancelación o no show",
    parrafos: [
      "En caso de cancelación del viaje, se aplicarán las siguientes penalidades sobre el valor total del plan:",
      "- Con más de 30 días de anticipación: 25%",
      "- Entre 20 y 30 días: 40%",
      "- Menos de 20 días o no presentación (“no show”): 100% del valor del servicio.",
      "Estas penalidades son independientes de las que apliquen los proveedores (aerolíneas, hoteles, navieras, etc.).",
    ],
  },
  {
    numero: 6,
    titulo: "Garantía de viaje / reprogramación sin penalidad",
    parrafos: [
      "El CLIENTE podrá reprogramar su viaje sin penalidad en caso de enfermedad comprobada, calamidad familiar o eventos de fuerza mayor que le impidan viajar, siempre que notifique a D’SPACIOS TRAVEL dentro de los ocho (8) días calendario siguientes al hecho y asuma los costos de reajuste tarifario según la nueva fecha.",
    ],
  },
  {
    numero: 7,
    titulo: "Terminación y reembolsos",
    parrafos: [
      "a) Si transcurridos treinta (30) días calendario antes de la fecha del viaje el CLIENTE no ha pagado la totalidad del valor, se entenderá que desiste del contrato, y los valores abonados se considerarán arras confirmatorias no reembolsables según el artículo 1859 del Código Civil.",
      "b) D’SPACIOS TRAVEL podrá dar por terminado el contrato con justa causa si el CLIENTE incumple los plazos de pago.",
      "c) En caso de enfermedad o calamidad comprobable, el CLIENTE podrá solicitar a los proveedores la devolución según sus políticas. D’SPACIOS TRAVEL no será responsable por reintegros ni compensaciones de dichos servicios.",
      "d) Todo reembolso estará sujeto a las condiciones, penalidades y tiempos definidos por los proveedores.",
    ],
  },
  {
    numero: 8,
    titulo: "Responsabilidad",
    parrafos: [
      "a) D’SPACIOS TRAVEL actúa como intermediario, por lo cual no es responsable por retrasos, cambios de itinerario, cancelaciones o incumplimientos de aerolíneas, navieras, hoteles, operadores o transportistas.",
      "b) Los horarios de vuelos y servicios son responsabilidad exclusiva de los proveedores.",
      "c) D’SPACIOS TRAVEL queda exonerado de responsabilidad por causas de fuerza mayor o caso fortuito, tales como fenómenos naturales, conflictos, pandemias, decisiones gubernamentales o situaciones de orden público.",
      "d) El CLIENTE se compromete a presentarse en el aeropuerto con 3 horas de anticipación para vuelos internacionales y 2 horas para nacionales.",
      "e) El CLIENTE debe adquirir un seguro o asistencia médica de viaje; si decide no hacerlo, exime expresamente a D’SPACIOS TRAVEL de toda responsabilidad derivada de eventos médicos o emergencias.",
    ],
  },
  {
    numero: 9,
    titulo: "Declaración de veracidad y prevención de lavado de activos",
    parrafos: [
      "El CLIENTE declara bajo la gravedad de juramento que los fondos utilizados para la compra de los servicios turísticos provienen de actividades lícitas y que no están relacionados con lavado de activos, financiación del terrorismo o actividades ilícitas. D’SPACIOS TRAVEL podrá dar por terminado el contrato sin indemnización si identifica indicios de actividades irregulares o incumplimiento de esta obligación.",
    ],
  },
  {
    numero: 10,
    titulo: "Exoneración por documentación o requisitos migratorios",
    parrafos: [
      "El CLIENTE es el único responsable de contar con la documentación y requisitos migratorios o sanitarios exigidos (pasaporte, visas, vacunas, permisos de salida de menores, etc.). D’SPACIOS TRAVEL no asume responsabilidad si el CLIENTE o alguno de sus acompañantes no puede viajar por carecer de dichos documentos o incumplir las exigencias de las autoridades.",
    ],
  },
  {
    numero: 11,
    titulo: "Garantía legal del servicio",
    parrafos: [
      "El término de garantía de los servicios turísticos será de quince (15) días calendario posteriores a la finalización del viaje, tiempo durante el cual el CLIENTE podrá presentar reclamaciones directas ante D’SPACIOS TRAVEL.",
    ],
  },
  {
    numero: 12,
    titulo: "Compromiso de protección infantil y ética",
    parrafos: [
      "D’SPACIOS TRAVEL rechaza de forma expresa toda práctica de explotación sexual o comercial de niños, niñas y adolescentes, conforme a la Ley 679 de 2001 y la Ley 1336 de 2009. El CLIENTE se compromete a cumplir con estas disposiciones y con las normas de respeto y comportamiento durante el desarrollo de los servicios turísticos.",
    ],
  },
  {
    numero: 13,
    titulo: "Veracidad de los datos del cliente",
    parrafos: [
      "El CLIENTE declara que la información y datos personales suministrados son verídicos, completos y actualizados. Cualquier error u omisión que afecte la prestación del servicio exime a D’SPACIOS TRAVEL de responsabilidad y de los costos derivados de su corrección.",
    ],
  },
  {
    numero: 14,
    titulo: "Declaración de perfeccionamiento del contrato",
    parrafos: [
      "El presente contrato se perfecciona desde el primer pago realizado por el CLIENTE y la confirmación de la reserva por parte de D’SPACIOS TRAVEL. Los servicios se ejecutarán únicamente cuando el valor total del plan haya sido cancelado dentro de los plazos establecidos.",
    ],
  },
  {
    numero: 15,
    titulo: "Protección de datos personales",
    parrafos: [
      "En cumplimiento de la Ley 1581 de 2012 y sus decretos reglamentarios, D’SPACIOS TRAVEL informa al CLIENTE que los datos personales suministrados serán tratados conforme a su Política de Protección de Datos, con el fin de gestionar reservas, pagos, comunicaciones y ofertas comerciales. El CLIENTE podrá ejercer sus derechos de acceso, corrección, supresión o revocatoria enviando su solicitud al correo contacto@dspaciostravel.com.",
    ],
  },
  {
    numero: 16,
    titulo: "Jurisdicción y ley aplicable",
    parrafos: [
      "El presente contrato se regirá por las leyes de la República de Colombia. Cualquier controversia se resolverá en la jurisdicción ordinaria de Medellín, Antioquia.",
    ],
  },
  {
    numero: 17,
    titulo: "Aceptación por medio de pago",
    parrafos: [
      "El CLIENTE acepta que la realización de cualquier pago (abono o pago total) a las cuentas oficiales de D’SPACIOS TRAVEL S.A.S. implica su aceptación expresa, inequívoca y definitiva de todos los términos y condiciones contenidos en este contrato. El CLIENTE autoriza a D’SPACIOS TRAVEL a considerar el comprobante, recibo o registro de la transacción como prueba de la celebración y aceptación del contrato, así como del contenido de las obligaciones pactadas.",
    ],
  },
  {
    numero: 18,
    titulo: "Contrato digital y compromiso ambiental",
    parrafos: [
      "D’SPACIOS TRAVEL S.A.S. promueve el cuidado del medio ambiente y la reducción del uso de papel en sus operaciones. En consecuencia, el presente contrato se emite y envía únicamente en formato digital, siendo válido en todos sus efectos legales conforme a la Ley 527 de 1999 sobre mensajes de datos y comercio electrónico. El CLIENTE podrá conservar su copia electrónica y solicitarla nuevamente a través del correo contacto@dspaciostravel.com en caso de requerirla. Se solicita a las partes no imprimir este documento, contribuyendo así a la protección de los recursos naturales y a las políticas de sostenibilidad de D’SPACIOS TRAVEL.",
    ],
  },
];

/**
 * Prefijo fijo de la constancia de emisión. La fecha es dinámica.
 * Uso: `${CONSTANCIA_PREFIJO} ${fechaEmision}.`
 *      → "En constancia, se emite digitalmente en Medellín, el 1 de junio de 2026."
 */
export const CONSTANCIA_PREFIJO =
  "En constancia, se emite digitalmente en Medellín, el";

/** Etiquetas fijas del bloque de firma (los valores los pone el asesor). */
export const FIRMA_ETIQUETAS = {
  cargo: "Cargo:",
  cc: "CC:",
  tel: "Tel:",
} as const;

/**
 * Prefijo fijo del copyright del pie. El año es dinámico.
 * Uso: `${COPYRIGHT_PREFIJO} ${anio}`
 *      → "D’spacios Travel – Todos los derechos reservados © 2025"
 */
export const COPYRIGHT_PREFIJO =
  "D’spacios Travel – Todos los derechos reservados ©";

/** Aviso fijo de no impresión / contrato digital (marca de agua / pie). */
export const AVISO_NO_IMPRIMIR =
  "Documento digital — se solicita no imprimir.";
