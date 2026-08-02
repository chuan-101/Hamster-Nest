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
      agent_council: {
        Row: {
          category: string | null
          created_at: string | null
          entry_type: string | null
          executor: string | null
          id: string
          message: string
          metadata: Json | null
          parent_id: string | null
          proposal_status: string | null
          read_by: string[] | null
          speaker: string
          topic: string
          updated_at: string | null
          user_id: string | null
          vote: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          entry_type?: string | null
          executor?: string | null
          id?: string
          message: string
          metadata?: Json | null
          parent_id?: string | null
          proposal_status?: string | null
          read_by?: string[] | null
          speaker: string
          topic: string
          updated_at?: string | null
          user_id?: string | null
          vote?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          entry_type?: string | null
          executor?: string | null
          id?: string
          message?: string
          metadata?: Json | null
          parent_id?: string | null
          proposal_status?: string | null
          read_by?: string[] | null
          speaker?: string
          topic?: string
          updated_at?: string | null
          user_id?: string | null
          vote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_council_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "agent_council"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_events: {
        Row: {
          actor: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: number
          importance: string
          payload: Json
          title: string
          user_id: string
        }
        Insert: {
          actor: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: never
          importance?: string
          payload?: Json
          title: string
          user_id: string
        }
        Update: {
          actor?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: never
          importance?: string
          payload?: Json
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_feed_items: {
        Row: {
          content: string
          content_format: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          metadata: Json
          pinned: boolean
          priority: string
          read_at: string | null
          related_id: string | null
          related_table: string | null
          source: string | null
          status: string
          summary: string | null
          title: string
          type: string
          updated_at: string
          user_id: string
          visible_from: string
        }
        Insert: {
          content: string
          content_format?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json
          pinned?: boolean
          priority?: string
          read_at?: string | null
          related_id?: string | null
          related_table?: string | null
          source?: string | null
          status?: string
          summary?: string | null
          title: string
          type: string
          updated_at?: string
          user_id?: string
          visible_from?: string
        }
        Update: {
          content?: string
          content_format?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          metadata?: Json
          pinned?: boolean
          priority?: string
          read_at?: string | null
          related_id?: string | null
          related_table?: string | null
          source?: string | null
          status?: string
          summary?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
          visible_from?: string
        }
        Relationships: []
      }
      agent_heartbeats: {
        Row: {
          agent_id: string
          agent_type: string
          created_at: string
          heartbeat_at: string
          id: string
          last_task: string | null
          metadata: Json
          status: string
          user_id: string
        }
        Insert: {
          agent_id: string
          agent_type: string
          created_at?: string
          heartbeat_at?: string
          id?: string
          last_task?: string | null
          metadata?: Json
          status: string
          user_id: string
        }
        Update: {
          agent_id?: string
          agent_type?: string
          created_at?: string
          heartbeat_at?: string
          id?: string
          last_task?: string | null
          metadata?: Json
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_settings: {
        Row: {
          agent_mode: string | null
          checkin_enabled: boolean
          cooldown_after_interaction_minutes: number
          created_at: string
          day_max_interval_minutes: number
          day_min_interval_minutes: number
          day_mode_end_hour: number
          day_mode_start_hour: number
          heartbeat_data: Json | null
          id: string
          last_seen_at: string | null
          max_daily_checkins_day: number
          max_daily_checkins_night: number
          night_max_interval_minutes: number
          night_min_interval_minutes: number
          night_mode_end_hour: number
          night_mode_start_hour: number
          per_channel_schedule: Json
          quiet_hours_end_hour: number | null
          quiet_hours_start_hour: number | null
          updated_at: string
          user_id: string
          wechat_context_summary_model: string | null
          wechat_context_summary_refresh_rounds: number | null
          wechat_context_summary_trigger_rounds: number | null
          wechat_context_window_rounds: number | null
          wechat_memory_search_enabled: boolean | null
          wechat_memory_search_min_length: number | null
        }
        Insert: {
          agent_mode?: string | null
          checkin_enabled?: boolean
          cooldown_after_interaction_minutes?: number
          created_at?: string
          day_max_interval_minutes?: number
          day_min_interval_minutes?: number
          day_mode_end_hour?: number
          day_mode_start_hour?: number
          heartbeat_data?: Json | null
          id?: string
          last_seen_at?: string | null
          max_daily_checkins_day?: number
          max_daily_checkins_night?: number
          night_max_interval_minutes?: number
          night_min_interval_minutes?: number
          night_mode_end_hour?: number
          night_mode_start_hour?: number
          per_channel_schedule?: Json
          quiet_hours_end_hour?: number | null
          quiet_hours_start_hour?: number | null
          updated_at?: string
          user_id: string
          wechat_context_summary_model?: string | null
          wechat_context_summary_refresh_rounds?: number | null
          wechat_context_summary_trigger_rounds?: number | null
          wechat_context_window_rounds?: number | null
          wechat_memory_search_enabled?: boolean | null
          wechat_memory_search_min_length?: number | null
        }
        Update: {
          agent_mode?: string | null
          checkin_enabled?: boolean
          cooldown_after_interaction_minutes?: number
          created_at?: string
          day_max_interval_minutes?: number
          day_min_interval_minutes?: number
          day_mode_end_hour?: number
          day_mode_start_hour?: number
          heartbeat_data?: Json | null
          id?: string
          last_seen_at?: string | null
          max_daily_checkins_day?: number
          max_daily_checkins_night?: number
          night_max_interval_minutes?: number
          night_min_interval_minutes?: number
          night_mode_end_hour?: number
          night_mode_start_hour?: number
          per_channel_schedule?: Json
          quiet_hours_end_hour?: number | null
          quiet_hours_start_hour?: number | null
          updated_at?: string
          user_id?: string
          wechat_context_summary_model?: string | null
          wechat_context_summary_refresh_rounds?: number | null
          wechat_context_summary_trigger_rounds?: number | null
          wechat_context_window_rounds?: number | null
          wechat_memory_search_enabled?: boolean | null
          wechat_memory_search_min_length?: number | null
        }
        Relationships: []
      }
      agent_tasks: {
        Row: {
          command: string
          completed_at: string | null
          correlation_id: string | null
          created_at: string | null
          error: string | null
          executor: string
          id: string
          parent_task_id: string | null
          payload_json: Json | null
          result_detail: string | null
          result_summary: string | null
          source: string
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          command: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          error?: string | null
          executor: string
          id?: string
          parent_task_id?: string | null
          payload_json?: Json | null
          result_detail?: string | null
          result_summary?: string | null
          source: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          command?: string
          completed_at?: string | null
          correlation_id?: string | null
          created_at?: string | null
          error?: string | null
          executor?: string
          id?: string
          parent_task_id?: string | null
          payload_json?: Json | null
          result_detail?: string | null
          result_summary?: string | null
          source?: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_executions: {
        Row: {
          approval_id: string
          claimed_at: string
          error_message: string | null
          executor: string
          exit_code: number | null
          finished_at: string | null
          id: string
          output_excerpt: string | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          approval_id: string
          claimed_at?: string
          error_message?: string | null
          executor: string
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          output_excerpt?: string | null
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          approval_id?: string
          claimed_at?: string
          error_message?: string | null
          executor?: string
          exit_code?: number | null
          finished_at?: string | null
          id?: string
          output_excerpt?: string | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_executions_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: true
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          proposed_action: Json
          responded_at: string | null
          response_note: string | null
          source_actor: string
          status: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          proposed_action: Json
          responded_at?: string | null
          response_note?: string | null
          source_actor: string
          status?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          proposed_action?: Json
          responded_at?: string | null
          response_note?: string | null
          source_actor?: string
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      archive_categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          parent_id: string | null
          scope: string
          sort_order: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          scope: string
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          scope?: string
          sort_order?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archive_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "archive_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archive_categories_parent_user_fkey"
            columns: ["parent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "archive_categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      archives: {
        Row: {
          aliases: string[] | null
          category_id: string
          content: string
          created_at: string | null
          id: string
          importance: string | null
          is_deleted: boolean | null
          keywords: string[] | null
          source: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          aliases?: string[] | null
          category_id: string
          content: string
          created_at?: string | null
          id?: string
          importance?: string | null
          is_deleted?: boolean | null
          keywords?: string[] | null
          source?: string | null
          title: string
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          aliases?: string[] | null
          category_id?: string
          content?: string
          created_at?: string | null
          id?: string
          importance?: string | null
          is_deleted?: boolean | null
          keywords?: string[] | null
          source?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archives_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "archive_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archives_category_user_fkey"
            columns: ["category_id", "user_id"]
            isOneToOne: false
            referencedRelation: "archive_categories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      auto_letter_config: {
        Row: {
          active_hour_end: number | null
          active_hour_start: number | null
          auto_letters_today: number | null
          auto_letters_today_date: string | null
          created_at: string | null
          enabled: boolean
          last_auto_letter_at: string | null
          t2_daily_limit: number | null
          t2_interval_hours: number | null
          t2_mode: string
          t2_random_probability: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active_hour_end?: number | null
          active_hour_start?: number | null
          auto_letters_today?: number | null
          auto_letters_today_date?: string | null
          created_at?: string | null
          enabled?: boolean
          last_auto_letter_at?: string | null
          t2_daily_limit?: number | null
          t2_interval_hours?: number | null
          t2_mode?: string
          t2_random_probability?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          active_hour_end?: number | null
          active_hour_start?: number | null
          auto_letters_today?: number | null
          auto_letters_today_date?: string | null
          created_at?: string | null
          enabled?: boolean
          last_auto_letter_at?: string | null
          t2_daily_limit?: number | null
          t2_interval_hours?: number | null
          t2_mode?: string
          t2_random_probability?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      bubble_messages: {
        Row: {
          action_tag: string | null
          content: string
          created_at: string
          id: string
          meta: Json
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          action_tag?: string | null
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          session_id: string
          user_id?: string
        }
        Update: {
          action_tag?: string | null
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bubble_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "bubble_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      bubble_sessions: {
        Row: {
          created_at: string
          id: string
          session_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          session_date?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          session_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      capabilities: {
        Row: {
          cooldown_rule: string | null
          cooldown_until: string | null
          created_at: string | null
          description: string | null
          enabled: boolean | null
          failure_count: number | null
          id: string
          last_used_at: string | null
          name: string
          output_channel: string | null
          requires_confirmation: boolean | null
          risk_level: string
          trigger_conditions: string | null
          trigger_config: Json | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          cooldown_rule?: string | null
          cooldown_until?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          failure_count?: number | null
          id?: string
          last_used_at?: string | null
          name: string
          output_channel?: string | null
          requires_confirmation?: boolean | null
          risk_level?: string
          trigger_conditions?: string | null
          trigger_config?: Json | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          cooldown_rule?: string | null
          cooldown_until?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          failure_count?: number | null
          id?: string
          last_used_at?: string | null
          name?: string
          output_channel?: string | null
          requires_confirmation?: boolean | null
          risk_level?: string
          trigger_conditions?: string | null
          trigger_config?: Json | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      channel_config: {
        Row: {
          active_model: string
          channel_name: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_model: string
          channel_name: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_model?: string
          channel_name?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkin_logs: {
        Row: {
          canonical_event_id: number | null
          canonical_message_id: string | null
          checkin_time: string
          created_at: string
          decision: string
          error_detail: string | null
          generation_audit: Json
          id: string
          idempotency_key: string | null
          input_summary: string | null
          model: string | null
          raw_output: string | null
          topic_fingerprint: string | null
          tokens_used: number | null
          user_id: string
          wechat_message_id: string | null
        }
        Insert: {
          canonical_event_id?: number | null
          canonical_message_id?: string | null
          checkin_time?: string
          created_at?: string
          decision?: string
          error_detail?: string | null
          generation_audit?: Json
          id?: string
          idempotency_key?: string | null
          input_summary?: string | null
          model?: string | null
          raw_output?: string | null
          topic_fingerprint?: string | null
          tokens_used?: number | null
          user_id?: string
          wechat_message_id?: string | null
        }
        Update: {
          canonical_event_id?: number | null
          canonical_message_id?: string | null
          checkin_time?: string
          created_at?: string
          decision?: string
          error_detail?: string | null
          generation_audit?: Json
          id?: string
          idempotency_key?: string | null
          input_summary?: string | null
          model?: string | null
          raw_output?: string | null
          topic_fingerprint?: string | null
          tokens_used?: number | null
          user_id?: string
          wechat_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkin_logs_canonical_event_fkey"
            columns: ["canonical_event_id"]
            isOneToOne: false
            referencedRelation: "agent_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkin_logs_canonical_message_fkey"
            columns: ["canonical_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      checkins: {
        Row: {
          checkin_date: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checkin_date: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checkin_date?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      codex_control: {
        Row: {
          action: string
          created_at: string | null
          executed_at: string | null
          id: string
          source: string
          status: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          executed_at?: string | null
          id?: string
          source?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          executed_at?: string | null
          id?: string
          source?: string
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      codex_tasks: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          result: string | null
          source: string
          started_at: string | null
          status: string
          task: string
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          result?: string | null
          source?: string
          started_at?: string | null
          status?: string
          task: string
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          result?: string | null
          source?: string
          started_at?: string | null
          status?: string
          task?: string
          user_id?: string | null
        }
        Relationships: []
      }
      compression_cache: {
        Row: {
          compressed_up_to_message_id: string
          conversation_id: string
          module: string
          summary_text: string
          updated_at: string
        }
        Insert: {
          compressed_up_to_message_id: string
          conversation_id: string
          module?: string
          summary_text: string
          updated_at?: string
        }
        Update: {
          compressed_up_to_message_id?: string
          conversation_id?: string
          module?: string
          summary_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_profiles: {
        Row: {
          active: boolean
          context_recipe: Json
          conversation_kind: string
          created_at: string
          default_responder_port_key: string
          handler: string
          id: string
          participant_port_keys: string[]
          profile_key: string
          rules_prompt_name: string | null
          session_policy: string
          singleton_session_key: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          context_recipe: Json
          conversation_kind: string
          created_at?: string
          default_responder_port_key: string
          handler: string
          id?: string
          participant_port_keys: string[]
          profile_key: string
          rules_prompt_name?: string | null
          session_policy: string
          singleton_session_key?: string | null
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          active?: boolean
          context_recipe?: Json
          conversation_kind?: string
          created_at?: string
          default_responder_port_key?: string
          handler?: string
          id?: string
          participant_port_keys?: string[]
          profile_key?: string
          rules_prompt_name?: string | null
          session_policy?: string
          singleton_session_key?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      council_categories: {
        Row: {
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          key: string
          label: string
          sort_order: number
        }
        Update: {
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      current_context_snapshot: {
        Row: {
          created_at: string | null
          id: string
          snapshot_type: string
          stale_after: string | null
          summary_json: Json | null
          summary_text: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          snapshot_type?: string
          stale_after?: string | null
          summary_json?: Json | null
          summary_text: string
          user_id?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          snapshot_type?: string
          stale_after?: string | null
          summary_json?: Json | null
          summary_text?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_status_digest: {
        Row: {
          care_priority: string | null
          created_at: string | null
          date: string
          id: string
          period_of_day: string
          source_range_end: string | null
          source_range_start: string | null
          summary_json: Json | null
          summary_text: string | null
          user_id: string
        }
        Insert: {
          care_priority?: string | null
          created_at?: string | null
          date: string
          id?: string
          period_of_day: string
          source_range_end?: string | null
          source_range_start?: string | null
          summary_json?: Json | null
          summary_text?: string | null
          user_id?: string
        }
        Update: {
          care_priority?: string | null
          created_at?: string | null
          date?: string
          id?: string
          period_of_day?: string
          source_range_end?: string | null
          source_range_start?: string | null
          summary_json?: Json | null
          summary_text?: string | null
          user_id?: string
        }
        Relationships: []
      }
      device_status: {
        Row: {
          battery_level: number | null
          brightness: number | null
          created_at: string
          device_name: string | null
          id: string
          is_charging: boolean | null
          latitude: number | null
          longitude: number | null
          now_playing: string | null
          now_playing_artist: string | null
          now_playing_title: string | null
          raw_data: Json | null
          source_app: string | null
          step_count: number | null
          steps: number | null
          user_id: string
          weather: string | null
          wifi_name: string | null
        }
        Insert: {
          battery_level?: number | null
          brightness?: number | null
          created_at?: string
          device_name?: string | null
          id?: string
          is_charging?: boolean | null
          latitude?: number | null
          longitude?: number | null
          now_playing?: string | null
          now_playing_artist?: string | null
          now_playing_title?: string | null
          raw_data?: Json | null
          source_app?: string | null
          step_count?: number | null
          steps?: number | null
          user_id?: string
          weather?: string | null
          wifi_name?: string | null
        }
        Update: {
          battery_level?: number | null
          brightness?: number | null
          created_at?: string
          device_name?: string | null
          id?: string
          is_charging?: boolean | null
          latitude?: number | null
          longitude?: number | null
          now_playing?: string | null
          now_playing_artist?: string | null
          now_playing_title?: string | null
          raw_data?: Json | null
          source_app?: string | null
          step_count?: number | null
          steps?: number | null
          user_id?: string
          weather?: string | null
          wifi_name?: string | null
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          app_version: string | null
          created_at: string
          device_name: string | null
          enabled: boolean
          expo_push_token: string
          id: string
          last_seen_at: string | null
          native_push_token: string | null
          platform: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          enabled?: boolean
          expo_push_token: string
          id?: string
          last_seen_at?: string | null
          native_push_token?: string | null
          platform: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_name?: string | null
          enabled?: boolean
          expo_push_token?: string
          id?: string
          last_seen_at?: string | null
          native_push_token?: string | null
          platform?: string
          user_id?: string
        }
        Relationships: []
      }
      enabled_models: {
        Row: {
          display_name: string | null
          enabled_at: string
          id: string
          is_default: boolean
          model_id: string
          provider_id: string
          user_id: string
        }
        Insert: {
          display_name?: string | null
          enabled_at?: string
          id?: string
          is_default?: boolean
          model_id: string
          provider_id: string
          user_id: string
        }
        Update: {
          display_name?: string | null
          enabled_at?: string
          id?: string
          is_default?: boolean
          model_id?: string
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enabled_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "llm_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_ai_profiles: {
        Row: {
          api_base_url: string | null
          context_token_limit: number
          created_at: string
          enabled: boolean
          id: string
          model: string
          name: string
          slot_index: number
          system_prompt: string
          temperature: number | null
          top_p: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_base_url?: string | null
          context_token_limit?: number
          created_at?: string
          enabled?: boolean
          id?: string
          model?: string
          name?: string
          slot_index: number
          system_prompt?: string
          temperature?: number | null
          top_p?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_base_url?: string | null
          context_token_limit?: number
          created_at?: string
          enabled?: boolean
          id?: string
          model?: string
          name?: string
          slot_index?: number
          system_prompt?: string
          temperature?: number | null
          top_p?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      forum_replies: {
        Row: {
          author_name: string
          author_slot: number | null
          author_type: string
          body: string
          created_at: string
          id: string
          parent_id: string | null
          reply_to_author_name: string
          reply_to_reply_id: string | null
          thread_id: string
          user_id: string
        }
        Insert: {
          author_name?: string
          author_slot?: number | null
          author_type: string
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          reply_to_author_name?: string
          reply_to_reply_id?: string | null
          thread_id: string
          user_id: string
        }
        Update: {
          author_name?: string
          author_slot?: number | null
          author_type?: string
          body?: string
          created_at?: string
          id?: string
          parent_id?: string | null
          reply_to_author_name?: string
          reply_to_reply_id?: string | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_replies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "forum_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_reply_to_reply_id_fkey"
            columns: ["reply_to_reply_id"]
            isOneToOne: false
            referencedRelation: "forum_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "forum_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_threads: {
        Row: {
          author_name: string
          author_slot: number | null
          author_type: string
          body: string
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name?: string
          author_slot?: number | null
          author_type: string
          body?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author_name?: string
          author_slot?: number | null
          author_type?: string
          body?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generation_ports: {
        Row: {
          active: boolean
          created_at: string
          id: string
          identity_prompt_name: string
          model_channel_name: string | null
          port_key: string
          runtime_kind: string
          sop_ref: string | null
          sop_source: string | null
          style_prompt_name: string | null
          target_role: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          identity_prompt_name: string
          model_channel_name?: string | null
          port_key: string
          runtime_kind: string
          sop_ref?: string | null
          sop_source?: string | null
          style_prompt_name?: string | null
          target_role?: string | null
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          identity_prompt_name?: string
          model_channel_name?: string | null
          port_key?: string
          runtime_kind?: string
          sop_ref?: string | null
          sop_source?: string | null
          style_prompt_name?: string | null
          target_role?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "generation_ports_model_channel_fkey"
            columns: ["user_id", "model_channel_name"]
            isOneToOne: false
            referencedRelation: "channel_config"
            referencedColumns: ["user_id", "channel_name"]
          },
        ]
      }
      ideas: {
        Row: {
          captured_by: string
          category: string | null
          content: string
          created_at: string | null
          id: string
          source_context: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          captured_by: string
          category?: string | null
          content: string
          created_at?: string | null
          id?: string
          source_context?: string | null
          status?: string | null
          user_id?: string
        }
        Update: {
          captured_by?: string
          category?: string | null
          content?: string
          created_at?: string | null
          id?: string
          source_context?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      knowledge_folders: {
        Row: {
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_edges: {
        Row: {
          created_at: string | null
          description: string | null
          edge_type: string
          from_node_id: string
          id: string
          strength: number | null
          to_node_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          edge_type: string
          from_node_id: string
          id?: string
          strength?: number | null
          to_node_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          edge_type?: string
          from_node_id?: string
          id?: string
          strength?: number | null
          to_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "learning_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "learning_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_nodes: {
        Row: {
          content: string | null
          created_at: string | null
          folder_id: string | null
          id: string
          metadata: Json | null
          node_type: string
          tags: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          folder_id?: string | null
          id?: string
          metadata?: Json | null
          node_type: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          folder_id?: string | null
          id?: string
          metadata?: Json | null
          node_type?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "learning_nodes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      letter_conversations: {
        Row: {
          conversation_id: string
          created_at: string
          letter_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          letter_id: string
          user_id?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          letter_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "letter_conversations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "letter_conversations_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "letters"
            referencedColumns: ["id"]
          },
        ]
      }
      letters: {
        Row: {
          content: string
          conversation_id: string | null
          created_at: string
          id: string
          is_read: boolean
          metadata: Json | null
          model: string
          module: string
          trigger_reason: string | null
          trigger_type: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          metadata?: Json | null
          model: string
          module?: string
          trigger_reason?: string | null
          trigger_type?: string
          user_id?: string
        }
        Update: {
          content?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          metadata?: Json | null
          model?: string
          module?: string
          trigger_reason?: string | null
          trigger_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "letters_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_providers: {
        Row: {
          active: boolean
          base_url: string
          created_at: string
          display_name: string
          id: string
          name: string
          priority: number
          secret_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          base_url: string
          created_at?: string
          display_name: string
          id?: string
          name: string
          priority?: number
          secret_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          base_url?: string
          created_at?: string
          display_name?: string
          id?: string
          name?: string
          priority?: number
          secret_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_usage: {
        Row: {
          cache_write_tokens: number | null
          cached_tokens: number | null
          completion_tokens: number | null
          conversation_id: string | null
          cost_usd: number | null
          created_at: string
          id: string
          model: string | null
          module: string | null
          prompt_tokens: number | null
          raw: Json | null
          total_tokens: number | null
        }
        Insert: {
          cache_write_tokens?: number | null
          cached_tokens?: number | null
          completion_tokens?: number | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          model?: string | null
          module?: string | null
          prompt_tokens?: number | null
          raw?: Json | null
          total_tokens?: number | null
        }
        Update: {
          cache_write_tokens?: number | null
          cached_tokens?: number | null
          completion_tokens?: number | null
          conversation_id?: string | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          model?: string | null
          module?: string | null
          prompt_tokens?: number | null
          raw?: Json | null
          total_tokens?: number | null
        }
        Relationships: []
      }
      lounge_members: {
        Row: {
          color: string
          display_name: string
          emoji: string
          sender: string
        }
        Insert: {
          color: string
          display_name: string
          emoji: string
          sender: string
        }
        Update: {
          color?: string
          display_name?: string
          emoji?: string
          sender?: string
        }
        Relationships: []
      }
      lounge_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          mentions: string[]
          meta: Json
          sender: string
          sofa_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          mentions?: string[]
          meta?: Json
          sender: string
          sofa_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          mentions?: string[]
          meta?: Json
          sender?: string
          sofa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lounge_messages_sofa_id_fkey"
            columns: ["sofa_id"]
            isOneToOne: false
            referencedRelation: "lounge_sofas"
            referencedColumns: ["id"]
          },
        ]
      }
      lounge_sofas: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      memo_entries: {
        Row: {
          content: string
          created_at: string | null
          id: string
          is_deleted: boolean | null
          is_pinned: boolean | null
          source: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          source?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          source?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      memo_entry_tags: {
        Row: {
          memo_entry_id: string
          memo_tag_id: string
        }
        Insert: {
          memo_entry_id: string
          memo_tag_id: string
        }
        Update: {
          memo_entry_id?: string
          memo_tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memo_entry_tags_memo_entry_id_fkey"
            columns: ["memo_entry_id"]
            isOneToOne: false
            referencedRelation: "memo_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memo_entry_tags_memo_tag_id_fkey"
            columns: ["memo_tag_id"]
            isOneToOne: false
            referencedRelation: "memo_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      memo_tags: {
        Row: {
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_entries: {
        Row: {
          content: string
          created_at: string
          id: string
          is_deleted: boolean
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          source: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          client_created_at: string | null
          client_id: string | null
          content: string
          created_at: string
          id: string
          meta: Json
          reply_to_id: string | null
          role: string
          sender_key: string | null
          session_id: string
          target_sender_keys: string[] | null
          user_id: string
        }
        Insert: {
          client_created_at?: string | null
          client_id?: string | null
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          reply_to_id?: string | null
          role: string
          sender_key?: string | null
          session_id: string
          target_sender_keys?: string[] | null
          user_id?: string
        }
        Update: {
          client_created_at?: string | null
          client_id?: string | null
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          reply_to_id?: string | null
          role?: string
          sender_key?: string | null
          session_id?: string
          target_sender_keys?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_reply_same_session_fkey"
            columns: ["session_id", "reply_to_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["session_id", "id"]
          },
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          agent_event_id: number | null
          channel: string
          created_at: string
          error_message: string | null
          id: string
          receipt_checked_at: string | null
          sent_at: string | null
          status: string
          target: string | null
          ticket_id: string | null
          user_id: string
        }
        Insert: {
          agent_event_id?: number | null
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          receipt_checked_at?: string | null
          sent_at?: string | null
          status?: string
          target?: string | null
          ticket_id?: string | null
          user_id: string
        }
        Update: {
          agent_event_id?: number | null
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          receipt_checked_at?: string | null
          sent_at?: string | null
          status?: string
          target?: string | null
          ticket_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_agent_event_id_fkey"
            columns: ["agent_event_id"]
            isOneToOne: false
            referencedRelation: "agent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      novel_books: {
        Row: {
          characters: Json | null
          created_at: string | null
          description: string | null
          id: string
          model_config: Json | null
          outline: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string | null
          user_id: string | null
          world_setting: string | null
        }
        Insert: {
          characters?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          model_config?: Json | null
          outline?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string | null
          user_id?: string | null
          world_setting?: string | null
        }
        Update: {
          characters?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          model_config?: Json | null
          outline?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
          world_setting?: string | null
        }
        Relationships: []
      }
      novel_chapters: {
        Row: {
          book_id: string | null
          chapter_number: number
          content: string | null
          created_at: string | null
          director_note: string | null
          id: string
          status: string
          summary: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          book_id?: string | null
          chapter_number: number
          content?: string | null
          created_at?: string | null
          director_note?: string | null
          id?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          book_id?: string | null
          chapter_number?: number
          content?: string | null
          created_at?: string | null
          director_note?: string | null
          id?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "novel_chapters_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "novel_books"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          sent_at: string | null
          source: string | null
          status: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          sent_at?: string | null
          source?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          sent_at?: string | null
          source?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_wechat_messages: {
        Row: {
          content: string
          created_at: string
          delivered_at: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          metadata: Json | null
          processing_by: string | null
          retry_count: number
          sent_at: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          metadata?: Json | null
          processing_by?: string | null
          retry_count?: number
          sent_at?: string | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          metadata?: Json | null
          processing_by?: string | null
          retry_count?: number
          sent_at?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      print_capsules: {
        Row: {
          batch_id: string | null
          content: string
          created_at: string | null
          created_by: string
          hidden_until_printed: boolean | null
          id: string
          paper_size: string | null
          printed_at: string | null
          scheduled_print_week: string | null
          sort_order: number | null
          status: string
          title: string
          trigger_reason: string | null
          type: string
          user_id: string
        }
        Insert: {
          batch_id?: string | null
          content: string
          created_at?: string | null
          created_by: string
          hidden_until_printed?: boolean | null
          id?: string
          paper_size?: string | null
          printed_at?: string | null
          scheduled_print_week?: string | null
          sort_order?: number | null
          status?: string
          title: string
          trigger_reason?: string | null
          type: string
          user_id?: string
        }
        Update: {
          batch_id?: string | null
          content?: string
          created_at?: string | null
          created_by?: string
          hidden_until_printed?: boolean | null
          id?: string
          paper_size?: string | null
          printed_at?: string | null
          scheduled_print_week?: string | null
          sort_order?: number | null
          status?: string
          title?: string
          trigger_reason?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      prompt_templates: {
        Row: {
          active: boolean
          category: string
          content: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          category: string
          content: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active?: boolean
          category?: string
          content?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      provider_models: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_default: boolean
          model_id: string
          model_type: string
          provider_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          model_id: string
          model_type?: string
          provider_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          model_id?: string
          model_type?: string
          provider_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          api_base_url: string
          created_at: string
          enabled: boolean
          id: string
          name: string
          priority: number
          secret_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_base_url: string
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          priority?: number
          secret_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_base_url?: string
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          priority?: number
          secret_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          platform: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          platform?: string
          updated_at?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          platform?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      quests: {
        Row: {
          completed_at: string | null
          completed_note: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          reward_points: number
          status: string
          title: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_note?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          reward_points?: number
          status?: string
          title: string
          user_id?: string
        }
        Update: {
          completed_at?: string | null
          completed_note?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          reward_points?: number
          status?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      rp_messages: {
        Row: {
          client_created_at: string | null
          client_id: string | null
          content: string
          created_at: string
          id: string
          meta: Json
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          client_created_at?: string | null
          client_id?: string | null
          content: string
          created_at?: string
          id?: string
          meta?: Json
          role: string
          session_id: string
          user_id: string
        }
        Update: {
          client_created_at?: string | null
          client_id?: string | null
          content?: string
          created_at?: string
          id?: string
          meta?: Json
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rp_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "rp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rp_npc_cards: {
        Row: {
          api_config: Json
          avatar_bg: string | null
          avatar_initial: string | null
          created_at: string
          display_name: string
          enabled: boolean
          id: string
          model_config: Json
          session_id: string
          system_prompt: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_config?: Json
          avatar_bg?: string | null
          avatar_initial?: string | null
          created_at?: string
          display_name: string
          enabled?: boolean
          id?: string
          model_config?: Json
          session_id: string
          system_prompt?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_config?: Json
          avatar_bg?: string | null
          avatar_initial?: string | null
          created_at?: string
          display_name?: string
          enabled?: boolean
          id?: string
          model_config?: Json
          session_id?: string
          system_prompt?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rp_npc_cards_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "rp_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      rp_session_groups: {
        Row: {
          created_at: string | null
          id: string
          session_id: string
          story_group_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          session_id: string
          story_group_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          session_id?: string
          story_group_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rp_session_groups_story_group_id_fkey"
            columns: ["story_group_id"]
            isOneToOne: false
            referencedRelation: "rp_story_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      rp_sessions: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_archived: boolean
          player_avatar_url: string | null
          player_display_name: string | null
          rp_context_token_limit: number | null
          rp_keep_recent_messages: number | null
          settings: Json
          tile_color: string | null
          title: string | null
          updated_at: string
          user_id: string
          worldbook_text: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          player_avatar_url?: string | null
          player_display_name?: string | null
          rp_context_token_limit?: number | null
          rp_keep_recent_messages?: number | null
          settings?: Json
          tile_color?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
          worldbook_text?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          player_avatar_url?: string | null
          player_display_name?: string | null
          rp_context_token_limit?: number | null
          rp_keep_recent_messages?: number | null
          settings?: Json
          tile_color?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          worldbook_text?: string
        }
        Relationships: []
      }
      rp_story_groups: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scheduled_wakeup: {
        Row: {
          cancelled_at: string | null
          created_at: string | null
          created_by: string
          delivered_at: string | null
          id: string
          message: string
          recurrence_rule: string | null
          status: string
          timezone: string | null
          trigger_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string | null
          created_by: string
          delivered_at?: string | null
          id?: string
          message: string
          recurrence_rule?: string | null
          status?: string
          timezone?: string | null
          trigger_at: string
          user_id?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string | null
          created_by?: string
          delivered_at?: string | null
          id?: string
          message?: string
          recurrence_rule?: string | null
          status?: string
          timezone?: string | null
          trigger_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          archived_at: string | null
          conversation_kind: string
          conversation_profile_key: string | null
          created_at: string
          handler: string
          id: string
          is_archived: boolean
          override_model: string | null
          override_reasoning: boolean | null
          routing_config: Json
          session_key: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          conversation_kind?: string
          conversation_profile_key?: string | null
          created_at?: string
          handler?: string
          id?: string
          is_archived?: boolean
          override_model?: string | null
          override_reasoning?: boolean | null
          routing_config?: Json
          session_key?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          conversation_kind?: string
          conversation_profile_key?: string | null
          created_at?: string
          handler?: string
          id?: string
          is_archived?: boolean
          override_model?: string | null
          override_reasoning?: boolean | null
          routing_config?: Json
          session_key?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      snack_posts: {
        Row: {
          content: string
          created_at: string
          id: string
          is_deleted: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          updated_at?: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      snack_replies: {
        Row: {
          content: string
          created_at: string
          id: string
          is_deleted: boolean
          meta: Json
          post_id: string
          role: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          meta?: Json
          post_id: string
          role?: string
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          meta?: Json
          post_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snack_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "snack_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      special_dates: {
        Row: {
          created_at: string | null
          day: number
          enabled: boolean
          id: string
          label: string
          month: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          day: number
          enabled?: boolean
          id?: string
          label?: string
          month: number
          user_id?: string
        }
        Update: {
          created_at?: string | null
          day?: number
          enabled?: boolean
          id?: string
          label?: string
          month?: number
          user_id?: string
        }
        Relationships: []
      }
      syzygy_commands: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          command_type: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          payload: Json
          result: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          command_type: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          command_type?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      syzygy_posts: {
        Row: {
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          is_deleted: boolean
          model_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_deleted?: boolean
          model_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_deleted?: boolean
          model_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      syzygy_replies: {
        Row: {
          author_role: string
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          is_deleted: boolean
          model_id: string | null
          post_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author_role: string
          content: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_deleted?: boolean
          model_id?: string | null
          post_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author_role?: string
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_deleted?: boolean
          model_id?: string | null
          post_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "syzygy_replies_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "syzygy_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      syzygy_signals: {
        Row: {
          created_at: string | null
          dedupe_key: string | null
          expires_at: string | null
          id: string
          payload: Json
          processed_at: string | null
          signal_type: string
          source: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          dedupe_key?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          signal_type: string
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          dedupe_key?: string | null
          expires_at?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          signal_type?: string
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      thought_relations: {
        Row: {
          created_at: string | null
          from_id: string
          id: string
          score: number | null
          to_id: string
        }
        Insert: {
          created_at?: string | null
          from_id: string
          id?: string
          score?: number | null
          to_id: string
        }
        Update: {
          created_at?: string | null
          from_id?: string
          id?: string
          score?: number | null
          to_id?: string
        }
        Relationships: []
      }
      timeline_config: {
        Row: {
          config_key: string
          config_value: string
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          config_key: string
          config_value: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          config_key?: string
          config_value?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      timeline_entries: {
        Row: {
          created_at: string | null
          event_date: string
          id: string
          recorder: string
          source: string
          summary: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_date: string
          id?: string
          recorder?: string
          source?: string
          summary: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_date?: string
          id?: string
          recorder?: string
          source?: string
          summary?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      todo_categories: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          sort_order?: number
          user_id?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      todos: {
        Row: {
          category_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          date: string
          event_date: string | null
          id: string
          notes: string | null
          sort_order: number
          status: string
          title: string
          todo_type: string | null
          user_id: string
        }
        Insert: {
          category_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          date: string
          event_date?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          status?: string
          title: string
          todo_type?: string | null
          user_id?: string
        }
        Update: {
          category_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          date?: string
          event_date?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          status?: string
          title?: string
          todo_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todos_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "todo_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_quota: {
        Row: {
          count: number
          day: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          day: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          bubble_chat_max_tokens: number | null
          bubble_chat_model: string | null
          bubble_chat_reasoning_enabled: boolean | null
          bubble_chat_system_prompt: string | null
          bubble_chat_temperature: number | null
          chat_reasoning_enabled: boolean
          compression_enabled: boolean
          compression_keep_recent_messages: number
          compression_trigger_ratio: number
          default_model: string
          enable_reasoning: boolean
          enabled_models: string[]
          letter_reply_system_prompt: string | null
          lounge_scene_prompt: string | null
          max_tokens: number
          memory_auto_extract_enabled: boolean
          memory_extract_model: string | null
          memory_merge_enabled: boolean
          rp_reasoning_enabled: boolean
          snack_system_prompt: string | null
          summarizer_model: string | null
          system_prompt: string
          syzygy_post_system_prompt: string | null
          syzygy_reply_system_prompt: string | null
          temperature: number
          top_p: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bubble_chat_max_tokens?: number | null
          bubble_chat_model?: string | null
          bubble_chat_reasoning_enabled?: boolean | null
          bubble_chat_system_prompt?: string | null
          bubble_chat_temperature?: number | null
          chat_reasoning_enabled?: boolean
          compression_enabled?: boolean
          compression_keep_recent_messages?: number
          compression_trigger_ratio?: number
          default_model?: string
          enable_reasoning?: boolean
          enabled_models?: string[]
          letter_reply_system_prompt?: string | null
          lounge_scene_prompt?: string | null
          max_tokens?: number
          memory_auto_extract_enabled?: boolean
          memory_extract_model?: string | null
          memory_merge_enabled?: boolean
          rp_reasoning_enabled?: boolean
          snack_system_prompt?: string | null
          summarizer_model?: string | null
          system_prompt?: string
          syzygy_post_system_prompt?: string | null
          syzygy_reply_system_prompt?: string | null
          temperature?: number
          top_p?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          bubble_chat_max_tokens?: number | null
          bubble_chat_model?: string | null
          bubble_chat_reasoning_enabled?: boolean | null
          bubble_chat_system_prompt?: string | null
          bubble_chat_temperature?: number | null
          chat_reasoning_enabled?: boolean
          compression_enabled?: boolean
          compression_keep_recent_messages?: number
          compression_trigger_ratio?: number
          default_model?: string
          enable_reasoning?: boolean
          enabled_models?: string[]
          letter_reply_system_prompt?: string | null
          lounge_scene_prompt?: string | null
          max_tokens?: number
          memory_auto_extract_enabled?: boolean
          memory_extract_model?: string | null
          memory_merge_enabled?: boolean
          rp_reasoning_enabled?: boolean
          snack_system_prompt?: string | null
          summarizer_model?: string | null
          system_prompt?: string
          syzygy_post_system_prompt?: string | null
          syzygy_reply_system_prompt?: string | null
          temperature?: number
          top_p?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          coins_delta: number
          created_at: string
          description: string
          id: string
          points_delta: number
          quest_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          coins_delta?: number
          created_at?: string
          description: string
          id?: string
          points_delta?: number
          quest_id?: string | null
          type: string
          user_id?: string
        }
        Update: {
          coins_delta?: number
          created_at?: string
          description?: string
          id?: string
          points_delta?: number
          quest_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      wechat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          role: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          role: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string | null
        }
        Relationships: []
      }
      weekly_digest: {
        Row: {
          created_at: string | null
          digest_json: Json | null
          digest_text: string | null
          highlights: string[] | null
          id: string
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string | null
          digest_json?: Json | null
          digest_text?: string | null
          highlights?: string[] | null
          id?: string
          user_id?: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string | null
          digest_json?: Json | null
          digest_text?: string | null
          highlights?: string[] | null
          id?: string
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      wiki_entries: {
        Row: {
          category: string
          content: string
          created_at: string | null
          id: string
          status: string
          tags: string[] | null
          title: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string | null
          id?: string
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string | null
          id?: string
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      llm_usage_daily: {
        Row: {
          cache_write_tokens: number | null
          cached_tokens: number | null
          calls: number | null
          completion_tokens: number | null
          cost_usd: number | null
          day: string | null
          model: string | null
          module: string | null
          prompt_tokens: number | null
          total_tokens: number | null
        }
        Relationships: []
      }
      wallet_balance: {
        Row: {
          coins: number | null
          points: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      claim_pending_wechat_message: {
        Args: { p_worker_id: string }
        Returns: {
          content: string
          created_at: string
          id: string
          idempotency_key: string
          metadata: Json
          retry_count: number
          source: string
          user_id: string
        }[]
      }
      complete_quest: {
        Args: { p_note?: string; p_quest_id: string; p_user_id?: string }
        Returns: Json
      }
      consume_usage_quota: {
        Args: { p_scope: string; p_user_id: string }
        Returns: number
      }
      conversation_dispatch_cancel_pending: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: Json
      }
      conversation_dispatch_complete_reply: {
        Args: {
          p_completed_at?: string
          p_content: string
          p_task_id: string
          p_user_id: string
        }
        Returns: Json
      }
      conversation_companion_publish_proactive: {
        Args: {
          p_client_id: string
          p_content: string
          p_generated_at: string
          p_generation_audit: Json
          p_importance?: string
          p_input_summary: string
          p_model: string
          p_raw_output: string
          p_tokens_used: number
          p_topic_fingerprint: string
          p_user_id: string
        }
        Returns: Json
      }
      conversation_dispatch_prepare: {
        Args: {
          p_client_created_at?: string
          p_client_id: string
          p_content: string
          p_retry_failed?: boolean
          p_session_id: string
          p_target_sender_keys?: string[]
        }
        Returns: Json
      }
      conversation_dispatch_prepare_durable: {
        Args: {
          p_client_created_at?: string
          p_client_id: string
          p_content: string
          p_retry_failed?: boolean
          p_session_id: string
          p_target_sender_keys?: string[]
          p_user_id: string
        }
        Returns: Json
      }
      conversation_profile_publish: {
        Args: {
          p_context_recipe: Json
          p_conversation_kind: string
          p_default_responder_port_key: string
          p_expected_active_version?: number
          p_handler: string
          p_participant_port_keys: string[]
          p_profile_key: string
          p_rules_prompt_name: string
          p_session_policy: string
          p_singleton_session_key: string
        }
        Returns: {
          active: boolean
          context_recipe: Json
          conversation_kind: string
          created_at: string
          default_responder_port_key: string
          handler: string
          id: string
          participant_port_keys: string[]
          profile_key: string
          rules_prompt_name: string | null
          session_policy: string
          singleton_session_key: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "conversation_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_session_create: {
        Args: {
          p_display_config?: Json
          p_profile_key: string
          p_session_id: string
          p_title: string
        }
        Returns: {
          archived_at: string | null
          conversation_kind: string
          conversation_profile_key: string | null
          created_at: string
          handler: string
          id: string
          is_archived: boolean
          override_model: string | null
          override_reasoning: boolean | null
          routing_config: Json
          session_key: string | null
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      council_submit_report: {
        Args: {
          p_artifacts?: string[]
          p_follow_ups?: string[]
          p_message: string
          p_proposal_id: string
          p_result: string
          p_speaker: string
        }
        Returns: Json
      }
      daitch_mokotoff: { Args: { "": string }; Returns: string[] }
      dmetaphone: { Args: { "": string }; Returns: string }
      dmetaphone_alt: { Args: { "": string }; Returns: string }
      exchange_points_to_coins: {
        Args: { p_points: number; p_user_id?: string }
        Returns: Json
      }
      generation_port_publish: {
        Args: {
          p_expected_active_version?: number
          p_identity_prompt_name: string
          p_model_channel_name: string
          p_port_key: string
          p_runtime_kind: string
          p_sop_ref: string
          p_sop_source: string
          p_style_prompt_name: string
          p_target_role: string
        }
        Returns: {
          active: boolean
          created_at: string
          id: string
          identity_prompt_name: string
          model_channel_name: string | null
          port_key: string
          runtime_kind: string
          sop_ref: string | null
          sop_source: string | null
          style_prompt_name: string | null
          target_role: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "generation_ports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_forum_thread_replies_tree: {
        Args: { p_thread_id: string }
        Returns: {
          author_name: string
          author_slot: number
          author_type: string
          body: string
          created_at: string
          depth: number
          id: string
          parent_id: string
          reply_to_author_name: string
          reply_to_reply_id: string
          sort_path: string
          thread_id: string
          user_id: string
        }[]
      }
      get_push_dispatch_secret: { Args: never; Returns: string }
      mark_wechat_message_failed: {
        Args: { p_error: string; p_message_id: string; p_worker_id: string }
        Returns: boolean
      }
      mark_wechat_message_sent: {
        Args: { p_message_id: string; p_worker_id: string }
        Returns: boolean
      }
      prompt_template_publish: {
        Args: {
          p_category: string
          p_content: string
          p_expected_active_version?: number
          p_name: string
        }
        Returns: {
          active: boolean
          category: string
          content: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "prompt_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_stuck_wechat_messages: {
        Args: { p_max_retries?: number; p_timeout_minutes?: number }
        Returns: number
      }
      respond_to_approval: {
        Args: { p_decision: string; p_id: string; p_note?: string }
        Returns: {
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          proposed_action: Json
          responded_at: string | null
          response_note: string | null
          source_actor: string
          status: string
          title: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "approval_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_snack_post: { Args: { p_post_id: string }; Returns: undefined }
      runtime_control_prepare: {
        Args: {
          p_action: string
          p_client_id: string
          p_confirm_running_tasks?: boolean
          p_target_role: string
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_snack_post: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      soft_delete_snack_reply: {
        Args: { p_reply_id: string }
        Returns: undefined
      }
      soundex: { Args: { "": string }; Returns: string }
      spend_coins: {
        Args: { p_amount: number; p_description: string; p_user_id?: string }
        Returns: Json
      }
      text_soundex: { Args: { "": string }; Returns: string }
      unaccent: { Args: { "": string }; Returns: string }
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
  public: {
    Enums: {},
  },
} as const
