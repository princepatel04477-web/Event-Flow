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
    PostgrestVersion: "14.15"
  }
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_staff_policies: { Args: { p_table: string }; Returns: undefined }
      attach_standard_triggers: {
        Args: { p_table: unknown }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_member: { Args: { p_event_id: string }; Returns: boolean }
      is_staff: { Args: { p_event_id: string }; Returns: boolean }
      role_in_event: {
        Args: { p_event_id: string }
        Returns: Database["app"]["Enums"]["event_role"]
      }
    }
    Enums: {
      age_band: "adult" | "child" | "infant"
      call_outcome:
        | "connected"
        | "no_answer"
        | "busy"
        | "switched_off"
        | "wrong_number"
        | "callback"
        | "declined"
        | "other"
      data_source:
        | "excel_import"
        | "rsvp_call"
        | "event_team"
        | "client"
        | "system"
      deliverable_kind: "hamper" | "return_gift"
      deliverable_status: "pending" | "assigned" | "delivered" | "not_required"
      event_role: "event_team" | "client"
      extraction_status: "pending" | "accepted" | "rejected" | "superseded"
      global_role: "admin" | "member"
      group_type: "family" | "couple" | "friends" | "single"
      message_status: "queued" | "sent" | "delivered" | "read" | "failed"
      rsvp_status:
        | "not_started"
        | "attempted"
        | "callback"
        | "tentative"
        | "confirmed"
        | "declined"
        | "unreachable"
      side: "bride" | "groom" | "both" | "other"
      travel_direction: "arrival" | "departure"
      travel_mode: "air" | "train" | "bus" | "cab" | "self_drive"
      trip_status: "planned" | "dispatched" | "completed" | "cancelled"
      vehicle_status: "available" | "assigned" | "unavailable"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          at: string
          event_id: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          at?: string
          event_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          at?: string
          event_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      call_attempts: {
        Row: {
          callback_at: string | null
          caller_id: string
          device_started_at: string | null
          dialed_number: string
          duration_sec: number | null
          ended_at: string | null
          event_id: string
          finalized_at: string | null
          group_id: string
          id: string
          notes: string | null
          outcome: Database["app"]["Enums"]["call_outcome"] | null
          started_at: string
        }
        Insert: {
          callback_at?: string | null
          caller_id?: string
          device_started_at?: string | null
          dialed_number: string
          duration_sec?: number | null
          ended_at?: string | null
          event_id: string
          finalized_at?: string | null
          group_id: string
          id?: string
          notes?: string | null
          outcome?: Database["app"]["Enums"]["call_outcome"] | null
          started_at?: string
        }
        Update: {
          callback_at?: string | null
          caller_id?: string
          device_started_at?: string | null
          dialed_number?: string
          duration_sec?: number | null
          ended_at?: string | null
          event_id?: string
          finalized_at?: string | null
          group_id?: string
          id?: string
          notes?: string | null
          outcome?: Database["app"]["Enums"]["call_outcome"] | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_attempts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_attempts_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "call_attempts_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "call_attempts_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
        ]
      }
      call_recordings: {
        Row: {
          call_attempt_id: string | null
          device_captured_at: string | null
          duration_sec: number | null
          event_id: string
          file_size_bytes: number | null
          group_id: string | null
          id: string
          mime_type: string | null
          recorded_at: string
          sha256: string | null
          storage_bucket: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          call_attempt_id?: string | null
          device_captured_at?: string | null
          duration_sec?: number | null
          event_id: string
          file_size_bytes?: number | null
          group_id?: string | null
          id?: string
          mime_type?: string | null
          recorded_at?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          call_attempt_id?: string | null
          device_captured_at?: string | null
          duration_sec?: number | null
          event_id?: string
          file_size_bytes?: number | null
          group_id?: string | null
          id?: string
          mime_type?: string | null
          recorded_at?: string
          sha256?: string | null
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_recordings_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_recordings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_recordings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "call_recordings_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "call_recordings_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "call_recordings_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
        ]
      }
      deliverables: {
        Row: {
          assigned_to: string | null
          created_at: string
          event_id: string
          group_id: string
          guest_id: string | null
          id: string
          item_name: string | null
          kind: Database["app"]["Enums"]["deliverable_kind"]
          notes: string | null
          quantity: number
          room_id: string | null
          status: Database["app"]["Enums"]["deliverable_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          event_id: string
          group_id: string
          guest_id?: string | null
          id?: string
          item_name?: string | null
          kind: Database["app"]["Enums"]["deliverable_kind"]
          notes?: string | null
          quantity?: number
          room_id?: string | null
          status?: Database["app"]["Enums"]["deliverable_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          event_id?: string
          group_id?: string
          guest_id?: string | null
          id?: string
          item_name?: string | null
          kind?: Database["app"]["Enums"]["deliverable_kind"]
          notes?: string | null
          quantity?: number
          room_id?: string | null
          status?: Database["app"]["Enums"]["deliverable_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliverables_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "deliverables_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "deliverables_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "deliverables_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "deliverables_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "deliverables_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "client_guest_profiles"
            referencedColumns: ["guest_id", "event_id"]
          },
          {
            foreignKeyName: "deliverables_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "deliverables_room_id_event_id_fkey"
            columns: ["room_id", "event_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      delivery_proofs: {
        Row: {
          captured_by: string
          deliverable_id: string
          device_captured_at: string | null
          event_id: string
          file_size_bytes: number | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          photo_sha256: string | null
          received_by_name: string | null
          recorded_at: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          captured_by?: string
          deliverable_id: string
          device_captured_at?: string | null
          event_id: string
          file_size_bytes?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          photo_sha256?: string | null
          received_by_name?: string | null
          recorded_at?: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          captured_by?: string
          deliverable_id?: string
          device_captured_at?: string | null
          event_id?: string
          file_size_bytes?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          photo_sha256?: string | null
          received_by_name?: string | null
          recorded_at?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_proofs_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_proofs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "delivery_proofs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      event_members: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          role: Database["app"]["Enums"]["event_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          role: Database["app"]["Enums"]["event_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          role?: Database["app"]["Enums"]["event_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_members_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      events: {
        Row: {
          bride_name: string | null
          code: string
          created_at: string
          created_by: string | null
          ends_on: string | null
          groom_name: string | null
          id: string
          is_active: boolean
          name: string
          starts_on: string | null
          updated_at: string
          venue_city: string | null
        }
        Insert: {
          bride_name?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          groom_name?: string | null
          id?: string
          is_active?: boolean
          name: string
          starts_on?: string | null
          updated_at?: string
          venue_city?: string | null
        }
        Update: {
          bride_name?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          ends_on?: string | null
          groom_name?: string | null
          id?: string
          is_active?: boolean
          name?: string
          starts_on?: string | null
          updated_at?: string
          venue_city?: string | null
        }
        Relationships: []
      }
      guest_groups: {
        Row: {
          alt_mobile: string | null
          city: string | null
          confirmed_pax: number | null
          created_at: string
          event_id: string
          expected_pax: number
          group_code: string | null
          group_type: Database["app"]["Enums"]["group_type"]
          head_name: string
          id: string
          locked_by: string | null
          locked_until: string | null
          needs_return_gift: boolean
          primary_mobile: string | null
          priority: number
          remarks: string | null
          rsvp_status: Database["app"]["Enums"]["rsvp_status"]
          side: Database["app"]["Enums"]["side"] | null
          source_row_hash: string | null
          updated_at: string
        }
        Insert: {
          alt_mobile?: string | null
          city?: string | null
          confirmed_pax?: number | null
          created_at?: string
          event_id: string
          expected_pax?: number
          group_code?: string | null
          group_type?: Database["app"]["Enums"]["group_type"]
          head_name: string
          id?: string
          locked_by?: string | null
          locked_until?: string | null
          needs_return_gift?: boolean
          primary_mobile?: string | null
          priority?: number
          remarks?: string | null
          rsvp_status?: Database["app"]["Enums"]["rsvp_status"]
          side?: Database["app"]["Enums"]["side"] | null
          source_row_hash?: string | null
          updated_at?: string
        }
        Update: {
          alt_mobile?: string | null
          city?: string | null
          confirmed_pax?: number | null
          created_at?: string
          event_id?: string
          expected_pax?: number
          group_code?: string | null
          group_type?: Database["app"]["Enums"]["group_type"]
          head_name?: string
          id?: string
          locked_by?: string | null
          locked_until?: string | null
          needs_return_gift?: boolean
          primary_mobile?: string | null
          priority?: number
          remarks?: string | null
          rsvp_status?: Database["app"]["Enums"]["rsvp_status"]
          side?: Database["app"]["Enums"]["side"] | null
          source_row_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      guests: {
        Row: {
          age_band: Database["app"]["Enums"]["age_band"]
          created_at: string
          event_id: string
          full_name: string
          group_id: string
          id: string
          is_head: boolean
          mobile: string | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          age_band?: Database["app"]["Enums"]["age_band"]
          created_at?: string
          event_id: string
          full_name: string
          group_id: string
          id?: string
          is_head?: boolean
          mobile?: string | null
          notes?: string | null
          updated_at?: string
        }
        Update: {
          age_band?: Database["app"]["Enums"]["age_band"]
          created_at?: string
          event_id?: string
          full_name?: string
          group_id?: string
          id?: string
          is_head?: boolean
          mobile?: string | null
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guests_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "guests_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "guests_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
        ]
      }
      hotels: {
        Row: {
          address: string | null
          contact_mobile: string | null
          contact_name: string | null
          created_at: string
          event_id: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_mobile?: string | null
          contact_name?: string | null
          created_at?: string
          event_id: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_mobile?: string | null
          contact_name?: string | null
          created_at?: string
          event_id?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hotels_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hotels_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "hotels_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          event_id: string
          filename: string | null
          id: string
          imported_by: string | null
          inserted_rows: number
          kind: string
          skipped_rows: number
          status: string
          storage_path: string | null
          total_rows: number | null
          updated_rows: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event_id: string
          filename?: string | null
          id?: string
          imported_by?: string | null
          inserted_rows?: number
          kind: string
          skipped_rows?: number
          status?: string
          storage_path?: string | null
          total_rows?: number | null
          updated_rows?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          event_id?: string
          filename?: string | null
          id?: string
          imported_by?: string | null
          inserted_rows?: number
          kind?: string
          skipped_rows?: number
          status?: string
          storage_path?: string | null
          total_rows?: number | null
          updated_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "import_batches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      import_rows: {
        Row: {
          batch_id: string
          created_at: string
          error: string | null
          event_id: string
          group_id: string | null
          id: string
          raw: Json
          row_hash: string
          row_number: number
          status: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          error?: string | null
          event_id: string
          group_id?: string | null
          id?: string
          raw: Json
          row_hash: string
          row_number: number
          status?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          error?: string | null
          event_id?: string
          group_id?: string | null
          id?: string
          raw?: Json
          row_hash?: string
          row_number?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_rows_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "import_rows_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "import_rows_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "import_rows_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "import_rows_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string
          event_id: string | null
          id: string
          is_active: boolean
          key: string
          language: string
          updated_at: string
          variables: Json
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          key: string
          language?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          key?: string
          language?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "message_templates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_by: string | null
          delivered_at: string | null
          error: string | null
          event_id: string
          group_id: string | null
          guest_id: string | null
          id: string
          provider: string | null
          provider_message_id: string | null
          queued_at: string
          read_at: string | null
          sent_at: string | null
          status: Database["app"]["Enums"]["message_status"]
          template_key: string | null
          to_number: string
        }
        Insert: {
          body: string
          created_by?: string | null
          delivered_at?: string | null
          error?: string | null
          event_id: string
          group_id?: string | null
          guest_id?: string | null
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          sent_at?: string | null
          status?: Database["app"]["Enums"]["message_status"]
          template_key?: string | null
          to_number: string
        }
        Update: {
          body?: string
          created_by?: string | null
          delivered_at?: string | null
          error?: string | null
          event_id?: string
          group_id?: string | null
          guest_id?: string | null
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          queued_at?: string
          read_at?: string | null
          sent_at?: string | null
          status?: Database["app"]["Enums"]["message_status"]
          template_key?: string | null
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "messages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "messages_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "messages_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "messages_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "messages_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "client_guest_profiles"
            referencedColumns: ["guest_id", "event_id"]
          },
          {
            foreignKeyName: "messages_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          global_role: Database["app"]["Enums"]["global_role"]
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          global_role?: Database["app"]["Enums"]["global_role"]
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          global_role?: Database["app"]["Enums"]["global_role"]
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      room_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          check_in_date: string | null
          check_in_time: string | null
          check_out_date: string | null
          check_out_time: string | null
          created_at: string
          event_id: string
          group_id: string
          guest_id: string
          id: string
          is_override: boolean
          override_reason: string | null
          release_reason: string | null
          released_at: string | null
          room_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          check_in_date?: string | null
          check_in_time?: string | null
          check_out_date?: string | null
          check_out_time?: string | null
          created_at?: string
          event_id: string
          group_id: string
          guest_id: string
          id?: string
          is_override?: boolean
          override_reason?: string | null
          release_reason?: string | null
          released_at?: string | null
          room_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          check_in_date?: string | null
          check_in_time?: string | null
          check_out_date?: string | null
          check_out_time?: string | null
          created_at?: string
          event_id?: string
          group_id?: string
          guest_id?: string
          id?: string
          is_override?: boolean
          override_reason?: string | null
          release_reason?: string | null
          released_at?: string | null
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "room_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "room_assignments_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "room_assignments_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "room_assignments_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "room_assignments_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "client_guest_profiles"
            referencedColumns: ["guest_id", "event_id"]
          },
          {
            foreignKeyName: "room_assignments_guest_id_event_id_fkey"
            columns: ["guest_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guests"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "room_assignments_room_id_event_id_fkey"
            columns: ["room_id", "event_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      rooms: {
        Row: {
          capacity: number
          created_at: string
          event_id: string
          floor: string | null
          hotel_id: string
          id: string
          is_blocked: boolean
          notes: string | null
          room_number: string
          room_type: string | null
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          event_id: string
          floor?: string | null
          hotel_id: string
          id?: string
          is_blocked?: boolean
          notes?: string | null
          room_number: string
          room_type?: string | null
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          event_id?: string
          floor?: string | null
          hotel_id?: string
          id?: string
          is_blocked?: boolean
          notes?: string | null
          room_number?: string
          room_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rooms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rooms_hotel_id_event_id_fkey"
            columns: ["hotel_id", "event_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      rsvp_extractions: {
        Row: {
          applied_at: string | null
          call_attempt_id: string | null
          confidence: Json
          created_at: string
          event_id: string
          group_id: string
          id: string
          model: string | null
          parsed: Json
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["app"]["Enums"]["extraction_status"]
          transcript_id: string | null
        }
        Insert: {
          applied_at?: string | null
          call_attempt_id?: string | null
          confidence?: Json
          created_at?: string
          event_id: string
          group_id: string
          id?: string
          model?: string | null
          parsed: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["app"]["Enums"]["extraction_status"]
          transcript_id?: string | null
        }
        Update: {
          applied_at?: string | null
          call_attempt_id?: string | null
          confidence?: Json
          created_at?: string
          event_id?: string
          group_id?: string
          id?: string
          model?: string | null
          parsed?: Json
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["app"]["Enums"]["extraction_status"]
          transcript_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_extractions_call_attempt_id_fkey"
            columns: ["call_attempt_id"]
            isOneToOne: false
            referencedRelation: "call_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_extractions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvp_extractions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rsvp_extractions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "rsvp_extractions_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "rsvp_extractions_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "rsvp_extractions_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "rsvp_extractions_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      transcripts: {
        Row: {
          confidence: number | null
          created_at: string
          event_id: string
          id: string
          language: string | null
          model: string | null
          provider: string | null
          recording_id: string
          text: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          event_id: string
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          recording_id: string
          text: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          event_id?: string
          id?: string
          language?: string | null
          model?: string | null
          provider?: string | null
          recording_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcripts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcripts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "transcripts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "transcripts_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "call_recordings"
            referencedColumns: ["id"]
          },
        ]
      }
      travel_legs: {
        Row: {
          created_at: string
          created_by: string | null
          direction: Database["app"]["Enums"]["travel_direction"]
          event_id: string
          group_id: string
          id: string
          mode: Database["app"]["Enums"]["travel_mode"] | null
          needs_transport: boolean
          notes: string | null
          pax_on_leg: number | null
          point: string | null
          reference: string | null
          source: Database["app"]["Enums"]["data_source"]
          travel_date: string | null
          travel_time: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direction: Database["app"]["Enums"]["travel_direction"]
          event_id: string
          group_id: string
          id?: string
          mode?: Database["app"]["Enums"]["travel_mode"] | null
          needs_transport?: boolean
          notes?: string | null
          pax_on_leg?: number | null
          point?: string | null
          reference?: string | null
          source?: Database["app"]["Enums"]["data_source"]
          travel_date?: string | null
          travel_time?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direction?: Database["app"]["Enums"]["travel_direction"]
          event_id?: string
          group_id?: string
          id?: string
          mode?: Database["app"]["Enums"]["travel_mode"] | null
          needs_transport?: boolean
          notes?: string | null
          pax_on_leg?: number | null
          point?: string | null
          reference?: string | null
          source?: Database["app"]["Enums"]["data_source"]
          travel_date?: string | null
          travel_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "travel_legs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "travel_legs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "travel_legs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "travel_legs_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "travel_legs_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "travel_legs_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
        ]
      }
      trip_passengers: {
        Row: {
          created_at: string
          event_id: string
          group_id: string
          id: string
          pax: number
          travel_leg_id: string | null
          trip_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          group_id: string
          id?: string
          pax: number
          travel_leg_id?: string | null
          trip_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          group_id?: string
          id?: string
          pax?: number
          travel_leg_id?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_passengers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_passengers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "trip_passengers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "trip_passengers_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "guest_groups"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "trip_passengers_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_rsvp_queue"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "trip_passengers_group_id_event_id_fkey"
            columns: ["group_id", "event_id"]
            isOneToOne: false
            referencedRelation: "v_travel_ledger"
            referencedColumns: ["group_id", "event_id"]
          },
          {
            foreignKeyName: "trip_passengers_travel_leg_id_event_id_fkey"
            columns: ["travel_leg_id", "event_id"]
            isOneToOne: false
            referencedRelation: "travel_legs"
            referencedColumns: ["id", "event_id"]
          },
          {
            foreignKeyName: "trip_passengers_trip_id_event_id_fkey"
            columns: ["trip_id", "event_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      trips: {
        Row: {
          created_at: string
          created_by: string | null
          direction: Database["app"]["Enums"]["travel_direction"]
          driver_mobile: string | null
          driver_name: string | null
          drop_point: string | null
          event_id: string
          expense_amount: number | null
          expense_mode: string | null
          expense_notes: string | null
          id: string
          pickup_point: string | null
          scheduled_at: string | null
          seats_capacity: number | null
          seats_used: number
          status: Database["app"]["Enums"]["trip_status"]
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direction: Database["app"]["Enums"]["travel_direction"]
          driver_mobile?: string | null
          driver_name?: string | null
          drop_point?: string | null
          event_id: string
          expense_amount?: number | null
          expense_mode?: string | null
          expense_notes?: string | null
          id?: string
          pickup_point?: string | null
          scheduled_at?: string | null
          seats_capacity?: number | null
          seats_used?: number
          status?: Database["app"]["Enums"]["trip_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direction?: Database["app"]["Enums"]["travel_direction"]
          driver_mobile?: string | null
          driver_name?: string | null
          drop_point?: string | null
          event_id?: string
          expense_amount?: number | null
          expense_mode?: string | null
          expense_notes?: string | null
          id?: string
          pickup_point?: string | null
          scheduled_at?: string | null
          seats_capacity?: number | null
          seats_used?: number
          status?: Database["app"]["Enums"]["trip_status"]
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "trips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_event_id_fkey"
            columns: ["vehicle_id", "event_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id", "event_id"]
          },
        ]
      }
      vehicle_types: {
        Row: {
          created_at: string
          default_capacity: number
          event_id: string | null
          id: string
          is_active: boolean
          name: string
          seat_label: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_capacity: number
          event_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          seat_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_capacity?: number
          event_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          seat_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "vehicle_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      vehicles: {
        Row: {
          capacity: number
          created_at: string
          driver_mobile: string | null
          driver_name: string | null
          event_id: string
          id: string
          label: string | null
          notes: string | null
          rate_note: string | null
          registration_no: string | null
          status: Database["app"]["Enums"]["vehicle_status"]
          updated_at: string
          vehicle_type_id: string | null
          vendor_name: string | null
        }
        Insert: {
          capacity: number
          created_at?: string
          driver_mobile?: string | null
          driver_name?: string | null
          event_id: string
          id?: string
          label?: string | null
          notes?: string | null
          rate_note?: string | null
          registration_no?: string | null
          status?: Database["app"]["Enums"]["vehicle_status"]
          updated_at?: string
          vehicle_type_id?: string | null
          vendor_name?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string
          driver_mobile?: string | null
          driver_name?: string | null
          event_id?: string
          id?: string
          label?: string | null
          notes?: string | null
          rate_note?: string | null
          registration_no?: string | null
          status?: Database["app"]["Enums"]["vehicle_status"]
          updated_at?: string
          vehicle_type_id?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "vehicles_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "vehicles_vehicle_type_id_fkey"
            columns: ["vehicle_type_id"]
            isOneToOne: false
            referencedRelation: "vehicle_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_guest_profiles: {
        Row: {
          arrival_date: string | null
          arrival_mode: Database["app"]["Enums"]["travel_mode"] | null
          arrival_point: string | null
          arrival_time: string | null
          departure_date: string | null
          departure_mode: Database["app"]["Enums"]["travel_mode"] | null
          departure_point: string | null
          departure_time: string | null
          event_id: string | null
          family_head: string | null
          group_type: Database["app"]["Enums"]["group_type"] | null
          guest_id: string | null
          guest_name: string | null
          hamper_delivered: boolean | null
          hotel_name: string | null
          needs_return_gift: boolean | null
          pax: number | null
          return_gift_delivered: boolean | null
          room_number: string | null
          side: Database["app"]["Enums"]["side"] | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guests_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      v_event_attention: {
        Row: {
          arrivals_no_vehicle: number | null
          confirmed_no_room: number | null
          event_id: string | null
          hampers_pending: number | null
          no_departure: number | null
        }
        Insert: {
          arrivals_no_vehicle?: never
          confirmed_no_room?: never
          event_id?: string | null
          hampers_pending?: never
          no_departure?: never
        }
        Update: {
          arrivals_no_vehicle?: never
          confirmed_no_room?: never
          event_id?: string | null
          hampers_pending?: never
          no_departure?: never
        }
        Relationships: []
      }
      v_event_dashboard: {
        Row: {
          arrivals_today: number | null
          departures_today: number | null
          event_id: string | null
          guests_roomed: number | null
          hampers_delivered: number | null
          hampers_pending: number | null
          logistics_expense: number | null
          name: string | null
          return_gifts_delivered: number | null
          rsvp_confirmed: number | null
          rsvp_pending: number | null
          total_groups: number | null
          total_pax: number | null
        }
        Insert: {
          arrivals_today?: never
          departures_today?: never
          event_id?: string | null
          guests_roomed?: never
          hampers_delivered?: never
          hampers_pending?: never
          logistics_expense?: never
          name?: string | null
          return_gifts_delivered?: never
          rsvp_confirmed?: never
          rsvp_pending?: never
          total_groups?: never
          total_pax?: never
        }
        Update: {
          arrivals_today?: never
          departures_today?: never
          event_id?: string | null
          guests_roomed?: never
          hampers_delivered?: never
          hampers_pending?: never
          logistics_expense?: never
          name?: string | null
          return_gifts_delivered?: never
          rsvp_confirmed?: never
          rsvp_pending?: never
          total_groups?: never
          total_pax?: never
        }
        Relationships: []
      }
      v_rsvp_queue: {
        Row: {
          attempt_count: number | null
          confirmed_pax: number | null
          event_id: string | null
          expected_pax: number | null
          group_id: string | null
          group_type: Database["app"]["Enums"]["group_type"] | null
          head_name: string | null
          is_locked: boolean | null
          last_attempt_at: string | null
          last_outcome: Database["app"]["Enums"]["call_outcome"] | null
          locked_by: string | null
          locked_until: string | null
          next_callback_at: string | null
          primary_mobile: string | null
          priority: number | null
          remarks: string | null
          rsvp_status: Database["app"]["Enums"]["rsvp_status"] | null
          side: Database["app"]["Enums"]["side"] | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
      v_travel_ledger: {
        Row: {
          arrival_legs: number | null
          departure_legs: number | null
          event_id: string | null
          group_id: string | null
          head_name: string | null
          ledger_state: string | null
          pax: number | null
        }
        Relationships: [
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_attention"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "guest_groups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "v_event_dashboard"
            referencedColumns: ["event_id"]
          },
        ]
      }
    }
    Functions: {
      apply_rsvp_extraction: {
        Args: { p_extraction_id: string; p_payload: Json }
        Returns: {
          alt_mobile: string | null
          city: string | null
          confirmed_pax: number | null
          created_at: string
          event_id: string
          expected_pax: number
          group_code: string | null
          group_type: Database["app"]["Enums"]["group_type"]
          head_name: string
          id: string
          locked_by: string | null
          locked_until: string | null
          needs_return_gift: boolean
          primary_mobile: string | null
          priority: number
          remarks: string | null
          rsvp_status: Database["app"]["Enums"]["rsvp_status"]
          side: Database["app"]["Enums"]["side"] | null
          source_row_hash: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "guest_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_group: {
        Args: { p_group_id: string; p_minutes?: number }
        Returns: {
          alt_mobile: string | null
          city: string | null
          confirmed_pax: number | null
          created_at: string
          event_id: string
          expected_pax: number
          group_code: string | null
          group_type: Database["app"]["Enums"]["group_type"]
          head_name: string
          id: string
          locked_by: string | null
          locked_until: string | null
          needs_return_gift: boolean
          primary_mobile: string | null
          priority: number
          remarks: string | null
          rsvp_status: Database["app"]["Enums"]["rsvp_status"]
          side: Database["app"]["Enums"]["side"] | null
          source_row_hash: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "guest_groups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      commit_guest_import: {
        Args: {
          p_event_id: string
          p_filename: string
          p_kind: string
          p_rows: Json
        }
        Returns: Json
      }
      release_group: { Args: { p_group_id: string }; Returns: undefined }
      upsert_import_leg: {
        Args: {
          p_direction: Database["app"]["Enums"]["travel_direction"]
          p_event_id: string
          p_group_id: string
          p_leg: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
  app: {
    Enums: {
      age_band: ["adult", "child", "infant"],
      call_outcome: [
        "connected",
        "no_answer",
        "busy",
        "switched_off",
        "wrong_number",
        "callback",
        "declined",
        "other",
      ],
      data_source: [
        "excel_import",
        "rsvp_call",
        "event_team",
        "client",
        "system",
      ],
      deliverable_kind: ["hamper", "return_gift"],
      deliverable_status: ["pending", "assigned", "delivered", "not_required"],
      event_role: ["event_team", "client"],
      extraction_status: ["pending", "accepted", "rejected", "superseded"],
      global_role: ["admin", "member"],
      group_type: ["family", "couple", "friends", "single"],
      message_status: ["queued", "sent", "delivered", "read", "failed"],
      rsvp_status: [
        "not_started",
        "attempted",
        "callback",
        "tentative",
        "confirmed",
        "declined",
        "unreachable",
      ],
      side: ["bride", "groom", "both", "other"],
      travel_direction: ["arrival", "departure"],
      travel_mode: ["air", "train", "bus", "cab", "self_drive"],
      trip_status: ["planned", "dispatched", "completed", "cancelled"],
      vehicle_status: ["available", "assigned", "unavailable"],
    },
  },
  public: {
    Enums: {},
  },
} as const
