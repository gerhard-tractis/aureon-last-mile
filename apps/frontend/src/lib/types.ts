export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          changes_json: Json | null
          id: string
          ip_address: string | null
          operator_id: string
          resource_id: string | null
          resource_type: string | null
          timestamp: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          changes_json?: Json | null
          id?: string
          ip_address?: string | null
          operator_id: string
          resource_id?: string | null
          resource_type?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          changes_json?: Json | null
          id?: string
          ip_address?: string | null
          operator_id?: string
          resource_id?: string | null
          resource_type?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      hub_receptions: {
        Row: {
          id: string
          manifest_id: string
          operator_id: string
          received_by: string | null
          delivered_by: string | null
          status: string
          started_at: string | null
          completed_at: string | null
          expected_count: number
          received_count: number
          discrepancy_notes: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          manifest_id: string
          operator_id: string
          received_by?: string | null
          delivered_by?: string | null
          status?: string
          started_at?: string | null
          completed_at?: string | null
          expected_count?: number
          received_count?: number
          discrepancy_notes?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          manifest_id?: string
          operator_id?: string
          received_by?: string | null
          delivered_by?: string | null
          status?: string
          started_at?: string | null
          completed_at?: string | null
          expected_count?: number
          received_count?: number
          discrepancy_notes?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hub_receptions_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_receptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_receptions_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hub_receptions_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_trigger_failures: {
        Row: {
          error_detail: string | null
          error_message: string
          id: string
          operation: string
          table_name: string
          timestamp: string | null
        }
        Insert: {
          error_detail?: string | null
          error_message: string
          id?: string
          operation: string
          table_name: string
          timestamp?: string | null
        }
        Update: {
          error_detail?: string | null
          error_message?: string
          id?: string
          operation?: string
          table_name?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      barcode_scans: {
        Row: {
          barcode: string
          id: string
          latitude: number | null
          longitude: number | null
          manifest_id: string | null
          metadata: Json | null
          operator_id: string
          order_id: string | null
          scanned_at: string | null
          scanned_by: string
        }
        Insert: {
          barcode: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          manifest_id?: string | null
          metadata?: Json | null
          operator_id: string
          order_id?: string | null
          scanned_at?: string | null
          scanned_by: string
        }
        Update: {
          barcode?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          manifest_id?: string | null
          metadata?: Json | null
          operator_id?: string
          order_id?: string | null
          scanned_at?: string | null
          scanned_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "barcode_scans_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barcode_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barcode_scans_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      discrepancy_notes: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          deleted_at: string | null
          id: string
          manifest_id: string
          note: string
          operator_id: string
          package_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          manifest_id: string
          note: string
          operator_id: string
          package_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          id?: string
          manifest_id?: string
          note?: string
          operator_id?: string
          package_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discrepancy_notes_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_notes_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancy_notes_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      manifests: {
        Row: {
          assigned_to_user_id: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          external_load_id: string
          id: string
          operator_id: string
          pickup_location: string | null
          retailer_name: string | null
          signature_client: string | null
          signature_client_name: string | null
          signature_operator: string | null
          signature_operator_name: string | null
          started_at: string | null
          reception_status: string | null
          status: string
          total_orders: number | null
          total_packages: number | null
          updated_at: string
        }
        Insert: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          external_load_id: string
          id?: string
          operator_id: string
          pickup_location?: string | null
          reception_status?: string | null
          retailer_name?: string | null
          signature_client?: string | null
          signature_client_name?: string | null
          signature_operator?: string | null
          signature_operator_name?: string | null
          started_at?: string | null
          status?: string
          total_orders?: number | null
          total_packages?: number | null
          updated_at?: string
        }
        Update: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          external_load_id?: string
          id?: string
          operator_id?: string
          pickup_location?: string | null
          reception_status?: string | null
          retailer_name?: string | null
          signature_client?: string | null
          signature_client_name?: string | null
          signature_operator?: string | null
          signature_operator_name?: string | null
          started_at?: string | null
          status?: string
          total_orders?: number | null
          total_packages?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manifests_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          country_code: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          is_active: boolean | null
          name: string
          settings: Json | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          country_code?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          settings?: Json | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          country_code?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          settings?: Json | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      chile_comunas: {
        Row: {
          id: string
          codigo_cut: string
          nombre: string
          provincia: string
          region: string
          region_num: number
          geometry: string | null
        }
        Insert: {
          id?: string
          codigo_cut: string
          nombre: string
          provincia: string
          region: string
          region_num: number
          geometry?: string | null
        }
        Update: {
          id?: string
          codigo_cut?: string
          nombre?: string
          provincia?: string
          region?: string
          region_num?: number
          geometry?: string | null
        }
        Relationships: []
      }
      chile_comuna_aliases: {
        Row: {
          id: string
          alias: string
          comuna_id: string
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          alias: string
          comuna_id: string
          source?: string
          created_at?: string
        }
        Update: {
          id?: string
          alias?: string
          comuna_id?: string
          source?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chile_comuna_aliases_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_zone_comunas: {
        Row: { dock_zone_id: string; comuna_id: string }
        Insert: { dock_zone_id: string; comuna_id: string }
        Update: { dock_zone_id?: string; comuna_id?: string }
        Relationships: [
          {
            foreignKeyName: "dock_zone_comunas_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_zone_comunas_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_zones: {
        Row: {
          id: string
          operator_id: string
          name: string
          code: string
          is_consolidation: boolean
          is_active: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          name: string
          code: string
          is_consolidation?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          name?: string
          code?: string
          is_consolidation?: boolean
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dock_zones_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_batches: {
        Row: {
          id: string
          operator_id: string
          dock_zone_id: string
          status: string
          package_count: number
          created_by: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          dock_zone_id: string
          status?: string
          package_count?: number
          created_by: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          dock_zone_id?: string
          status?: string
          package_count?: number
          created_by?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dock_batches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_batches_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_scans: {
        Row: {
          id: string
          operator_id: string
          batch_id: string
          barcode: string
          scan_result: string
          package_id: string | null
          scanned_by: string
          scanned_at: string
          created_at: string
          deleted_at: string | null
          redirect_reason: string | null
          manual_override: boolean
          dock_zone_id: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          batch_id?: string
          barcode: string
          scan_result: string
          package_id?: string | null
          scanned_by: string
          scanned_at?: string
          created_at?: string
          deleted_at?: string | null
          redirect_reason?: string | null
          manual_override?: boolean
          dock_zone_id?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          batch_id?: string
          barcode?: string
          scan_result?: string
          package_id?: string | null
          scanned_by?: string
          scanned_at?: string
          created_at?: string
          deleted_at?: string | null
          redirect_reason?: string | null
          manual_override?: boolean
          dock_zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dock_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "dock_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_verifications: {
        Row: {
          id: string
          operator_id: string
          package_id: string
          verified_by: string
          verified_at: string
          source: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          package_id: string
          verified_by: string
          verified_at?: string
          source: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          package_id?: string
          verified_by?: string
          verified_at?: string
          source?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      packages: {
        Row: {
          id: string
          operator_id: string
          order_id: string
          label: string
          package_number: string | null
          declared_box_count: number | null
          is_generated_label: boolean | null
          parent_label: string | null
          sku_items: Json
          declared_weight_kg: number | null
          declared_dimensions: Json | null
          verified_weight_kg: number | null
          verified_dimensions: Json | null
          metadata: Json | null
          raw_data: Json
          status: string
          status_updated_at: string | null
          dock_zone_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          order_id: string
          label: string
          package_number?: string | null
          declared_box_count?: number | null
          is_generated_label?: boolean | null
          parent_label?: string | null
          sku_items?: Json
          declared_weight_kg?: number | null
          declared_dimensions?: Json | null
          verified_weight_kg?: number | null
          verified_dimensions?: Json | null
          metadata?: Json | null
          raw_data: Json
          status?: string
          status_updated_at?: string | null
          dock_zone_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          order_id?: string
          label?: string
          package_number?: string | null
          declared_box_count?: number | null
          is_generated_label?: boolean | null
          parent_label?: string | null
          sku_items?: Json
          declared_weight_kg?: number | null
          declared_dimensions?: Json | null
          verified_weight_kg?: number | null
          verified_dimensions?: Json | null
          metadata?: Json | null
          raw_data?: Json
          status?: string
          status_updated_at?: string | null
          dock_zone_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_scans: {
        Row: {
          barcode_scanned: string
          created_at: string
          deleted_at: string | null
          id: string
          manifest_id: string
          operator_id: string
          package_id: string | null
          scan_result: string
          scanned_at: string
          scanned_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          barcode_scanned: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id: string
          operator_id: string
          package_id?: string | null
          scan_result: string
          scanned_at: string
          scanned_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode_scanned?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id?: string
          operator_id?: string
          package_id?: string | null
          scan_result?: string
          scanned_at?: string
          scanned_by_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_scans_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_scans_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      reception_scans: {
        Row: {
          id: string
          reception_id: string
          package_id: string | null
          operator_id: string
          scanned_by: string | null
          barcode: string
          scan_result: string
          scanned_at: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          reception_id: string
          package_id?: string | null
          operator_id: string
          scanned_by?: string | null
          barcode: string
          scan_result: string
          scanned_at: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          reception_id?: string
          package_id?: string | null
          operator_id?: string
          scanned_by?: string | null
          barcode?: string
          scan_result?: string
          scanned_at?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reception_scans_reception_id_fkey"
            columns: ["reception_id"]
            isOneToOne: false
            referencedRelation: "hub_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_scans_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reception_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          id: string
          operator_id: string
          order_number: string
          customer_name: string
          customer_phone: string
          delivery_address: string
          comuna: string
          comuna_id: string | null
          comuna_raw: string | null
          delivery_date: string
          delivery_window_start: string | null
          delivery_window_end: string | null
          retailer_name: string | null
          external_load_id: string | null
          recipient_region: string | null
          raw_data: Json
          metadata: Json | null
          imported_via: 'API' | 'EMAIL' | 'MANUAL' | 'CSV'
          imported_at: string
          created_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          order_number: string
          customer_name: string
          customer_phone: string
          delivery_address: string
          comuna: string
          comuna_id?: string | null
          comuna_raw?: string | null
          delivery_date: string
          delivery_window_start?: string | null
          delivery_window_end?: string | null
          retailer_name?: string | null
          external_load_id?: string | null
          recipient_region?: string | null
          raw_data: Json
          metadata?: Json | null
          imported_via: 'API' | 'EMAIL' | 'MANUAL' | 'CSV'
          imported_at: string
          created_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          order_number?: string
          customer_name?: string
          customer_phone?: string
          delivery_address?: string
          comuna?: string
          comuna_id?: string | null
          comuna_raw?: string | null
          delivery_date?: string
          delivery_window_start?: string | null
          delivery_window_end?: string | null
          retailer_name?: string | null
          external_load_id?: string | null
          recipient_region?: string | null
          raw_data?: Json
          metadata?: Json | null
          imported_via?: 'API' | 'EMAIL' | 'MANUAL' | 'CSV'
          imported_at?: string
          created_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      todo_list: {
        Row: {
          created_at: string
          description: string | null
          done: boolean
          done_at: string | null
          id: number
          owner: string
          title: string
          urgent: boolean
        }
        Insert: {
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          id?: number
          owner: string
          title: string
          urgent?: boolean
        }
        Update: {
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          id?: number
          owner?: string
          title?: string
          urgent?: boolean
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string | null
          full_name: string | null
          id: string
          operator_id: string
          role: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          full_name?: string | null
          id: string
          operator_id: string
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string | null
          id?: string
          operator_id?: string
          role?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_attempts: {
        Row: {
          id: string
          operator_id: string
          order_id: string
          attempt_number: number
          status: Database["public"]["Enums"]["delivery_attempt_status_enum"]
          failure_reason: string | null
          attempted_at: string
          driver_id: string | null
          created_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          order_id: string
          attempt_number: number
          status: Database["public"]["Enums"]["delivery_attempt_status_enum"]
          failure_reason?: string | null
          attempted_at: string
          driver_id?: string | null
          created_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          order_id?: string
          attempt_number?: number
          status?: Database["public"]["Enums"]["delivery_attempt_status_enum"]
          failure_reason?: string | null
          attempted_at?: string
          driver_id?: string | null
          created_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_attempts_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_metrics: {
        Row: {
          id: string
          operator_id: string
          metric_date: string
          retailer_name: string | null
          total_orders: number
          delivered_orders: number
          first_attempt_deliveries: number
          failed_deliveries: number
          shortage_claims_count: number
          shortage_claims_amount_clp: number
          avg_delivery_time_minutes: number | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          metric_date: string
          retailer_name?: string | null
          total_orders?: number
          delivered_orders?: number
          first_attempt_deliveries?: number
          failed_deliveries?: number
          shortage_claims_count?: number
          shortage_claims_amount_clp?: number
          avg_delivery_time_minutes?: number | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          metric_date?: string
          retailer_name?: string | null
          total_orders?: number
          delivered_orders?: number
          first_attempt_deliveries?: number
          failed_deliveries?: number
          shortage_claims_count?: number
          shortage_claims_amount_clp?: number
          avg_delivery_time_minutes?: number | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_metrics_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          operator_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          operator_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          operator_id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicles: {
        Row: {
          id: string
          operator_id: string
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_vehicle_id: string | null
          plate_number: string | null
          vehicle_type: string | null
          driver_name: string | null
          raw_data: Json
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_vehicle_id?: string | null
          plate_number?: string | null
          vehicle_type?: string | null
          driver_name?: string | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          external_vehicle_id?: string | null
          plate_number?: string | null
          vehicle_type?: string | null
          driver_name?: string | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          id: string
          operator_id: string
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_route_id: string
          route_date: string
          driver_name: string | null
          vehicle_id: string | null
          status: Database["public"]["Enums"]["route_status_enum"]
          planned_stops: number | null
          completed_stops: number
          start_time: string | null
          end_time: string | null
          total_km: number | null
          idle_time_minutes: number | null
          raw_data: Json
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_route_id: string
          route_date: string
          driver_name?: string | null
          vehicle_id?: string | null
          status?: Database["public"]["Enums"]["route_status_enum"]
          planned_stops?: number | null
          completed_stops?: number
          start_time?: string | null
          end_time?: string | null
          total_km?: number | null
          idle_time_minutes?: number | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          external_route_id?: string
          route_date?: string
          driver_name?: string | null
          vehicle_id?: string | null
          status?: Database["public"]["Enums"]["route_status_enum"]
          planned_stops?: number | null
          completed_stops?: number
          start_time?: string | null
          end_time?: string | null
          total_km?: number | null
          idle_time_minutes?: number | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routes_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatches: {
        Row: {
          id: string
          operator_id: string
          route_id: string | null
          order_id: string | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_dispatch_id: string | null
          external_route_id: string | null
          status: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus: string | null
          substatus_code: string | null
          planned_sequence: number | null
          estimated_at: string | null
          arrived_at: string | null
          completed_at: string | null
          failure_reason: string | null
          driver_notes: string | null
          is_pickup: boolean
          latitude: number | null
          longitude: number | null
          raw_data: Json
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          route_id?: string | null
          order_id?: string | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_dispatch_id?: string | null
          external_route_id?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          planned_sequence?: number | null
          estimated_at?: string | null
          arrived_at?: string | null
          completed_at?: string | null
          failure_reason?: string | null
          driver_notes?: string | null
          is_pickup?: boolean
          latitude?: number | null
          longitude?: number | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          route_id?: string | null
          order_id?: string | null
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          external_dispatch_id?: string | null
          external_route_id?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          planned_sequence?: number | null
          estimated_at?: string | null
          arrived_at?: string | null
          completed_at?: string | null
          failure_reason?: string | null
          driver_notes?: string | null
          is_pickup?: boolean
          latitude?: number | null
          longitude?: number | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dispatches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_clients: {
        Row: {
          id: string
          operator_id: string
          name: string
          slug: string
          connector_type: string | null
          connector_config: Json
          is_active: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          name: string
          slug: string
          connector_type?: string | null
          connector_config?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          name?: string
          slug?: string
          connector_type?: string | null
          connector_config?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_clients_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_points: {
        Row: {
          id: string
          operator_id: string
          tenant_client_id: string
          name: string
          code: string
          intake_method: string
          intake_config: Json
          parsing_rules: Json
          order_defaults: Json
          confirmation_config: Json
          sla_config: Json
          pickup_locations: Json
          is_active: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          tenant_client_id: string
          name: string
          code: string
          intake_method: string
          intake_config?: Json
          parsing_rules?: Json
          order_defaults?: Json
          confirmation_config?: Json
          sla_config?: Json
          pickup_locations?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          tenant_client_id?: string
          name?: string
          code?: string
          intake_method?: string
          intake_config?: Json
          parsing_rules?: Json
          order_defaults?: Json
          confirmation_config?: Json
          sla_config?: Json
          pickup_locations?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_points_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_points_tenant_client_id_fkey"
            columns: ["tenant_client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_old_audit_logs: { Args: never; Returns: undefined }
      create_audit_logs_partition: {
        Args: { partition_date: string }
        Returns: undefined
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      get_operator_id: { Args: never; Returns: string }
      log_audit_event: {
        Args: {
          p_action: string
          p_changes: Json
          p_resource_id: string
          p_resource_type: string
        }
        Returns: undefined
      }
      set_config: {
        Args: {
          is_local?: boolean
          setting_name: string
          setting_value: string
        }
        Returns: string
      }
      validate_audit_logging: {
        Args: never
        Returns: {
          details: string
          status: string
          test_name: string
        }[]
      }
      calculate_sla: {
        Args: {
          p_operator_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: number | null
      }
      calculate_fadr: {
        Args: {
          p_operator_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: number | null
      }
      get_failure_reasons: {
        Args: {
          p_operator_id: string
          p_start_date: string
          p_end_date: string
        }
        Returns: { reason: string; count: number; percentage: number }[]
      }
      calculate_daily_metrics: {
        Args: {
          p_date: string
        }
        Returns: undefined
      }
      normalize_comuna_id: {
        Args: { raw_name: string }
        Returns: string | null
      }
      map_comuna_alias: {
        Args: { p_alias: string; p_comuna_id: string; p_source?: string }
        Returns: undefined
      }
      get_unmatched_comunas: {
        Args: { p_operator_id: string }
        Returns: { comuna_raw: string; order_count: number }[]
      }
      get_ops_control_snapshot: {
        Args: { p_operator_id: string }
        Returns: Json
      }
      get_pre_route_snapshot: {
        Args: {
          p_operator_id: string
          p_delivery_date: string
          p_window_start?: string | null
          p_window_end?: string | null
        }
        Returns: Json
      }
      create_seeded_route: {
        Args: {
          p_operator_id: string
          p_order_ids: string[]
        }
        Returns: Json
      }
    }
    Enums: {
      routing_provider_enum:
        | "dispatchtrack"
        | "simpliroute"
        | "drivin"
      route_status_enum:
        | "draft"
        | "planned"
        | "in_progress"
        | "completed"
        | "cancelled"
      dispatch_status_enum:
        | "pending"
        | "delivered"
        | "failed"
        | "partial"
      batch_status_enum:
        | "open"
        | "closed"
      dock_scan_result_enum:
        | "accepted"
        | "rejected"
      delivery_attempt_status_enum:
        | "success"
        | "failed"
        | "returned"
      imported_via_enum:
        | "API"
        | "EMAIL"
        | "MANUAL"
        | "CSV"
      hub_reception_status_enum:
        | "pending"
        | "in_progress"
        | "completed"
      package_status_enum:
        | "ingresado"
        | "verificado"
        | "en_bodega"
        | "sectorizado"
        | "retenido"
        | "asignado"
        | "en_carga"
        | "listo_para_despacho"
        | "en_ruta"
        | "entregado"
        | "cancelado"
        | "devuelto"
        | "dañado"
        | "extraviado"
      reception_scan_result_enum:
        | "received"
        | "not_found"
        | "duplicate"
      reception_status_enum:
        | "awaiting_reception"
        | "reception_in_progress"
        | "received"
      user_role:
        | "pickup_crew"
        | "warehouse_staff"
        | "loading_crew"
        | "operations_manager"
        | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      delivery_attempt_status_enum: [
        "success",
        "failed",
        "returned",
      ],
      hub_reception_status_enum: [
        "pending",
        "in_progress",
        "completed",
      ],
      package_status_enum: [
        "ingresado",
        "verificado",
        "en_bodega",
        "asignado",
        "en_carga",
        "listo_para_despacho",
        "en_ruta",
        "entregado",
        "cancelado",
        "devuelto",
        "dañado",
        "extraviado",
      ],
      reception_scan_result_enum: [
        "received",
        "not_found",
        "duplicate",
      ],
      reception_status_enum: [
        "awaiting_reception",
        "reception_in_progress",
        "received",
      ],
      user_role: [
        "pickup_crew",
        "warehouse_staff",
        "loading_crew",
        "operations_manager",
        "admin",
      ],
    },
  },
} as const

// ── Pre-Ruta domain types (spec-37) ──────────────────────────────────────────

export type PreRouteOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_address: string;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  package_count: number;
  has_split_dock_zone: boolean;
};

export type PreRouteComuna = {
  id: string;
  name: string;
  order_count: number;
  package_count: number;
  orders: PreRouteOrder[];
};

export type PreRouteAnden = {
  id: string;
  name: string;
  comunas_list: string[];
  order_count: number;
  package_count: number;
  comunas: PreRouteComuna[];
  order_ids: string[];
  has_split_dock_zone_warnings: boolean;
};

export type PreRouteSnapshot = {
  generated_at: string;
  totals: {
    order_count: number;
    package_count: number;
    anden_count: number;
    split_dock_zone_order_count: number;
  };
  andenes: PreRouteAnden[];
  unmapped_comunas: { id: string; name: string; order_count: number; package_count: number }[];
};
