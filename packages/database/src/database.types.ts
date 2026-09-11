export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_commands: {
        Row: {
          command_type: string
          created_at: string
          error_message: string | null
          id: string
          operator_id: string
          payload: Json
          processed_at: string | null
          source: string
          status: Database["public"]["Enums"]["command_status_enum"] | null
        }
        Insert: {
          command_type: string
          created_at?: string
          error_message?: string | null
          id?: string
          operator_id: string
          payload?: Json
          processed_at?: string | null
          source: string
          status?: Database["public"]["Enums"]["command_status_enum"] | null
        }
        Update: {
          command_type?: string
          created_at?: string
          error_message?: string | null
          id?: string
          operator_id?: string
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: Database["public"]["Enums"]["command_status_enum"] | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_commands_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          actor_id: string
          actor_type: Database["public"]["Enums"]["actor_type_enum"]
          aggregate_id: string
          aggregate_type: string
          causation_id: string | null
          correlation_id: string | null
          created_at: string
          event_type: string
          event_version: number
          id: string
          metadata: Json
          occurred_at: string
          operator_id: string
          payload: Json
        }
        Insert: {
          actor_id: string
          actor_type: Database["public"]["Enums"]["actor_type_enum"]
          aggregate_id: string
          aggregate_type: string
          causation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type: string
          event_version?: number
          id?: string
          metadata?: Json
          occurred_at?: string
          operator_id: string
          payload: Json
        }
        Update: {
          actor_id?: string
          actor_type?: Database["public"]["Enums"]["actor_type_enum"]
          aggregate_id?: string
          aggregate_type?: string
          causation_id?: string | null
          correlation_id?: string | null
          created_at?: string
          event_type?: string
          event_version?: number
          id?: string
          metadata?: Json
          occurred_at?: string
          operator_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_events_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_calls: {
        Row: {
          agent_name: string
          completed_at: string | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          event_id: string
          id: string
          input_args: Json
          operator_id: string
          output_result: Json | null
          started_at: string | null
          status: string
          tokens_input: number | null
          tokens_output: number | null
          tool_name: string
          tool_version: string | null
        }
        Insert: {
          agent_name: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_id: string
          id?: string
          input_args: Json
          operator_id: string
          output_result?: Json | null
          started_at?: string | null
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          tool_name: string
          tool_version?: string | null
        }
        Update: {
          agent_name?: string
          completed_at?: string | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          event_id?: string
          id?: string
          input_args?: Json
          operator_id?: string
          output_result?: Json | null
          started_at?: string | null
          status?: string
          tokens_input?: number | null
          tokens_output?: number | null
          tool_name?: string
          tool_version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_calls_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "agent_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_calls_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by_agent: string | null
          deleted_at: string | null
          delivered_at: string | null
          delivery_location: Json | null
          dispatch_id: string | null
          driver_id: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          in_transit_at: string | null
          managed_by_agent: string | null
          negotiated_rate_clp: number | null
          offer_expires_at: string | null
          offered_at: string | null
          offered_rate_clp: number | null
          operator_id: string
          order_id: string
          pickup_at: string | null
          pickup_location: Json | null
          pod_notes: string | null
          pod_photo_url: string | null
          pod_recipient_name: string | null
          pod_signature_url: string | null
          previous_status:
            | Database["public"]["Enums"]["assignment_status_enum"]
            | null
          raw_data: Json
          rejection_reason: string | null
          route_id: string | null
          sequence_number: number | null
          status: Database["public"]["Enums"]["assignment_status_enum"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by_agent?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_location?: Json | null
          dispatch_id?: string | null
          driver_id: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          in_transit_at?: string | null
          managed_by_agent?: string | null
          negotiated_rate_clp?: number | null
          offer_expires_at?: string | null
          offered_at?: string | null
          offered_rate_clp?: number | null
          operator_id: string
          order_id: string
          pickup_at?: string | null
          pickup_location?: Json | null
          pod_notes?: string | null
          pod_photo_url?: string | null
          pod_recipient_name?: string | null
          pod_signature_url?: string | null
          previous_status?:
            | Database["public"]["Enums"]["assignment_status_enum"]
            | null
          raw_data?: Json
          rejection_reason?: string | null
          route_id?: string | null
          sequence_number?: number | null
          status?: Database["public"]["Enums"]["assignment_status_enum"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by_agent?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_location?: Json | null
          dispatch_id?: string | null
          driver_id?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          in_transit_at?: string | null
          managed_by_agent?: string | null
          negotiated_rate_clp?: number | null
          offer_expires_at?: string | null
          offered_at?: string | null
          offered_rate_clp?: number | null
          operator_id?: string
          order_id?: string
          pickup_at?: string | null
          pickup_location?: Json | null
          pod_notes?: string | null
          pod_photo_url?: string | null
          pod_recipient_name?: string | null
          pod_signature_url?: string | null
          previous_status?:
            | Database["public"]["Enums"]["assignment_status_enum"]
            | null
          raw_data?: Json
          rejection_reason?: string | null
          route_id?: string | null
          sequence_number?: number | null
          status?: Database["public"]["Enums"]["assignment_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
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
      capacity_alerts: {
        Row: {
          actual_orders: number
          alert_date: string
          client_id: string
          created_at: string
          daily_capacity: number
          deleted_at: string | null
          dismissed_at: string | null
          id: string
          operator_id: string
          threshold_pct: number
          updated_at: string | null
          utilization_pct: number
        }
        Insert: {
          actual_orders: number
          alert_date: string
          client_id: string
          created_at?: string
          daily_capacity: number
          deleted_at?: string | null
          dismissed_at?: string | null
          id?: string
          operator_id: string
          threshold_pct: number
          updated_at?: string | null
          utilization_pct: number
        }
        Update: {
          actual_orders?: number
          alert_date?: string
          client_id?: string
          created_at?: string
          daily_capacity?: number
          deleted_at?: string | null
          dismissed_at?: string | null
          id?: string
          operator_id?: string
          threshold_pct?: number
          updated_at?: string | null
          utilization_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "capacity_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_alerts_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      carton_expansion_audit: {
        Row: {
          actor_user_id: string
          at: string
          boxes_added: number
          id: string
          operator_id: string
          package_id: string
          parent_label: string
          reason: string
        }
        Insert: {
          actor_user_id: string
          at?: string
          boxes_added: number
          id?: string
          operator_id: string
          package_id: string
          parent_label: string
          reason: string
        }
        Update: {
          actor_user_id?: string
          at?: string
          boxes_added?: number
          id?: string
          operator_id?: string
          package_id?: string
          parent_label?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "carton_expansion_audit_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carton_expansion_audit_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      chile_comuna_aliases: {
        Row: {
          alias: string
          comuna_id: string
          created_at: string
          id: string
          source: string
        }
        Insert: {
          alias: string
          comuna_id: string
          created_at?: string
          id?: string
          source?: string
        }
        Update: {
          alias?: string
          comuna_id?: string
          created_at?: string
          id?: string
          source?: string
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
      chile_comunas: {
        Row: {
          codigo_cut: string
          geometry: unknown
          id: string
          nombre: string
          provincia: string
          region: string
          region_num: number
        }
        Insert: {
          codigo_cut: string
          geometry?: unknown
          id?: string
          nombre: string
          provincia: string
          region: string
          region_num: number
        }
        Update: {
          codigo_cut?: string
          geometry?: unknown
          id?: string
          nombre?: string
          provincia?: string
          region?: string
          region_num?: number
        }
        Relationships: []
      }
      conversation_messages: {
        Row: {
          agent_action_taken: string | null
          body: string | null
          content_type: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          direction: Database["public"]["Enums"]["message_direction_enum"]
          entities: Json | null
          external_message_id: string | null
          id: string
          intent: string | null
          intent_confidence: number | null
          media_mime_type: string | null
          media_url: string | null
          operator_id: string
          processed_at: string | null
          processed_by_agent: string | null
          raw_data: Json
          sender_type: Database["public"]["Enums"]["message_sender_enum"]
          sentiment: string | null
          template_name: string | null
          template_params: Json | null
          wa_status: string | null
          wa_status_at: string | null
        }
        Insert: {
          agent_action_taken?: string | null
          body?: string | null
          content_type?: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          direction: Database["public"]["Enums"]["message_direction_enum"]
          entities?: Json | null
          external_message_id?: string | null
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          media_mime_type?: string | null
          media_url?: string | null
          operator_id: string
          processed_at?: string | null
          processed_by_agent?: string | null
          raw_data?: Json
          sender_type: Database["public"]["Enums"]["message_sender_enum"]
          sentiment?: string | null
          template_name?: string | null
          template_params?: Json | null
          wa_status?: string | null
          wa_status_at?: string | null
        }
        Update: {
          agent_action_taken?: string | null
          body?: string | null
          content_type?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          direction?: Database["public"]["Enums"]["message_direction_enum"]
          entities?: Json | null
          external_message_id?: string | null
          id?: string
          intent?: string | null
          intent_confidence?: number | null
          media_mime_type?: string | null
          media_url?: string | null
          operator_id?: string
          processed_at?: string | null
          processed_by_agent?: string | null
          raw_data?: Json
          sender_type?: Database["public"]["Enums"]["message_sender_enum"]
          sentiment?: string | null
          template_name?: string | null
          template_params?: Json | null
          wa_status?: string | null
          wa_status_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_agent: string | null
          channel: Database["public"]["Enums"]["conversation_channel_enum"]
          context_assignment_id: string | null
          context_order_ids: string[] | null
          created_at: string
          deleted_at: string | null
          driver_id: string | null
          external_thread_id: string | null
          id: string
          is_active: boolean
          last_message_at: string | null
          message_count: number
          operator_id: string
          participant_name: string | null
          participant_phone: string
          participant_type: Database["public"]["Enums"]["participant_type_enum"]
          raw_data: Json
          requires_human: boolean
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_agent?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel_enum"]
          context_assignment_id?: string | null
          context_order_ids?: string[] | null
          created_at?: string
          deleted_at?: string | null
          driver_id?: string | null
          external_thread_id?: string | null
          id?: string
          is_active?: boolean
          last_message_at?: string | null
          message_count?: number
          operator_id: string
          participant_name?: string | null
          participant_phone: string
          participant_type: Database["public"]["Enums"]["participant_type_enum"]
          raw_data?: Json
          requires_human?: boolean
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_agent?: string | null
          channel?: Database["public"]["Enums"]["conversation_channel_enum"]
          context_assignment_id?: string | null
          context_order_ids?: string[] | null
          created_at?: string
          deleted_at?: string | null
          driver_id?: string | null
          external_thread_id?: string | null
          id?: string
          is_active?: boolean
          last_message_at?: string | null
          message_count?: number
          operator_id?: string
          participant_name?: string | null
          participant_phone?: string
          participant_type?: Database["public"]["Enums"]["participant_type_enum"]
          raw_data?: Json
          requires_human?: boolean
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_context_assignment_id_fkey"
            columns: ["context_assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_session_messages: {
        Row: {
          action_taken: string | null
          body: string
          created_at: string
          deleted_at: string | null
          external_message_id: string | null
          id: string
          media_type: string | null
          media_url: string | null
          operator_id: string
          role: string
          session_id: string
          template_name: string | null
          wa_status: string | null
          wa_status_at: string | null
        }
        Insert: {
          action_taken?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          external_message_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          operator_id: string
          role: string
          session_id: string
          template_name?: string | null
          wa_status?: string | null
          wa_status_at?: string | null
        }
        Update: {
          action_taken?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          external_message_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          operator_id?: string
          role?: string
          session_id?: string
          template_name?: string | null
          wa_status?: string | null
          wa_status_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_session_messages_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_session_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "customer_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sessions: {
        Row: {
          closed_at: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string
          deleted_at: string | null
          escalated_at: string | null
          id: string
          operator_id: string
          order_id: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          deleted_at?: string | null
          escalated_at?: string | null
          id?: string
          operator_id: string
          order_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          deleted_at?: string | null
          escalated_at?: string | null
          id?: string
          operator_id?: string
          order_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_sessions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_sessions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_monthly_rollup: {
        Row: {
          computed_at: string
          cpo_clp: number | null
          created_at: string
          csat_pct: number | null
          deleted_at: string | null
          delivered_orders: number
          failed_orders: number
          id: string
          nps_score: number | null
          operator_id: string
          otif_pct: number | null
          period_month: number
          period_year: number
          source_daily_rows: number
          total_orders: number
          updated_at: string
        }
        Insert: {
          computed_at: string
          cpo_clp?: number | null
          created_at?: string
          csat_pct?: number | null
          deleted_at?: string | null
          delivered_orders?: number
          failed_orders?: number
          id?: string
          nps_score?: number | null
          operator_id: string
          otif_pct?: number | null
          period_month: number
          period_year: number
          source_daily_rows?: number
          total_orders?: number
          updated_at?: string
        }
        Update: {
          computed_at?: string
          cpo_clp?: number | null
          created_at?: string
          csat_pct?: number | null
          deleted_at?: string | null
          delivered_orders?: number
          failed_orders?: number
          id?: string
          nps_score?: number | null
          operator_id?: string
          otif_pct?: number | null
          period_month?: number
          period_year?: number
          source_daily_rows?: number
          total_orders?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_monthly_rollup_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      discrepancies: {
        Row: {
          barcode: string | null
          created_at: string
          deleted_at: string | null
          detected_at: string
          detected_by_user_id: string | null
          id: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id: string | null
          migrated_from_note_id: string | null
          note: string | null
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id: string
          package_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          route_reception_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          deleted_at?: string | null
          detected_at?: string
          detected_by_user_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id?: string | null
          migrated_from_note_id?: string | null
          note?: string | null
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id: string
          package_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          route_reception_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          deleted_at?: string | null
          detected_at?: string
          detected_by_user_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id?: string | null
          migrated_from_note_id?: string | null
          note?: string | null
          operation_type?: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id?: string
          package_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          route_reception_id?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discrepancies_detected_by_user_id_fkey"
            columns: ["detected_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_migrated_from_note_id_fkey"
            columns: ["migrated_from_note_id"]
            isOneToOne: false
            referencedRelation: "discrepancy_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_route_reception_id_fkey"
            columns: ["route_reception_id"]
            isOneToOne: false
            referencedRelation: "route_receptions"
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
            foreignKeyName: "discrepancy_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
      dispatches: {
        Row: {
          actual_sequence: number | null
          adopted_reason: string | null
          arrived_at: string | null
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          driver_notes: string | null
          estimated_at: string | null
          external_dispatch_id: string | null
          external_route_id: string | null
          failure_reason: string | null
          id: string
          is_pickup: boolean
          latitude: number | null
          longitude: number | null
          operator_id: string
          order_id: string | null
          planned_sequence: number | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data: Json
          removal_reason: string | null
          route_id: string | null
          stage: string
          staged_at: string | null
          staged_by: string | null
          status: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus: string | null
          substatus_code: string | null
          updated_at: string
        }
        Insert: {
          actual_sequence?: number | null
          adopted_reason?: string | null
          arrived_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          driver_notes?: string | null
          estimated_at?: string | null
          external_dispatch_id?: string | null
          external_route_id?: string | null
          failure_reason?: string | null
          id?: string
          is_pickup?: boolean
          latitude?: number | null
          longitude?: number | null
          operator_id: string
          order_id?: string | null
          planned_sequence?: number | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          removal_reason?: string | null
          route_id?: string | null
          stage?: string
          staged_at?: string | null
          staged_by?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          updated_at?: string
        }
        Update: {
          actual_sequence?: number | null
          adopted_reason?: string | null
          arrived_at?: string | null
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          driver_notes?: string | null
          estimated_at?: string | null
          external_dispatch_id?: string | null
          external_route_id?: string | null
          failure_reason?: string | null
          id?: string
          is_pickup?: boolean
          latitude?: number | null
          longitude?: number | null
          operator_id?: string
          order_id?: string | null
          planned_sequence?: number | null
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          removal_reason?: string | null
          route_id?: string | null
          stage?: string
          staged_at?: string | null
          staged_by?: string | null
          status?: Database["public"]["Enums"]["dispatch_status_enum"]
          substatus?: string | null
          substatus_code?: string | null
          updated_at?: string
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
            foreignKeyName: "dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
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
            foreignKeyName: "dispatches_staged_by_fkey"
            columns: ["staged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_batches: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          dock_zone_id: string
          id: string
          operator_id: string
          package_count: number
          status: Database["public"]["Enums"]["batch_status_enum"]
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          dock_zone_id: string
          id?: string
          operator_id: string
          package_count?: number
          status?: Database["public"]["Enums"]["batch_status_enum"]
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          dock_zone_id?: string
          id?: string
          operator_id?: string
          package_count?: number
          status?: Database["public"]["Enums"]["batch_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_batches_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_batches_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_scans: {
        Row: {
          barcode: string
          batch_id: string | null
          created_at: string
          deleted_at: string | null
          dock_zone_id: string | null
          id: string
          load_position_id: string | null
          manual_override: boolean
          operator_id: string
          package_id: string | null
          redirect_reason: string | null
          scan_result: Database["public"]["Enums"]["dock_scan_result_enum"]
          scanned_at: string
          scanned_by: string
          updated_at: string
        }
        Insert: {
          barcode: string
          batch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dock_zone_id?: string | null
          id?: string
          load_position_id?: string | null
          manual_override?: boolean
          operator_id: string
          package_id?: string | null
          redirect_reason?: string | null
          scan_result: Database["public"]["Enums"]["dock_scan_result_enum"]
          scanned_at?: string
          scanned_by: string
          updated_at?: string
        }
        Update: {
          barcode?: string
          batch_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dock_zone_id?: string | null
          id?: string
          load_position_id?: string | null
          manual_override?: boolean
          operator_id?: string
          package_id?: string | null
          redirect_reason?: string | null
          scan_result?: Database["public"]["Enums"]["dock_scan_result_enum"]
          scanned_at?: string
          scanned_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_scans_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "dock_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_load_position_id_fkey"
            columns: ["load_position_id"]
            isOneToOne: false
            referencedRelation: "load_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_verifications: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          package_id: string
          source: string
          updated_at: string
          verified_at: string
          verified_by: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          package_id: string
          source: string
          updated_at?: string
          verified_at?: string
          verified_by: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          package_id?: string
          source?: string
          updated_at?: string
          verified_at?: string
          verified_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_verifications_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_verifications_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_zone_adjacency: {
        Row: {
          adjacent_zone_id: string
          created_at: string
          deleted_at: string | null
          dock_zone_id: string
          id: string
          operator_id: string
        }
        Insert: {
          adjacent_zone_id: string
          created_at?: string
          deleted_at?: string | null
          dock_zone_id: string
          id?: string
          operator_id: string
        }
        Update: {
          adjacent_zone_id?: string
          created_at?: string
          deleted_at?: string | null
          dock_zone_id?: string
          id?: string
          operator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_zone_adjacency_adjacent_zone_id_fkey"
            columns: ["adjacent_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
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
            foreignKeyName: "dock_zone_adjacency_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_zone_comunas: {
        Row: {
          comuna_id: string
          dock_zone_id: string
        }
        Insert: {
          comuna_id: string
          dock_zone_id: string
        }
        Update: {
          comuna_id?: string
          dock_zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dock_zone_comunas_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dock_zone_comunas_dock_zone_id_fkey"
            columns: ["dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      dock_zones: {
        Row: {
          capacity: number | null
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          is_consolidation: boolean
          name: string
          operator_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_consolidation?: boolean
          name: string
          operator_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          is_consolidation?: boolean
          name?: string
          operator_id?: string
          sort_order?: number
          updated_at?: string
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
      driver_availabilities: {
        Row: {
          availability_date: string
          available_from: string
          available_until: string
          created_at: string
          deleted_at: string | null
          driver_id: string
          id: string
          is_available: boolean
          max_deliveries: number | null
          max_weight_kg: number | null
          notes: string | null
          operator_id: string
          raw_data: Json
          source: string
          updated_at: string
        }
        Insert: {
          availability_date: string
          available_from: string
          available_until: string
          created_at?: string
          deleted_at?: string | null
          driver_id: string
          id?: string
          is_available?: boolean
          max_deliveries?: number | null
          max_weight_kg?: number | null
          notes?: string | null
          operator_id: string
          raw_data?: Json
          source?: string
          updated_at?: string
        }
        Update: {
          availability_date?: string
          available_from?: string
          available_until?: string
          created_at?: string
          deleted_at?: string | null
          driver_id?: string
          id?: string
          is_available?: boolean
          max_deliveries?: number | null
          max_weight_kg?: number | null
          notes?: string | null
          operator_id?: string
          raw_data?: Json
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_availabilities_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_availabilities_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          default_vehicle_id: string | null
          deleted_at: string | null
          email: string | null
          fleet_type: Database["public"]["Enums"]["fleet_type_enum"]
          full_name: string
          id: string
          last_location: Json | null
          last_seen_at: string | null
          max_deliveries_per_day: number | null
          max_volume_m3: number | null
          max_weight_kg: number | null
          on_time_rate: number | null
          operator_id: string
          pay_config: Json
          pay_model: Database["public"]["Enums"]["pay_model_enum"]
          phone: string
          phone_secondary: string | null
          raw_data: Json
          rut: string | null
          score: number | null
          status: Database["public"]["Enums"]["driver_status_enum"]
          successful_deliveries: number
          total_deliveries: number
          updated_at: string
          user_id: string | null
          whatsapp_opted_in: boolean
          whatsapp_opted_in_at: string | null
          zones: Json
        }
        Insert: {
          created_at?: string
          default_vehicle_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fleet_type: Database["public"]["Enums"]["fleet_type_enum"]
          full_name: string
          id?: string
          last_location?: Json | null
          last_seen_at?: string | null
          max_deliveries_per_day?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          on_time_rate?: number | null
          operator_id: string
          pay_config?: Json
          pay_model?: Database["public"]["Enums"]["pay_model_enum"]
          phone: string
          phone_secondary?: string | null
          raw_data?: Json
          rut?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["driver_status_enum"]
          successful_deliveries?: number
          total_deliveries?: number
          updated_at?: string
          user_id?: string | null
          whatsapp_opted_in?: boolean
          whatsapp_opted_in_at?: string | null
          zones?: Json
        }
        Update: {
          created_at?: string
          default_vehicle_id?: string | null
          deleted_at?: string | null
          email?: string | null
          fleet_type?: Database["public"]["Enums"]["fleet_type_enum"]
          full_name?: string
          id?: string
          last_location?: Json | null
          last_seen_at?: string | null
          max_deliveries_per_day?: number | null
          max_volume_m3?: number | null
          max_weight_kg?: number | null
          on_time_rate?: number | null
          operator_id?: string
          pay_config?: Json
          pay_model?: Database["public"]["Enums"]["pay_model_enum"]
          phone?: string
          phone_secondary?: string | null
          raw_data?: Json
          rut?: string | null
          score?: number | null
          status?: Database["public"]["Enums"]["driver_status_enum"]
          successful_deliveries?: number
          total_deliveries?: number
          updated_at?: string
          user_id?: string | null
          whatsapp_opted_in?: boolean
          whatsapp_opted_in_at?: string | null
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "drivers_default_vehicle_id_fkey"
            columns: ["default_vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exceptions: {
        Row: {
          assignment_id: string | null
          auto_resolution_attempted: boolean
          auto_resolution_result: Json | null
          auto_resolution_strategy: string | null
          context_data: Json
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          detected_at: string
          detected_by_agent: string | null
          driver_id: string | null
          escalated_at: string | null
          escalation_target: string | null
          exception_type: string
          id: string
          operator_id: string
          order_id: string | null
          pickup_point_id: string | null
          raw_data: Json
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          settlement_id: string | null
          severity: Database["public"]["Enums"]["exception_severity_enum"]
          status: Database["public"]["Enums"]["exception_status_enum"]
          title: string
          updated_at: string
        }
        Insert: {
          assignment_id?: string | null
          auto_resolution_attempted?: boolean
          auto_resolution_result?: Json | null
          auto_resolution_strategy?: string | null
          context_data?: Json
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          detected_at?: string
          detected_by_agent?: string | null
          driver_id?: string | null
          escalated_at?: string | null
          escalation_target?: string | null
          exception_type: string
          id?: string
          operator_id: string
          order_id?: string | null
          pickup_point_id?: string | null
          raw_data?: Json
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settlement_id?: string | null
          severity: Database["public"]["Enums"]["exception_severity_enum"]
          status?: Database["public"]["Enums"]["exception_status_enum"]
          title: string
          updated_at?: string
        }
        Update: {
          assignment_id?: string | null
          auto_resolution_attempted?: boolean
          auto_resolution_result?: Json | null
          auto_resolution_strategy?: string | null
          context_data?: Json
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          detected_at?: string
          detected_by_agent?: string | null
          driver_id?: string | null
          escalated_at?: string | null
          escalation_target?: string | null
          exception_type?: string
          id?: string
          operator_id?: string
          order_id?: string | null
          pickup_point_id?: string | null
          raw_data?: Json
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settlement_id?: string | null
          severity?: Database["public"]["Enums"]["exception_severity_enum"]
          status?: Database["public"]["Enums"]["exception_status_enum"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exceptions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_generator_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicles: {
        Row: {
          capacity_packages: number | null
          created_at: string
          deleted_at: string | null
          driver_name: string | null
          external_vehicle_id: string | null
          id: string
          operator_id: string
          plate_number: string | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data: Json
          updated_at: string
          vehicle_type: string | null
        }
        Insert: {
          capacity_packages?: number | null
          created_at?: string
          deleted_at?: string | null
          driver_name?: string | null
          external_vehicle_id?: string | null
          id?: string
          operator_id: string
          plate_number?: string | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          updated_at?: string
          vehicle_type?: string | null
        }
        Update: {
          capacity_packages?: number | null
          created_at?: string
          deleted_at?: string | null
          driver_name?: string | null
          external_vehicle_id?: string | null
          id?: string
          operator_id?: string
          plate_number?: string | null
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          updated_at?: string
          vehicle_type?: string | null
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
      geocode_cache: {
        Row: {
          address_hash: string
          created_at: string
          geocode_precision: string
          geocode_source: string
          hit_count: number
          id: string
          last_used_at: string | null
          latitude: number
          longitude: number
          normalisation_version: number
          updated_at: string
        }
        Insert: {
          address_hash: string
          created_at?: string
          geocode_precision: string
          geocode_source: string
          hit_count?: number
          id?: string
          last_used_at?: string | null
          latitude: number
          longitude: number
          normalisation_version: number
          updated_at?: string
        }
        Update: {
          address_hash?: string
          created_at?: string
          geocode_precision?: string
          geocode_source?: string
          hit_count?: number
          id?: string
          last_used_at?: string | null
          latitude?: number
          longitude?: number
          normalisation_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      intake_submissions: {
        Row: {
          channel: Database["public"]["Enums"]["intake_method_enum"]
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          deleted_at: string | null
          external_ref: string | null
          id: string
          operator_id: string
          orders_created: number | null
          orders_extracted: number | null
          parsed_data: Json | null
          pickup_point_id: string
          processed_by_agent: string | null
          processing_completed_at: string | null
          processing_started_at: string | null
          raw_data: Json
          raw_file_url: string | null
          raw_payload: Json
          status: Database["public"]["Enums"]["intake_status_enum"]
          updated_at: string
          validation_errors: Json | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["intake_method_enum"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          external_ref?: string | null
          id?: string
          operator_id: string
          orders_created?: number | null
          orders_extracted?: number | null
          parsed_data?: Json | null
          pickup_point_id: string
          processed_by_agent?: string | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          raw_data?: Json
          raw_file_url?: string | null
          raw_payload: Json
          status?: Database["public"]["Enums"]["intake_status_enum"]
          updated_at?: string
          validation_errors?: Json | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["intake_method_enum"]
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          external_ref?: string | null
          id?: string
          operator_id?: string
          orders_created?: number | null
          orders_extracted?: number | null
          parsed_data?: Json | null
          pickup_point_id?: string
          processed_by_agent?: string | null
          processing_completed_at?: string | null
          processing_started_at?: string | null
          raw_data?: Json
          raw_file_url?: string | null
          raw_payload?: Json
          status?: Database["public"]["Enums"]["intake_status_enum"]
          updated_at?: string
          validation_errors?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_submissions_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_submissions_generator_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_submissions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          client_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: Database["public"]["Enums"]["connector_type_enum"]
          max_retries: number
          operator_id: string
          priority: number
          result: Json | null
          retry_count: number
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status_enum"]
          updated_at: string
        }
        Insert: {
          client_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["connector_type_enum"]
          max_retries?: number
          operator_id: string
          priority?: number
          result?: Json | null
          retry_count?: number
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status_enum"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["connector_type_enum"]
          max_retries?: number
          operator_id?: string
          priority?: number
          result?: Json | null
          retry_count?: number
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      load_positions: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          fronts_dock_zone_id: string | null
          id: string
          is_active: boolean
          label: string | null
          operator_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          fronts_dock_zone_id?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          operator_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          fronts_dock_zone_id?: string | null
          id?: string
          is_active?: boolean
          label?: string | null
          operator_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_positions_fronts_dock_zone_id_fkey"
            columns: ["fronts_dock_zone_id"]
            isOneToOne: false
            referencedRelation: "dock_zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "load_positions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      manifest_documents: {
        Row: {
          captured_at: string
          deleted_at: string | null
          id: string
          manifest_id: string
          operator_id: string
          sheet_number: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          captured_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id: string
          operator_id: string
          sheet_number: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          captured_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id?: string
          operator_id?: string
          sheet_number?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manifest_documents_manifest_id_fkey"
            columns: ["manifest_id"]
            isOneToOne: false
            referencedRelation: "manifests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manifest_documents_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manifest_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          reception_status:
            | Database["public"]["Enums"]["reception_status_enum"]
            | null
          retailer_name: string | null
          signature_client: string | null
          signature_client_name: string | null
          signature_operator: string | null
          signature_operator_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["manifest_status_enum"]
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
          reception_status?:
            | Database["public"]["Enums"]["reception_status_enum"]
            | null
          retailer_name?: string | null
          signature_client?: string | null
          signature_client_name?: string | null
          signature_operator?: string | null
          signature_operator_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["manifest_status_enum"]
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
          reception_status?:
            | Database["public"]["Enums"]["reception_status_enum"]
            | null
          retailer_name?: string | null
          signature_client?: string | null
          signature_client_name?: string | null
          signature_operator?: string | null
          signature_operator_name?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["manifest_status_enum"]
          total_orders?: number | null
          total_packages?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manifests_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manifests_labels_printed_by_fkey"
            columns: ["labels_printed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
        ]
      }
      operator_config: {
        Row: {
          agent_overrides: Json | null
          auto_assignment_enabled: boolean | null
          business_hours: Json | null
          created_at: string
          escalation_email: string | null
          id: string
          operator_id: string
          timezone: string | null
          updated_at: string
          whatsapp_enabled: boolean | null
          wismo_response_language: string | null
        }
        Insert: {
          agent_overrides?: Json | null
          auto_assignment_enabled?: boolean | null
          business_hours?: Json | null
          created_at?: string
          escalation_email?: string | null
          id?: string
          operator_id: string
          timezone?: string | null
          updated_at?: string
          whatsapp_enabled?: boolean | null
          wismo_response_language?: string | null
        }
        Update: {
          agent_overrides?: Json | null
          auto_assignment_enabled?: boolean | null
          business_hours?: Json | null
          created_at?: string
          escalation_email?: string | null
          id?: string
          operator_id?: string
          timezone?: string | null
          updated_at?: string
          whatsapp_enabled?: boolean | null
          wismo_response_language?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_config_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: true
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_enabled_modules: {
        Row: {
          disabled_at: string | null
          disabled_by: string | null
          enabled_at: string
          enabled_by: string
          id: string
          module_key: string
          operator_id: string
        }
        Insert: {
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string
          enabled_by: string
          id?: string
          module_key: string
          operator_id: string
        }
        Update: {
          disabled_at?: string | null
          disabled_by?: string | null
          enabled_at?: string
          enabled_by?: string
          id?: string
          module_key?: string
          operator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_enabled_modules_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_module_audit: {
        Row: {
          action: string
          actor_user_id: string
          at: string
          id: string
          module_key: string
          operator_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          at?: string
          id?: string
          module_key: string
          operator_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
          at?: string
          id?: string
          module_key?: string
          operator_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operator_module_audit_operator_id_fkey"
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
      order_reschedules: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          customer_note: string | null
          deleted_at: string | null
          id: string
          operator_id: string
          operator_notes: string | null
          order_id: string
          reason: string
          requested_address: string | null
          requested_date: string | null
          requested_window_end: string | null
          requested_window_start: string | null
          session_message_id: string | null
          status: string
          triggered_by: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          customer_note?: string | null
          deleted_at?: string | null
          id?: string
          operator_id: string
          operator_notes?: string | null
          order_id: string
          reason: string
          requested_address?: string | null
          requested_date?: string | null
          requested_window_end?: string | null
          requested_window_start?: string | null
          session_message_id?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          customer_note?: string | null
          deleted_at?: string | null
          id?: string
          operator_id?: string
          operator_notes?: string | null
          order_id?: string
          reason?: string
          requested_address?: string | null
          requested_date?: string | null
          requested_window_end?: string | null
          requested_window_start?: string | null
          session_message_id?: string | null
          status?: string
          triggered_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_reschedules_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reschedules_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reschedules_session_message_id_fkey"
            columns: ["session_message_id"]
            isOneToOne: false
            referencedRelation: "customer_session_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          agent_metadata: Json | null
          cargo_type: string | null
          comuna: string
          comuna_id: string | null
          comuna_raw: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          deleted_at: string | null
          delivery_address: string
          delivery_date: string
          delivery_window_end: string | null
          delivery_window_start: string | null
          destination_address: Json | null
          dispatch_guide_url: string | null
          external_load_id: string | null
          geocode_attempts: number
          geocode_last_attempt_at: string | null
          geocode_next_attempt_at: string | null
          geocode_precision: string | null
          geocode_source: string | null
          geocode_status: string
          geocoded_at: string | null
          id: string
          imported_at: string
          imported_via: Database["public"]["Enums"]["imported_via_enum"]
          intake_submission_id: string | null
          latitude: number | null
          leading_status: Database["public"]["Enums"]["order_status_enum"]
          longitude: number | null
          metadata: Json | null
          operator_id: string
          order_number: string
          origin_address: Json | null
          pickup_point_id: string | null
          priority: number
          raw_data: Json
          recipient_region: string | null
          requires_signature: boolean
          rescheduled_delivery_date: string | null
          rescheduled_window_end: string | null
          rescheduled_window_start: string | null
          retailer_name: string | null
          service_type: string | null
          sla_breached: boolean
          sla_deadline_at: string | null
          source_file: string | null
          status: Database["public"]["Enums"]["order_status_enum"]
          status_detail: string | null
          status_updated_at: string | null
          tenant_client_id: string | null
          total_volume_m3: number | null
          total_weight_kg: number | null
          updated_at: string | null
        }
        Insert: {
          agent_metadata?: Json | null
          cargo_type?: string | null
          comuna: string
          comuna_id?: string | null
          comuna_raw?: string | null
          created_at?: string
          customer_name: string
          customer_phone: string
          deleted_at?: string | null
          delivery_address: string
          delivery_date: string
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_address?: Json | null
          dispatch_guide_url?: string | null
          external_load_id?: string | null
          geocode_attempts?: number
          geocode_last_attempt_at?: string | null
          geocode_next_attempt_at?: string | null
          geocode_precision?: string | null
          geocode_source?: string | null
          geocode_status?: string
          geocoded_at?: string | null
          id?: string
          imported_at: string
          imported_via: Database["public"]["Enums"]["imported_via_enum"]
          intake_submission_id?: string | null
          latitude?: number | null
          leading_status?: Database["public"]["Enums"]["order_status_enum"]
          longitude?: number | null
          metadata?: Json | null
          operator_id: string
          order_number: string
          origin_address?: Json | null
          pickup_point_id?: string | null
          priority?: number
          raw_data: Json
          recipient_region?: string | null
          requires_signature?: boolean
          rescheduled_delivery_date?: string | null
          rescheduled_window_end?: string | null
          rescheduled_window_start?: string | null
          retailer_name?: string | null
          service_type?: string | null
          sla_breached?: boolean
          sla_deadline_at?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          status_detail?: string | null
          status_updated_at?: string | null
          tenant_client_id?: string | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_metadata?: Json | null
          cargo_type?: string | null
          comuna?: string
          comuna_id?: string | null
          comuna_raw?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          deleted_at?: string | null
          delivery_address?: string
          delivery_date?: string
          delivery_window_end?: string | null
          delivery_window_start?: string | null
          destination_address?: Json | null
          dispatch_guide_url?: string | null
          external_load_id?: string | null
          geocode_attempts?: number
          geocode_last_attempt_at?: string | null
          geocode_next_attempt_at?: string | null
          geocode_precision?: string | null
          geocode_source?: string | null
          geocode_status?: string
          geocoded_at?: string | null
          id?: string
          imported_at?: string
          imported_via?: Database["public"]["Enums"]["imported_via_enum"]
          intake_submission_id?: string | null
          latitude?: number | null
          leading_status?: Database["public"]["Enums"]["order_status_enum"]
          longitude?: number | null
          metadata?: Json | null
          operator_id?: string
          order_number?: string
          origin_address?: Json | null
          pickup_point_id?: string | null
          priority?: number
          raw_data?: Json
          recipient_region?: string | null
          requires_signature?: boolean
          rescheduled_delivery_date?: string | null
          rescheduled_window_end?: string | null
          rescheduled_window_start?: string | null
          retailer_name?: string | null
          service_type?: string | null
          sla_breached?: boolean
          sla_deadline_at?: string | null
          source_file?: string | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          status_detail?: string | null
          status_updated_at?: string | null
          tenant_client_id?: string | null
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_generator_id_fkey"
            columns: ["pickup_point_id"]
            isOneToOne: false
            referencedRelation: "pickup_points"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_intake_submission_id_fkey"
            columns: ["intake_submission_id"]
            isOneToOne: false
            referencedRelation: "intake_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_client_id_fkey"
            columns: ["tenant_client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          declared_box_count: number | null
          declared_dimensions: Json | null
          declared_weight_kg: number | null
          deleted_at: string | null
          dock_zone_id: string | null
          id: string
          is_generated_label: boolean | null
          label: string
          load_inferred: boolean
          loaded_at: string | null
          loaded_by: string | null
          loaded_route_id: string | null
          metadata: Json | null
          operator_id: string
          order_id: string
          package_number: string | null
          parent_label: string | null
          raw_data: Json
          return_reason: string | null
          return_reason_code: string | null
          sku_items: Json
          status: Database["public"]["Enums"]["package_status_enum"]
          status_updated_at: string | null
          updated_at: string | null
          verified_dimensions: Json | null
          verified_weight_kg: number | null
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          declared_box_count?: number | null
          declared_dimensions?: Json | null
          declared_weight_kg?: number | null
          deleted_at?: string | null
          dock_zone_id?: string | null
          id?: string
          is_generated_label?: boolean | null
          label: string
          load_inferred?: boolean
          loaded_at?: string | null
          loaded_by?: string | null
          loaded_route_id?: string | null
          metadata?: Json | null
          operator_id: string
          order_id: string
          package_number?: string | null
          parent_label?: string | null
          raw_data: Json
          return_reason?: string | null
          return_reason_code?: string | null
          sku_items?: Json
          status?: Database["public"]["Enums"]["package_status_enum"]
          status_updated_at?: string | null
          updated_at?: string | null
          verified_dimensions?: Json | null
          verified_weight_kg?: number | null
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          declared_box_count?: number | null
          declared_dimensions?: Json | null
          declared_weight_kg?: number | null
          deleted_at?: string | null
          dock_zone_id?: string | null
          id?: string
          is_generated_label?: boolean | null
          label?: string
          load_inferred?: boolean
          loaded_at?: string | null
          loaded_by?: string | null
          loaded_route_id?: string | null
          metadata?: Json | null
          operator_id?: string
          order_id?: string
          package_number?: string | null
          parent_label?: string | null
          raw_data?: Json
          return_reason?: string | null
          return_reason_code?: string | null
          sku_items?: Json
          status?: Database["public"]["Enums"]["package_status_enum"]
          status_updated_at?: string | null
          updated_at?: string | null
          verified_dimensions?: Json | null
          verified_weight_kg?: number | null
        }
        Relationships: [
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
        ]
      }
      performance_metrics: {
        Row: {
          avg_delivery_time_minutes: number | null
          created_at: string
          deleted_at: string | null
          delivered_orders: number
          failed_deliveries: number
          first_attempt_deliveries: number
          id: string
          metric_date: string
          operator_id: string
          retailer_name: string | null
          shortage_claims_amount_clp: number
          shortage_claims_count: number
          total_orders: number
          updated_at: string
        }
        Insert: {
          avg_delivery_time_minutes?: number | null
          created_at?: string
          deleted_at?: string | null
          delivered_orders?: number
          failed_deliveries?: number
          first_attempt_deliveries?: number
          id?: string
          metric_date: string
          operator_id: string
          retailer_name?: string | null
          shortage_claims_amount_clp?: number
          shortage_claims_count?: number
          total_orders?: number
          updated_at?: string
        }
        Update: {
          avg_delivery_time_minutes?: number | null
          created_at?: string
          deleted_at?: string | null
          delivered_orders?: number
          failed_deliveries?: number
          first_attempt_deliveries?: number
          id?: string
          metric_date?: string
          operator_id?: string
          retailer_name?: string | null
          shortage_claims_amount_clp?: number
          shortage_claims_count?: number
          total_orders?: number
          updated_at?: string
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
      pickup_points: {
        Row: {
          code: string | null
          confirmation_config: Json
          created_at: string
          deleted_at: string | null
          id: string
          intake_config: Json
          intake_method: Database["public"]["Enums"]["intake_method_enum"]
          is_active: boolean
          name: string | null
          operator_id: string
          order_defaults: Json
          parsing_rules: Json
          pickup_locations: Json
          sla_config: Json
          tenant_client_id: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          confirmation_config?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          intake_config?: Json
          intake_method: Database["public"]["Enums"]["intake_method_enum"]
          is_active?: boolean
          name?: string | null
          operator_id: string
          order_defaults?: Json
          parsing_rules?: Json
          pickup_locations?: Json
          sla_config?: Json
          tenant_client_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          confirmation_config?: Json
          created_at?: string
          deleted_at?: string | null
          id?: string
          intake_config?: Json
          intake_method?: Database["public"]["Enums"]["intake_method_enum"]
          is_active?: boolean
          name?: string | null
          operator_id?: string
          order_defaults?: Json
          parsing_rules?: Json
          pickup_locations?: Json
          sla_config?: Json
          tenant_client_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generators_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generators_tenant_client_id_fkey"
            columns: ["tenant_client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
        ]
      }
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
            foreignKeyName: "pickup_route_crew_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
        ]
      }
      pickup_routes: {
        Row: {
          cancellation_reason: string | null
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
          status: Database["public"]["Enums"]["pickup_route_status_enum"]
          updated_at: string
          vehicle_id: string
          vehicle_label: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          code: string
          created_at?: string
          deleted_at?: string | null
          driver_id: string
          id?: string
          in_transit_at?: string | null
          operator_id: string
          received_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["pickup_route_status_enum"]
          updated_at?: string
          vehicle_id: string
          vehicle_label?: string | null
        }
        Update: {
          cancellation_reason?: string | null
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
          status?: Database["public"]["Enums"]["pickup_route_status_enum"]
          updated_at?: string
          vehicle_id?: string
          vehicle_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_routes_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_routes_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
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
      pickup_scans: {
        Row: {
          barcode_scanned: string
          client_operation_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          manifest_id: string
          operator_id: string
          package_id: string | null
          scan_result: Database["public"]["Enums"]["scan_result_enum"]
          scanned_at: string
          scanned_by_user_id: string | null
          updated_at: string
        }
        Insert: {
          barcode_scanned: string
          client_operation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id: string
          operator_id: string
          package_id?: string | null
          scan_result: Database["public"]["Enums"]["scan_result_enum"]
          scanned_at: string
          scanned_by_user_id?: string | null
          updated_at?: string
        }
        Update: {
          barcode_scanned?: string
          client_operation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          manifest_id?: string
          operator_id?: string
          package_id?: string | null
          scan_result?: Database["public"]["Enums"]["scan_result_enum"]
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
          {
            foreignKeyName: "pickup_scans_scanned_by_user_id_fkey"
            columns: ["scanned_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_files: {
        Row: {
          client_id: string
          created_at: string
          file_name: string
          file_size_bytes: number | null
          id: string
          job_id: string
          operator_id: string
          received_at: string
          row_count: number | null
          storage_path: string
        }
        Insert: {
          client_id: string
          created_at?: string
          file_name: string
          file_size_bytes?: number | null
          id?: string
          job_id: string
          operator_id: string
          received_at?: string
          row_count?: number | null
          storage_path: string
        }
        Update: {
          client_id?: string
          created_at?: string
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          job_id?: string
          operator_id?: string
          received_at?: string
          row_count?: number | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_files_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      reception_scans: {
        Row: {
          barcode: string
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          package_id: string | null
          reception_id: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          scanned_by: string | null
          updated_at: string
        }
        Insert: {
          barcode: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          package_id?: string | null
          reception_id: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          scanned_by?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          package_id?: string | null
          reception_id?: string
          scan_result?: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at?: string
          scanned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reception_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
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
            foreignKeyName: "reception_scans_reception_id_fkey"
            columns: ["reception_id"]
            isOneToOne: false
            referencedRelation: "route_receptions"
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
      retailer_daily_capacities: {
        Row: {
          capacity_date: string
          client_id: string
          created_at: string
          daily_capacity: number
          deleted_at: string | null
          id: string
          notes: string | null
          operator_id: string
          source: string
          updated_at: string | null
        }
        Insert: {
          capacity_date: string
          client_id: string
          created_at?: string
          daily_capacity: number
          deleted_at?: string | null
          id?: string
          notes?: string | null
          operator_id: string
          source?: string
          updated_at?: string | null
        }
        Update: {
          capacity_date?: string
          client_id?: string
          created_at?: string
          daily_capacity?: number
          deleted_at?: string | null
          id?: string
          notes?: string | null
          operator_id?: string
          source?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retailer_daily_capacities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tenant_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retailer_daily_capacities_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      retailer_return_sla_config: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          notes: string | null
          operator_id: string
          retailer_id: string
          retailer_name: string
          sla_hours: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          operator_id: string
          retailer_id: string
          retailer_name: string
          sla_hours: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          notes?: string | null
          operator_id?: string
          retailer_id?: string
          retailer_name?: string
          sla_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retailer_return_sla_config_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
        ]
      }
      return_reception_scans: {
        Row: {
          barcode: string
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          package_id: string | null
          return_reception_id: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          scanned_by: string | null
          updated_at: string
        }
        Insert: {
          barcode: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          package_id?: string | null
          return_reception_id: string
          scan_result: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at: string
          scanned_by?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          package_id?: string | null
          return_reception_id?: string
          scan_result?: Database["public"]["Enums"]["reception_scan_result_enum"]
          scanned_at?: string
          scanned_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_reception_scans_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_reception_scans_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_reception_scans_return_reception_id_fkey"
            columns: ["return_reception_id"]
            isOneToOne: false
            referencedRelation: "return_receptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_reception_scans_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      return_receptions: {
        Row: {
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          expected_count: number
          external_route_id: string
          id: string
          operator_id: string
          received_by: string | null
          received_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          expected_count?: number
          external_route_id: string
          id?: string
          operator_id: string
          received_by?: string | null
          received_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          expected_count?: number
          external_route_id?: string
          id?: string
          operator_id?: string
          received_by?: string | null
          received_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "return_receptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "return_receptions_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      route_blocks: {
        Row: {
          comuna_id: string
          created_at: string
          deleted_at: string | null
          donor_route_id: string | null
          id: string
          operator_id: string
          route_id: string
          sequence_index: number
          sequence_source: string
          updated_at: string
        }
        Insert: {
          comuna_id: string
          created_at?: string
          deleted_at?: string | null
          donor_route_id?: string | null
          id?: string
          operator_id: string
          route_id: string
          sequence_index: number
          sequence_source?: string
          updated_at?: string
        }
        Update: {
          comuna_id?: string
          created_at?: string
          deleted_at?: string | null
          donor_route_id?: string | null
          id?: string
          operator_id?: string
          route_id?: string
          sequence_index?: number
          sequence_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_blocks_comuna_id_fkey"
            columns: ["comuna_id"]
            isOneToOne: false
            referencedRelation: "chile_comunas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_blocks_donor_route_id_fkey"
            columns: ["donor_route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
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
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count: number
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
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count?: number
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
          status?: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_receptions_delivered_by_fkey"
            columns: ["delivered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_receptions_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_receptions_pickup_route_id_fkey"
            columns: ["pickup_route_id"]
            isOneToOne: false
            referencedRelation: "pickup_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_receptions_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          completed_stops: number | null
          created_at: string
          deleted_at: string | null
          dispatch_attempt_at: string | null
          driver_name: string | null
          end_time: string | null
          external_route_id: string
          id: string
          idle_time_minutes: number | null
          load_position_assigned_at: string | null
          load_position_assigned_by: string | null
          load_position_id: string | null
          load_position_released_at: string | null
          load_position_released_by: string | null
          max_drops: number | null
          operator_id: string
          planned_stops: number | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data: Json
          route_date: string
          start_time: string | null
          status: Database["public"]["Enums"]["route_status_enum"]
          total_km: number | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          completed_stops?: number | null
          created_at?: string
          deleted_at?: string | null
          dispatch_attempt_at?: string | null
          driver_name?: string | null
          end_time?: string | null
          external_route_id: string
          id?: string
          idle_time_minutes?: number | null
          load_position_assigned_at?: string | null
          load_position_assigned_by?: string | null
          load_position_id?: string | null
          load_position_released_at?: string | null
          load_position_released_by?: string | null
          max_drops?: number | null
          operator_id: string
          planned_stops?: number | null
          provider: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          route_date: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["route_status_enum"]
          total_km?: number | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          completed_stops?: number | null
          created_at?: string
          deleted_at?: string | null
          dispatch_attempt_at?: string | null
          driver_name?: string | null
          end_time?: string | null
          external_route_id?: string
          id?: string
          idle_time_minutes?: number | null
          load_position_assigned_at?: string | null
          load_position_assigned_by?: string | null
          load_position_id?: string | null
          load_position_released_at?: string | null
          load_position_released_by?: string | null
          max_drops?: number | null
          operator_id?: string
          planned_stops?: number | null
          provider?: Database["public"]["Enums"]["routing_provider_enum"]
          raw_data?: Json
          route_date?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["route_status_enum"]
          total_km?: number | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routes_load_position_assigned_by_fkey"
            columns: ["load_position_assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_load_position_id_fkey"
            columns: ["load_position_id"]
            isOneToOne: false
            referencedRelation: "load_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_load_position_released_by_fkey"
            columns: ["load_position_released_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
      settlement_documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          document_type: string
          file_name: string
          file_size_bytes: number | null
          folio_number: string | null
          id: string
          iva_amount_clp: number | null
          mime_type: string | null
          net_amount_clp: number | null
          notes: string | null
          operator_id: string
          raw_data: Json
          settlement_id: string
          storage_path: string
          total_amount_clp: number | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          document_type: string
          file_name: string
          file_size_bytes?: number | null
          folio_number?: string | null
          id?: string
          iva_amount_clp?: number | null
          mime_type?: string | null
          net_amount_clp?: number | null
          notes?: string | null
          operator_id: string
          raw_data?: Json
          settlement_id: string
          storage_path: string
          total_amount_clp?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          document_type?: string
          file_name?: string
          file_size_bytes?: number | null
          folio_number?: string | null
          id?: string
          iva_amount_clp?: number | null
          mime_type?: string | null
          net_amount_clp?: number | null
          notes?: string | null
          operator_id?: string
          raw_data?: Json
          settlement_id?: string
          storage_path?: string
          total_amount_clp?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_documents_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_documents_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_line_items: {
        Row: {
          amount_clp: number
          assignment_id: string | null
          client_charge_clp: number | null
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          is_credit: boolean
          line_type: string
          operator_id: string
          order_id: string | null
          quantity: number
          raw_data: Json
          settlement_id: string
          unit_rate_clp: number
          updated_at: string
        }
        Insert: {
          amount_clp?: number
          assignment_id?: string | null
          client_charge_clp?: number | null
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          is_credit?: boolean
          line_type: string
          operator_id: string
          order_id?: string | null
          quantity?: number
          raw_data?: Json
          settlement_id: string
          unit_rate_clp?: number
          updated_at?: string
        }
        Update: {
          amount_clp?: number
          assignment_id?: string | null
          client_charge_clp?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          is_credit?: boolean
          line_type?: string
          operator_id?: string
          order_id?: string | null
          quantity?: number
          raw_data?: Json
          settlement_id?: string
          unit_rate_clp?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_line_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_line_items_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_line_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_line_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bonuses_clp: number
          calculated_at: string | null
          created_at: string
          deductions_clp: number
          deleted_at: string | null
          dispute_reason: string | null
          dispute_resolved_at: string | null
          dispute_resolved_by: string | null
          disputed_at: string | null
          driver_id: string
          failed_deliveries: number
          gross_pay_clp: number
          id: string
          net_pay_clp: number
          notes: string | null
          operator_id: string
          operator_margin_clp: number
          operator_revenue_clp: number
          paid_at: string | null
          pay_config_snapshot: Json
          pay_model: Database["public"]["Enums"]["pay_model_enum"]
          payment_reference: string | null
          raw_data: Json
          reviewed_at: string | null
          reviewed_by: string | null
          settlement_date: string
          status: Database["public"]["Enums"]["settlement_status_enum"]
          successful_deliveries: number
          total_deliveries: number
          total_km: number | null
          total_packages: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bonuses_clp?: number
          calculated_at?: string | null
          created_at?: string
          deductions_clp?: number
          deleted_at?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_resolved_by?: string | null
          disputed_at?: string | null
          driver_id: string
          failed_deliveries?: number
          gross_pay_clp?: number
          id?: string
          net_pay_clp?: number
          notes?: string | null
          operator_id: string
          operator_margin_clp?: number
          operator_revenue_clp?: number
          paid_at?: string | null
          pay_config_snapshot: Json
          pay_model: Database["public"]["Enums"]["pay_model_enum"]
          payment_reference?: string | null
          raw_data?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_date: string
          status?: Database["public"]["Enums"]["settlement_status_enum"]
          successful_deliveries?: number
          total_deliveries?: number
          total_km?: number | null
          total_packages?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bonuses_clp?: number
          calculated_at?: string | null
          created_at?: string
          deductions_clp?: number
          deleted_at?: string | null
          dispute_reason?: string | null
          dispute_resolved_at?: string | null
          dispute_resolved_by?: string | null
          disputed_at?: string | null
          driver_id?: string
          failed_deliveries?: number
          gross_pay_clp?: number
          id?: string
          net_pay_clp?: number
          notes?: string | null
          operator_id?: string
          operator_margin_clp?: number
          operator_revenue_clp?: number
          paid_at?: string | null
          pay_config_snapshot?: Json
          pay_model?: Database["public"]["Enums"]["pay_model_enum"]
          payment_reference?: string | null
          raw_data?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          settlement_date?: string
          status?: Database["public"]["Enums"]["settlement_status_enum"]
          successful_deliveries?: number
          total_deliveries?: number
          total_km?: number | null
          total_packages?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_periods_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_dispute_resolved_by_fkey"
            columns: ["dispute_resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      spec79_loaded_route_backfill_candidates: {
        Row: {
          created_at: string
          operator_id: string
          order_id: string
          route_id: string
        }
        Insert: {
          created_at?: string
          operator_id: string
          order_id: string
          route_id: string
        }
        Update: {
          created_at?: string
          operator_id?: string
          order_id?: string
          route_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec79_loaded_route_backfill_candidates_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec79_loaded_route_backfill_candidates_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec79_loaded_route_backfill_candidates_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_clients: {
        Row: {
          connector_config: Json
          connector_type:
            | Database["public"]["Enums"]["connector_type_enum"]
            | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          operator_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          connector_config?: Json
          connector_type?:
            | Database["public"]["Enums"]["connector_type_enum"]
            | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          operator_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          connector_config?: Json
          connector_type?:
            | Database["public"]["Enums"]["connector_type_enum"]
            | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          operator_id?: string
          slug?: string
          updated_at?: string
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
      users: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          operator_id: string
          permissions: string[]
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          operator_id: string
          permissions?: string[]
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          operator_id?: string
          permissions?: string[]
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
      vehicle_load_samples: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          operator_id: string
          package_count: number
          route_id: string
          sealed_at: string
          total_volume_m3: number | null
          total_weight_kg: number | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id: string
          package_count: number
          route_id: string
          sealed_at: string
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          operator_id?: string
          package_count?: number
          route_id?: string
          sealed_at?: string
          total_volume_m3?: number | null
          total_weight_kg?: number | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_load_samples_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_load_samples_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_load_samples_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
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
      wismo_notifications: {
        Row: {
          channel: Database["public"]["Enums"]["conversation_channel_enum"]
          conversation_id: string | null
          conversation_message_id: string | null
          created_at: string
          deleted_at: string | null
          delivered_at: string | null
          delivery_status: Database["public"]["Enums"]["wismo_delivery_status_enum"]
          external_message_id: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          message_body: string | null
          notification_type: Database["public"]["Enums"]["wismo_type_enum"]
          operator_id: string
          order_id: string
          raw_data: Json
          read_at: string | null
          recipient_name: string | null
          recipient_phone: string
          scheduled_at: string | null
          sent_at: string | null
          template_name: string | null
          template_params: Json | null
          triggered_by: string | null
          triggered_by_event_id: string | null
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["conversation_channel_enum"]
          conversation_id?: string | null
          conversation_message_id?: string | null
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_status?: Database["public"]["Enums"]["wismo_delivery_status_enum"]
          external_message_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          message_body?: string | null
          notification_type: Database["public"]["Enums"]["wismo_type_enum"]
          operator_id: string
          order_id: string
          raw_data?: Json
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone: string
          scheduled_at?: string | null
          sent_at?: string | null
          template_name?: string | null
          template_params?: Json | null
          triggered_by?: string | null
          triggered_by_event_id?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["conversation_channel_enum"]
          conversation_id?: string | null
          conversation_message_id?: string | null
          created_at?: string
          deleted_at?: string | null
          delivered_at?: string | null
          delivery_status?: Database["public"]["Enums"]["wismo_delivery_status_enum"]
          external_message_id?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          message_body?: string | null
          notification_type?: Database["public"]["Enums"]["wismo_type_enum"]
          operator_id?: string
          order_id?: string
          raw_data?: Json
          read_at?: string | null
          recipient_name?: string | null
          recipient_phone?: string
          scheduled_at?: string | null
          sent_at?: string | null
          template_name?: string | null
          template_params?: Json | null
          triggered_by?: string | null
          triggered_by_event_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_wismo_triggered_by_event"
            columns: ["triggered_by_event_id"]
            isOneToOne: false
            referencedRelation: "agent_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wismo_notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wismo_notifications_conversation_message_id_fkey"
            columns: ["conversation_message_id"]
            isOneToOne: false
            referencedRelation: "conversation_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wismo_notifications_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wismo_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      pg_all_foreign_keys: {
        Row: {
          fk_columns: unknown[] | null
          fk_constraint_name: unknown
          fk_schema_name: unknown
          fk_table_name: unknown
          fk_table_oid: unknown
          is_deferrable: boolean | null
          is_deferred: boolean | null
          match_type: string | null
          on_delete: string | null
          on_update: string | null
          pk_columns: unknown[] | null
          pk_constraint_name: unknown
          pk_index_name: unknown
          pk_schema_name: unknown
          pk_table_name: unknown
          pk_table_oid: unknown
        }
        Relationships: []
      }
      route_stop_counts: {
        Row: {
          adopted_stops: number | null
          force_split_stops: number | null
          operator_id: string | null
          partially_staged_stops: number | null
          pending_stops: number | null
          route_id: string | null
          staged_stops: number | null
          total_stops: number | null
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
        ]
      }
      tap_funky: {
        Row: {
          args: string | null
          is_definer: boolean | null
          is_strict: boolean | null
          is_visible: boolean | null
          kind: unknown
          langoid: unknown
          name: unknown
          oid: unknown
          owner: unknown
          returns: string | null
          returns_set: boolean | null
          schema: unknown
          volatility: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _cleanup: { Args: never; Returns: boolean }
      _contract_on: { Args: { "": string }; Returns: unknown }
      _currtest: { Args: never; Returns: number }
      _db_privs: { Args: never; Returns: unknown[] }
      _extensions: { Args: never; Returns: unknown[] }
      _get: { Args: { "": string }; Returns: number }
      _get_latest: { Args: { "": string }; Returns: number[] }
      _get_note: { Args: { "": string }; Returns: string }
      _get_or_create_unregistered_vehicle: {
        Args: { p_operator: string }
        Returns: string
      }
      _is_verbose: { Args: never; Returns: boolean }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _prokind: { Args: { p_oid: unknown }; Returns: unknown }
      _query: { Args: { "": string }; Returns: string }
      _refine_vol: { Args: { "": string }; Returns: string }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _table_privs: { Args: never; Returns: unknown[] }
      _temptypes: { Args: { "": string }; Returns: string }
      _todo: { Args: never; Returns: string }
      accept_topup_block: {
        Args: {
          p_comuna_id: string
          p_donor_route_id: string
          p_operator_id: string
          p_reason: string
          p_receiving_route_id: string
          p_user_id: string
        }
        Returns: Json
      }
      add_dock_zone_adjacency_pair: {
        Args: { p_adjacent_zone_id: string; p_dock_zone_id: string }
        Returns: {
          adjacent_zone_id: string
          created_at: string
          deleted_at: string | null
          dock_zone_id: string
          id: string
          operator_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "dock_zone_adjacency"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      add_manifest_to_route: {
        Args: { p_manifest_id: string; p_route_id: string }
        Returns: {
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
          reception_status:
            | Database["public"]["Enums"]["reception_status_enum"]
            | null
          retailer_name: string | null
          signature_client: string | null
          signature_client_name: string | null
          signature_operator: string | null
          signature_operator_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["manifest_status_enum"]
          total_orders: number | null
          total_packages: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "manifests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      archive_old_audit_logs: { Args: never; Returns: undefined }
      assert_operator_access: {
        Args: { p_operator_id: string }
        Returns: undefined
      }
      assign_load_position: {
        Args: {
          p_load_position_id?: string
          p_operator_id: string
          p_route_id: string
          p_user_id: string
        }
        Returns: string
      }
      calculate_daily_metrics: { Args: { p_date: string }; Returns: undefined }
      calculate_dashboard_monthly_rollup: {
        Args: { p_month: number; p_year: number }
        Returns: undefined
      }
      calculate_fadr: {
        Args: {
          p_end_date: string
          p_operator_id: string
          p_start_date: string
        }
        Returns: number
      }
      calculate_order_priority: {
        Args: {
          p_current_time?: string
          p_delivery_date: string
          p_delivery_window_end: string
        }
        Returns: string
      }
      calculate_sla: {
        Args: {
          p_end_date: string
          p_operator_id: string
          p_start_date: string
        }
        Returns: number
      }
      cancel_pickup_route: {
        Args: { p_reason: string; p_route_id: string }
        Returns: {
          cancellation_reason: string | null
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
          status: Database["public"]["Enums"]["pickup_route_status_enum"]
          updated_at: string
          vehicle_id: string
          vehicle_label: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pickup_routes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_load_position_conflict: {
        Args: { p_operator_id: string; p_route_id: string }
        Returns: Json
      }
      close_manifest: {
        Args: { p_manifest_id: string; p_signatures: Json }
        Returns: {
          out_completed_at: string
          out_missing_count: number
          out_signature_client: string
          out_signature_client_name: string
          out_unexpected_count: number
          out_verified_count: number
        }[]
      }
      close_pickup_route: {
        Args: { p_route_id: string }
        Returns: {
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
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "route_receptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      col_is_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      col_not_null:
        | {
            Args: {
              column_name: unknown
              description?: string
              schema_name: unknown
              table_name: unknown
            }
            Returns: string
          }
        | {
            Args: {
              column_name: unknown
              description?: string
              table_name: unknown
            }
            Returns: string
          }
      complete_return_reception_scan: {
        Args: {
          p_barcode: string
          p_operator_id: string
          p_package_id: string
          p_return_reception_id: string
          p_scanned_by: string
        }
        Returns: Json
      }
      complete_route_reception: {
        Args: {
          p_discrepancy_notes?: string
          p_missing_reasons?: Json
          p_route_id: string
        }
        Returns: {
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
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "route_receptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      compute_route_actual_sequence: {
        Args: { p_operator_id: string; p_route_id: string }
        Returns: undefined
      }
      create_audit_logs_partition: {
        Args: { partition_date: string }
        Returns: undefined
      }
      create_seeded_route: {
        Args: {
          p_operator_id: string
          p_order_ids: string[]
          p_route_date?: string
        }
        Returns: Json
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_minted_carton: {
        Args: { p_package_id: string; p_reason: string }
        Returns: undefined
      }
      diag:
        | {
            Args: { msg: unknown }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { msg: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.diag(msg => text), public.diag(msg => anyelement). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      diag_test_name: { Args: { "": string }; Returns: string }
      disable_module_for_operator: {
        Args: { p_module_key: string; p_operator_id: string; p_reason: string }
        Returns: undefined
      }
      disablelongtransactions: { Args: never; Returns: string }
      do_tap:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enable_module_for_operator: {
        Args: { p_module_key: string; p_operator_id: string; p_reason: string }
        Returns: undefined
      }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expand_carton: {
        Args: {
          p_additional_boxes: number
          p_package_id: string
          p_reason: string
        }
        Returns: {
          out_declared_box_count: number
          out_id: string
          out_is_generated_label: boolean
          out_label: string
          out_order_id: string
          out_package_number: string
          out_parent_label: string
        }[]
      }
      fail:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      find_or_create_return_reception: {
        Args: { p_external_route_id: string; p_operator_id: string }
        Returns: Json
      }
      findfuncs: { Args: { "": string }; Returns: string[] }
      finish: { Args: { exception_on_failure?: boolean }; Returns: string[] }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_active_routes_with_dispatches: {
        Args: { p_operator_id: string; p_route_date?: string }
        Returns: Json
      }
      get_capacity_utilization: {
        Args: { p_date_from: string; p_date_to: string; p_operator_id: string }
        Returns: {
          actual_orders: number
          capacity_date: string
          client_id: string
          daily_capacity: number
          retailer_name: string
          utilization_pct: number
        }[]
      }
      get_committed_orders_daily: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json[]
      }
      get_completed_manifests: {
        Args: never
        Returns: {
          completed_at: string
          created_at: string
          external_load_id: string
          id: string
          labels_printed_at: string
          labels_printed_by_name: string
          missing_count: number
          pickup_point: string
          retailer_name: string
          signature_operator: string
          total_orders: number
          total_packages: number
        }[]
      }
      get_current_user_role: { Args: never; Returns: string }
      get_daily_orders_by_client: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json[]
      }
      get_dashboard_late_reasons: {
        Args: { p_end: string; p_operator_id: string; p_start: string }
        Returns: {
          count: number
          pct: number
          reason: string
        }[]
      }
      get_dashboard_north_stars: {
        Args: { p_month: number; p_operator_id: string; p_year: number }
        Returns: {
          computed_at: string
          cpo_clp: number
          csat_pct: number
          delivered_orders: number
          failed_orders: number
          nps_score: number
          otif_pct: number
          period_month: number
          period_year: number
          row_type: string
          total_orders: number
        }[]
      }
      get_dashboard_otif_by_customer: {
        Args: { p_end: string; p_operator_id: string; p_start: string }
        Returns: {
          customer_name: string
          delivered_orders: number
          otif_pct: number
          total_orders: number
        }[]
      }
      get_dashboard_otif_by_region: {
        Args: { p_end: string; p_operator_id: string; p_start: string }
        Returns: {
          delivered_orders: number
          otif_pct: number
          region_name: string
          total_orders: number
        }[]
      }
      get_dashboard_route_tactics: {
        Args: { p_end: string; p_operator_id: string; p_start: string }
        Returns: {
          avg_km_per_route: number
          avg_km_per_stop: number
          avg_orders_per_route: number
          fadr_pct: number
        }[]
      }
      get_discrepancies: {
        Args: {
          p_operation_type?: Database["public"]["Enums"]["discrepancy_operation_enum"]
          p_source_id?: string
          p_status?: Database["public"]["Enums"]["discrepancy_status_enum"]
        }
        Returns: {
          barcode: string | null
          created_at: string
          deleted_at: string | null
          detected_at: string
          detected_by_user_id: string | null
          id: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id: string | null
          migrated_from_note_id: string | null
          note: string | null
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id: string
          package_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          route_reception_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "discrepancies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_discrepancies_ops_control: {
        Args: {
          p_status?: Database["public"]["Enums"]["discrepancy_status_enum"]
        }
        Returns: {
          carga: string
          closed_by_name: string
          detected_at: string
          id: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          note: string
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          order_number: string
          package_label: string
          ruta: string
          status: Database["public"]["Enums"]["discrepancy_status_enum"]
          total_count: number
        }[]
      }
      get_distribution_overview: {
        Args: { p_operator_id: string }
        Returns: Json
      }
      get_enabled_modules_for_operator: {
        Args: { p_operator_id: string }
        Returns: string[]
      }
      get_forecast_accuracy: {
        Args: { p_date_from: string; p_date_to: string; p_operator_id: string }
        Returns: {
          accuracy_score: number
          avg_variance_pct: number
          client_id: string
          days_measured: number
          retailer_name: string
        }[]
      }
      get_in_transit_manifests: {
        Args: never
        Returns: {
          closed_at: string
          created_at: string
          external_load_id: string
          id: string
          labels_printed_at: string
          labels_printed_by_name: string
          missing_count: number
          pickup_point: string
          reception_status: string
          retailer_name: string
          total_orders: number
          total_packages: number
          updated_at: string
        }[]
      }
      get_manifest_label_data: {
        Args: { p_manifest_id: string; p_package_id?: string }
        Returns: {
          comuna: string
          customer_name: string
          customer_phone: string
          declared_box_count: number
          delivery_address: string
          external_load_id: string
          order_number: string
          package_id: string
          package_label: string
          package_number: string
          retailer_name: string
          sku_items: Json
        }[]
      }
      get_module_audit_for_operator: {
        Args: { p_operator_id: string }
        Returns: {
          action: string
          actor_user_id: string
          at: string
          id: string
          module_key: string
          reason: string
        }[]
      }
      get_move_task_snapshot: { Args: { p_operator_id: string }; Returns: Json }
      get_my_active_pickup_route: { Args: never; Returns: Json }
      get_nav_counts: {
        Args: { p_operator_id: string }
        Returns: {
          dispatch: number
          distribution: number
          orders: number
          pickup: number
          reception: number
        }[]
      }
      get_operator_id: { Args: never; Returns: string }
      get_ops_control_snapshot: {
        Args: { p_operator_id: string }
        Returns: Json
      }
      get_orders_by_client: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json[]
      }
      get_orders_by_comuna: {
        Args: { p_end_date: string; p_region?: string; p_start_date: string }
        Returns: Json[]
      }
      get_orders_list: {
        Args: {
          p_client?: string
          p_comunas?: string[]
          p_date_from?: string
          p_date_to?: string
          p_driver?: string
          p_has_pod?: boolean
          p_limit?: number
          p_min_attempts?: number
          p_offset?: number
          p_operator_id: string
          p_route_ids?: string[]
          p_search?: string
          p_sla?: string[]
          p_statuses?: string[]
        }
        Returns: {
          comuna: string
          customer_name: string
          driver_name: string
          has_pod: boolean
          id: string
          last_event_at: string
          last_event_label: string
          leading_status: string
          minutes_remaining: number
          order_number: string
          package_count: number
          route_label: string
          sla_status: string
          total_count: number
        }[]
      }
      get_packages_loaded_stats: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: Json
      }
      get_pending_manifests: {
        Args: never
        Returns: {
          created_at: string
          external_load_id: string
          id: string
          labels_printed_at: string
          labels_printed_by_name: string
          order_count: number
          package_count: number
          pickup_cutoff_time: string
          pickup_point: string
          pickup_window_end: string
          pickup_window_start: string
          retailer_name: string
          verified_count: number
        }[]
      }
      get_pipeline_counts: {
        Args: { p_date?: string; p_operator_id: string }
        Returns: {
          alert_count: number
          count: number
          late_count: number
          status: Database["public"]["Enums"]["order_status_enum"]
          urgent_count: number
        }[]
      }
      get_pre_route_snapshot: {
        Args: {
          p_delivery_date: string
          p_operator_id: string
          p_window_end?: string
          p_window_start?: string
        }
        Returns: Json
      }
      get_route_reception_snapshot: {
        Args: { p_route_id: string }
        Returns: Json
      }
      get_route_territory_history: {
        Args: { p_operator_id: string; p_route_id: string }
        Returns: {
          comuna_id: string
          comuna_name: string
          driver_name: string
          last_route_date: string
          run_count: number
        }[]
      }
      get_routed_manifests: {
        Args: never
        Returns: {
          closed_at: string
          created_at: string
          driver_name: string
          external_load_id: string
          id: string
          labels_printed_at: string
          labels_printed_by_name: string
          missing_count: number
          pickup_point: string
          pickup_route_id: string
          retailer_name: string
          route_code: string
          route_started_at: string
          route_status: string
          total_orders: number
          total_packages: number
          verified_count: number
        }[]
      }
      get_signature_rescue_manifests: {
        Args: never
        Returns: {
          completed_at: string
          created_at: string
          external_load_id: string
          id: string
          labels_printed_at: string
          labels_printed_by_name: string
          missing_count: number
          pickup_point: string
          retailer_name: string
          signature_operator: string
          total_orders: number
          total_packages: number
        }[]
      }
      get_topup_candidates: {
        Args: { p_operator_id: string; p_route_id: string }
        Returns: Json
      }
      get_unmatched_comunas: {
        Args: { p_operator_id: string }
        Returns: {
          comuna_raw: string
          order_count: number
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      has_unique: { Args: { "": string }; Returns: string }
      in_todo: { Args: never; Returns: boolean }
      is_empty: { Args: { "": string }; Returns: string }
      is_super_admin: { Args: never; Returns: boolean }
      isnt_empty: { Args: { "": string }; Returns: string }
      list_operators_with_module_state: {
        Args: never
        Returns: {
          enabled_modules: string[]
          operator_id: string
          operator_name: string
          operator_slug: string
        }[]
      }
      lives_ok: { Args: { "": string }; Returns: string }
      load_position_conflicts_with_route: {
        Args: {
          p_load_position_id: string
          p_operator_id: string
          p_route_id: string
        }
        Returns: boolean
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      map_comuna_alias: {
        Args: { p_alias: string; p_comuna_id: string; p_source?: string }
        Returns: undefined
      }
      mark_manifest_labels_printed: {
        Args: { p_manifest_id: string }
        Returns: undefined
      }
      move_route_block: {
        Args: {
          p_block_id: string
          p_direction: string
          p_operator_id: string
          p_route_id: string
        }
        Returns: undefined
      }
      no_plan: { Args: never; Returns: boolean[] }
      normalize_comuna_id: { Args: { raw_name: string }; Returns: string }
      num_failed: { Args: never; Returns: number }
      open_route_reception: {
        Args: { p_route_id: string }
        Returns: {
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
          status: Database["public"]["Enums"]["hub_reception_status_enum"]
          unexpected_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "route_receptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      order_sla_status: {
        Args: {
          p_delivered_at: string
          p_delivery_date: string
          p_delivery_window_end: string
          p_delivery_window_start: string
          p_now: string
          p_rescheduled_delivery_date: string
          p_rescheduled_window_end: string
          p_rescheduled_window_start: string
        }
        Returns: {
          minutes_remaining: number
          sla_status: string
        }[]
      }
      os_name: { Args: never; Returns: string }
      pass:
        | { Args: never; Returns: string }
        | { Args: { "": string }; Returns: string }
      pg_version: { Args: never; Returns: string }
      pg_version_num: { Args: never; Returns: number }
      pgtap_version: { Args: never; Returns: number }
      pipeline_position: { Args: { p_status: string }; Returns: number }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_failed_delivery: {
        Args: {
          p_dt_status: number
          p_operator_id: string
          p_order_number: string
          p_substatus: string
          p_substatus_code: string
        }
        Returns: Json
      }
      recompute_dispatch_stage: {
        Args: {
          p_dispatch_id: string
          p_operator_id: string
          p_order_id: string
          p_user_id: string
        }
        Returns: string
      }
      reconcile_abandoned_pickup_routes: {
        Args: { p_cutoff: string; p_operator?: string }
        Returns: number
      }
      record_discrepancies: {
        Args: {
          p_items: Json
          p_operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          p_source_id: string
        }
        Returns: {
          barcode: string | null
          created_at: string
          deleted_at: string | null
          detected_at: string
          detected_by_user_id: string | null
          id: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id: string | null
          migrated_from_note_id: string | null
          note: string | null
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id: string
          package_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          route_reception_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "discrepancies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      release_load_position: {
        Args: { p_operator_id: string; p_route_id: string; p_user_id: string }
        Returns: undefined
      }
      remove_dock_zone_adjacency_pair: {
        Args: { p_adjacent_zone_id: string; p_dock_zone_id: string }
        Returns: number
      }
      remove_manifest_from_route: {
        Args: { p_manifest_id: string; p_route_id: string }
        Returns: {
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
          reception_status:
            | Database["public"]["Enums"]["reception_status_enum"]
            | null
          retailer_name: string | null
          signature_client: string | null
          signature_client_name: string | null
          signature_operator: string | null
          signature_operator_name: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["manifest_status_enum"]
          total_orders: number | null
          total_packages: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "manifests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_pickup_route: {
        Args: { p_route_id: string }
        Returns: {
          cancellation_reason: string | null
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
          status: Database["public"]["Enums"]["pickup_route_status_enum"]
          updated_at: string
          vehicle_id: string
          vehicle_label: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pickup_routes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_discrepancy: {
        Args: {
          p_id: string
          p_resolution: string
          p_status: Database["public"]["Enums"]["discrepancy_status_enum"]
        }
        Returns: {
          barcode: string | null
          created_at: string
          deleted_at: string | null
          detected_at: string
          detected_by_user_id: string | null
          id: string
          kind: Database["public"]["Enums"]["discrepancy_kind_enum"]
          manifest_id: string | null
          migrated_from_note_id: string | null
          note: string | null
          operation_type: Database["public"]["Enums"]["discrepancy_operation_enum"]
          operator_id: string
          package_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          route_reception_id: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["discrepancy_status_enum"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "discrepancies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      route_block_is_physically_staged: {
        Args: { p_comuna_id: string; p_operator_id: string; p_route_id: string }
        Returns: boolean
      }
      route_source_dock_zone_ids: {
        Args: {
          p_comuna_id?: string
          p_operator_id: string
          p_route_id: string
        }
        Returns: {
          dock_zone_id: string
        }[]
      }
      runtests:
        | { Args: never; Returns: string[] }
        | { Args: { "": string }; Returns: string[] }
      seed_default_route_blocks: {
        Args: {
          p_operator_id: string
          p_order_ids?: string[]
          p_route_id: string
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
      skip:
        | { Args: { "": string }; Returns: string }
        | { Args: { how_many: number; why: string }; Returns: string }
      spec45_caller_operator_id: { Args: never; Returns: string }
      spec52_may_advance_status: {
        Args: { p_current: string; p_new: string }
        Returns: boolean
      }
      spec74_backfill_package_load_state: { Args: never; Returns: number }
      spec79_backfill_loaded_route_id: { Args: never; Returns: number }
      spec79_backfill_loaded_route_id_batch: {
        Args: { p_batch_size?: number }
        Returns: {
          remaining_count: number
          updated_count: number
        }[]
      }
      spec79_populate_loaded_route_backfill_candidates: {
        Args: never
        Returns: number
      }
      spec85_backfill_discrepancy_notes: { Args: never; Returns: number }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      start_pickup_route:
        | {
            Args: { p_crew_user_ids?: string[]; p_vehicle_id: string }
            Returns: {
              cancellation_reason: string | null
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
              status: Database["public"]["Enums"]["pickup_route_status_enum"]
              updated_at: string
              vehicle_id: string
              vehicle_label: string | null
            }
            SetofOptions: {
              from: "*"
              to: "pickup_routes"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { p_vehicle_label?: string }
            Returns: {
              cancellation_reason: string | null
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
              status: Database["public"]["Enums"]["pickup_route_status_enum"]
              updated_at: string
              vehicle_id: string
              vehicle_label: string | null
            }
            SetofOptions: {
              from: "*"
              to: "pickup_routes"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      sweep_load_position_assignments: {
        Args: { p_limit?: number; p_operator_id: string; p_user_id: string }
        Returns: {
          load_position_id: string
          route_id: string
        }[]
      }
      throws_ok: { Args: { "": string }; Returns: string }
      todo:
        | { Args: { how_many: number }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
        | { Args: { why: string }; Returns: boolean[] }
        | { Args: { how_many: number; why: string }; Returns: boolean[] }
      todo_end: { Args: never; Returns: boolean[] }
      todo_start:
        | { Args: never; Returns: boolean[] }
        | { Args: { "": string }; Returns: boolean[] }
      transition_route_status: {
        Args: {
          p_operator_id: string
          p_route_id: string
          p_to_status: Database["public"]["Enums"]["route_status_enum"]
        }
        Returns: Database["public"]["Enums"]["route_status_enum"]
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
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
    }
    Enums: {
      actor_type_enum:
        | "agent"
        | "human"
        | "driver"
        | "client"
        | "system"
        | "webhook"
      assignment_status_enum:
        | "pending"
        | "offered"
        | "negotiating"
        | "rejected"
        | "expired"
        | "accepted"
        | "pickup_pending"
        | "picked_up"
        | "in_transit"
        | "delivered"
        | "partially_done"
        | "failed"
        | "settled"
        | "cancelled"
      batch_status_enum: "open" | "closed"
      command_status_enum: "pending" | "processed" | "failed"
      connector_type_enum: "csv_email" | "api" | "browser"
      conversation_channel_enum: "whatsapp" | "sms" | "portal"
      discrepancy_kind_enum: "missing" | "unexpected"
      discrepancy_operation_enum: "pickup" | "reception"
      discrepancy_status_enum: "open" | "resolved" | "lost"
      dispatch_status_enum: "pending" | "delivered" | "failed" | "partial"
      dock_scan_result_enum: "accepted" | "rejected" | "wrong_zone" | "unmapped"
      driver_status_enum: "active" | "inactive" | "suspended" | "terminated"
      exception_category_enum:
        | "late_delivery"
        | "driver_no_show"
        | "missing_pod"
        | "wrong_address"
        | "data_quality"
        | "customer_complaint"
        | "safety_incident"
        | "duplicate_submission"
        | "amount_mismatch"
        | "other"
      exception_severity_enum: "low" | "medium" | "high" | "critical"
      exception_status_enum:
        | "open"
        | "auto_resolving"
        | "auto_resolved"
        | "escalated"
        | "human_resolved"
        | "dismissed"
      fleet_type_enum: "own" | "external"
      hub_reception_status_enum: "pending" | "in_progress" | "completed"
      imported_via_enum: "API" | "EMAIL" | "MANUAL" | "CSV" | "OCR"
      intake_method_enum:
        | "email"
        | "whatsapp"
        | "portal"
        | "api"
        | "manual"
        | "mobile_camera"
      intake_status_enum:
        | "received"
        | "parsing"
        | "parsed"
        | "needs_review"
        | "confirmed"
        | "failed"
        | "rejected"
      job_status_enum:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "retrying"
      manifest_status_enum:
        | "pending"
        | "in_progress"
        | "completed"
        | "cancelled"
      message_direction_enum: "inbound" | "outbound"
      message_sender_enum: "agent" | "human" | "participant" | "system"
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
        | "asignado"
        | "en_carga"
        | "listo_para_despacho"
        | "en_ruta"
        | "entregado"
        | "retorno_hub"
        | "cancelado"
        | "devuelto"
        | "dañado"
        | "extraviado"
        | "sectorizado"
        | "retenido"
      participant_type_enum: "driver" | "client" | "generator"
      pay_model_enum:
        | "per_delivery"
        | "per_km"
        | "fixed_daily"
        | "per_package"
        | "hybrid"
      pickup_route_status_enum:
        | "draft"
        | "in_progress"
        | "in_transit"
        | "received"
        | "cancelled"
      reception_scan_result_enum:
        | "received"
        | "not_found"
        | "duplicate"
        | "route_mismatch"
      reception_status_enum:
        | "awaiting_reception"
        | "reception_in_progress"
        | "received"
      route_status_enum:
        | "planned"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "draft"
        | "loading"
        | "loaded"
        | "dispatched"
        | "in_transit"
      routing_provider_enum: "dispatchtrack" | "simpliroute" | "drivin"
      scan_result_enum: "verified" | "not_found" | "duplicate"
      settlement_status_enum:
        | "open"
        | "calculating"
        | "pending_review"
        | "approved"
        | "paid"
        | "disputed"
      user_role:
        | "pickup_crew"
        | "warehouse_staff"
        | "loading_crew"
        | "operations_manager"
        | "admin"
        | "super_admin"
        | "pickup_leader"
        | "ops_leader"
      wismo_delivery_status_enum:
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
      wismo_type_enum:
        | "proactive_eta"
        | "proactive_dispatched"
        | "proactive_delivered"
        | "proactive_failed"
        | "proactive_rescheduled"
        | "reactive_status"
        | "reactive_reschedule"
        | "reactive_cancel"
        | "reactive_other"
        | "proactive_early_arrival"
        | "proactive_pickup_confirmed"
    }
    CompositeTypes: {
      _time_trial_type: {
        a_time: number | null
      }
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_type_enum: [
        "agent",
        "human",
        "driver",
        "client",
        "system",
        "webhook",
      ],
      assignment_status_enum: [
        "pending",
        "offered",
        "negotiating",
        "rejected",
        "expired",
        "accepted",
        "pickup_pending",
        "picked_up",
        "in_transit",
        "delivered",
        "partially_done",
        "failed",
        "settled",
        "cancelled",
      ],
      batch_status_enum: ["open", "closed"],
      command_status_enum: ["pending", "processed", "failed"],
      connector_type_enum: ["csv_email", "api", "browser"],
      conversation_channel_enum: ["whatsapp", "sms", "portal"],
      discrepancy_kind_enum: ["missing", "unexpected"],
      discrepancy_operation_enum: ["pickup", "reception"],
      discrepancy_status_enum: ["open", "resolved", "lost"],
      dispatch_status_enum: ["pending", "delivered", "failed", "partial"],
      dock_scan_result_enum: ["accepted", "rejected", "wrong_zone", "unmapped"],
      driver_status_enum: ["active", "inactive", "suspended", "terminated"],
      exception_category_enum: [
        "late_delivery",
        "driver_no_show",
        "missing_pod",
        "wrong_address",
        "data_quality",
        "customer_complaint",
        "safety_incident",
        "duplicate_submission",
        "amount_mismatch",
        "other",
      ],
      exception_severity_enum: ["low", "medium", "high", "critical"],
      exception_status_enum: [
        "open",
        "auto_resolving",
        "auto_resolved",
        "escalated",
        "human_resolved",
        "dismissed",
      ],
      fleet_type_enum: ["own", "external"],
      hub_reception_status_enum: ["pending", "in_progress", "completed"],
      imported_via_enum: ["API", "EMAIL", "MANUAL", "CSV", "OCR"],
      intake_method_enum: [
        "email",
        "whatsapp",
        "portal",
        "api",
        "manual",
        "mobile_camera",
      ],
      intake_status_enum: [
        "received",
        "parsing",
        "parsed",
        "needs_review",
        "confirmed",
        "failed",
        "rejected",
      ],
      job_status_enum: [
        "pending",
        "running",
        "completed",
        "failed",
        "retrying",
      ],
      manifest_status_enum: [
        "pending",
        "in_progress",
        "completed",
        "cancelled",
      ],
      message_direction_enum: ["inbound", "outbound"],
      message_sender_enum: ["agent", "human", "participant", "system"],
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
        "asignado",
        "en_carga",
        "listo_para_despacho",
        "en_ruta",
        "entregado",
        "retorno_hub",
        "cancelado",
        "devuelto",
        "dañado",
        "extraviado",
        "sectorizado",
        "retenido",
      ],
      participant_type_enum: ["driver", "client", "generator"],
      pay_model_enum: [
        "per_delivery",
        "per_km",
        "fixed_daily",
        "per_package",
        "hybrid",
      ],
      pickup_route_status_enum: [
        "draft",
        "in_progress",
        "in_transit",
        "received",
        "cancelled",
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
      route_status_enum: [
        "planned",
        "in_progress",
        "completed",
        "cancelled",
        "draft",
        "loading",
        "loaded",
        "dispatched",
        "in_transit",
      ],
      routing_provider_enum: ["dispatchtrack", "simpliroute", "drivin"],
      scan_result_enum: ["verified", "not_found", "duplicate"],
      settlement_status_enum: [
        "open",
        "calculating",
        "pending_review",
        "approved",
        "paid",
        "disputed",
      ],
      user_role: [
        "pickup_crew",
        "warehouse_staff",
        "loading_crew",
        "operations_manager",
        "admin",
        "super_admin",
        "pickup_leader",
        "ops_leader",
      ],
      wismo_delivery_status_enum: [
        "pending",
        "sent",
        "delivered",
        "read",
        "failed",
      ],
      wismo_type_enum: [
        "proactive_eta",
        "proactive_dispatched",
        "proactive_delivered",
        "proactive_failed",
        "proactive_rescheduled",
        "reactive_status",
        "reactive_reschedule",
        "reactive_cancel",
        "reactive_other",
        "proactive_early_arrival",
        "proactive_pickup_confirmed",
      ],
    },
  },
} as const

