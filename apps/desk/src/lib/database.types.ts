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
    PostgrestVersion: "14.18"
  }
  core: {
    Tables: {
      audit_event: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          at: string
          data: Json
          entity: string | null
          entity_id: string | null
          id: number
          org_id: string | null
          product_code: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          at?: string
          data?: Json
          entity?: string | null
          entity_id?: string | null
          id?: never
          org_id?: string | null
          product_code?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          at?: string
          data?: Json
          entity?: string | null
          entity_id?: string | null
          id?: never
          org_id?: string | null
          product_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_event_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisation"
            referencedColumns: ["id"]
          },
        ]
      }
      membership: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisation"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation: {
        Row: {
          address: string | null
          billing_email: string | null
          country: string
          created_at: string
          gstin: string | null
          id: string
          kind: string
          legal_name: string | null
          name: string
          pan: string | null
          parent_id: string | null
          phone: string | null
          slug: string | null
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          billing_email?: string | null
          country?: string
          created_at?: string
          gstin?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          name: string
          pan?: string | null
          parent_id?: string | null
          phone?: string | null
          slug?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          billing_email?: string | null
          country?: string
          created_at?: string
          gstin?: string | null
          id?: string
          kind?: string
          legal_name?: string | null
          name?: string
          pan?: string | null
          parent_id?: string | null
          phone?: string | null
          slug?: string | null
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organisation"
            referencedColumns: ["id"]
          },
        ]
      }
      plan: {
        Row: {
          active: boolean
          code: string
          created_at: string
          features: Json
          id: string
          name: string
          period: string
          price_paise: number
          product_code: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          features?: Json
          id?: string
          name: string
          period?: string
          price_paise?: number
          product_code: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          features?: Json
          id?: string
          name?: string
          period?: string
          price_paise?: number
          product_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
        ]
      }
      product: {
        Row: {
          code: string
          created_at: string
          name: string
          sort: number
          status: string
          unit: string
        }
        Insert: {
          code: string
          created_at?: string
          name: string
          sort?: number
          status?: string
          unit: string
        }
        Update: {
          code?: string
          created_at?: string
          name?: string
          sort?: number
          status?: string
          unit?: string
        }
        Relationships: []
      }
      product_access: {
        Row: {
          granted_at: string
          membership_id: string
          product_code: string
        }
        Insert: {
          granted_at?: string
          membership_id: string
          product_code: string
        }
        Update: {
          granted_at?: string
          membership_id?: string
          product_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_access_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "membership"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_access_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
        ]
      }
      reserved_name: {
        Row: {
          name: string
        }
        Insert: {
          name: string
        }
        Update: {
          name?: string
        }
        Relationships: []
      }
      subscription: {
        Row: {
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          id: string
          notes: string | null
          org_id: string
          plan_id: string | null
          product_code: string
          quantity: number | null
          started_at: string
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          notes?: string | null
          org_id: string
          plan_id?: string | null
          product_code: string
          quantity?: number | null
          started_at?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          plan_id?: string | null
          product_code?: string
          quantity?: number | null
          started_at?: string
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisation"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_product_code_fkey"
            columns: ["product_code"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_campustwin_subscription: {
        Args: { p_org: string }
        Returns: undefined
      }
      login_for_email: { Args: { p_email: string }; Returns: string }
      org_status: { Args: { p: string }; Returns: string }
      release_org: { Args: { p_org: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  desk: {
    Tables: {
      article: {
        Row: {
          body: string
          category_id: number | null
          id: number
          org_id: string
          published: boolean
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          category_id?: number | null
          id?: never
          org_id: string
          published?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          category_id?: number | null
          id?: never
          org_id?: string
          published?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "category"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      category: {
        Row: {
          active: boolean
          id: number
          name: string
          org_id: string
        }
        Insert: {
          active?: boolean
          id?: never
          name: string
          org_id: string
        }
        Update: {
          active?: boolean
          id?: never
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      message: {
        Row: {
          author_kind: string
          author_name: string
          author_user_id: string | null
          body: string
          created_at: string
          id: number
          internal: boolean
          org_id: string
          ticket_id: number
        }
        Insert: {
          author_kind: string
          author_name: string
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: never
          internal?: boolean
          org_id: string
          ticket_id: number
        }
        Update: {
          author_kind?: string
          author_name?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: never
          internal?: boolean
          org_id?: string
          ticket_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_org_id_ticket_id_fkey"
            columns: ["org_id", "ticket_id"]
            isOneToOne: false
            referencedRelation: "ticket"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      series: {
        Row: {
          current: number
          org_id: string
        }
        Insert: {
          current: number
          org_id: string
        }
        Update: {
          current?: number
          org_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          display_name: string | null
          form_open: boolean
          org_id: string
          public_code: string
          resolve_high: number
          resolve_low: number
          resolve_normal: number
          resolve_urgent: number
          respond_high: number
          respond_low: number
          respond_normal: number
          respond_urgent: number
          updated_at: string
        }
        Insert: {
          display_name?: string | null
          form_open?: boolean
          org_id: string
          public_code?: string
          resolve_high?: number
          resolve_low?: number
          resolve_normal?: number
          resolve_urgent?: number
          respond_high?: number
          respond_low?: number
          respond_normal?: number
          respond_urgent?: number
          updated_at?: string
        }
        Update: {
          display_name?: string | null
          form_open?: boolean
          org_id?: string
          public_code?: string
          resolve_high?: number
          resolve_low?: number
          resolve_normal?: number
          resolve_urgent?: number
          respond_high?: number
          respond_low?: number
          respond_normal?: number
          respond_urgent?: number
          updated_at?: string
        }
        Relationships: []
      }
      team: {
        Row: {
          added_at: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          added_at?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      ticket: {
        Row: {
          assignee_id: string | null
          category_id: number | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          first_response_at: string | null
          id: number
          kind: string
          number: number
          org_id: string
          priority: string
          public_token: string
          requester_email: string | null
          requester_name: string
          requester_phone: string | null
          resolve_by: string | null
          resolved_at: string | null
          respond_by: string | null
          source: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          category_id?: number | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          first_response_at?: string | null
          id?: never
          kind?: string
          number: number
          org_id: string
          priority?: string
          public_token?: string
          requester_email?: string | null
          requester_name: string
          requester_phone?: string | null
          resolve_by?: string | null
          resolved_at?: string | null
          respond_by?: string | null
          source?: string
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          category_id?: number | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          first_response_at?: string | null
          id?: never
          kind?: string
          number?: number
          org_id?: string
          priority?: string
          public_token?: string
          requester_email?: string | null
          requester_name?: string
          requester_phone?: string | null
          resolve_by?: string | null
          resolved_at?: string | null
          respond_by?: string | null
          source?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_org_id_category_id_fkey"
            columns: ["org_id", "category_id"]
            isOneToOne: false
            referencedRelation: "category"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agents: {
        Args: { p_org: string }
        Returns: {
          email: string
          role: string
          user_id: string
        }[]
      }
      my_orgs: { Args: never; Returns: string[] }
      role: { Args: { p_org: string }; Returns: string }
      setup: { Args: { p_org: string }; Returns: undefined }
      subscribed: { Args: { p_org: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  core: {
    Enums: {},
  },
  desk: {
    Enums: {},
  },
} as const
