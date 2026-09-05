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
          labels_printed_at: string | null
          labels_printed_by: string | null
          operator_id: string
          pickup_location: string | null
          pickup_route_id: string | null
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
          labels_printed_at?: string | null
          labels_printed_by?: string | null
          operator_id: string
          pickup_location?: string | null
          pickup_route_id?: string | null
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
          labels_printed_at?: string | null
          labels_printed_by?: string | null
          operator_id?: string
          pickup_location?: string | null
          pickup_route_id?: string | null
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
          {
            foreignKeyName: "manifests_pickup_route_id_fkey"
            columns: ["pickup_route_id"]
            isOneToOne: false
            referencedRelation: "pickup_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manifests_labels_printed_by_fkey"
            columns: ["labels_printed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      /**
       * spec-61 — who besides the leader is on a pickup trip. Read-only from
       * the frontend: `authenticated` holds SELECT and nothing else
       * (20260820000004), and both writers (start_pickup_route, the
       * route-status trigger) are SECURITY DEFINER. Insert/Update are typed
       * because the generated shape has them, not because the client may use
       * them — a PostgREST write here fails on the grant.
       */
      pickup_route_crew: {
        Row: {
          added_at: string
          added_by: string
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          pickup_route_id: string
          removed_at: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          pickup_route_id: string
          removed_at?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          pickup_route_id?: string
          removed_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_route_crew_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_route_crew_pickup_route_id_fkey"
            columns: ["pickup_route_id"]
            isOneToOne: false
            referencedRelation: "pickup_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_route_crew_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_route_crew_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_routes: {
        Row: {
          cancelled_at: string | null
          code: string
          created_at: string
          deleted_at: string | null
          driver_id: string
          id: string
          in_transit_at: string | null
          operator_id: string
          received_at: string | null
          started_at: string
          status: string
          updated_at: string
          vehicle_id: string | null
          /** @deprecated spec-52 — read the joined vehicles.plate instead. */
          vehicle_label: string | null
        }
        Insert: {
          cancelled_at?: string | null
          code?: string
          created_at?: string
          deleted_at?: string | null
          driver_id: string
          id?: string
          in_transit_at?: string | null
          operator_id: string
          received_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_label?: string | null
        }
        Update: {
          cancelled_at?: string | null
          code?: string
          created_at?: string
          deleted_at?: string | null
          driver_id?: string
          id?: string
          in_transit_at?: string | null
          operator_id?: string
          received_at?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_routes_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_routes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          plate: string
          updated_at: string
          vehicle_type: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          plate: string
          updated_at?: string
          vehicle_type?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          plate?: string
          updated_at?: string
          vehicle_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      route_receptions: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          delivered_by: string
          discrepancy_notes: string | null
          expected_count: number
          id: string
          operator_id: string
          pickup_route_id: string
          received_by: string | null
          received_count: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          delivered_by: string
          discrepancy_notes?: string | null
          expected_count?: number
          id?: string
          operator_id: string
          pickup_route_id: string
          received_by?: string | null
          received_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          delivered_by?: string
          discrepancy_notes?: string | null
          expected_count?: number
          id?: string
          operator_id?: string
          pickup_route_id?: string
          received_by?: string | null
          received_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_receptions_pickup_route_id_fkey"
            columns: ["pickup_route_id"]
            isOneToOne: true
            referencedRelation: "pickup_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_receptions_operator_id_fkey"
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
          capacity: number | null
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
          capacity?: number | null
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
          capacity?: number | null
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
      dock_zone_adjacency: {
        Row: {
          id: string
          operator_id: string
          dock_zone_id: string
          adjacent_zone_id: string
          created_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          dock_zone_id: string
          adjacent_zone_id: string
          created_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          dock_zone_id?: string
          adjacent_zone_id?: string
          created_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dock_zone_adjacency_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_zone_adjacency_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_zone_adjacency_adjacent_zone_id_fkey"
            columns: ["adjacent_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
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
          load_position_id: string | null
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
          load_position_id?: string | null
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
          load_position_id?: string | null
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
          return_reason: string | null
          return_reason_code: string | null
          loaded_at: string | null
          loaded_by: string | null
          load_inferred: boolean
          loaded_route_id: string | null
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
          return_reason?: string | null
          return_reason_code?: string | null
          loaded_at?: string | null
          loaded_by?: string | null
          load_inferred?: boolean
          loaded_route_id?: string | null
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
          return_reason?: string | null
          return_reason_code?: string | null
          loaded_at?: string | null
          loaded_by?: string | null
          load_inferred?: boolean
          loaded_route_id?: string | null
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
          {
            foreignKeyName: "packages_loaded_by_fkey"
            columns: ["loaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_loaded_route_id_fkey"
            columns: ["loaded_route_id"]
            isOneToOne: false
            referencedRelation: "routes"
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
            referencedRelation: "route_receptions"
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
          {
            foreignKeyName: "orders_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
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
          // spec-73 phase 1 (20260904000001) — not covered by the generator
          // this file's other rows were produced from; added by hand to
          // match the migration until types.ts is regenerated.
          capacity_packages: number | null
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
          capacity_packages?: number | null
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
          capacity_packages?: number | null
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
          load_position_id: string | null
          load_position_assigned_at: string | null
          load_position_assigned_by: string | null
          load_position_released_at: string | null
          load_position_released_by: string | null
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
          load_position_id?: string | null
          load_position_assigned_at?: string | null
          load_position_assigned_by?: string | null
          load_position_released_at?: string | null
          load_position_released_by?: string | null
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
          load_position_id?: string | null
          load_position_assigned_at?: string | null
          load_position_assigned_by?: string | null
          load_position_released_at?: string | null
          load_position_released_by?: string | null
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
          {
            foreignKeyName: "routes_load_position_id_fkey"
            columns: ["load_position_id"]
            isOneToOne: false
            referencedRelation: "load_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      load_positions: {
        Row: {
          id: string
          operator_id: string
          code: string
          label: string | null
          is_active: boolean
          fronts_dock_zone_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          code: string
          label?: string | null
          is_active?: boolean
          fronts_dock_zone_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          code?: string
          label?: string | null
          is_active?: boolean
          fronts_dock_zone_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "load_positions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_positions_fronts_dock_zone_id_fkey"
            columns: ["fronts_dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
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
          actual_sequence: number | null
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
          stage: Database["public"]["Enums"]["dispatch_stage"]
          staged_at: string | null
          staged_by: string | null
          adopted_reason: string | null
          removal_reason: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          route_id?: string | null
          order_id?: string | null
          stage?: Database["public"]["Enums"]["dispatch_stage"]
          staged_at?: string | null
          staged_by?: string | null
          adopted_reason?: string | null
          removal_reason?: string | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          external_dispatch_id?: string | null
          external_route_id?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          planned_sequence?: number | null
          actual_sequence?: number | null
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
          stage?: Database["public"]["Enums"]["dispatch_stage"]
          staged_at?: string | null
          staged_by?: string | null
          adopted_reason?: string | null
          removal_reason?: string | null
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          external_dispatch_id?: string | null
          external_route_id?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          planned_sequence?: number | null
          actual_sequence?: number | null
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
      route_blocks: {
        Row: {
          id: string
          operator_id: string
          route_id: string
          comuna_id: string
          sequence_index: number
          sequence_source: string
          // spec-73 phase 4. Set only on a block created by
          // accept_topup_block — see that migration's column comment.
          donor_route_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          route_id: string
          comuna_id: string
          sequence_index: number
          sequence_source?: string
          donor_route_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          route_id?: string
          comuna_id?: string
          sequence_index?: number
          sequence_source?: string
          donor_route_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "route_blocks_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_blocks_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_blocks_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
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
      return_receptions: {
        Row: {
          id: string
          operator_id: string
          external_route_id: string
          received_by: string | null
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          started_at: string | null
          completed_at: string | null
          expected_count: number
          received_count: number
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          operator_id: string
          external_route_id: string
          received_by?: string | null
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          started_at?: string | null
          completed_at?: string | null
          expected_count?: number
          received_count?: number
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          operator_id?: string
          external_route_id?: string
          received_by?: string | null
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          started_at?: string | null
          completed_at?: string | null
          expected_count?: number
          received_count?: number
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_receptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      return_reception_scans: {
        Row: {
          id: string
          return_reception_id: string
          package_id: string | null
          operator_id: string
          scanned_by: string | null
          barcode: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          created_at: string
          updated_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          return_reception_id: string
          package_id?: string | null
          operator_id: string
          scanned_by?: string | null
          barcode: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          return_reception_id?: string
          package_id?: string | null
          operator_id?: string
          scanned_by?: string | null
          barcode?: string
          scan_result?: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at?: string
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "return_reception_scans_return_reception_id_fkey"
            columns: ["return_reception_id"]
            isOneToOne: false
            referencedRelation: "return_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_reception_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      // spec-70 phase 1 (20260825000002). The first view in this project —
      // hand-added because nothing here has ever regenerated this file
      // against a view before. Row shape matches the SELECT in the
      // migration: route_id nullable (dispatches.route_id is), operator_id
      // not (dispatches.operator_id is NOT NULL, the tenant column), the four
      // counts are COUNT(*)/COUNT(*) FILTER, never null.
      route_stop_counts: {
        Row: {
          route_id: string | null
          operator_id: string
          total_stops: number
          pending_stops: number
          staged_stops: number
          adopted_stops: number
          partially_staged_stops: number
          // spec-77 phase 1b (20260908000001) — force_split's own bucket,
          // appended after partially_staged_stops (CREATE OR REPLACE VIEW
          // cannot reorder existing output columns). Hand-added here for the
          // same reason the rest of this view is: nothing regenerates this
          // file against a view.
          force_split_stops: number
        }
        Relationships: []
      }
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
      expand_carton: {
        Args: {
          p_package_id: string
          p_additional_boxes: number
          p_reason: string
        }
        Returns: {
          out_id: string
          out_label: string
          out_package_number: string | null
          out_declared_box_count: number
          out_parent_label: string | null
          out_is_generated_label: boolean
          out_order_id: string
        }[]
      }
      delete_minted_carton: {
        Args: { p_package_id: string; p_reason: string }
        Returns: undefined
      }
      mark_manifest_labels_printed: {
        Args: { p_manifest_id: string }
        Returns: undefined
      }
      get_manifest_label_data: {
        Args: { p_manifest_id: string; p_package_id?: string | null }
        Returns: {
          package_id: string
          package_label: string
          package_number: string | null
          declared_box_count: number | null
          sku_items: Json
          order_number: string
          customer_name: string
          delivery_address: string
          comuna: string
          customer_phone: string
          external_load_id: string
          retailer_name: string | null
        }[]
      }
      // spec-52: the UUID overload is the real one. A deprecated
      // `start_pickup_route(p_vehicle_label TEXT)` compat wrapper still exists
      // in the database during the expand phase, but nothing calls it — it is
      // dropped in the contract phase and is deliberately not typed here.
      start_pickup_route: {
        // spec-61: the crew list is optional — a leader may still ride alone.
        Args: { p_vehicle_id: string; p_crew_user_ids?: string[] }
        Returns: Database["public"]["Tables"]["pickup_routes"]["Row"]
      }
      // spec-61 — the caller's open route: the one they LEAD or are active
      // CREW on, with plate, leader name and crew. `Json` because the function
      // returns JSONB; the real shape is ActivePickupRoute's payload in
      // hooks/pickup/useActivePickupRoute.ts.
      get_my_active_pickup_route: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      add_manifest_to_route: {
        Args: { p_route_id: string; p_manifest_id: string }
        Returns: Database["public"]["Tables"]["manifests"]["Row"]
      }
      // spec-64 Task 1 (20260824000004) — the counterpart to
      // add_manifest_to_route above: detach a carga from an in_progress
      // pickup route while it has zero verified pickup scans.
      remove_manifest_from_route: {
        Args: { p_route_id: string; p_manifest_id: string }
        Returns: Database["public"]["Tables"]["manifests"]["Row"]
      }
      close_pickup_route: {
        Args: { p_route_id: string }
        Returns: Database["public"]["Tables"]["route_receptions"]["Row"]
      }
      cancel_pickup_route: {
        Args: { p_route_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["pickup_routes"]["Row"]
      }
      get_route_reception_snapshot: {
        Args: { p_route_id: string }
        Returns: Json
      }
      complete_route_reception: {
        Args: { p_route_id: string; p_discrepancy_notes?: string | null }
        Returns: Database["public"]["Tables"]["route_receptions"]["Row"]
      }
      // spec-52 Task 5 (20260812000005). Hand-added like the rest of this file —
      // `generate-types` runs against production and must never be used here.
      open_route_reception: {
        Args: { p_route_id: string }
        Returns: Database["public"]["Tables"]["route_receptions"]["Row"]
      }
      reopen_pickup_route: {
        Args: { p_route_id: string }
        Returns: Database["public"]["Tables"]["pickup_routes"]["Row"]
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
          p_route_date?: string | null
        }
        Returns: Json
      }
      move_route_block: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_block_id: string
          p_direction: string
        }
        Returns: undefined
      }
      seed_default_route_blocks: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_order_ids?: string[]
        }
        Returns: undefined
      }
      get_route_territory_history: {
        Args: {
          p_route_id: string
          p_operator_id: string
        }
        Returns: {
          comuna_id: string
          comuna_name: string
          driver_name: string
          run_count: number
          last_route_date: string
        }[]
      }
      transition_route_status: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_to_status: Database["public"]["Enums"]["route_status_enum"]
        }
        Returns: Database["public"]["Enums"]["route_status_enum"]
      }
      assign_load_position: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_user_id: string
          p_load_position_id?: string | null
        }
        Returns: string | null
      }
      release_load_position: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      load_position_conflicts_with_route: {
        Args: {
          p_load_position_id: string
          p_route_id: string
          p_operator_id: string
        }
        Returns: boolean
      }
      check_load_position_conflict: {
        Args: {
          p_route_id: string
          p_operator_id: string
        }
        Returns: Json
      }
      sweep_load_position_assignments: {
        Args: {
          p_operator_id: string
          p_user_id: string
          p_limit?: number
        }
        Returns: {
          route_id: string
          load_position_id: string
        }[]
      }
      // spec-71 phase 5 (20260828000001). The move-task picker's data
      // source — see MoveTaskSnapshot below for the real (narrower) return
      // shape; `Json` here matches every other jsonb-returning function in
      // this file (get_pre_route_snapshot, check_load_position_conflict).
      get_move_task_snapshot: {
        Args: {
          p_operator_id: string
        }
        Returns: Json
      }
      // spec-74 phase 3 review Fix 3 (20260902000001). Atomically locks a
      // dispatch row, recomputes its stage from packages, and writes
      // stage/staged_at/staged_by in one statement — see stage-dispatch.ts.
      // Returns the DispatchStage text actually written (never widened to
      // `Json` — the caller narrows this to `DispatchStage` itself).
      recompute_dispatch_stage: {
        Args: {
          p_dispatch_id: string
          p_operator_id: string
          p_order_id: string
          p_user_id: string
        }
        Returns: string
      }
      process_failed_delivery: {
        Args: {
          p_order_number: string
          p_dt_status: number
          p_substatus: string
          p_substatus_code: string
          p_operator_id: string
        }
        Returns: Json
      }
      complete_return_reception_scan: {
        Args: {
          p_package_id: string
          p_return_reception_id: string
          p_scanned_by: string | null
          p_barcode: string
          p_operator_id: string
        }
        Returns: Json
      }
      find_or_create_return_reception: {
        Args: {
          p_operator_id: string
          p_external_route_id: string
        }
        Returns: Json
      }
      add_dock_zone_adjacency_pair: {
        Args: {
          p_dock_zone_id: string
          p_adjacent_zone_id: string
        }
        Returns: {
          id: string
          operator_id: string
          dock_zone_id: string
          adjacent_zone_id: string
          created_at: string
          deleted_at: string | null
        }[]
      }
      remove_dock_zone_adjacency_pair: {
        Args: {
          p_dock_zone_id: string
          p_adjacent_zone_id: string
        }
        Returns: number
      }
      // spec-73 phase 4 (20260906000001). Read-only source-andén lookup
      // shared by get_topup_candidates/accept_topup_block below.
      route_source_dock_zone_ids: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_comuna_id?: string | null
        }
        Returns: { dock_zone_id: string }[]
      }
      // spec-73 phase 4. Top-up suggestion computation — see
      // GET .../topup/route.ts. Json here matches every other
      // jsonb-returning function in this file.
      get_topup_candidates: {
        Args: {
          p_route_id: string
          p_operator_id: string
        }
        Returns: Json
      }
      // spec-73 phase 4 review fix (Decision 5.5). TRUE when a route's
      // comuna block has already been physically scanned onto a load
      // position, which makes it undonatable.
      route_block_is_physically_staged: {
        Args: {
          p_route_id: string
          p_operator_id: string
          p_comuna_id: string
        }
        Returns: boolean
      }
      // spec-73 phase 4. Accept a top-up suggestion — see
      // POST .../topup/accept/route.ts.
      accept_topup_block: {
        Args: {
          p_receiving_route_id: string
          p_donor_route_id: string
          p_comuna_id: string
          p_operator_id: string
          p_user_id: string
          p_reason: string
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
        | "loading"
        | "loaded"
        | "dispatched"
        | "in_transit"
        | "in_progress"
        | "completed"
        | "cancelled"
      dispatch_stage:
        | "planned"
        | "partially_staged"
        | "staged"
        | "adopted"
        | "force_split"
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
      order_status_enum:
        | "ingresado"
        | "verificado"
        | "en_bodega"
        | "asignado"
        | "en_carga"
        | "listo_para_despacho"
        | "en_ruta"
        | "entregado"
        | "cancelado"
        | "en_retorno"
        | "parcialmente_entregado"
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
        | "retorno_hub"
        | "entregado"
        | "cancelado"
        | "devuelto"
        | "dañado"
        | "extraviado"
      reception_scan_result_enum:
        | "received"
        | "not_found"
        | "duplicate"
        | "route_mismatch"
      reception_status_enum:
        | "awaiting_reception"
        | "reception_in_progress"
        | "received"
      // Hand-maintained fork of generated Supabase output — this file isn't
      // regenerated, so `tsc` cannot check this list against the database
      // enum. super_admin is already missing below; that's the standing
      // proof nothing here enforces it. Update by hand whenever the
      // database's user_role enum changes.
      user_role:
        | "pickup_crew"
        | "warehouse_staff"
        | "loading_crew"
        | "operations_manager"
        | "admin"
        | "pickup_leader"
        | "ops_leader"
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
      order_status_enum: [
        "ingresado",
        "verificado",
        "en_bodega",
        "asignado",
        "en_carga",
        "listo_para_despacho",
        "en_ruta",
        "entregado",
        "cancelado",
        "en_retorno",
        "parcialmente_entregado",
      ],
      package_status_enum: [
        "ingresado",
        "verificado",
        "en_bodega",
        "sectorizado",
        "retenido",
        "asignado",
        "en_carga",
        "listo_para_despacho",
        "en_ruta",
        "retorno_hub",
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
        "route_mismatch",
      ],
      reception_status_enum: [
        "awaiting_reception",
        "reception_in_progress",
        "received",
      ],
      // Hand-maintained fork of generated Supabase output — this file isn't
      // regenerated, so `tsc` cannot check this list against the database
      // enum. super_admin is already missing below; that's the standing
      // proof nothing here enforces it. Update by hand whenever the
      // database's user_role enum changes.
      user_role: [
        "pickup_crew",
        "warehouse_staff",
        "loading_crew",
        "operations_manager",
        "admin",
        "pickup_leader",
        "ops_leader",
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

// spec-71 phase 5 (20260828000001_spec71_move_task_snapshot.sql). The
// move-task picker's data source. `groups` is per-andén, ordered by
// remaining_count DESC (biggest hop first) in the SQL function itself —
// consumers should not re-sort. `is_retired` is Decision 7's consumer
// contract: a group whose `dock_zone_id` points at a soft-deleted andén
// still appears (dock_zone_code/name are then null), it does not vanish.
export type MoveTaskZoneGroup = {
  dock_zone_id: string | null;
  dock_zone_code: string | null;
  dock_zone_name: string | null;
  is_retired: boolean;
  remaining_count: number;
};

export type MoveTaskRoute = {
  route_id: string;
  external_route_id: string;
  driver_name: string | null;
  load_position_id: string;
  load_position_code: string;
  load_position_label: string | null;
  total_packages: number;
  remaining_packages: number;
  offset_conflict: boolean;
  groups: MoveTaskZoneGroup[];
};

export type MoveTaskUnassignedRoute = {
  route_id: string;
  external_route_id: string;
  driver_name: string | null;
  total_packages: number;
  remaining_packages: number;
};

export type MoveTaskSnapshot = {
  generated_at: string;
  routes: MoveTaskRoute[];
  unassigned_routes: MoveTaskUnassignedRoute[];
};
