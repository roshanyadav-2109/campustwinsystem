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
  fin: {
    Tables: {
      account: {
        Row: {
          account_type: string | null
          active: boolean
          code: string
          created_at: string
          id: number
          is_group: boolean
          name: string
          org_id: string
          parent_id: number | null
          root_type: string
        }
        Insert: {
          account_type?: string | null
          active?: boolean
          code: string
          created_at?: string
          id?: never
          is_group?: boolean
          name: string
          org_id: string
          parent_id?: number | null
          root_type: string
        }
        Update: {
          account_type?: string | null
          active?: boolean
          code?: string
          created_at?: string
          id?: never
          is_group?: boolean
          name?: string
          org_id?: string
          parent_id?: number | null
          root_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_org_id_parent_id_fkey"
            columns: ["org_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      allocation: {
        Row: {
          against_id: number
          amount: number
          id: number
          org_id: string
          voucher_id: number
        }
        Insert: {
          against_id: number
          amount: number
          id?: never
          org_id: string
          voucher_id: number
        }
        Update: {
          against_id?: number
          amount?: number
          id?: never
          org_id?: string
          voucher_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "allocation_org_id_against_id_fkey"
            columns: ["org_id", "against_id"]
            isOneToOne: false
            referencedRelation: "voucher"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "allocation_org_id_voucher_id_fkey"
            columns: ["org_id", "voucher_id"]
            isOneToOne: false
            referencedRelation: "voucher"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      gl_entry: {
        Row: {
          account_id: number
          created_at: string
          credit: number
          date: string
          debit: number
          id: number
          is_reversal: boolean
          narration: string | null
          org_id: string
          party_id: number | null
          voucher_id: number
        }
        Insert: {
          account_id: number
          created_at?: string
          credit?: number
          date: string
          debit?: number
          id?: never
          is_reversal?: boolean
          narration?: string | null
          org_id: string
          party_id?: number | null
          voucher_id: number
        }
        Update: {
          account_id?: number
          created_at?: string
          credit?: number
          date?: string
          debit?: number
          id?: never
          is_reversal?: boolean
          narration?: string | null
          org_id?: string
          party_id?: number | null
          voucher_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "gl_entry_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "gl_entry_org_id_party_id_fkey"
            columns: ["org_id", "party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "gl_entry_org_id_voucher_id_fkey"
            columns: ["org_id", "voucher_id"]
            isOneToOne: false
            referencedRelation: "voucher"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      journal_line: {
        Row: {
          account_id: number
          credit: number
          debit: number
          id: number
          line_no: number
          memo: string | null
          org_id: string
          party_id: number | null
          voucher_id: number
        }
        Insert: {
          account_id: number
          credit?: number
          debit?: number
          id?: never
          line_no: number
          memo?: string | null
          org_id: string
          party_id?: number | null
          voucher_id: number
        }
        Update: {
          account_id?: number
          credit?: number
          debit?: number
          id?: never
          line_no?: number
          memo?: string | null
          org_id?: string
          party_id?: number | null
          voucher_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_line_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "journal_line_org_id_party_id_fkey"
            columns: ["org_id", "party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "journal_line_org_id_voucher_id_fkey"
            columns: ["org_id", "voucher_id"]
            isOneToOne: false
            referencedRelation: "voucher"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      party: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          email: string | null
          gstin: string | null
          id: number
          kind: string
          name: string
          org_id: string
          phone: string | null
          state_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: never
          kind?: string
          name: string
          org_id: string
          phone?: string | null
          state_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          email?: string | null
          gstin?: string | null
          id?: never
          kind?: string
          name?: string
          org_id?: string
          phone?: string | null
          state_code?: string | null
        }
        Relationships: []
      }
      series: {
        Row: {
          current: number
          fy: string
          org_id: string
          prefix: string
        }
        Insert: {
          current: number
          fy: string
          org_id: string
          prefix: string
        }
        Update: {
          current?: number
          fy?: string
          org_id?: string
          prefix?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          books_locked_until: string | null
          gstin: string | null
          input_cgst: number | null
          input_igst: number | null
          input_sgst: number | null
          legal_name: string | null
          org_id: string
          output_cgst: number | null
          output_igst: number | null
          output_sgst: number | null
          payable_account: number | null
          receivable_account: number | null
          round_off_account: number | null
          state_code: string | null
          updated_at: string
        }
        Insert: {
          books_locked_until?: string | null
          gstin?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          legal_name?: string | null
          org_id: string
          output_cgst?: number | null
          output_igst?: number | null
          output_sgst?: number | null
          payable_account?: number | null
          receivable_account?: number | null
          round_off_account?: number | null
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          books_locked_until?: string | null
          gstin?: string | null
          input_cgst?: number | null
          input_igst?: number | null
          input_sgst?: number | null
          legal_name?: string | null
          org_id?: string
          output_cgst?: number | null
          output_igst?: number | null
          output_sgst?: number | null
          payable_account?: number | null
          receivable_account?: number | null
          round_off_account?: number | null
          state_code?: string | null
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
      voucher: {
        Row: {
          amount: number | null
          cancelled_at: string | null
          cancelled_by: string | null
          cash_account_id: number | null
          created_at: string
          created_by: string | null
          date: string
          due_date: string | null
          id: number
          interstate: boolean | null
          kind: string
          narration: string | null
          number: string | null
          org_id: string
          party_id: number | null
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          status: string
          subtotal: number | null
          tax_total: number | null
          total: number | null
        }
        Insert: {
          amount?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_account_id?: number | null
          created_at?: string
          created_by?: string | null
          date: string
          due_date?: string | null
          id?: never
          interstate?: boolean | null
          kind: string
          narration?: string | null
          number?: string | null
          org_id: string
          party_id?: number | null
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          status?: string
          subtotal?: number | null
          tax_total?: number | null
          total?: number | null
        }
        Update: {
          amount?: number | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cash_account_id?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          due_date?: string | null
          id?: never
          interstate?: boolean | null
          kind?: string
          narration?: string | null
          number?: string | null
          org_id?: string
          party_id?: number | null
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          status?: string
          subtotal?: number | null
          tax_total?: number | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_org_id_cash_account_id_fkey"
            columns: ["org_id", "cash_account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "voucher_org_id_party_id_fkey"
            columns: ["org_id", "party_id"]
            isOneToOne: false
            referencedRelation: "party"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      voucher_item: {
        Row: {
          account_id: number
          amount: number | null
          description: string
          id: number
          line_no: number
          org_id: string
          qty: number
          rate: number
          tax_rate: number
          voucher_id: number
        }
        Insert: {
          account_id: number
          amount?: number | null
          description: string
          id?: never
          line_no: number
          org_id: string
          qty?: number
          rate: number
          tax_rate?: number
          voucher_id: number
        }
        Update: {
          account_id?: number
          amount?: number | null
          description?: string
          id?: never
          line_no?: number
          org_id?: string
          qty?: number
          rate?: number
          tax_rate?: number
          voucher_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "voucher_item_org_id_account_id_fkey"
            columns: ["org_id", "account_id"]
            isOneToOne: false
            referencedRelation: "account"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "voucher_item_org_id_voucher_id_fkey"
            columns: ["org_id", "voucher_id"]
            isOneToOne: false
            referencedRelation: "voucher"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_write: { Args: { p_org: string }; Returns: boolean }
      cancel_voucher: { Args: { p_voucher: number }; Returns: undefined }
      fy: { Args: { d: string }; Returns: string }
      gst_summary: {
        Args: { p_from: string; p_org: string; p_to: string }
        Returns: {
          cgst: number
          igst: number
          sgst: number
          side: string
          tax_rate: number
          taxable: number
        }[]
      }
      is_platform_owner: { Args: never; Returns: boolean }
      my_orgs: { Args: never; Returns: string[] }
      outstanding: { Args: { p_voucher: number }; Returns: number }
      post_voucher: { Args: { p_voucher: number }; Returns: string }
      postable: { Args: { p_account: number; p_org: string }; Returns: boolean }
      retained_until: {
        Args: { p_date: string; p_org: string }
        Returns: number
      }
      role: { Args: { p_org: string }; Returns: string }
      setup: {
        Args: { p_gstin?: string; p_org: string; p_state?: string }
        Returns: undefined
      }
      subscribed: { Args: { p_org: string }; Returns: boolean }
      trial_balance: {
        Args: { p_from: string; p_org: string; p_to: string }
        Returns: {
          account_id: number
          account_type: string
          closing: number
          code: string
          credit: number
          debit: number
          name: string
          opening: number
          root_type: string
        }[]
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
  fin: {
    Enums: {},
  },
} as const
