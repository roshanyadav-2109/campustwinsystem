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
  alum: {
    Tables: {
      campaign: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          eligible_80g: boolean
          fund_type: string
          goal: number | null
          id: number
          org_id: string
          title: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          eligible_80g?: boolean
          fund_type?: string
          goal?: number | null
          id?: never
          org_id: string
          title: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          eligible_80g?: boolean
          fund_type?: string
          goal?: number | null
          id?: never
          org_id?: string
          title?: string
        }
        Relationships: []
      }
      donation: {
        Row: {
          amount: number
          campaign_id: number
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          donated_on: string
          donor_address: string | null
          donor_citizenship: string
          donor_email: string | null
          donor_name: string
          donor_pan: string | null
          eligible_80g: boolean
          id: number
          member_id: number | null
          mode: string
          not_eligible_why: string | null
          org_id: string
          receipt_number: string | null
          reference: string | null
          status: string
        }
        Insert: {
          amount: number
          campaign_id: number
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          donated_on: string
          donor_address?: string | null
          donor_citizenship?: string
          donor_email?: string | null
          donor_name: string
          donor_pan?: string | null
          eligible_80g?: boolean
          id?: never
          member_id?: number | null
          mode: string
          not_eligible_why?: string | null
          org_id: string
          receipt_number?: string | null
          reference?: string | null
          status?: string
        }
        Update: {
          amount?: number
          campaign_id?: number
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          donated_on?: string
          donor_address?: string | null
          donor_citizenship?: string
          donor_email?: string | null
          donor_name?: string
          donor_pan?: string | null
          eligible_80g?: boolean
          id?: never
          member_id?: number | null
          mode?: string
          not_eligible_why?: string | null
          org_id?: string
          receipt_number?: string | null
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_org_id_campaign_id_fkey"
            columns: ["org_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "donation_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      event: {
        Row: {
          capacity: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: number
          online_url: string | null
          org_id: string
          starts_at: string
          status: string
          title: string
          venue: string | null
        }
        Insert: {
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: never
          online_url?: string | null
          org_id: string
          starts_at: string
          status?: string
          title: string
          venue?: string | null
        }
        Update: {
          capacity?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: never
          online_url?: string | null
          org_id?: string
          starts_at?: string
          status?: string
          title?: string
          venue?: string | null
        }
        Relationships: []
      }
      job: {
        Row: {
          apply_url: string | null
          closes_on: string | null
          company: string
          created_at: string
          created_by: string | null
          description: string | null
          id: number
          location: string | null
          member_id: number | null
          org_id: string
          status: string
          title: string
        }
        Insert: {
          apply_url?: string | null
          closes_on?: string | null
          company: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: never
          location?: string | null
          member_id?: number | null
          org_id: string
          status?: string
          title: string
        }
        Update: {
          apply_url?: string | null
          closes_on?: string | null
          company?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: never
          location?: string | null
          member_id?: number | null
          org_id?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      member: {
        Row: {
          batch_year: number | null
          city: string | null
          company: string | null
          country: string
          created_at: string
          email: string | null
          full_name: string
          higher_studies: string | null
          id: number
          job_title: string | null
          linkedin_url: string | null
          org_id: string
          phone: string | null
          programme: string | null
          roll_number: string | null
          show_in_directory: boolean
          source: string
          status: string
          updated_at: string
          user_id: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          batch_year?: number | null
          city?: string | null
          company?: string | null
          country?: string
          created_at?: string
          email?: string | null
          full_name: string
          higher_studies?: string | null
          id?: never
          job_title?: string | null
          linkedin_url?: string | null
          org_id: string
          phone?: string | null
          programme?: string | null
          roll_number?: string | null
          show_in_directory?: boolean
          source?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          batch_year?: number | null
          city?: string | null
          company?: string | null
          country?: string
          created_at?: string
          email?: string | null
          full_name?: string
          higher_studies?: string | null
          id?: never
          job_title?: string | null
          linkedin_url?: string | null
          org_id?: string
          phone?: string | null
          programme?: string | null
          roll_number?: string | null
          show_in_directory?: boolean
          source?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
      post: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: number
          org_id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: never
          org_id: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: never
          org_id?: string
          title?: string
        }
        Relationships: []
      }
      rsvp: {
        Row: {
          event_id: number
          member_id: number
          org_id: string
          status: string
          updated_at: string
        }
        Insert: {
          event_id: number
          member_id: number
          org_id: string
          status: string
          updated_at?: string
        }
        Update: {
          event_id?: number
          member_id?: number
          org_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvp_org_id_event_id_fkey"
            columns: ["org_id", "event_id"]
            isOneToOne: false
            referencedRelation: "event"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "rsvp_org_id_member_id_fkey"
            columns: ["org_id", "member_id"]
            isOneToOne: false
            referencedRelation: "member"
            referencedColumns: ["org_id", "id"]
          },
        ]
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
          address: string | null
          display_name: string | null
          fcra_registered: boolean
          join_code: string
          join_open: boolean
          org_id: string
          pan: string | null
          reg_80g: string | null
          reg_80g_valid_until: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          display_name?: string | null
          fcra_registered?: boolean
          join_code?: string
          join_open?: boolean
          org_id: string
          pan?: string | null
          reg_80g?: string | null
          reg_80g_valid_until?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          display_name?: string | null
          fcra_registered?: boolean
          join_code?: string
          join_open?: boolean
          org_id?: string
          pan?: string | null
          reg_80g?: string | null
          reg_80g_valid_until?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      fy: { Args: { d: string }; Returns: string }
      is_staff: { Args: { p_org: string }; Returns: boolean }
      my_member: { Args: { p_org: string }; Returns: number }
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
  alum: {
    Enums: {},
  },
  core: {
    Enums: {},
  },
} as const
