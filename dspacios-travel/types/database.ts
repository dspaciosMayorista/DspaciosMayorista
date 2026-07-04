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
      salidas_dinamicas: {
        Row: {
          id: number; paquete_id: number; aerolinea: string | null; ruta: string | null; origen: string | null;
          fecha_ida: string; fecha_regreso: string | null;
          hora_salida_ida: string | null; hora_llegada_ida: string | null; hora_salida_reg: string | null; hora_llegada_reg: string | null;
          valor_tiquete: number; aplica_mk: boolean; ta: number; fee_infante: number;
          compra_inicio: string | null; compra_fin: string | null; activo: boolean; notas: string | null; orden: number; created_at: string;
        };
        Insert: {
          id?: number; paquete_id: number; aerolinea?: string | null; ruta?: string | null; origen?: string | null;
          fecha_ida: string; fecha_regreso?: string | null;
          hora_salida_ida?: string | null; hora_llegada_ida?: string | null; hora_salida_reg?: string | null; hora_llegada_reg?: string | null;
          valor_tiquete?: number; aplica_mk?: boolean; ta?: number; fee_infante?: number;
          compra_inicio?: string | null; compra_fin?: string | null; activo?: boolean; notas?: string | null; orden?: number; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["salidas_dinamicas"]["Insert"]>;
        Relationships: [];
      };
      auditoria: {
        Row: {
          id: number;
          creado_en: string;
          actor_id: string | null;
          actor_email: string | null;
          actor_nombre: string | null;
          actor_rol: string | null;
          accion: string;
          tabla: string;
          registro_id: string | null;
          antes: Json | null;
          despues: Json | null;
          cambios: Json | null;
          tenant: string;
        };
        Insert: {
          id?: number;
          creado_en?: string;
          actor_id?: string | null;
          actor_email?: string | null;
          actor_nombre?: string | null;
          actor_rol?: string | null;
          accion: string;
          tabla: string;
          registro_id?: string | null;
          antes?: Json | null;
          despues?: Json | null;
          cambios?: Json | null;
        };
        Update: {
          id?: number;
          creado_en?: string;
          actor_id?: string | null;
          actor_email?: string | null;
          actor_nombre?: string | null;
          actor_rol?: string | null;
          accion?: string;
          tabla?: string;
          registro_id?: string | null;
          antes?: Json | null;
          despues?: Json | null;
          cambios?: Json | null;
        };
        Relationships: [];
      };
      usuarios: {
        Row: {
          id: string;
          email: string;
          nombre: string;
          rol: Database["public"]["Enums"]["rol_usuario"];
          activo: boolean;
          fecha_registro: string;
          escala_id: number | null;
          aplica_retencion: boolean;
          agencia_id: string | null;
          pct_comision: number | null;
          tenant: string;
        };
        Insert: {
          id?: string;
          email: string;
          nombre: string;
          rol?: Database["public"]["Enums"]["rol_usuario"];
          activo?: boolean;
          fecha_registro?: string;
          escala_id?: number | null;
          aplica_retencion?: boolean;
          agencia_id?: string | null;
          pct_comision?: number | null;
          tenant?: string;
        };
        Update: {
          id?: string;
          email?: string;
          nombre?: string;
          rol?: Database["public"]["Enums"]["rol_usuario"];
          activo?: boolean;
          fecha_registro?: string;
          agencia_id?: string | null;
          pct_comision?: number | null;
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
          escala_id: number | null;
          aplica_retencion: boolean;
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
          escala_id?: number | null;
          aplica_retencion?: boolean;
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
          banco: string | null;
          tipo_cuenta: string | null;
          numero_cuenta: string | null;
          politica_reservas: string | null;
          aplica_retencion: boolean;
          pct_retencion: number;
          clasificacion: string;
          created_at: string;
          voucher_contacto: string | null;
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
          banco?: string | null;
          tipo_cuenta?: string | null;
          numero_cuenta?: string | null;
          politica_reservas?: string | null;
          aplica_retencion?: boolean;
          pct_retencion?: number;
          clasificacion?: string;
          created_at?: string;
          voucher_contacto?: string | null;
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
          tipo: string;
          pct_comision: number | null;
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
          tipo?: string;
          pct_comision?: number | null;
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
          impuesto: number;
          costo_hotel: number;
          costo_aereo: number;
          costo_receptivo: number;
          costo_asistencia: number;
          otros_costos: number;
          estado: string;
          observaciones: string | null;
          facturado: boolean;
          moneda: string;
          trm_contrato: number | null;
          tenant: string;
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
          b2b_usuario_id: string | null;
          modo_compra: string | null;
          comision_b2b: number | null;
          comision_estado: string | null;
          recobro_total: number | null;
          recobro_empresa: number | null;
          recobro_aliado: number | null;
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
          impuesto?: number;
          costo_hotel?: number;
          costo_aereo?: number;
          costo_receptivo?: number;
          costo_asistencia?: number;
          otros_costos?: number;
          estado?: string;
          observaciones?: string | null;
          facturado?: boolean;
          moneda?: string;
          trm_contrato?: number | null;
          tenant?: string;
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
          b2b_usuario_id?: string | null;
          modo_compra?: string | null;
          comision_b2b?: number | null;
          comision_estado?: string | null;
          recobro_total?: number | null;
          recobro_empresa?: number | null;
          recobro_aliado?: number | null;
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
          monto_cop: number | null;
          trm: number | null;
          tenant: string;
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
          monto_cop?: number | null;
          trm?: number | null;
          tenant?: string;
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
      agencias: {
        Row: {
          tenant: string;
          razon_social: string | null;
          nombre_comercial: string | null;
          nit: string | null;
          dv: string | null;
          rnt: string | null;
          direccion: string | null;
          ciudad: string | null;
          correo: string | null;
          telefono: string | null;
          actividad_economica: string | null;
          responsabilidades: string | null;
          representante_legal: string | null;
          factura_electronica: boolean;
          banco: string | null;
          tipo_cuenta: string | null;
          numero_cuenta: string | null;
          updated_at: string;
        };
        Insert: {
          tenant: string;
          razon_social?: string | null;
          nombre_comercial?: string | null;
          nit?: string | null;
          dv?: string | null;
          rnt?: string | null;
          direccion?: string | null;
          ciudad?: string | null;
          correo?: string | null;
          telefono?: string | null;
          actividad_economica?: string | null;
          responsabilidades?: string | null;
          representante_legal?: string | null;
          factura_electronica?: boolean;
          banco?: string | null;
          tipo_cuenta?: string | null;
          numero_cuenta?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["agencias"]["Insert"]>;
        Relationships: [];
      };
      contrato_facturacion: {
        Row: {
          numero_contrato: string;
          irt: number;
          ingreso_propio: number;
          ingreso_exento: number;
          tipo_exento: string | null;
          lleva_iva: boolean;
          observacion: string | null;
          dian_emitida: boolean;
          dian_fecha: string | null;
          updated_at: string;
        };
        Insert: {
          numero_contrato: string;
          irt?: number;
          ingreso_propio?: number;
          ingreso_exento?: number;
          tipo_exento?: string | null;
          lleva_iva?: boolean;
          observacion?: string | null;
          dian_emitida?: boolean;
          dian_fecha?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_facturacion"]["Insert"]>;
        Relationships: [];
      };
      pe_empleados: {
        Row: {
          id: number;
          nombre: string;
          tipo: string;
          salario: number;
          auxilio: boolean;
          riesgo: string;
          declarante: boolean;
          contrato_path: string | null;
          contrato_nombre: string | null;
          activo: boolean;
          tenant: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          nombre: string;
          tipo?: string;
          salario?: number;
          auxilio?: boolean;
          riesgo?: string;
          declarante?: boolean;
          contrato_path?: string | null;
          contrato_nombre?: string | null;
          activo?: boolean;
          tenant?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pe_empleados"]["Insert"]>;
        Relationships: [];
      };
      contabilidad_movimientos: {
        Row: {
          id: number;
          fecha: string;
          tipo: string;
          concepto: string;
          tercero: string | null;
          categoria: string | null;
          medio_pago: string | null;
          valor: number;
          comprobante: string | null;
          observacion: string | null;
          tenant: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          fecha?: string;
          tipo?: string;
          concepto: string;
          tercero?: string | null;
          categoria?: string | null;
          medio_pago?: string | null;
          valor?: number;
          comprobante?: string | null;
          observacion?: string | null;
          tenant?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["contabilidad_movimientos"]["Insert"]>;
        Relationships: [];
      };
      conciliacion_extracto: {
        Row: {
          id: number; fecha: string; descripcion: string | null; valor: number;
          saldo: number | null; periodo: string; cuenta: string | null; tenant: string;
          conciliacion_id: number | null; created_at: string;
        };
        Insert: {
          id?: number; fecha: string; descripcion?: string | null; valor: number;
          saldo?: number | null; periodo: string; cuenta?: string | null; tenant?: string;
          conciliacion_id?: number | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conciliacion_extracto"]["Insert"]>;
        Relationships: [];
      };
      conciliacion: {
        Row: { id: number; nota: string | null; total: number; tenant: string; created_at: string };
        Insert: { id?: number; nota?: string | null; total?: number; tenant?: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["conciliacion"]["Insert"]>;
        Relationships: [];
      };
      conciliacion_sistema: {
        Row: {
          id: number; conciliacion_id: number; ref: string;
          descripcion: string | null; fecha: string | null; valor: number; created_at: string;
        };
        Insert: {
          id?: number; conciliacion_id: number; ref: string;
          descripcion?: string | null; fecha?: string | null; valor: number; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conciliacion_sistema"]["Insert"]>;
        Relationships: [];
      };
      pe_costos: {
        Row: {
          id: number;
          concepto: string;
          categoria: string | null;
          clasificacion: string;
          valor: number;
          activo: boolean;
          tenant: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          concepto: string;
          categoria?: string | null;
          clasificacion?: string;
          valor?: number;
          activo?: boolean;
          tenant?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["pe_costos"]["Insert"]>;
        Relationships: [];
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
          trm1: number | null;
          abono2: number | null;
          fecha_abono2: string | null;
          trm2: number | null;
          abono3: number | null;
          fecha_abono3: string | null;
          trm3: number | null;
          observaciones: string | null;
          tipo_facturacion: string | null;
          base_gravable: number | null;
          iva_proveedor: number | null;
          valor_irt: number | null;
          clasificacion: string;
          tenant: string;
          moneda: string;
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
          trm1?: number | null;
          abono2?: number | null;
          fecha_abono2?: string | null;
          trm2?: number | null;
          abono3?: number | null;
          fecha_abono3?: string | null;
          trm3?: number | null;
          observaciones?: string | null;
          tipo_facturacion?: string | null;
          base_gravable?: number | null;
          iva_proveedor?: number | null;
          valor_irt?: number | null;
          clasificacion?: string;
          tenant?: string;
          moneda?: string;
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
          fecha_pago: string | null;
          created_at: string;
          tenant: string;
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
          fecha_pago?: string | null;
          created_at?: string;
          tenant?: string;
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
      factura_items: {
        Row: {
          id: number;
          factura_id: number;
          descripcion: string | null;
          valor: number;
          gravable: boolean;
          orden: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          factura_id: number;
          descripcion?: string | null;
          valor?: number;
          gravable?: boolean;
          orden?: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          factura_id?: number;
          descripcion?: string | null;
          valor?: number;
          gravable?: boolean;
          orden?: number;
          created_at?: string;
        };
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
          base_no_gravable: number;
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
          base_no_gravable?: number;
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
          origen: string | null;
          tarifa_neta: number | null;
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
          origen?: string | null;
          tarifa_neta?: number | null;
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
      bloqueo_cambios: {
        Row: {
          id: number;
          bloqueo_id: number;
          fecha: string;
          detalle: string | null;
          nota: string | null;
          registrado_por: string | null;
        };
        Insert: {
          id?: number;
          bloqueo_id: number;
          fecha?: string;
          detalle?: string | null;
          nota?: string | null;
          registrado_por?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["bloqueo_cambios"]["Insert"]>;
        Relationships: [];
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
          pais: string | null;
          activo: boolean;
        };
        Insert: {
          id?: number;
          nombre: string;
          codigo_iata?: string | null;
          pais?: string | null;
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
          pax_min: number | null;
          pax_max: number | null;
          contacto_telefono: string | null;
          email_comercial: string | null;
          estrellas: number | null;
          clasificacion: string | null;
          descripcion: string | null;
          ubicacion: string | null;
          video_url: string | null;
          moneda: string;
          infante_cargo_neto: number;
          infante_cargo_desc: string | null;
          infante_nota: string | null;
          nino_nota: string | null;
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
          pax_min?: number | null;
          pax_max?: number | null;
          contacto_telefono?: string | null;
          email_comercial?: string | null;
          estrellas?: number | null;
          clasificacion?: string | null;
          moneda?: string;
          descripcion?: string | null;
          ubicacion?: string | null;
          video_url?: string | null;
          infante_cargo_neto?: number;
          infante_cargo_desc?: string | null;
          infante_nota?: string | null;
          nino_nota?: string | null;
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
          nota_especial: string | null;
          activo: boolean;
        };
        Insert: {
          id?: number;
          codigo: string;
          nombre: string;
          descripcion?: string | null;
          nota_especial?: string | null;
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
          categoria: string | null;
          proveedor: string | null;
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
          categoria?: string | null;
          proveedor?: string | null;
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
          record: string | null;
          vuelo_ida: string | null;
          vuelo_regreso: string | null;
          hora_salida_ida: string | null;
          hora_llegada_ida: string | null;
          hora_salida_reg: string | null;
          hora_llegada_reg: string | null;
          fecha_regreso: string | null;
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
          record?: string | null;
          vuelo_ida?: string | null;
          vuelo_regreso?: string | null;
          hora_salida_ida?: string | null;
          hora_llegada_ida?: string | null;
          hora_salida_reg?: string | null;
          hora_llegada_reg?: string | null;
          fecha_regreso?: string | null;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["contrato_vuelos"]["Insert"]>;
        Relationships: [];
      };
      contrato_servicios: {
        Row: { id: number; numero_contrato: string; tipo: string; descripcion: string; proveedor: string | null; costo: number | null; orden: number | null };
        Insert: { id?: number; numero_contrato: string; tipo?: string; descripcion: string; proveedor?: string | null; costo?: number | null; orden?: number | null };
        Update: Partial<Database["public"]["Tables"]["contrato_servicios"]["Insert"]>;
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
        Row: { id: number; hotel_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null; orden: number; prioridad: number; compra_inicio: string | null; compra_fin: string | null; tipo: string; descuento_valor: number | null; rangos: Json; blackouts: Json; min_noches: number };
        Insert: { id?: number; hotel_id: number; nombre: string; fecha_inicio?: string | null; fecha_fin?: string | null; orden?: number; prioridad?: number; compra_inicio?: string | null; compra_fin?: string | null; tipo?: string; descuento_valor?: number | null; rangos?: Json; blackouts?: Json; min_noches?: number };
        Update: Partial<Database["public"]["Tables"]["hotel_temporadas"]["Insert"]>;
        Relationships: [];
      };
      hotel_calculadora: {
        Row: { id: number; hotel_id: number; tipo: string; params: Json; updated_at: string };
        Insert: { id?: number; hotel_id: number; tipo?: string; params?: Json; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["hotel_calculadora"]["Insert"]>;
        Relationships: [];
      };
      formas_pago: {
        Row: { id: number; nombre: string; activo: boolean; orden: number; created_at: string };
        Insert: { id?: number; nombre: string; activo?: boolean; orden?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["formas_pago"]["Insert"]>;
        Relationships: [];
      };
      escalas_comision: {
        Row: { id: number; nombre: string; activo: boolean; created_at: string };
        Insert: { id?: number; nombre: string; activo?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["escalas_comision"]["Insert"]>;
        Relationships: [];
      };
      escala_rangos: {
        Row: { id: number; escala_id: number; pvp_desde: number; pvp_hasta: number | null; pct: number; orden: number };
        Insert: { id?: number; escala_id: number; pvp_desde?: number; pvp_hasta?: number | null; pct?: number; orden?: number };
        Update: Partial<Database["public"]["Tables"]["escala_rangos"]["Insert"]>;
        Relationships: [];
      };
      crm_contactos: {
        Row: {
          id: number; categoria: string; nombre: string; tipo_doc: string | null; documento: string | null;
          email: string | null; telefono: string | null; ciudad: string | null; pais: string | null;
          fecha_nacimiento: string | null; genero: string | null; origen: string | null; etiquetas: string[] | null;
          subcategoria: string | null;
          acepta_publicidad: boolean; no_contactar: boolean; notas: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: number; categoria?: string; nombre: string; tipo_doc?: string | null; documento?: string | null;
          email?: string | null; telefono?: string | null; ciudad?: string | null; pais?: string | null;
          fecha_nacimiento?: string | null; genero?: string | null; origen?: string | null; etiquetas?: string[] | null;
          subcategoria?: string | null;
          acepta_publicidad?: boolean; no_contactar?: boolean; notas?: string | null; created_at?: string; updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["crm_contactos"]["Insert"]>;
        Relationships: [];
      };
      crm_email_config: {
        Row: { id: number; proveedor: string; remitente_email: string | null; remitente_nombre: string | null; responder_a: string | null; api_key: string | null; firma_html: string | null; activo: boolean; updated_at: string };
        Insert: { id?: number; proveedor?: string; remitente_email?: string | null; remitente_nombre?: string | null; responder_a?: string | null; api_key?: string | null; firma_html?: string | null; activo?: boolean; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_email_config"]["Insert"]>;
        Relationships: [];
      };
      crm_campanas: {
        Row: { id: number; asunto: string; cuerpo_html: string | null; categoria: string | null; tipo: string; total: number; enviados: number; fallidos: number; estado: string; created_at: string };
        Insert: { id?: number; asunto: string; cuerpo_html?: string | null; categoria?: string | null; tipo?: string; total?: number; enviados?: number; fallidos?: number; estado?: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_campanas"]["Insert"]>;
        Relationships: [];
      };
      crm_material: {
        Row: { id: number; destino: string | null; hotel_producto: string; hotel_id: number | null; tipo_material: string | null; fuente: string | null; estado: string; prioridad: string; link_archivo: string | null; fecha_material: string | null; observaciones: string | null; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; destino?: string | null; hotel_producto: string; hotel_id?: number | null; tipo_material?: string | null; fuente?: string | null; estado?: string; prioridad?: string; link_archivo?: string | null; fecha_material?: string | null; observaciones?: string | null; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_material"]["Insert"]>;
        Relationships: [];
      };
      crm_envio: {
        Row: { id: number; material_id: number | null; destino: string | null; hotel_producto: string; tipo_material: string | null; fecha_envio: string; lista_enviada: string | null; canal: string | null; objetivo: string | null; enfoque: string | null; resultado: string; responsable: string | null; observaciones: string | null; created_at: string };
        Insert: { id?: number; material_id?: number | null; destino?: string | null; hotel_producto: string; tipo_material?: string | null; fecha_envio: string; lista_enviada?: string | null; canal?: string | null; objetivo?: string | null; enfoque?: string | null; resultado?: string; responsable?: string | null; observaciones?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_envio"]["Insert"]>;
        Relationships: [];
      };
      crm_difusion_plan: {
        Row: { id: number; material_id: number | null; fecha_programada: string; destino: string | null; hotel_producto: string | null; tipo_material: string | null; canal: string | null; lista_objetivo: string | null; enfoque: string | null; estado: string; observaciones: string | null; created_at: string; updated_at: string };
        Insert: { id?: number; material_id?: number | null; fecha_programada: string; destino?: string | null; hotel_producto?: string | null; tipo_material?: string | null; canal?: string | null; lista_objetivo?: string | null; enfoque?: string | null; estado?: string; observaciones?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["crm_difusion_plan"]["Insert"]>;
        Relationships: [];
      };
      contrato_adjuntos: {
        Row: { id: number; numero_contrato: string; tipo: string; nombre: string | null; path: string; size_bytes: number | null; subido_por: string | null; created_at: string };
        Insert: { id?: number; numero_contrato: string; tipo?: string; nombre?: string | null; path: string; size_bytes?: number | null; subido_por?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["contrato_adjuntos"]["Insert"]>;
        Relationships: [];
      };
      hotel_documentos: {
        Row: { id: number; hotel_id: number; tipo: string; nombre: string | null; path: string; size_bytes: number | null; subido_por: string | null; created_at: string };
        Insert: { id?: number; hotel_id: number; tipo?: string; nombre?: string | null; path: string; size_bytes?: number | null; subido_por?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["hotel_documentos"]["Insert"]>;
        Relationships: [];
      };
      hotel_acomodaciones: {
        Row: {
          id: number; hotel_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          pax_tarifa: number; pax_max: number;
          adt_min: number; adt_max: number;
          chd_min: number; chd_max: number;
          inf_min: number; inf_max: number;
          created_at: string;
        };
        Insert: {
          id?: number; hotel_id: number;
          acomodacion: Database["public"]["Enums"]["acomodacion_tipo"];
          pax_tarifa?: number; pax_max?: number;
          adt_min?: number; adt_max?: number;
          chd_min?: number; chd_max?: number;
          inf_min?: number; inf_max?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hotel_acomodaciones"]["Insert"]>;
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
          precio_persona: number | null; precio_grupo: number | null; categoria: string;
          descripcion: string | null; recargo_individual: number | null; moneda: string;
          liquidacion: Database["public"]["Enums"]["liquidacion_tipo"]; alcance: string; activo: boolean; created_at: string;
        };
        Insert: {
          id?: number; nombre: string; proveedor_id?: number | null; destino_id?: number | null;
          tarifa_neta?: number; temporada?: string | null; rangos_edad?: number[] | null; tipo_tarifa?: string;
          precio_persona?: number | null; precio_grupo?: number | null; categoria?: string;
          descripcion?: string | null; recargo_individual?: number | null; moneda?: string;
          liquidacion?: Database["public"]["Enums"]["liquidacion_tipo"]; alcance?: string; activo?: boolean; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["servicios_adicionales"]["Insert"]>;
        Relationships: [];
      };
      servicio_tarifa_pax: {
        Row: { id: number; servicio_id: number; pax_desde: number; pax_hasta: number; precio: number; temporada: string; created_at: string };
        Insert: { id?: number; servicio_id: number; pax_desde?: number; pax_hasta?: number; precio?: number; temporada?: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["servicio_tarifa_pax"]["Insert"]>;
        Relationships: [];
      };
      servicio_temporadas: {
        Row: { id: number; servicio_id: number; nombre: string; fecha_inicio: string | null; fecha_fin: string | null; prioridad: number; compra_inicio: string | null; compra_fin: string | null; precio_persona: number | null; recargo_individual: number | null; orden: number; created_at: string };
        Insert: { id?: number; servicio_id: number; nombre: string; fecha_inicio?: string | null; fecha_fin?: string | null; prioridad?: number; compra_inicio?: string | null; compra_fin?: string | null; precio_persona?: number | null; recargo_individual?: number | null; orden?: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["servicio_temporadas"]["Insert"]>;
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
          moneda: string;
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
          moneda?: string;
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
        Row: { id: number; paquete_id: number; servicio_id: number; modo: string; incluido: boolean };
        Insert: { id?: number; paquete_id: number; servicio_id: number; modo?: string; incluido?: boolean };
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
          descripcion: string | null;
          recargo_individual: number | null;
          moneda: string;
          salida_id: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          paquete_id: number;
          moneda?: string;
          salida_id?: number | null;
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
          descripcion?: string | null;
          recargo_individual?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["tarifario_resultado"]["Insert"]>;
        Relationships: [];
      };
      programas: {
        Row: {
          id: number;
          proveedor_id: number | null;
          nombre: string;
          subtitulo: string | null;
          dias: number | null;
          noches: number | null;
          moneda: string;
          salidas: string | null;
          vigencia_desde: string | null;
          vigencia_hasta: string | null;
          min_pax: number | null;
          max_pax: number | null;
          pct_mk: number;
          pct_fee_tarjeta: number;
          nino_edad_max: number | null;
          nino_valor_servicios: number | null;
          edad_nino_min: number;
          edad_nino_max: number;
          edad_infante_max: number;
          texto_condiciones: string | null;
          texto_cancelacion: string | null;
          texto_pagos: string | null;
          notas: string | null;
          highlights: string[];
          desde_precio: number | null;
          incluye_aereo: boolean;
          portada_url: string | null;
          flyer_url: string | null;
          historia_url: string | null;
          asistencia_medica_dia: number;
          modo_precio: string;
          video_url: string | null;
          activo: boolean;          publicado: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          proveedor_id?: number | null;
          nombre: string;
          subtitulo?: string | null;
          dias?: number | null;
          noches?: number | null;
          moneda?: string;
          salidas?: string | null;
          vigencia_desde?: string | null;
          vigencia_hasta?: string | null;
          min_pax?: number | null;
          max_pax?: number | null;
          pct_mk?: number;
          pct_fee_tarjeta?: number;
          nino_edad_max?: number | null;
          nino_valor_servicios?: number | null;
          edad_nino_min?: number;
          edad_nino_max?: number;
          edad_infante_max?: number;
          texto_condiciones?: string | null;
          texto_cancelacion?: string | null;
          texto_pagos?: string | null;
          notas?: string | null;
          highlights?: string[];
          desde_precio?: number | null;
          incluye_aereo?: boolean;
          portada_url?: string | null;
          flyer_url?: string | null;
          historia_url?: string | null;
          asistencia_medica_dia?: number;
          modo_precio?: string;
          video_url?: string | null;
          activo?: boolean;
          publicado?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["programas"]["Insert"]>;
        Relationships: [];
      };
      programa_salidas: {
        Row: {
          id: number;
          programa_id: number;
          orden: number;
          etiqueta: string | null;
          fecha_desde: string | null;
          fecha_hasta: string | null;
          noches: number | null;
          columna: string | null;
          neto_sencilla: number | null;
          neto_doble: number | null;
          neto_triple: number | null;
          neto_multiple: number | null;
          neto_nino: number | null;
          bajo_solicitud: boolean;
        };
        Insert: {
          id?: number;
          programa_id: number;
          orden?: number;
          etiqueta?: string | null;
          fecha_desde?: string | null;
          fecha_hasta?: string | null;
          noches?: number | null;
          columna?: string | null;
          neto_sencilla?: number | null;
          neto_doble?: number | null;
          neto_triple?: number | null;
          neto_multiple?: number | null;
          neto_nino?: number | null;
          bajo_solicitud?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["programa_salidas"]["Insert"]>;
        Relationships: [];
      };
      programa_ciudades: {
        Row: {
          id: number;
          programa_id: number;
          orden: number;
          nombre: string;
          codigo_iata: string | null;
          noches: number;
        };
        Insert: {
          id?: number;
          programa_id: number;
          orden?: number;
          nombre: string;
          codigo_iata?: string | null;
          noches?: number;
        };
        Update: Partial<Database["public"]["Tables"]["programa_ciudades"]["Insert"]>;
        Relationships: [];
      };
      programa_dias: {
        Row: {
          id: number;
          programa_id: number;
          dia: number;
          titulo: string | null;
          desayuno: boolean;
          almuerzo: boolean;
          cena: boolean;
          descripcion: string | null;
        };
        Insert: {
          id?: number;
          programa_id: number;
          dia: number;
          titulo?: string | null;
          desayuno?: boolean;
          almuerzo?: boolean;
          cena?: boolean;
          descripcion?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["programa_dias"]["Insert"]>;
        Relationships: [];
      };
      programa_categorias: {
        Row: {
          id: number;
          programa_id: number;
          orden: number;
          nombre: string | null;
        };
        Insert: {
          id?: number;
          programa_id: number;
          orden?: number;
          nombre?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["programa_categorias"]["Insert"]>;
        Relationships: [];
      };
      programa_categoria_hoteles: {
        Row: {
          id: number;
          categoria_id: number;
          ciudad: string;
          hotel: string | null;
          orden: number;
        };
        Insert: {
          id?: number;
          categoria_id: number;
          ciudad: string;
          hotel?: string | null;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["programa_categoria_hoteles"]["Insert"]>;
        Relationships: [];
      };
      programa_precios: {
        Row: {
          id: number;
          categoria_id: number;
          acomodacion: string;
          neto: number | null;
          bajo_solicitud: boolean;
        };
        Insert: {
          id?: number;
          categoria_id: number;
          acomodacion: string;
          neto?: number | null;
          bajo_solicitud?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["programa_precios"]["Insert"]>;
        Relationships: [];
      };
      programa_inclusiones: {
        Row: {
          id: number;
          programa_id: number;
          ciudad: string | null;
          tipo: string;
          texto: string;
          orden: number;
        };
        Insert: {
          id?: number;
          programa_id: number;
          ciudad?: string | null;
          tipo: string;
          texto: string;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["programa_inclusiones"]["Insert"]>;
        Relationships: [];
      };
      programa_tours: {
        Row: {
          id: number;
          programa_id: number;
          ciudad: string | null;
          nombre: string;
          precio: number | null;
          min_pax: number;
          dias_operacion: string | null;
          descripcion: string | null;
          orden: number;
        };
        Insert: {
          id?: number;
          programa_id: number;
          ciudad?: string | null;
          nombre: string;
          precio?: number | null;
          min_pax?: number;
          dias_operacion?: string | null;
          descripcion?: string | null;
          orden?: number;
        };
        Update: Partial<Database["public"]["Tables"]["programa_tours"]["Insert"]>;
        Relationships: [];
      };
      programa_blackouts: {
        Row: {
          id: number;
          programa_id: number;
          fecha_inicio: string | null;
          fecha_fin: string | null;
          motivo: string | null;
          ciudad: string | null;
        };
        Insert: {
          id?: number;
          programa_id: number;
          fecha_inicio?: string | null;
          fecha_fin?: string | null;
          motivo?: string | null;
          ciudad?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["programa_blackouts"]["Insert"]>;
        Relationships: [];
      };
      cotizaciones: {
        Row: {
          id: number;
          codigo: string;
          tipo: string;
          created_at: string;
          estado: string;
          payload: Json | null;
          detalle: Json | null;
          cliente: string | null;
          cliente_documento: string | null;
          destino: string | null;
          hotel: string | null;
          modulo: string | null;
          plan_nombre: string | null;
          pax: number | null;
          precio_venta: number | null;
          moneda: string | null;
          fecha_salida: string | null;
          fecha_regreso: string | null;
          vigencia_hasta: string | null;
          paquete_armado_id: number | null;
          asesor: string | null;
          creado_por: string | null;
          numero_contrato: string | null;
          share_token: string;
        };
        Insert: {
          id?: number;
          codigo?: string;
          tipo?: string;
          share_token?: string;
          created_at?: string;
          estado?: string;
          payload?: Json | null;
          detalle?: Json | null;
          cliente?: string | null;
          cliente_documento?: string | null;
          destino?: string | null;
          hotel?: string | null;
          modulo?: string | null;
          plan_nombre?: string | null;
          pax?: number | null;
          precio_venta?: number | null;
          moneda?: string | null;
          fecha_salida?: string | null;
          fecha_regreso?: string | null;
          vigencia_hasta?: string | null;
          paquete_armado_id?: number | null;
          asesor?: string | null;
          creado_por?: string | null;
          numero_contrato?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["cotizaciones"]["Insert"]>;
        Relationships: [];
      };
      cotizacion_servicios: {
        Row: {
          id: number;
          cotizacion_id: number;
          orden: number;
          tipo_servicio: string;
          plataforma: string | null;
          nombre_servicio: string | null;
          proveedor: string | null;
          costo_neto: number;
          modo: string;
          pct_markup: number;
          ta: number;
          valor: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          cotizacion_id: number;
          orden?: number;
          tipo_servicio: string;
          plataforma?: string | null;
          nombre_servicio?: string | null;
          proveedor?: string | null;
          costo_neto?: number;
          modo?: string;
          pct_markup?: number;
          ta?: number;
          valor?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cotizacion_servicios"]["Insert"]>;
        Relationships: [];
      };
      hotel_fotos: {
        Row: {
          id: number;
          hotel_id: number;
          path: string;
          url: string;
          orden: number;
          es_portada: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          hotel_id: number;
          path: string;
          url: string;
          orden?: number;
          es_portada?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hotel_fotos"]["Insert"]>;
        Relationships: [];
      };
      config_solicitudes: {
        Row: {
          id: number;
          whatsapp: string | null;
          emails: string | null;
          mensaje_extra: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          whatsapp?: string | null;
          emails?: string | null;
          mensaje_extra?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["config_solicitudes"]["Insert"]>;
        Relationships: [];
      };
      config_sitio: {
        Row: {
          id: number;
          video_fondo_url: string | null;
          link_pago: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          video_fondo_url?: string | null;
          link_pago?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["config_sitio"]["Insert"]>;
        Relationships: [];
      };
      b2b_solicitudes: {
        Row: {
          id: number; tipo: string; nombre: string; nit: string | null; contacto: string | null;
          email: string; telefono: string | null; ciudad: string | null; notas: string | null;
          acepta_notificaciones: boolean; estado: string; usuario_id: string | null;
          revisado_por: string | null; revisado_at: string | null; created_at: string;
        };
        Insert: {
          id?: number; tipo?: string; nombre: string; nit?: string | null; contacto?: string | null;
          email: string; telefono?: string | null; ciudad?: string | null; notas?: string | null;
          acepta_notificaciones?: boolean; estado?: string; usuario_id?: string | null;
          revisado_por?: string | null; revisado_at?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["b2b_solicitudes"]["Insert"]>;
        Relationships: [];
      };
      permisos_rol: {
        Row: { rol: string; modulo: string; consultar: boolean; modificar: boolean; eliminar: boolean };
        Insert: { rol: string; modulo: string; consultar?: boolean; modificar?: boolean; eliminar?: boolean };
        Update: Partial<Database["public"]["Tables"]["permisos_rol"]["Insert"]>;
        Relationships: [];
      };
      permisos_usuario: {
        Row: { usuario_id: string; modulo: string; consultar: boolean; modificar: boolean; eliminar: boolean };
        Insert: { usuario_id: string; modulo: string; consultar?: boolean; modificar?: boolean; eliminar?: boolean };
        Update: Partial<Database["public"]["Tables"]["permisos_usuario"]["Insert"]>;
        Relationships: [];
      };
      vouchers: {
        Row: {
          id: number;
          numero_contrato: string;
          tipo: string;
          proveedor: string | null;
          contenido: Json;
          share_token: string;
          created_at: string;
        };
        Insert: {
          id?: number;
          numero_contrato: string;
          tipo?: string;
          proveedor?: string | null;
          contenido: Json;
          share_token?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vouchers"]["Insert"]>;
        Relationships: [];
      };
      config_cobros: {
        Row: { tipo_paquete: string; pct_abono: number; updated_at: string };
        Insert: { tipo_paquete: string; pct_abono?: number; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["config_cobros"]["Insert"]>;
        Relationships: [];
      };
      cuotas: {
        Row: { id: number; numero_contrato: string; orden: number; tipo: string; fecha_limite: string; monto: number; created_at: string };
        Insert: { id?: number; numero_contrato: string; orden: number; tipo: string; fecha_limite: string; monto: number; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["cuotas"]["Insert"]>;
        Relationships: [];
      };
      config_notificaciones: {
        Row: { id: number; remitente: string; destinatarios: string | null; dias_anticipacion: number; alerta_cxp: boolean; alerta_cuotas: boolean; alerta_bloqueos: boolean; activo: boolean; updated_at: string };
        Insert: { id?: number; remitente?: string; destinatarios?: string | null; dias_anticipacion?: number; alerta_cxp?: boolean; alerta_cuotas?: boolean; alerta_bloqueos?: boolean; activo?: boolean; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["config_notificaciones"]["Insert"]>;
        Relationships: [];
      };
      hotel_blackouts: {
        Row: { id: number; hotel_id: number; fecha_inicio: string; fecha_fin: string; total: boolean; acomodaciones: string[] | null; motivo: string | null; created_at: string };
        Insert: { id?: number; hotel_id: number; fecha_inicio: string; fecha_fin: string; total?: boolean; acomodaciones?: string[] | null; motivo?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["hotel_blackouts"]["Insert"]>;
        Relationships: [];
      };
      web_paquetes: {
        Row: { id: number; titulo: string; region: string | null; destino: string | null; duracion: string | null; personas: string | null; precio_desde: string | null; descripcion: string | null; descripcion_larga: string | null; incluye: string[]; no_incluye: string[]; imagen_url: string | null; galeria: string[]; destacado: boolean; cta_url: string | null; orden: number; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; titulo: string; region?: string | null; destino?: string | null; duracion?: string | null; personas?: string | null; precio_desde?: string | null; descripcion?: string | null; descripcion_larga?: string | null; incluye?: string[]; no_incluye?: string[]; imagen_url?: string | null; galeria?: string[]; destacado?: boolean; cta_url?: string | null; orden?: number; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_paquetes"]["Insert"]>;
        Relationships: [];
      };
      web_destinos: {
        Row: { id: number; nombre: string; region: string | null; imagen_url: string | null; tips: string[]; orden: number; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; nombre: string; region?: string | null; imagen_url?: string | null; tips?: string[]; orden?: number; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_destinos"]["Insert"]>;
        Relationships: [];
      };
      web_testimonios: {
        Row: { id: number; nombre: string; ubicacion: string | null; rating: number; comentario: string; imagen_url: string | null; orden: number; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; nombre: string; ubicacion?: string | null; rating?: number; comentario: string; imagen_url?: string | null; orden?: number; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_testimonios"]["Insert"]>;
        Relationships: [];
      };
      web_blog: {
        Row: { id: number; titulo: string; slug: string | null; categoria: string | null; fecha: string | null; resumen: string | null; contenido: string | null; imagen_url: string | null; orden: number; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; titulo: string; slug?: string | null; categoria?: string | null; fecha?: string | null; resumen?: string | null; contenido?: string | null; imagen_url?: string | null; orden?: number; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_blog"]["Insert"]>;
        Relationships: [];
      };
      web_config: {
        Row: { id: number; hero_titulo: string | null; hero_subtitulo: string | null; hero_imagen_url: string | null; hero_cta_texto: string | null; hero_cta_url: string | null; nosotros_titulo: string | null; nosotros_texto: string | null; nosotros_imagen_url: string | null; contacto_email: string | null; contacto_telefono: string | null; whatsapp_numero: string | null; whatsapp_mensaje: string | null; direccion: string | null; instagram_url: string | null; facebook_url: string | null; tiktok_url: string | null; extra: Json; updated_at: string };
        Insert: { id?: number; hero_titulo?: string | null; hero_subtitulo?: string | null; hero_imagen_url?: string | null; hero_cta_texto?: string | null; hero_cta_url?: string | null; nosotros_titulo?: string | null; nosotros_texto?: string | null; nosotros_imagen_url?: string | null; contacto_email?: string | null; contacto_telefono?: string | null; whatsapp_numero?: string | null; whatsapp_mensaje?: string | null; direccion?: string | null; instagram_url?: string | null; facebook_url?: string | null; tiktok_url?: string | null; extra?: Json; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_config"]["Insert"]>;
        Relationships: [];
      };
      web_paginas: {
        Row: { id: number; parent_id: number | null; slug: string; titulo: string; etiqueta_menu: string | null; tipo: string; es_grupo_menu: boolean; en_menu: boolean; orden: number; seo_titulo: string | null; seo_descripcion: string | null; imagen_portada: string | null; activo: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; parent_id?: number | null; slug: string; titulo: string; etiqueta_menu?: string | null; tipo?: string; es_grupo_menu?: boolean; en_menu?: boolean; orden?: number; seo_titulo?: string | null; seo_descripcion?: string | null; imagen_portada?: string | null; activo?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_paginas"]["Insert"]>;
        Relationships: [];
      };
      web_secciones: {
        Row: { id: number; pagina_id: number; tipo: string; orden: number; datos: Json; visible: boolean; created_at: string; updated_at: string };
        Insert: { id?: number; pagina_id: number; tipo: string; orden?: number; datos?: Json; visible?: boolean; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["web_secciones"]["Insert"]>;
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
      fn_fusionar_destino: {
        Args: { p_origen: number; p_destino: number };
        Returns: undefined;
      };
      siguiente_numero_contrato: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      eliminar_contrato: {
        Args: { p_numero: string; p_reusar: boolean };
        Returns: undefined;
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
      tarifario_modulo: "bloqueo" | "porcion_terrestre" | "servicios" | "dinamico";
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
