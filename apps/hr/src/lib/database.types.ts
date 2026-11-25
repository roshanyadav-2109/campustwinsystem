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
  hr: {
    Tables: {
      attendance: {
        Row: {
          check_in: string | null
          check_out: string | null
          day: string
          employee_id: number
          id: number
          note: string | null
          org_id: string
          source: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          day: string
          employee_id: number
          id?: never
          note?: string | null
          org_id: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          day?: string
          employee_id?: number
          id?: never
          note?: string | null
          org_id?: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_org_id_employee_id_fkey"
            columns: ["org_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      department: {
        Row: {
          created_at: string
          id: number
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      designation: {
        Row: {
          created_at: string
          id: number
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      employee: {
        Row: {
          code: string
          created_at: string
          date_of_birth: string | null
          date_of_joining: string | null
          date_of_leaving: string | null
          department_id: number | null
          designation_id: number | null
          email: string | null
          employment_type: string
          full_name: string
          gender: string | null
          id: number
          manager_id: number | null
          org_id: string
          phone: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          date_of_birth?: string | null
          date_of_joining?: string | null
          date_of_leaving?: string | null
          department_id?: number | null
          designation_id?: number | null
          email?: string | null
          employment_type?: string
          full_name: string
          gender?: string | null
          id?: never
          manager_id?: number | null
          org_id: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          date_of_birth?: string | null
          date_of_joining?: string | null
          date_of_leaving?: string | null
          department_id?: number | null
          designation_id?: number | null
          email?: string | null
          employment_type?: string
          full_name?: string
          gender?: string | null
          id?: never
          manager_id?: number | null
          org_id?: string
          phone?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_org_id_department_id_fkey"
            columns: ["org_id", "department_id"]
            isOneToOne: false
            referencedRelation: "department"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "employee_org_id_designation_id_fkey"
            columns: ["org_id", "designation_id"]
            isOneToOne: false
            referencedRelation: "designation"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "employee_org_id_manager_id_fkey"
            columns: ["org_id", "manager_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      holiday: {
        Row: {
          day: string
          id: number
          name: string
          org_id: string
        }
        Insert: {
          day: string
          id?: never
          name: string
          org_id: string
        }
        Update: {
          day?: string
          id?: never
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      leave_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          days: number
          employee_id: number
          id: number
          kind: string
          leave_type_id: number
          note: string | null
          org_id: string
          request_id: number | null
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days: number
          employee_id: number
          id?: never
          kind: string
          leave_type_id: number
          note?: string | null
          org_id: string
          request_id?: number | null
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number
          employee_id?: number
          id?: never
          kind?: string
          leave_type_id?: number
          note?: string | null
          org_id?: string
          request_id?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_ledger_org_id_employee_id_fkey"
            columns: ["org_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "leave_ledger_org_id_leave_type_id_fkey"
            columns: ["org_id", "leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_type"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "leave_ledger_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "leave_request"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_request: {
        Row: {
          created_at: string
          days: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_id: number
          from_date: string
          half_day: boolean
          id: number
          leave_type_id: number
          org_id: string
          reason: string
          status: string
          to_date: string
        }
        Insert: {
          created_at?: string
          days: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id: number
          from_date: string
          half_day?: boolean
          id?: never
          leave_type_id: number
          org_id: string
          reason: string
          status?: string
          to_date: string
        }
        Update: {
          created_at?: string
          days?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id?: number
          from_date?: string
          half_day?: boolean
          id?: never
          leave_type_id?: number
          org_id?: string
          reason?: string
          status?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_request_org_id_employee_id_fkey"
            columns: ["org_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "leave_request_org_id_leave_type_id_fkey"
            columns: ["org_id", "leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_type"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      leave_type: {
        Row: {
          active: boolean
          allow_negative: boolean
          annual_quota: number
          code: string
          created_at: string
          id: number
          is_paid: boolean
          name: string
          org_id: string
        }
        Insert: {
          active?: boolean
          allow_negative?: boolean
          annual_quota?: number
          code: string
          created_at?: string
          id?: never
          is_paid?: boolean
          name: string
          org_id: string
        }
        Update: {
          active?: boolean
          allow_negative?: boolean
          annual_quota?: number
          code?: string
          created_at?: string
          id?: never
          is_paid?: boolean
          name?: string
          org_id?: string
        }
        Relationships: []
      }
      team: {
        Row: {
          added_at: string
          org_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          org_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          org_id?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      leave_balance: {
        Row: {
          balance: number | null
          employee_id: number | null
          leave_type_id: number | null
          org_id: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_ledger_org_id_employee_id_fkey"
            columns: ["org_id", "employee_id"]
            isOneToOne: false
            referencedRelation: "employee"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "leave_ledger_org_id_leave_type_id_fkey"
            columns: ["org_id", "leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_type"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
    }
    Functions: {
      allocate_year: {
        Args: { p_org: string; p_year: number }
        Returns: number
      }
      can_see_employee: {
        Args: { p_employee: number; p_org: string }
        Returns: boolean
      }
      cancel_leave: { Args: { p_request: number }; Returns: undefined }
      check_in: { Args: { p_org: string }; Returns: undefined }
      check_out: { Args: { p_org: string }; Returns: undefined }
      decide_leave: {
        Args: { p_approve: boolean; p_note?: string; p_request: number }
        Returns: undefined
      }
      is_admin: { Args: { p_org: string }; Returns: boolean }
      manages: { Args: { p_employee: number }; Returns: boolean }
      my_employee: { Args: { p_org: string }; Returns: number }
      my_orgs: { Args: never; Returns: string[] }
      seed_defaults: { Args: { p_org: string }; Returns: undefined }
      subscribed: { Args: { p_org: string }; Returns: boolean }
      today: { Args: never; Returns: string }
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
  hr: {
    Enums: {},
  },
} as const
