// Generado manualmente a partir del schema en supabase/migrations/
// Para regenerar desde la BD: supabase gen types typescript --project-id sbqvrckukbjzhtzqpyzg

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      usuarios: {
        Row: {
          id: string;
          email: string;
          nombre: string;
          rol: Database["public"]["Enums"]["rol_usuario"];
          activo: boolean;
          fecha_registro: string;
        };
        Insert: {
          id?: string;
          email: string;
          nombre: string;
          rol?: Database["public"]["Enums"]["rol_usuario"];
          activo?: boolean;
          fecha_registro?: string;
        };
        Update: {
          id?: string;
          email?: string;
          nombre?: string;
          rol?: Database["public"]["Enums"]["rol_usuario"];
          activo?: boolean;
          fecha_registro?: string;
        };
        Relationships: [];
      };
      asesores: {
        Row: {
          id: number;
          nombre: string;
          email: string | null;
          rol: string | null;
          pct_comision_base: number;
          pct_sobre_meta: number;
          meta_mensual: number;
          activo: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          nombre: string;
          email?: string | null;
          rol?: string | null;
          pct_comision_base?: number;
          pct_sobre_meta?: number;
          meta_mensual?: number;
          activo?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["asesores"]["Insert"]>;
        Relationships: [];
      };
      proveedores: {
        Row: {
          id: number;
          nombre: string;
          nit: string | null;
          tipo: string | null;
          ciudad: string | null;
          contacto: string | null;
          razon_social: string | null;
          datos_pago: string | null;
          aplica_retencion: boolean;
          pct_retencion: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          nombre: string;
          nit?: string | null;
          tipo?: string | null;
          ciudad?: string | null;
          contacto?: string | null;
          razon_social?: string | null;
          datos_pago?: string | null;
          aplica_retencion?: boolean;
          pct_retencion?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["proveedores"]["Insert"]>;
        Relationships: [];
      };
      aliados: {
        Row: {
          id: number;
          nombre: string;
          nit: string | null;
          contacto: string | null;
          email: string | null;
          telefono: string | null;
          aplica_retencion: boolean;
          pct_retencion: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          nombre: string;
          nit?: string | null;
          contacto?: string | null;
          email?: string | null;
          telefono?: string | null;
          aplica_retencion?: boolean;
          pct_retencion?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["aliados"]["Insert"]>;
        Relationships: [];
      };
      parametros_tributarios: {
        Row: {
          id: number;
          parametro: string;
          valor: number;
          base_calculo: string | null;
          descripcion: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          parametro: string;
          valor: number;
          base_calculo?: string | null;
          descripcion?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["parametros_tributarios"]["Insert"]>;
        Relationships: [];
      };
      ventas: {
        Row: {
          numero_contrato: string;
          fecha_venta: string;
          asesor: string | null;
          canal: string | null;
          tipo_cliente: string | null;
          cliente: string;
          destino: string | null;
          tipo_paquete: string | null;
          fecha_salida: string | null;
          fecha_regreso: string | null;
          pax: number;
          hotel: string | null;
          aerolinea: string | null;
          receptivo: string | null;
          asistencia: string | null;
          otros_proveedores: string | null;
          precio_venta: number;
          costo_hotel: number;
          costo_aereo: number;
          costo_receptivo: number;
          costo_asistencia: number;
          otros_costos: number;
          estado: string;
          observaciones: string | null;
          facturado: boolean;
          numero_documento: string | null;
          fecha_emision: string | null;
          cliente_documento: string | null;
          cliente_telefono: string | null;
          cliente_direccion: string | null;
          asistencia_medica: boolean;
          plan_nombre: string | null;
          tours_traslados: string | null;
          asesor_firma_nombre: string | null;
          asesor_firma_cargo: string | null;
          asesor_firma_cc: string | null;
          asesor_firma_tel: string | null;
          cliente_email: string | null;
          plazo: string | null;
          tipo_asesor: string | null;
          agencia_nombre: string | null;
          agencia_asesor: string | null;
          freelance_nombre: string | null;
          paquete_armado_id: number | null;
          bloqueo_ref_id: number | null;
          share_token: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          numero_contrato: string;
          fecha_venta?: string;
          asesor?: string | null;
          canal?: string | null;
          tipo_cliente?: string | null;
          cliente: string;
          destino?: string | null;
          tipo_paquete?: string | null;
          fecha_salida?: string | null;
          fecha_regreso?: string | null;
          pax?: number;
          hotel?: string | null;
          aerolinea?: string | null;
          receptivo?: string | null;
          asistencia?: string | null;
          otros_proveedores?: string | null;
          precio_venta?: number;
          costo_hotel?: number;
          costo_aereo?: number;
          costo_receptivo?: number;
          costo_asistencia?: number;
          otros_costos?: number;
          estado?: string;
          observaciones?: string | null;
          facturado?: boolean;
          numero_documento?: string | null;
          fecha_emision?: string | null;
          cliente_documento?: string | null;
          cliente_telefono?: string | null;
          cliente_direccion?: string | null;
          asistencia_medica?: boolean;
          plan_nombre?: string | null;
          tours_traslados?: string | null;
          asesor_firma_nombre?: string | null;
          asesor_firma_cargo?: string | null;
          asesor_firma_cc?: string | null;
          asesor_firma_tel?: string | null;
          cliente_email?: string | null;
          plazo?: string | null;
          tipo_asesor?: string | null;
          agencia_nombre?: string | null;
          agencia_asesor?: string | null;
          freelance_nombre?: string | null;
          paquete_armado_id?: number | null;
          bloqueo_ref_id?: number | null;
          share_token?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ventas"]["Insert"]>;
        Relationships: [];
      };
      abonos: {
        Row: {
          id: number;
          numero_contrato: string;
          cliente: string | null;
          fecha_abono: string;
          valor_abono: number;
          forma_pago: string | null;
          referencia: string | null;
          recibido_por: string | null;
          comprobante: string | null;
          observacion: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          cliente?: string | null;
          fecha_abono?: string;
          valor_abono: number;
          forma_pago?: string | null;
          referencia?: string | null;
          recibido_por?: string | null;
          comprobante?: string | null;
          observacion?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["abonos"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "abonos_numero_contrato_fkey";
            columns: ["numero_contrato"];
            referencedRelation: "ventas";
            referencedColumns: ["numero_contrato"];
          }
        ];
      };
      cuentas_por_pagar: {
        Row: {
          id: number;
          numero_contrato: string;
          proveedor: string | null;
          tipo_proveedor: string | null;
          servicio: string | null;
          fecha_obligacion: string | null;
          fecha_vencimiento: string | null;
          valor_total: number;
          aplica_retencion: boolean;
          pct_retencion: number;
          abono1: number | null;
          fecha_abono1: string | null;
          abono2: number | null;
          fecha_abono2: string | null;
          abono3: number | null;
          fecha_abono3: string | null;
          observaciones: string | null;
          tipo_facturacion: string | null;
          base_gravable: number | null;
          iva_proveedor: number | null;
          valor_irt: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          proveedor?: string | null;
          tipo_proveedor?: string | null;
          servicio?: string | null;
          fecha_obligacion?: string | null;
          fecha_vencimiento?: string | null;
          valor_total?: number;
          aplica_retencion?: boolean;
          pct_retencion?: number;
          abono1?: number | null;
          fecha_abono1?: string | null;
          abono2?: number | null;
          fecha_abono2?: string | null;
          abono3?: number | null;
          fecha_abono3?: string | null;
          observaciones?: string | null;
          tipo_facturacion?: string | null;
          base_gravable?: number | null;
          iva_proveedor?: number | null;
          valor_irt?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cuentas_por_pagar"]["Insert"]>;
        Relationships: [];
      };
      aliados_b2b: {
        Row: {
          id: number;
          numero_contrato: string;
          aliado: string | null;
          nit: string | null;
          tipo_aliado: string | null;
          contacto: string | null;
          precio_venta: number;
          base_comision: number;
          pct_comision: number;
          recobro_total: number;
          pct_recobro_aliado: number;
          aplica_retencion: boolean;
          pct_retencion: number;
          estado: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          aliado?: string | null;
          nit?: string | null;
          tipo_aliado?: string | null;
          contacto?: string | null;
          precio_venta?: number;
          base_comision?: number;
          pct_comision?: number;
          recobro_total?: number;
          pct_recobro_aliado?: number;
          aplica_retencion?: boolean;
          pct_retencion?: number;
          estado?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["aliados_b2b"]["Insert"]>;
        Relationships: [];
      };
      liquidacion_comisiones: {
        Row: {
          id: number;
          numero_contrato: string;
          asesor: string | null;
          mes_liquidacion: string | null;
          precio_venta: number;
          costo_total: number;
          com_b2b_pagada: number;
          fecha_liquidacion: string | null;
          fecha_pago: string | null;
          estado: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          asesor?: string | null;
          mes_liquidacion?: string | null;
          precio_venta?: number;
          costo_total?: number;
          com_b2b_pagada?: number;
          fecha_liquidacion?: string | null;
          fecha_pago?: string | null;
          estado?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["liquidacion_comisiones"]["Insert"]>;
        Relationships: [];
      };
      facturacion: {
        Row: {
          id: number;
          numero_contrato: string;
          numero_factura: string | null;
          fecha_factura: string | null;
          cliente: string | null;
          nit_cliente: string | null;
          descripcion: string | null;
          tipo_documento: string | null;
          naturaleza_ingreso: string | null;
          base_gravable: number;
          iva_descontable: number;
          base_tercero: number;
          comision_fee: number;
          factura_todo: number;
          estado_dian: string | null;
          obs_tributaria: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          numero_factura?: string | null;
          fecha_factura?: string | null;
          cliente?: string | null;
          nit_cliente?: string | null;
          descripcion?: string | null;
          tipo_documento?: string | null;
          naturaleza_ingreso?: string | null;
          base_gravable?: number;
          iva_descontable?: number;
          base_tercero?: number;
          comision_fee?: number;
          factura_todo?: number;
          estado_dian?: string | null;
          obs_tributaria?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["facturacion"]["Insert"]>;
        Relationships: [];
      };
      rentabilidad: {
        Row: {
          id: number;
          numero_contrato: string;
          asesor: string | null;
          destino: string | null;
          canal: string | null;
          pax: number;
          precio_venta: number;
          costo_directo: number;
          iva_generado: number;
          iva_descontable: number;
          com_b2b: number;
          com_asesor: number;
          util_bruta: number;
          prov_ica: number;
          prov_bomberil: number;
          prov_fontur: number;
          prov_renta: number;
          total_provisiones: number;
          util_neta: number;
          margen_neto: number;
          clasificacion: string | null;
          mes: string | null;
          fecha_calculo: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          asesor?: string | null;
          destino?: string | null;
          canal?: string | null;
          pax?: number;
          precio_venta?: number;
          costo_directo?: number;
          iva_generado?: number;
          iva_descontable?: number;
          com_b2b?: number;
          com_asesor?: number;
          util_bruta?: number;
          prov_ica?: number;
          prov_bomberil?: number;
          prov_fontur?: number;
          prov_renta?: number;
          total_provisiones?: number;
          util_neta?: number;
          margen_neto?: number;
          clasificacion?: string | null;
          mes?: string | null;
          fecha_calculo?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["rentabilidad"]["Insert"]>;
        Relationships: [];
      };
      bloqueos_vuelo: {
        Row: {
          id: number;
          record: string;
          aerolinea: string | null;
          ruta: string | null;
          vuelo_ida: string | null;
          fecha_ida: string | null;
          hora_salida_ida: string | null;
          hora_llegada_ida: string | null;
          vuelo_regreso: string | null;
          fecha_regreso: string | null;
          hora_salida_reg: string | null;
          hora_llegada_reg: string | null;
          cupos_total: number;
          tarifa_para_empaquetar: number;
          fecha_devolucion: string | null;
          fecha_emision: string | null;
          notas: string | null;
          proveedor_id: number | null;
          destino_id: number | null;
          rangos_edad: number[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          record: string;
          proveedor_id?: number | null;
          destino_id?: number | null;
          rangos_edad?: number[] | null;
          aerolinea?: string | null;
          ruta?: string | null;
          vuelo_ida?: string | null;
          fecha_ida?: string | null;
          hora_salida_ida?: string | null;
          hora_llegada_ida?: string | null;
          vuelo_regreso?: string | null;
          fecha_regreso?: string | null;
          hora_salida_reg?: string | null;
          hora_llegada_reg?: string | null;
          cupos_total?: number;
          tarifa_para_empaquetar?: number;
          fecha_devolucion?: string | null;
          fecha_emision?: string | null;
          notas?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bloqueos_vuelo"]["Insert"]>;
        Relationships: [];
      };
      sillas: {
        Row: {
          id: number;
          bloqueo_id: number;
          numero_silla: number | null;
          estado: Database["public"]["Enums"]["estado_silla"];
          numero_contrato: string | null;
          pasajero_nombres: string | null;
          pasajero_apellidos: string | null;
          tipo_doc: string | null;
          numero_doc: string | null;
          nacimiento: string | null;
          asesor: string | null;
          agencia: string | null;
          hotel: string | null;
          acomodacion: string | null;
          plazo: string | null;
          inf_nombres: string | null;
          inf_apellidos: string | null;
          inf_tipo_doc: string | null;
          inf_numero: string | null;
          inf_nacimiento: string | null;
          responsable_menor: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          bloqueo_id: number;
          numero_silla?: number | null;
          estado?: Database["public"]["Enums"]["estado_silla"];
          numero_contrato?: string | null;
          pasajero_nombres?: string | null;
          pasajero_apellidos?: string | null;
          tipo_doc?: string | null;
          numero_doc?: string | null;
          nacimiento?: string | null;
          asesor?: string | null;
          agencia?: string | null;
          hotel?: string | null;
          acomodacion?: string | null;
          plazo?: string | null;
          inf_nombres?: string | null;
          inf_apellidos?: string | null;
          inf_tipo_doc?: string | null;
          inf_numero?: string | null;
          inf_nacimiento?: string | null;
          responsable_menor?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sillas"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "sillas_bloqueo_id_fkey";
            columns: ["bloqueo_id"];
            referencedRelation: "bloqueos_vuelo";
            referencedColumns: ["id"];
          }
        ];
      };
      movimientos_silla: {
        Row: {
          id: number;
          silla_id: number;
          bloqueo_origen_id: number | null;
          bloqueo_destino_id: number | null;
          motivo: string | null;
          fecha_movimiento: string;
          registrado_por: string | null;
        };
        Insert: {
          id?: number;
          silla_id: number;
          bloqueo_origen_id?: number | null;
          bloqueo_destino_id?: number | null;
          motivo?: string | null;
          fecha_movimiento?: string;
          registrado_por?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["movimientos_silla"]["Insert"]>;
        Relationships: [];
      };
      destinos: {
        Row: {
          id: number;
          nombre: string;
          codigo_iata: string | null;
          activo: boolean;
        };
        Insert: {
          id?: number;
          nombre: string;
          codigo_iata?: string | null;
          activo?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["destinos"]["Insert"]>;
        Relationships: [];
      };
      hoteles: {
        Row: {
          id: number;
          destino_id: number;
          nombre: string;
          zona: string | null;
          notas: string | null;
          activo: boolean;
          proveedor_id: number | null;
          edad_infante_min: number;
          edad_infante_max: number;
          edad_nino_min: number;
          edad_nino_max: number;
          rangos_edad: number[] | null;
        };
        Insert: {
          id?: number;
          destino_id: number;
          nombre: string;
          zona?: string | null;
          notas?: string | null;
          activo?: boolean;
          proveedor_id?: number | null;
          edad_infante_min?: number;
          edad_infante_max?: number;
          edad_nino_min?: number;
          edad_nino_max?: number;
          rangos_edad?: number[] | null;
        };
        Update: Partial<Database["public"]["Tables"]["hoteles"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "hoteles_destino_id_fkey";
            columns: ["destino_id"];
            referencedRelation: "destinos";
            referencedColumns: ["id"];
          }
        ];
      };
      habitaciones: {
        Row: { id: number; hotel_id: number; nombre: string };
        Insert: { id?: number; hotel_id: number; nombre: string };
        Update: Partial<Database["public"]["Tables"]["habitaciones"]["Insert"]>;
        Relationships: [];
      };
      planes_alimentacion: {
        Row: {
          id: number;
          codigo: string;
          nombre: string;
          descripcion: string | null;
          activo: boolean;
        };
        Insert: {
          id?: number;
          codigo: string;
          nombre: string;
          descripcion?: string | null;
          activo?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["planes_alimentacion"]["Insert"]>;
        Relationships: [];
      };
      temporadas: {
        Row: {
          id: number;
          destino_id: number;
          nombre: Database["public"]["Enums"]["temporada_tipo"];
          anio: number;
        };
        Insert: {
          id?: number;
          destino_id: number;
          nombre: Database["public"]["Enums"]["temporada_tipo"];
          anio?: number;
        };
        Update: Partial<Database["public"]["Tables"]["temporadas"]["Insert"]>;
        Relationships: [];
      };
      temporada_fechas: {
        Row: {
          id: number;
          temporada_id: number;
          fecha_inicio: string;
          fecha_fin: string;
        };
        Insert: {
          id?: number;
          temporada_id: number;
          fecha_inicio: string;
          fecha_fin: string;
        };
        Update: Partial<Database["public"]["Tables"]["temporada_fechas"]["Insert"]>;
        Relationships: [];
      };
      tarifas: {
        Row: {
          id: number;
          hotel_id: number;
          habitacion_id: number | null;
          plan_id: number;
          temporada_id: number;
          noches: number;
          comisionable: boolean;
          impuesto_no_comisionable: number;
          notas: string | null;
          activo: boolean;
          costo_base: number | null;
          pct_mk: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          hotel_id: number;
          habitacion_id?: number | null;
          plan_id: number;
          temporada_id: number;
          noches?: number;
          comisionable?: boolean;
          impuesto_no_comisionable?: number;
          notas?: string | null;
          activo?: boolean;
          costo_base?: number | null;
          pct_mk?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tarifas"]["Insert"]>;
        Relationships: [];
      };
      tarifa_precios: {
        Row: {
          id: number;
          tarifa_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          precio: number;
        };
        Insert: {
          id?: number;
          tarifa_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          precio: number;
        };
        Update: Partial<Database["public"]["Tables"]["tarifa_precios"]["Insert"]>;
        Relationships: [];
      };
      itinerarios: {
        Row: {
          id: number;
          destino_id: number;
          bloqueo_id: number | null;
          ruta: string | null;
          fecha_ida: string | null;
          fecha_regreso: string | null;
          cupos: number;
          activo: boolean;
        };
        Insert: {
          id?: number;
          destino_id: number;
          bloqueo_id?: number | null;
          ruta?: string | null;
          fecha_ida?: string | null;
          fecha_regreso?: string | null;
          cupos?: number;
          activo?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["itinerarios"]["Insert"]>;
        Relationships: [];
      };
      inclusiones: {
        Row: {
          id: number;
          destino_id: number;
          tipo: string;
          texto: string;
          orden: number;
        };
        Insert: {
          id?: number;
          destino_id: number;
          tipo: string;
          texto: string;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["inclusiones"]["Insert"]>;
        Relationships: [];
      };
      contrato_pasajeros: {
        Row: {
          id: number;
          numero_contrato: string;
          nombre: string;
          tipo_id: string | null;
          identificacion: string | null;
          fecha_nacimiento: string | null;
          nacionalidad: string | null;
          es_infante: boolean;
          orden: number;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          nombre: string;
          tipo_id?: string | null;
          identificacion?: string | null;
          fecha_nacimiento?: string | null;
          nacionalidad?: string | null;
          es_infante?: boolean;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_pasajeros"]["Insert"]>;
        Relationships: [];
      };
      contrato_hoteles: {
        Row: {
          id: number;
          numero_contrato: string;
          nombre: string;
          ciudad: string | null;
          alimentacion: string | null;
          acomodacion: string | null;
          detalle_acomodacion: string | null;
          fecha_ingreso: string | null;
          fecha_salida: string | null;
          orden: number;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          nombre: string;
          ciudad?: string | null;
          alimentacion?: string | null;
          acomodacion?: string | null;
          detalle_acomodacion?: string | null;
          fecha_ingreso?: string | null;
          fecha_salida?: string | null;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_hoteles"]["Insert"]>;
        Relationships: [];
      };
      contrato_vuelos: {
        Row: {
          id: number;
          numero_contrato: string;
          aerolinea: string | null;
          origen_codigo: string | null;
          origen_ciudad: string | null;
          destino_codigo: string | null;
          destino_ciudad: string | null;
          servicios: string | null;
          fecha_salida: string | null;
          orden: number;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          aerolinea?: string | null;
          origen_codigo?: string | null;
          origen_ciudad?: string | null;
          destino_codigo?: string | null;
          destino_ciudad?: string | null;
          servicios?: string | null;
          fecha_salida?: string | null;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_vuelos"]["Insert"]>;
        Relationships: [];
      };
      contrato_items: {
        Row: {
          id: number;
          numero_contrato: string;
          descripcion: string;
          adultos: number;
          ninos: number;
          tarifa_adulto: number;
          tarifa_nino: number;
          orden: number;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          descripcion: string;
          adultos?: number;
          ninos?: number;
          tarifa_adulto?: number;
          tarifa_nino?: number;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_items"]["Insert"]>;
        Relationships: [];
      };
      paquetes: {
        Row: {
          id: number;
          categoria: Database["public"]["Enums"]["paquete_categoria"];
          destino_id: number | null;
          nombre: string;
          descripcion: string | null;
          plan_alimentacion: string | null;
          noches: number;
          comisionable: boolean;
          impuesto_no_comisionable: number;
          bloqueo_id: number | null;
          activo: boolean;
          notas: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          categoria: Database["public"]["Enums"]["paquete_categoria"];
          destino_id?: number | null;
          nombre: string;
          descripcion?: string | null;
          plan_alimentacion?: string | null;
          noches?: number;
          comisionable?: boolean;
          impuesto_no_comisionable?: number;
          bloqueo_id?: number | null;
          activo?: boolean;
          notas?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["paquetes"]["Insert"]>;
        Relationships: [];
      };
      paquete_hoteles: {
        Row: {
          id: number;
          paquete_id: number;
          nombre: string;
          ciudad: string | null;
          alimentacion: string | null;
          acomodacion_detalle: string | null;
          noches: number;
          orden: number;
        };
        Insert: {
          id?: number;
          paquete_id: number;
          nombre: string;
          ciudad?: string | null;
          alimentacion?: string | null;
          acomodacion_detalle?: string | null;
          noches?: number;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["paquete_hoteles"]["Insert"]>;
        Relationships: [];
      };
      paquete_precios: {
        Row: {
          id: number;
          paquete_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          precio: number;
        };
        Insert: {
          id?: number;
          paquete_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          precio: number;
        };
        Update: Partial<Database["public"]["Tables"]["paquete_precios"]["Insert"]>;
        Relationships: [];
      };
      paquete_costos: {
        Row: {
          paquete_id: number;
          costo_hotel: number;
          costo_aereo: number;
          costo_receptivo: number;
          costo_asistencia: number;
          otros_costos: number;
        };
        Insert: {
          paquete_id: number;
          costo_hotel?: number;
          costo_aereo?: number;
          costo_receptivo?: number;
          costo_asistencia?: number;
          otros_costos?: number;
        };
        Update: Partial<Database["public"]["Tables"]["paquete_costos"]["Insert"]>;
        Relationships: [];
      };
      categorias_habitacion: {
        Row: { id: number; nombre: string; descripcion: string | null; activo: boolean; created_at: string };
        Insert: { id?: number; nombre: string; descripcion?: string | null; activo?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["categorias_habitacion"]["Insert"]>;
        Relationships: [];
      };
      hotel_categorias: {
        Row: { hotel_id: number; categoria_id: number };
        Insert: { hotel_id: number; categoria_id: number };
        Update: Partial<Database["public"]["Tables"]["hotel_categorias"]["Insert"]>;
        Relationships: [];
      };
      hotel_regimenes: {
        Row: { hotel_id: number; plan_id: number };
        Insert: { hotel_id: number; plan_id: number };
        Update: Partial<Database["public"]["Tables"]["hotel_regimenes"]["Insert"]>;
        Relationships: [];
      };
      hotel_temporadas: {
        Row: { id: number; hotel_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null; orden: number };
        Insert: { id?: number; hotel_id: number; nombre: string; fecha_inicio?: string | null; fecha_fin?: string | null; orden?: number };
        Update: Partial<Database["public"]["Tables"]["hotel_temporadas"]["Insert"]>;
        Relationships: [];
      };
      tarifa_hotel: {
        Row: {
          id: number; hotel_id: number; tipo_habitacion: string | null; alimentacion: string | null;
          temporada: string | null; neto_sencilla: number | null; neto_doble: number | null;
          neto_triple: number | null; neto_multiple: number | null; neto_nino: number | null;
          neto_nino2: number | null;
          notas: string | null; created_at: string;
        };
        Insert: {
          id?: number; hotel_id: number; tipo_habitacion?: string | null; alimentacion?: string | null;
          temporada?: string | null; neto_sencilla?: number | null; neto_doble?: number | null;
          neto_triple?: number | null; neto_multiple?: number | null; neto_nino?: number | null;
          neto_nino2?: number | null;
          notas?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tarifa_hotel"]["Insert"]>;
        Relationships: [];
      };
      servicios_adicionales: {
        Row: {
          id: number; nombre: string; proveedor_id: number | null; destino_id: number | null;
          tarifa_neta: number; temporada: string | null; rangos_edad: number[] | null; tipo_tarifa: string;
          precio_persona: number | null; precio_grupo: number | null;
          liquidacion: Database["public"]["Enums"]["liquidacion_tipo"]; activo: boolean; created_at: string;
        };
        Insert: {
          id?: number; nombre: string; proveedor_id?: number | null; destino_id?: number | null;
          tarifa_neta?: number; temporada?: string | null; rangos_edad?: number[] | null; tipo_tarifa?: string;
          precio_persona?: number | null; precio_grupo?: number | null;
          liquidacion?: Database["public"]["Enums"]["liquidacion_tipo"]; activo?: boolean; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["servicios_adicionales"]["Insert"]>;
        Relationships: [];
      };
      servicio_tarifa_pax: {
        Row: { id: number; servicio_id: number; pax_desde: number; pax_hasta: number; precio: number; created_at: string };
        Insert: { id?: number; servicio_id: number; pax_desde?: number; pax_hasta?: number; precio?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["servicio_tarifa_pax"]["Insert"]>;
        Relationships: [];
      };
      rangos_edad: {
        Row: { id: number; denominacion: string; edad_min: number; edad_max: number; activo: boolean; created_at: string };
        Insert: { id?: number; denominacion: string; edad_min?: number; edad_max?: number; activo?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["rangos_edad"]["Insert"]>;
        Relationships: [];
      };
      armado_paquetes: {
        Row: {
          id: number;
          nombre: string;
          activo: boolean;
          tipo: Database["public"]["Enums"]["tarifario_modulo"];
          noches: number;
          destino_id: number | null;
          fecha_compra_inicio: string | null;
          fecha_compra_fin: string | null;
          fecha_viaje_inicio: string | null;
          fecha_viaje_fin: string | null;
          pct_mk: number;
          impuesto_tipo: Database["public"]["Enums"]["impuesto_tipo"];
          impuesto_fijo: number;
          imagen_url: string | null;
          notas: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          nombre: string;
          activo?: boolean;
          tipo?: Database["public"]["Enums"]["tarifario_modulo"];
          noches?: number;
          destino_id?: number | null;
          fecha_compra_inicio?: string | null;
          fecha_compra_fin?: string | null;
          fecha_viaje_inicio?: string | null;
          fecha_viaje_fin?: string | null;
          pct_mk?: number;
          impuesto_tipo?: Database["public"]["Enums"]["impuesto_tipo"];
          impuesto_fijo?: number;
          imagen_url?: string | null;
          notas?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["armado_paquetes"]["Insert"]>;
        Relationships: [];
      };
      armado_vuelos: {
        Row: { paquete_id: number; bloqueo_id: number; aplica_mk: boolean; ta: number };
        Insert: { paquete_id: number; bloqueo_id: number; aplica_mk?: boolean; ta?: number };
        Update: Partial<Database["public"]["Tables"]["armado_vuelos"]["Insert"]>;
        Relationships: [];
      };
      armado_hoteles: {
        Row: { id: number; paquete_id: number; hotel_id: number; categorias: string[] | null; regimenes: string[] | null };
        Insert: { id?: number; paquete_id: number; hotel_id: number; categorias?: string[] | null; regimenes?: string[] | null };
        Update: Partial<Database["public"]["Tables"]["armado_hoteles"]["Insert"]>;
        Relationships: [];
      };
      armado_servicios: {
        Row: { id: number; paquete_id: number; servicio_id: number; modo: string };
        Insert: { id?: number; paquete_id: number; servicio_id: number; modo?: string };
        Update: Partial<Database["public"]["Tables"]["armado_servicios"]["Insert"]>;
        Relationships: [];
      };
      tarifario_resultado: {
        Row: {
          id: number;
          paquete_id: number;
          paquete_nombre: string | null;
          paquete_activo: boolean;
          modulo: Database["public"]["Enums"]["tarifario_modulo"];
          bloqueo_id: number | null;
          bloqueo_label: string | null;
          hotel_id: number | null;
          hotel_nombre: string | null;
          servicio_id: number | null;
          servicio_nombre: string | null;
          destino_id: number | null;
          destino_nombre: string | null;
          categoria: string | null;
          regimen: string | null;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"] | null;
          noches: number | null;
          fecha_ida: string | null;
          fecha_regreso: string | null;
          pax_desde: number | null;
          pax_hasta: number | null;
          tipo_tarifa: string | null;
          base_comisionable: number;
          impuesto: number;
          precio_pvp: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          paquete_id: number;
          paquete_nombre?: string | null;
          paquete_activo?: boolean;
          pax_desde?: number | null;
          pax_hasta?: number | null;
          tipo_tarifa?: string | null;
          modulo: Database["public"]["Enums"]["tarifario_modulo"];
          bloqueo_id?: number | null;
          bloqueo_label?: string | null;
          hotel_id?: number | null;
          hotel_nombre?: string | null;
          servicio_id?: number | null;
          servicio_nombre?: string | null;
          destino_id?: number | null;
          destino_nombre?: string | null;
          categoria?: string | null;
          regimen?: string | null;
          acomodacion?: Database["public"]["Enums"]["acomodacion_tipo"] | null;
          noches?: number | null;
          fecha_ida?: string | null;
          fecha_regreso?: string | null;
          base_comisionable?: number;
          impuesto?: number;
          precio_pvp?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tarifario_resultado"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      cupos_por_bloqueo: {
        Row: {
          id: number | null;
          record: string | null;
          ruta: string | null;
          fecha_ida: string | null;
          cupos_total: number | null;
          cupos_disponibles: number | null;
          cupos_ocupados: number | null;
          cupos_devueltos: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      mi_rol: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["rol_usuario"];
      };
      siguiente_numero_contrato: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: {
      rol_usuario:
        | "superadmin"
        | "gerencia"
        | "administracion"
        | "operaciones"
        | "venta"
        | "control_vuelo"
        | "agencia"
        | "freelance"
        | "cliente_final";
      estado_silla:
        | "disponible"
        | "en_plazo"
        | "confirmada"
        | "devuelta"
        | "no_vendida"
        | "cambio"
        | "cambio_entrante";
      acomodacion_tipo:
        | "sencilla"
        | "doble"
        | "triple"
        | "multiple"
        | "nino"
        | "nino2";
      temporada_tipo: "ALTA" | "MEDIA" | "BAJA";
      paquete_categoria: "bloqueo" | "porcion_terrestre";
      liquidacion_tipo: "dia" | "noche" | "paquete";
      impuesto_tipo: "tiquete" | "fijo";
      tarifario_modulo: "bloqueo" | "porcion_terrestre" | "servicios";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Helpers de conveniencia
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

// Tipos de uso frecuente
export type Usuario = Tables<"usuarios">;
export type Venta = Tables<"ventas">;
export type Abono = Tables<"abonos">;
export type BloqueoVuelo = Tables<"bloqueos_vuelo">;
export type Silla = Tables<"sillas">;
export type Destino = Tables<"destinos">;
export type Hotel = Tables<"hoteles">;
export type Tarifa = Tables<"tarifas">;
export type ContratoPasajero = Tables<"contrato_pasajeros">;
export type ContratoHotel = Tables<"contrato_hoteles">;
export type ContratoVuelo = Tables<"contrato_vuelos">;
export type ContratoItem = Tables<"contrato_items">;
export type Paquete = Tables<"paquetes">;
export type PaqueteHotel = Tables<"paquete_hoteles">;
export type PaquetePrecio = Tables<"paquete_precios">;
export type RolUsuario = Enums<"rol_usuario">;
export type EstadoSilla = Enums<"estado_silla">;
export type AcomodacionTipo = Enums<"acomodacion_tipo">;
