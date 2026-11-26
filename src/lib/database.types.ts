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
  public: {
    Tables: {
      absence_notice: {
        Row: {
          academic_year_id: number
          created_at: string
          explained_at: string | null
          explained_by: string | null
          id: number
          on_date: string
          reason: string | null
          school_id: number
          section_id: number
          status: string
          student_id: number
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          explained_at?: string | null
          explained_by?: string | null
          id?: never
          on_date: string
          reason?: string | null
          school_id?: number
          section_id: number
          status?: string
          student_id: number
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          explained_at?: string | null
          explained_by?: string | null
          id?: never
          on_date?: string
          reason?: string | null
          school_id?: number
          section_id?: number
          status?: string
          student_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "absence_notice_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_notice_explained_by_fkey"
            columns: ["explained_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_notice_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_notice_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "absence_notice_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_year: {
        Row: {
          created_at: string
          end_date: string
          id: number
          is_current: boolean
          name: string
          school_id: number
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: never
          is_current?: boolean
          name: string
          school_id?: number
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: never
          is_current?: boolean
          name?: string
          school_id?: number
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_year_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_enquiry: {
        Row: {
          academic_year_id: number
          address: string | null
          assigned_to: number | null
          child_name: string
          class_id: number
          created_at: string
          created_by: number | null
          date_of_birth: string | null
          email: string | null
          guardian_name: string
          id: number
          message: string | null
          next_follow_up: string | null
          phone: string
          previous_school: string | null
          school_id: number
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          academic_year_id?: number
          address?: string | null
          assigned_to?: number | null
          child_name: string
          class_id: number
          created_at?: string
          created_by?: number | null
          date_of_birth?: string | null
          email?: string | null
          guardian_name: string
          id?: never
          message?: string | null
          next_follow_up?: string | null
          phone: string
          previous_school?: string | null
          school_id?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          academic_year_id?: number
          address?: string | null
          assigned_to?: number | null
          child_name?: string
          class_id?: number
          created_at?: string
          created_by?: number | null
          date_of_birth?: string | null
          email?: string | null
          guardian_name?: string
          id?: never
          message?: string | null
          next_follow_up?: string | null
          phone?: string
          previous_school?: string | null
          school_id?: number
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_enquiry_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_enquiry_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_enquiry_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_enquiry_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_enquiry_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_followup: {
        Row: {
          by_staff: number
          created_at: string
          enquiry_id: number
          id: number
          next_follow_up: string | null
          note: string
          school_id: number
        }
        Insert: {
          by_staff: number
          created_at?: string
          enquiry_id: number
          id?: never
          next_follow_up?: string | null
          note: string
          school_id?: number
        }
        Update: {
          by_staff?: number
          created_at?: string
          enquiry_id?: number
          id?: never
          next_follow_up?: string | null
          note?: string
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "admission_followup_by_staff_fkey"
            columns: ["by_staff"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_followup_enquiry_id_fkey"
            columns: ["enquiry_id"]
            isOneToOne: false
            referencedRelation: "admission_enquiry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_followup_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      announcement: {
        Row: {
          academic_year_id: number | null
          body: string
          class_id: number | null
          created_at: string
          created_by: number | null
          id: number
          image_url: string | null
          published_at: string
          school_id: number
          scope: Database["public"]["Enums"]["announcement_scope"]
          section_id: number | null
          section_ids: number[] | null
          title: string
        }
        Insert: {
          academic_year_id?: number | null
          body: string
          class_id?: number | null
          created_at?: string
          created_by?: number | null
          id?: never
          image_url?: string | null
          published_at?: string
          school_id?: number
          scope?: Database["public"]["Enums"]["announcement_scope"]
          section_id?: number | null
          section_ids?: number[] | null
          title: string
        }
        Update: {
          academic_year_id?: number | null
          body?: string
          class_id?: number | null
          created_at?: string
          created_by?: number | null
          id?: never
          image_url?: string | null
          published_at?: string
          school_id?: number
          scope?: Database["public"]["Enums"]["announcement_scope"]
          section_id?: number | null
          section_ids?: number[] | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment: {
        Row: {
          academic_year_id: number
          assessed_on: string
          assessment_type_id: number
          created_at: string
          created_by: number | null
          id: number
          is_published: boolean
          max_marks: number
          name: string
          published_at: string | null
          school_id: number
          section_id: number
          subject_id: number
          term: number | null
        }
        Insert: {
          academic_year_id: number
          assessed_on: string
          assessment_type_id: number
          created_at?: string
          created_by?: number | null
          id?: never
          is_published?: boolean
          max_marks?: number
          name: string
          published_at?: string | null
          school_id?: number
          section_id: number
          subject_id: number
          term?: number | null
        }
        Update: {
          academic_year_id?: number
          assessed_on?: string
          assessment_type_id?: number
          created_at?: string
          created_by?: number | null
          id?: never
          is_published?: boolean
          max_marks?: number
          name?: string
          published_at?: string | null
          school_id?: number
          section_id?: number
          subject_id?: number
          term?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_assessment_type_id_fkey"
            columns: ["assessment_type_id"]
            isOneToOne: false
            referencedRelation: "assessment_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_type: {
        Row: {
          code: string
          id: number
          is_numeric: boolean
          name: string
          school_id: number
          weightage: number | null
        }
        Insert: {
          code: string
          id?: never
          is_numeric?: boolean
          name: string
          school_id?: number
          weightage?: number | null
        }
        Update: {
          code?: string
          id?: never
          is_numeric?: boolean
          name?: string
          school_id?: number
          weightage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_type_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_record: {
        Row: {
          academic_year_id: number
          created_at: string
          id: number
          marked_by: number | null
          on_date: string
          period: number | null
          school_id: number
          section_id: number
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: number
          subject_id: number | null
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          id?: never
          marked_by?: number | null
          on_date: string
          period?: number | null
          school_id?: number
          section_id: number
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: number
          subject_id?: number | null
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          id?: never
          marked_by?: number | null
          on_date?: string
          period?: number | null
          school_id?: number
          section_id?: number
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: number
          subject_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_record_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_record_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      bus: {
        Row: {
          capacity: number | null
          code: string
          created_at: string
          id: number
          is_active: boolean
          registration_no: string | null
          school_id: number
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          code: string
          created_at?: string
          id?: never
          is_active?: boolean
          registration_no?: string | null
          school_id?: number
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          code?: string
          created_at?: string
          id?: never
          is_active?: boolean
          registration_no?: string | null
          school_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bus_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      bus_assignment: {
        Row: {
          academic_year_id: number
          bus_id: number
          conductor_staff_id: number | null
          created_at: string
          driver_staff_id: number | null
          id: number
          is_active: boolean
          route_id: number
          school_id: number
          updated_at: string
        }
        Insert: {
          academic_year_id: number
          bus_id: number
          conductor_staff_id?: number | null
          created_at?: string
          driver_staff_id?: number | null
          id?: never
          is_active?: boolean
          route_id: number
          school_id?: number
          updated_at?: string
        }
        Update: {
          academic_year_id?: number
          bus_id?: number
          conductor_staff_id?: number | null
          created_at?: string
          driver_staff_id?: number | null
          id?: never
          is_active?: boolean
          route_id?: number
          school_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bus_assignment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_assignment_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: false
            referencedRelation: "bus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_assignment_conductor_staff_id_fkey"
            columns: ["conductor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_assignment_driver_staff_id_fkey"
            columns: ["driver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_assignment_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_assignment_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      bus_live: {
        Row: {
          bus_id: number
          eta_seconds: number | null
          heading: number | null
          is_running: boolean
          lat: number | null
          lng: number | null
          next_stop_id: number | null
          route_id: number | null
          school_id: number
          speed_kmh: number | null
          stops_remaining: number | null
          trip_id: number | null
          updated_at: string
        }
        Insert: {
          bus_id: number
          eta_seconds?: number | null
          heading?: number | null
          is_running?: boolean
          lat?: number | null
          lng?: number | null
          next_stop_id?: number | null
          route_id?: number | null
          school_id?: number
          speed_kmh?: number | null
          stops_remaining?: number | null
          trip_id?: number | null
          updated_at?: string
        }
        Update: {
          bus_id?: number
          eta_seconds?: number | null
          heading?: number | null
          is_running?: boolean
          lat?: number | null
          lng?: number | null
          next_stop_id?: number | null
          route_id?: number | null
          school_id?: number
          speed_kmh?: number | null
          stops_remaining?: number | null
          trip_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bus_live_bus_id_fkey"
            columns: ["bus_id"]
            isOneToOne: true
            referencedRelation: "bus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_live_next_stop_id_fkey"
            columns: ["next_stop_id"]
            isOneToOne: false
            referencedRelation: "route_stop"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_live_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_live_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bus_live_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      class: {
        Row: {
          created_at: string
          id: number
          level: number
          name: string
          school_id: number
          stage: Database["public"]["Enums"]["nep_stage"]
        }
        Insert: {
          created_at?: string
          id?: never
          level: number
          name: string
          school_id?: number
          stage: Database["public"]["Enums"]["nep_stage"]
        }
        Update: {
          created_at?: string
          id?: never
          level?: number
          name?: string
          school_id?: number
          stage?: Database["public"]["Enums"]["nep_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "class_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      class_subject: {
        Row: {
          class_id: number
          school_id: number
          subject_id: number
        }
        Insert: {
          class_id: number
          school_id?: number
          subject_id: number
        }
        Update: {
          class_id?: number
          school_id?: number
          subject_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_subject_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subject_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subject_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      event: {
        Row: {
          academic_year_id: number | null
          class_id: number | null
          created_at: string
          created_by: number | null
          description: string | null
          end_date: string | null
          event_type: Database["public"]["Enums"]["event_type"]
          id: number
          remind_before_days: number
          school_id: number
          section_id: number | null
          start_date: string
          title: string
        }
        Insert: {
          academic_year_id?: number | null
          class_id?: number | null
          created_at?: string
          created_by?: number | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: never
          remind_before_days?: number
          school_id?: number
          section_id?: number | null
          start_date: string
          title: string
        }
        Update: {
          academic_year_id?: number | null
          class_id?: number | null
          created_at?: string
          created_by?: number | null
          description?: string | null
          end_date?: string | null
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: never
          remind_before_days?: number
          school_id?: number
          section_id?: number | null
          start_date?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_head: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          school_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          is_active?: boolean
          name: string
          school_id?: number
        }
        Update: {
          created_at?: string
          id?: never
          is_active?: boolean
          name?: string
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_head_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_invoice: {
        Row: {
          academic_year_id: number
          amount: number
          created_at: string
          created_by: number | null
          due_date: string
          id: number
          paid_amount: number
          school_id: number
          section_id: number | null
          status: string
          student_id: number
          title: string
        }
        Insert: {
          academic_year_id: number
          amount: number
          created_at?: string
          created_by?: number | null
          due_date: string
          id?: never
          paid_amount?: number
          school_id?: number
          section_id?: number | null
          status?: string
          student_id: number
          title: string
        }
        Update: {
          academic_year_id?: number
          amount?: number
          created_at?: string
          created_by?: number | null
          due_date?: string
          id?: never
          paid_amount?: number
          school_id?: number
          section_id?: number | null
          status?: string
          student_id?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_invoice_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_invoice_line: {
        Row: {
          amount: number
          fee_head_id: number
          id: number
          invoice_id: number
          school_id: number
        }
        Insert: {
          amount: number
          fee_head_id: number
          id?: never
          invoice_id: number
          school_id?: number
        }
        Update: {
          amount?: number
          fee_head_id?: number
          id?: never
          invoice_id?: number
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_invoice_line_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_head"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_line_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fee_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_invoice_line_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_payment: {
        Row: {
          amount: number
          created_at: string
          id: number
          invoice_id: number
          is_refund: boolean
          mode: string
          note: string | null
          paid_on: string
          receipt_no: string
          received_by: number | null
          reference: string | null
          school_id: number
          student_id: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: never
          invoice_id: number
          is_refund?: boolean
          mode: string
          note?: string | null
          paid_on?: string
          receipt_no: string
          received_by?: number | null
          reference?: string | null
          school_id?: number
          student_id: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: never
          invoice_id?: number
          is_refund?: boolean
          mode?: string
          note?: string | null
          paid_on?: string
          receipt_no?: string
          received_by?: number | null
          reference?: string | null
          school_id?: number
          student_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fee_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payment_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payment_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_payment_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structure: {
        Row: {
          academic_year_id: number
          amount: number
          class_id: number
          created_at: string
          fee_head_id: number
          id: number
          school_id: number
        }
        Insert: {
          academic_year_id: number
          amount?: number
          class_id: number
          created_at?: string
          fee_head_id: number
          id?: never
          school_id?: number
        }
        Update: {
          academic_year_id?: number
          amount?: number
          class_id?: number
          created_at?: string
          fee_head_id?: number
          id?: never
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_structure_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structure_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structure_fee_head_id_fkey"
            columns: ["fee_head_id"]
            isOneToOne: false
            referencedRelation: "fee_head"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structure_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          body: string
          created_at: string
          from_profile: string | null
          id: number
          related_announcement_id: number | null
          responded_by: number | null
          response: string | null
          school_id: number
          section_id: number
          status: Database["public"]["Enums"]["feedback_status"]
          student_id: number
          subject: string
        }
        Insert: {
          body: string
          created_at?: string
          from_profile?: string | null
          id?: never
          related_announcement_id?: number | null
          responded_by?: number | null
          response?: string | null
          school_id?: number
          section_id: number
          status?: Database["public"]["Enums"]["feedback_status"]
          student_id: number
          subject: string
        }
        Update: {
          body?: string
          created_at?: string
          from_profile?: string | null
          id?: never
          related_announcement_id?: number | null
          responded_by?: number | null
          response?: string | null
          school_id?: number
          section_id?: number
          status?: Database["public"]["Enums"]["feedback_status"]
          student_id?: number
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_from_profile_fkey"
            columns: ["from_profile"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_related_announcement_id_fkey"
            columns: ["related_announcement_id"]
            isOneToOne: false
            referencedRelation: "announcement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: number
          phone: string | null
          relation: string | null
          school_id: number
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: never
          phone?: string | null
          relation?: string | null
          school_id?: number
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: never
          phone?: string | null
          relation?: string | null
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_student: {
        Row: {
          guardian_id: number
          is_primary: boolean
          school_id: number
          student_id: number
        }
        Insert: {
          guardian_id: number
          is_primary?: boolean
          school_id?: number
          student_id: number
        }
        Update: {
          guardian_id?: number
          is_primary?: boolean
          school_id?: number
          student_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "guardian_student_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "guardian"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_student_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      homework: {
        Row: {
          academic_year_id: number
          created_at: string
          created_by: number
          due_date: string
          id: number
          instructions: string
          link_url: string | null
          max_marks: number | null
          school_id: number
          section_id: number
          subject_id: number
          title: string
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          created_by: number
          due_date: string
          id?: never
          instructions?: string
          link_url?: string | null
          max_marks?: number | null
          school_id?: number
          section_id: number
          subject_id: number
          title: string
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          created_by?: number
          due_date?: string
          id?: never
          instructions?: string
          link_url?: string | null
          max_marks?: number | null
          school_id?: number
          section_id?: number
          subject_id?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submission: {
        Row: {
          checked_at: string | null
          checked_by: number | null
          homework_id: number
          id: number
          is_late: boolean
          link_url: string | null
          marks: number | null
          note: string | null
          remark: string | null
          school_id: number
          student_id: number
          submitted_at: string
        }
        Insert: {
          checked_at?: string | null
          checked_by?: number | null
          homework_id: number
          id?: never
          is_late?: boolean
          link_url?: string | null
          marks?: number | null
          note?: string | null
          remark?: string | null
          school_id?: number
          student_id: number
          submitted_at?: string
        }
        Update: {
          checked_at?: string | null
          checked_by?: number | null
          homework_id?: number
          id?: never
          is_late?: boolean
          link_url?: string | null
          marks?: number | null
          note?: string | null
          remark?: string | null
          school_id?: number
          student_id?: number
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submission_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submission_homework_id_fkey"
            columns: ["homework_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submission_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submission_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      hpc_input: {
        Row: {
          academic_year_id: number
          competency: string
          created_at: string
          id: number
          note: string | null
          rating: number | null
          school_id: number
          source: Database["public"]["Enums"]["hpc_source"]
          student_id: number
          submitted_by: string | null
        }
        Insert: {
          academic_year_id: number
          competency: string
          created_at?: string
          id?: never
          note?: string | null
          rating?: number | null
          school_id?: number
          source: Database["public"]["Enums"]["hpc_source"]
          student_id: number
          submitted_by?: string | null
        }
        Update: {
          academic_year_id?: number
          competency?: string
          created_at?: string
          id?: never
          note?: string | null
          rating?: number | null
          school_id?: number
          source?: Database["public"]["Enums"]["hpc_source"]
          student_id?: number
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hpc_input_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hpc_input_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hpc_input_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hpc_input_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_application: {
        Row: {
          academic_year_id: number
          applied_by: string | null
          created_at: string
          decided_at: string | null
          decided_by: number | null
          decision_note: string | null
          from_date: string
          id: number
          reason: string
          school_id: number
          section_id: number
          status: Database["public"]["Enums"]["leave_status"]
          student_id: number
          to_date: string
        }
        Insert: {
          academic_year_id: number
          applied_by?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: number | null
          decision_note?: string | null
          from_date: string
          id?: never
          reason: string
          school_id?: number
          section_id: number
          status?: Database["public"]["Enums"]["leave_status"]
          student_id: number
          to_date: string
        }
        Update: {
          academic_year_id?: number
          applied_by?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: number | null
          decision_note?: string | null
          from_date?: string
          id?: never
          reason?: string
          school_id?: number
          section_id?: number
          status?: Database["public"]["Enums"]["leave_status"]
          student_id?: number
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_application_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_application_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_application_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_application_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_application_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_application_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      library_book: {
        Row: {
          accession_no: string
          added_by: number | null
          author: string
          category: string
          copies_total: number
          created_at: string
          id: number
          is_active: boolean
          isbn: string | null
          language: string | null
          publisher: string | null
          school_id: number
          shelf: string | null
          title: string
        }
        Insert: {
          accession_no: string
          added_by?: number | null
          author: string
          category: string
          copies_total?: number
          created_at?: string
          id?: never
          is_active?: boolean
          isbn?: string | null
          language?: string | null
          publisher?: string | null
          school_id?: number
          shelf?: string | null
          title: string
        }
        Update: {
          accession_no?: string
          added_by?: number | null
          author?: string
          category?: string
          copies_total?: number
          created_at?: string
          id?: never
          is_active?: boolean
          isbn?: string | null
          language?: string | null
          publisher?: string | null
          school_id?: number
          shelf?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_book_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_book_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      library_issue: {
        Row: {
          book_id: number
          created_at: string
          due_on: string
          fine_amount: number
          fine_paid: boolean
          id: number
          issued_by: number | null
          issued_on: string
          note: string | null
          returned_on: string | null
          returned_to: number | null
          school_id: number
          staff_id: number | null
          student_id: number | null
        }
        Insert: {
          book_id: number
          created_at?: string
          due_on: string
          fine_amount?: number
          fine_paid?: boolean
          id?: never
          issued_by?: number | null
          issued_on: string
          note?: string | null
          returned_on?: string | null
          returned_to?: number | null
          school_id?: number
          staff_id?: number | null
          student_id?: number | null
        }
        Update: {
          book_id?: number
          created_at?: string
          due_on?: string
          fine_amount?: number
          fine_paid?: boolean
          id?: never
          issued_by?: number | null
          issued_on?: string
          note?: string | null
          returned_on?: string | null
          returned_to?: number | null
          school_id?: number
          staff_id?: number | null
          student_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "library_issue_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "library_book"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "library_book_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_returned_to_fkey"
            columns: ["returned_to"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_issue_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      library_setting: {
        Row: {
          fine_per_day: number
          id: number
          loan_days_staff: number
          loan_days_student: number
          max_books_staff: number
          max_books_student: number
          school_id: number
          updated_at: string
        }
        Insert: {
          fine_per_day?: number
          id?: number
          loan_days_staff?: number
          loan_days_student?: number
          max_books_staff?: number
          max_books_student?: number
          school_id?: number
          updated_at?: string
        }
        Update: {
          fine_per_day?: number
          id?: number
          loan_days_staff?: number
          loan_days_student?: number
          max_books_staff?: number
          max_books_student?: number
          school_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_setting_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      mark: {
        Row: {
          assessment_id: number
          created_at: string
          entered_by: number | null
          grade: string | null
          id: number
          is_absent: boolean
          marks_obtained: number | null
          remark: string | null
          school_id: number
          student_id: number
          updated_at: string
        }
        Insert: {
          assessment_id: number
          created_at?: string
          entered_by?: number | null
          grade?: string | null
          id?: never
          is_absent?: boolean
          marks_obtained?: number | null
          remark?: string | null
          school_id?: number
          student_id: number
          updated_at?: string
        }
        Update: {
          assessment_id?: number
          created_at?: string
          entered_by?: number | null
          grade?: string | null
          id?: never
          is_absent?: boolean
          marks_obtained?: number | null
          remark?: string | null
          school_id?: number
          student_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mark_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "v_mark_detail"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "mark_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "v_student_subject_trend"
            referencedColumns: ["assessment_id"]
          },
          {
            foreignKeyName: "mark_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_report: {
        Row: {
          academic_year_id: number
          emailed_at: string | null
          generated_at: string
          id: number
          month: string
          pdf_path: string | null
          school_id: number
          section_id: number
          student_id: number
          summary: Json | null
        }
        Insert: {
          academic_year_id: number
          emailed_at?: string | null
          generated_at?: string
          id?: never
          month: string
          pdf_path?: string | null
          school_id?: number
          section_id: number
          student_id: number
          summary?: Json | null
        }
        Update: {
          academic_year_id?: number
          emailed_at?: string | null
          generated_at?: string
          id?: never
          month?: string
          pdf_path?: string | null
          school_id?: number
          section_id?: number
          student_id?: number
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_report_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_report_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      observation: {
        Row: {
          academic_year_id: number
          body: string
          category: Database["public"]["Enums"]["observation_category"]
          competency: string | null
          created_at: string
          id: number
          observed_on: string
          rating: number | null
          school_id: number
          staff_id: number
          student_id: number
          subject_id: number | null
          visible_to_guardian: boolean
        }
        Insert: {
          academic_year_id: number
          body: string
          category?: Database["public"]["Enums"]["observation_category"]
          competency?: string | null
          created_at?: string
          id?: never
          observed_on?: string
          rating?: number | null
          school_id?: number
          staff_id: number
          student_id: number
          subject_id?: number | null
          visible_to_guardian?: boolean
        }
        Update: {
          academic_year_id?: number
          body?: string
          category?: Database["public"]["Enums"]["observation_category"]
          competency?: string | null
          created_at?: string
          id?: never
          observed_on?: string
          rating?: number | null
          school_id?: number
          staff_id?: number
          student_id?: number
          subject_id?: number | null
          visible_to_guardian?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "observation_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_run: {
        Row: {
          created_at: string
          created_by: number | null
          finalised_at: string | null
          id: number
          month: string
          school_id: number
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: number | null
          finalised_at?: string | null
          id?: never
          month: string
          school_id?: number
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: number | null
          finalised_at?: string | null
          id?: never
          month?: string
          school_id?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_run_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_run_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip: {
        Row: {
          basic: number
          created_at: string
          da: number
          gross: number
          hra: number
          id: number
          lwp_deduction: number
          month: string
          net: number
          other_allowance: number
          other_deduction: number
          pf_deduction: number
          run_id: number
          school_id: number
          staff_id: number
          tax_deduction: number
          unpaid_leave_days: number
          working_days: number
        }
        Insert: {
          basic?: number
          created_at?: string
          da?: number
          gross?: number
          hra?: number
          id?: never
          lwp_deduction?: number
          month: string
          net?: number
          other_allowance?: number
          other_deduction?: number
          pf_deduction?: number
          run_id: number
          school_id?: number
          staff_id: number
          tax_deduction?: number
          unpaid_leave_days?: number
          working_days?: number
        }
        Update: {
          basic?: number
          created_at?: string
          da?: number
          gross?: number
          hra?: number
          id?: never
          lwp_deduction?: number
          month?: string
          net?: number
          other_allowance?: number
          other_deduction?: number
          pf_deduction?: number
          run_id?: number
          school_id?: number
          staff_id?: number
          tax_deduction?: number
          unpaid_leave_days?: number
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "payslip_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_owner: {
        Row: {
          created_at: string | null
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      profile: {
        Row: {
          active_campus_id: number | null
          created_at: string
          full_name: string
          guardian_id: number | null
          id: string
          locale: string
          role: Database["public"]["Enums"]["profile_role"]
          school_id: number
          staff_id: number | null
          student_id: number | null
          university_id: number | null
        }
        Insert: {
          active_campus_id?: number | null
          created_at?: string
          full_name: string
          guardian_id?: number | null
          id: string
          locale?: string
          role: Database["public"]["Enums"]["profile_role"]
          school_id: number
          staff_id?: number | null
          student_id?: number | null
          university_id?: number | null
        }
        Update: {
          active_campus_id?: number | null
          created_at?: string
          full_name?: string
          guardian_id?: number | null
          id?: string
          locale?: string
          role?: Database["public"]["Enums"]["profile_role"]
          school_id?: number
          staff_id?: number | null
          student_id?: number | null
          university_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_active_campus_id_fkey"
            columns: ["active_campus_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: true
            referencedRelation: "guardian"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "university"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion: {
        Row: {
          created_at: string
          decided_by: number | null
          from_section_id: number | null
          from_year_id: number | null
          id: number
          outcome: string
          school_id: number
          student_id: number
          to_section_id: number | null
          to_year_id: number
        }
        Insert: {
          created_at?: string
          decided_by?: number | null
          from_section_id?: number | null
          from_year_id?: number | null
          id?: never
          outcome: string
          school_id?: number
          student_id: number
          to_section_id?: number | null
          to_year_id: number
        }
        Update: {
          created_at?: string
          decided_by?: number | null
          from_section_id?: number | null
          from_year_id?: number | null
          id?: never
          outcome?: string
          school_id?: number
          student_id?: number
          to_section_id?: number | null
          to_year_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotion_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_from_section_id_fkey"
            columns: ["from_section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_from_year_id_fkey"
            columns: ["from_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_to_section_id_fkey"
            columns: ["to_section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_to_year_id_fkey"
            columns: ["to_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
        ]
      }
      route: {
        Row: {
          code: string
          created_at: string
          id: number
          is_active: boolean
          name: string
          notes: string | null
          school_id: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: never
          is_active?: boolean
          name: string
          notes?: string | null
          school_id?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: never
          is_active?: boolean
          name?: string
          notes?: string | null
          school_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      route_stop: {
        Row: {
          created_at: string
          cum_distance_m: number
          geofence_m: number
          id: number
          landmark: string | null
          lat: number
          lng: number
          name: string
          route_id: number
          sched_am: string | null
          sched_pm: string | null
          school_id: number
          seq: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          cum_distance_m?: number
          geofence_m?: number
          id?: never
          landmark?: string | null
          lat: number
          lng: number
          name: string
          route_id: number
          sched_am?: string | null
          sched_pm?: string | null
          school_id?: number
          seq: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          cum_distance_m?: number
          geofence_m?: number
          id?: never
          landmark?: string | null
          lat?: number
          lng?: number
          name?: string
          route_id?: number
          sched_am?: string | null
          sched_pm?: string | null
          school_id?: number
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_stop_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_stop_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      school: {
        Row: {
          address: string | null
          code: string | null
          created_at: string
          emblem_path: string | null
          id: number
          login_image_url: string | null
          login_video_id: string | null
          logo_url: string | null
          max_twin_messages: number | null
          max_users: number | null
          modules: Json
          module_overrides: Json
          monogram: string | null
          name: string
          place: string | null
          plan: string
          primary_color: string
          short_name: string | null
          slug: string
          status: string
          tier: string
          university_id: number | null
        }
        Insert: {
          address?: string | null
          code?: string | null
          created_at?: string
          emblem_path?: string | null
          id?: never
          login_image_url?: string | null
          login_video_id?: string | null
          logo_url?: string | null
          max_twin_messages?: number | null
          max_users?: number | null
          modules?: Json
          module_overrides?: Json
          monogram?: string | null
          name: string
          place?: string | null
          plan?: string
          primary_color?: string
          short_name?: string | null
          slug: string
          status?: string
          tier?: string
          university_id?: number | null
        }
        Update: {
          address?: string | null
          code?: string | null
          created_at?: string
          emblem_path?: string | null
          id?: never
          login_image_url?: string | null
          login_video_id?: string | null
          logo_url?: string | null
          max_twin_messages?: number | null
          max_users?: number | null
          modules?: Json
          module_overrides?: Json
          monogram?: string | null
          name?: string
          place?: string | null
          plan?: string
          primary_color?: string
          short_name?: string | null
          slug?: string
          status?: string
          tier?: string
          university_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "school_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "university"
            referencedColumns: ["id"]
          },
        ]
      }
      section: {
        Row: {
          class_id: number
          created_at: string
          id: number
          name: string
          school_id: number
        }
        Insert: {
          class_id: number
          created_at?: string
          id?: never
          name: string
          school_id?: number
        }
        Update: {
          class_id?: number
          created_at?: string
          id?: never
          name?: string
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "section_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      slippage_flag: {
        Row: {
          academic_year_id: number
          computed_at: string
          id: number
          is_active: boolean
          reason: string | null
          school_id: number
          section_id: number
          student_id: number
          subject_id: number | null
          trend_delta: number | null
          window_size: number
        }
        Insert: {
          academic_year_id: number
          computed_at?: string
          id?: never
          is_active?: boolean
          reason?: string | null
          school_id?: number
          section_id: number
          student_id: number
          subject_id?: number | null
          trend_delta?: number | null
          window_size?: number
        }
        Update: {
          academic_year_id?: number
          computed_at?: string
          id?: never
          is_active?: boolean
          reason?: string | null
          school_id?: number
          section_id?: number
          student_id?: number
          subject_id?: number | null
          trend_delta?: number | null
          window_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "slippage_flag_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slippage_flag_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slippage_flag_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slippage_flag_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slippage_flag_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          email: string | null
          employee_code: string | null
          full_name: string
          id: number
          phone: string | null
          photo_path: string | null
          role: Database["public"]["Enums"]["staff_role"]
          school_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          employee_code?: string | null
          full_name: string
          id?: never
          phone?: string | null
          photo_path?: string | null
          role: Database["public"]["Enums"]["staff_role"]
          school_id?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          employee_code?: string | null
          full_name?: string
          id?: never
          phone?: string | null
          photo_path?: string | null
          role?: Database["public"]["Enums"]["staff_role"]
          school_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave: {
        Row: {
          academic_year_id: number
          created_at: string
          days: number
          decided_at: string | null
          decided_by: number | null
          decision_note: string | null
          from_date: string
          id: number
          leave_type_id: number
          reason: string
          school_id: number
          staff_id: number
          status: string
          to_date: string
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          days: number
          decided_at?: string | null
          decided_by?: number | null
          decision_note?: string | null
          from_date: string
          id?: never
          leave_type_id: number
          reason: string
          school_id?: number
          staff_id: number
          status?: string
          to_date: string
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          days?: number
          decided_at?: string | null
          decided_by?: number | null
          decision_note?: string | null
          from_date?: string
          id?: never
          leave_type_id?: number
          reason?: string
          school_id?: number
          staff_id?: number
          status?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "staff_leave_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leave_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave_type: {
        Row: {
          code: string
          created_at: string
          days_per_year: number
          id: number
          is_paid: boolean
          name: string
          school_id: number
        }
        Insert: {
          code: string
          created_at?: string
          days_per_year?: number
          id?: never
          is_paid?: boolean
          name: string
          school_id?: number
        }
        Update: {
          code?: string
          created_at?: string
          days_per_year?: number
          id?: never
          is_paid?: boolean
          name?: string
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_type_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary: {
        Row: {
          account_last4: string | null
          bank_name: string | null
          basic: number
          da: number
          effective_from: string
          hra: number
          id: number
          other_allowance: number
          other_deduction: number
          pf_deduction: number
          school_id: number
          staff_id: number
          tax_deduction: number
          updated_at: string
          updated_by: number | null
        }
        Insert: {
          account_last4?: string | null
          bank_name?: string | null
          basic?: number
          da?: number
          effective_from?: string
          hra?: number
          id?: never
          other_allowance?: number
          other_deduction?: number
          pf_deduction?: number
          school_id?: number
          staff_id: number
          tax_deduction?: number
          updated_at?: string
          updated_by?: number | null
        }
        Update: {
          account_last4?: string | null
          bank_name?: string | null
          basic?: number
          da?: number
          effective_from?: string
          hra?: number
          id?: never
          other_allowance?: number
          other_deduction?: number
          pf_deduction?: number
          school_id?: number
          staff_id?: number
          tax_deduction?: number
          updated_at?: string
          updated_by?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: true
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      student: {
        Row: {
          admission_no: string
          created_at: string
          dob: string | null
          email: string | null
          exit_remark: string | null
          full_name: string
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: number
          left_on: string | null
          phone: string | null
          photo_path: string | null
          school_id: number
          status: string
          updated_at: string
        }
        Insert: {
          admission_no: string
          created_at?: string
          dob?: string | null
          email?: string | null
          exit_remark?: string | null
          full_name: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: never
          left_on?: string | null
          phone?: string | null
          photo_path?: string | null
          school_id?: number
          status?: string
          updated_at?: string
        }
        Update: {
          admission_no?: string
          created_at?: string
          dob?: string | null
          email?: string | null
          exit_remark?: string | null
          full_name?: string
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: never
          left_on?: string | null
          phone?: string | null
          photo_path?: string | null
          school_id?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      student_enrollment: {
        Row: {
          academic_year_id: number
          created_at: string
          id: number
          roll_no: number | null
          school_id: number
          section_id: number
          status: string
          student_id: number
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          id?: never
          roll_no?: number | null
          school_id?: number
          section_id: number
          status?: string
          student_id: number
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          id?: never
          roll_no?: number | null
          school_id?: number
          section_id?: number
          status?: string
          student_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_enrollment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollment_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_enrollment_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      student_transport: {
        Row: {
          academic_year_id: number
          created_at: string
          drop_stop_id: number
          id: number
          is_active: boolean
          pickup_stop_id: number
          route_id: number
          school_id: number
          student_id: number
          updated_at: string
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          drop_stop_id: number
          id?: never
          is_active?: boolean
          pickup_stop_id: number
          route_id: number
          school_id?: number
          student_id: number
          updated_at?: string
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          drop_stop_id?: number
          id?: never
          is_active?: boolean
          pickup_stop_id?: number
          route_id?: number
          school_id?: number
          student_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_transport_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_transport_drop_stop_id_fkey"
            columns: ["drop_stop_id"]
            isOneToOne: false
            referencedRelation: "route_stop"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_transport_pickup_stop_id_fkey"
            columns: ["pickup_stop_id"]
            isOneToOne: false
            referencedRelation: "route_stop"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_transport_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "route"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_transport_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_transport_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
        ]
      }
      subject: {
        Row: {
          code: string
          created_at: string
          id: number
          name: string
          school_id: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: never
          name: string
          school_id?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: never
          name?: string
          school_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "subject_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_allotment: {
        Row: {
          academic_year_id: number
          created_at: string
          id: number
          is_class_teacher: boolean
          school_id: number
          section_id: number
          staff_id: number
          subject_id: number | null
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          id?: never
          is_class_teacher?: boolean
          school_id?: number
          section_id: number
          staff_id: number
          subject_id?: number | null
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          id?: never
          is_class_teacher?: boolean
          school_id?: number
          section_id?: number
          staff_id?: number
          subject_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teacher_allotment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_allotment_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_allotment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_allotment_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_allotment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_period: {
        Row: {
          created_at: string
          end_time: string
          id: number
          is_break: boolean
          label: string
          period_no: number
          school_id: number
          start_time: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: never
          is_break?: boolean
          label: string
          period_no: number
          school_id?: number
          start_time: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: never
          is_break?: boolean
          label?: string
          period_no?: number
          school_id?: number
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_period_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_slot: {
        Row: {
          academic_year_id: number
          created_at: string
          day_of_week: number
          id: number
          period_no: number
          room: string | null
          school_id: number
          section_id: number
          staff_id: number | null
          subject_id: number | null
          updated_at: string
        }
        Insert: {
          academic_year_id: number
          created_at?: string
          day_of_week: number
          id?: never
          period_no: number
          room?: string | null
          school_id?: number
          section_id: number
          staff_id?: number | null
          subject_id?: number | null
          updated_at?: string
        }
        Update: {
          academic_year_id?: number
          created_at?: string
          day_of_week?: number
          id?: never
          period_no?: number
          room?: string | null
          school_id?: number
          section_id?: number
          staff_id?: number | null
          subject_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_slot_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slot_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slot_school_period_fkey"
            columns: ["school_id", "period_no"]
            isOneToOne: false
            referencedRelation: "timetable_period"
            referencedColumns: ["school_id", "period_no"]
          },
          {
            foreignKeyName: "timetable_slot_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slot_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slot_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_alert: {
        Row: {
          channel: string | null
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["transport_alert_kind"]
          payload: Json
          route_stop_id: number | null
          school_id: number
          sent_at: string | null
          student_id: number
          trip_id: number
        }
        Insert: {
          channel?: string | null
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["transport_alert_kind"]
          payload?: Json
          route_stop_id?: number | null
          school_id?: number
          sent_at?: string | null
          student_id: number
          trip_id: number
        }
        Update: {
          channel?: string | null
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["transport_alert_kind"]
          payload?: Json
          route_stop_id?: number | null
          school_id?: number
          sent_at?: string | null
          student_id?: number
          trip_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "transport_alert_route_stop_id_fkey"
            columns: ["route_stop_id"]
            isOneToOne: false
            referencedRelation: "route_stop"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_alert_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_alert_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_alert_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      trip: {
        Row: {
          bus_assignment_id: number
          created_at: string
          ended_at: string | null
          id: number
          school_id: number
          service_date: string
          shift: Database["public"]["Enums"]["trip_shift"]
          started_at: string
          started_by: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }
        Insert: {
          bus_assignment_id: number
          created_at?: string
          ended_at?: string | null
          id?: never
          school_id?: number
          service_date?: string
          shift: Database["public"]["Enums"]["trip_shift"]
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Update: {
          bus_assignment_id?: number
          created_at?: string
          ended_at?: string | null
          id?: never
          school_id?: number
          service_date?: string
          shift?: Database["public"]["Enums"]["trip_shift"]
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_bus_assignment_id_fkey"
            columns: ["bus_assignment_id"]
            isOneToOne: false
            referencedRelation: "bus_assignment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profile"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_ping: {
        Row: {
          accuracy_m: number | null
          battery_pct: number | null
          captured_at: string
          device_at: string | null
          heading: number | null
          id: number
          lat: number
          lng: number
          school_id: number
          speed_kmh: number | null
          trip_id: number
        }
        Insert: {
          accuracy_m?: number | null
          battery_pct?: number | null
          captured_at?: string
          device_at?: string | null
          heading?: number | null
          id?: never
          lat: number
          lng: number
          school_id?: number
          speed_kmh?: number | null
          trip_id: number
        }
        Update: {
          accuracy_m?: number | null
          battery_pct?: number | null
          captured_at?: string
          device_at?: string | null
          heading?: number | null
          id?: never
          lat?: number
          lng?: number
          school_id?: number
          speed_kmh?: number | null
          trip_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_ping_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_ping_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_stop_event: {
        Row: {
          at: string
          event: Database["public"]["Enums"]["stop_event_kind"]
          id: number
          is_manual: boolean
          route_stop_id: number
          school_id: number
          trip_id: number
        }
        Insert: {
          at?: string
          event: Database["public"]["Enums"]["stop_event_kind"]
          id?: never
          is_manual?: boolean
          route_stop_id: number
          school_id?: number
          trip_id: number
        }
        Update: {
          at?: string
          event?: Database["public"]["Enums"]["stop_event_kind"]
          id?: never
          is_manual?: boolean
          route_stop_id?: number
          school_id?: number
          trip_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "trip_stop_event_route_stop_id_fkey"
            columns: ["route_stop_id"]
            isOneToOne: false
            referencedRelation: "route_stop"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stop_event_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "school"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_stop_event_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trip"
            referencedColumns: ["id"]
          },
        ]
      }
      university: {
        Row: {
          created_at: string | null
          id: number
          logo_url: string | null
          modules: Json | null
          module_overrides: Json
          name: string
          plan: string | null
          primary_color: string | null
          short_name: string | null
          slug: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          logo_url?: string | null
          modules?: Json | null
          module_overrides?: Json
          name: string
          plan?: string | null
          primary_color?: string | null
          short_name?: string | null
          slug: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          logo_url?: string | null
          modules?: Json | null
          module_overrides?: Json
          name?: string
          plan?: string | null
          primary_color?: string | null
          short_name?: string | null
          slug?: string
          status?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      library_book_stock: {
        Row: {
          accession_no: string | null
          author: string | null
          category: string | null
          copies_available: number | null
          copies_out: number | null
          copies_total: number | null
          created_at: string | null
          id: number | null
          is_active: boolean | null
          isbn: string | null
          language: string | null
          publisher: string | null
          shelf: string | null
          title: string | null
        }
        Relationships: []
      }
      v_mark_detail: {
        Row: {
          academic_year_id: number | null
          assessed_on: string | null
          assessment_id: number | null
          assessment_name: string | null
          band: string | null
          class_id: number | null
          class_level: number | null
          class_name: string | null
          is_absent: boolean | null
          is_current: boolean | null
          is_numeric: boolean | null
          mark_id: number | null
          marks_obtained: number | null
          max_marks: number | null
          percent: number | null
          section_id: number | null
          section_name: string | null
          student_id: number | null
          student_name: string | null
          subject_code: string | null
          subject_id: number | null
          subject_name: string | null
          term: number | null
          type_code: string | null
          year_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
        ]
      }
      v_section_distribution: {
        Row: {
          academic_year_id: number | null
          band: string | null
          n: number | null
          section_id: number | null
          subject_id: number | null
          term: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
        ]
      }
      v_section_subject_summary: {
        Row: {
          academic_year_id: number | null
          avg_percent: number | null
          class_id: number | null
          class_level: number | null
          class_name: string | null
          max_percent: number | null
          min_percent: number | null
          n_marks: number | null
          n_students: number | null
          section_id: number | null
          section_name: string | null
          subject_code: string | null
          subject_id: number | null
          subject_name: string | null
          term: number | null
          year_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
        ]
      }
      v_student_subject_trend: {
        Row: {
          academic_year_id: number | null
          assessed_on: string | null
          assessment_id: number | null
          assessment_name: string | null
          band: string | null
          class_id: number | null
          class_level: number | null
          class_name: string | null
          delta: number | null
          is_absent: boolean | null
          is_current: boolean | null
          is_numeric: boolean | null
          mark_id: number | null
          marks_obtained: number | null
          max_marks: number | null
          percent: number | null
          prev_percent: number | null
          section_id: number | null
          section_name: string | null
          seq: number | null
          student_id: number | null
          student_name: string | null
          subject_code: string | null
          subject_id: number | null
          subject_name: string | null
          term: number | null
          type_code: string | null
          year_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_academic_year_id_fkey"
            columns: ["academic_year_id"]
            isOneToOne: false
            referencedRelation: "academic_year"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "section"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subject"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mark_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "class"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      attendance_overview: {
        Args: { p_date: string; p_year: number }
        Returns: {
          class_id: number
          class_level: number
          class_name: string
          present: number
          section_id: number
          section_name: string
          total: number
        }[]
      }
      attendance_overview_range: {
        Args: { p_end: string; p_start: string; p_year: number }
        Returns: {
          class_id: number
          class_level: number
          class_name: string
          present: number
          section_id: number
          section_name: string
          total: number
        }[]
      }
      auto_conclusions: {
        Args: { p_section: number; p_year: number }
        Returns: string[]
      }
      class_comparison: {
        Args: { p_subject: number; p_year: number }
        Returns: {
          avg_percent: number
          class_id: number
          class_level: number
          class_name: string
          n_students: number
        }[]
      }
      class_overview: {
        Args: { p_year: number }
        Returns: {
          avg_percent: number
          class_id: number
          class_level: number
          class_name: string
          students: number
        }[]
      }
      commit_promotion: {
        Args: { p_from_year: number; p_rows: Json; p_to_year: number }
        Returns: number
      }
      create_class_exam: {
        Args: {
          p_class: number
          p_date: string
          p_max: number
          p_name: string
          p_subject: number
          p_term: number
          p_type?: string
          p_year: number
        }
        Returns: number
      }
      crew_stop_rider_counts: {
        Args: { p_route: number }
        Returns: {
          afternoon_count: number
          morning_count: number
          route_stop_id: number
        }[]
      }
      current_school_id: { Args: never; Returns: number }
      current_university_id: { Args: never; Returns: number }
      drain_transport_alerts: { Args: never; Returns: string }
      end_stale_trips: { Args: never; Returns: number }
      expire_stale_alerts: { Args: never; Returns: number }
      grade_band: { Args: { pct: number }; Returns: string }
      homework_check: {
        Args: { p_marks: number; p_remark: string; p_submission: number }
        Returns: number
      }
      homework_section_sizes: {
        Args: { p_year: number }
        Returns: {
          section_id: number
          students: number
        }[]
      }
      homework_submission_counts: {
        Args: { p_ids: number[] }
        Returns: {
          checked: number
          homework_id: number
          submitted: number
        }[]
      }
      homework_submit: {
        Args: {
          p_homework: number
          p_link: string
          p_note: string
          p_student: number
        }
        Returns: number
      }
      library_categories: { Args: never; Returns: string[] }
      library_totals: {
        Args: never
        Returns: {
          copies: number
          titles: number
        }[]
      }
      needs_support: {
        Args: { p_section: number; p_threshold?: number; p_year: number }
        Returns: {
          avg_percent: number
          reason: string
          recent_trend: number
          student_id: number
          student_name: string
          weak_subjects: string
        }[]
      }
      needs_support_class: {
        Args: { p_class: number; p_threshold?: number; p_year: number }
        Returns: {
          avg_percent: number
          reason: string
          recent_trend: number
          section_name: string
          student_id: number
          student_name: string
          weak_subjects: string
        }[]
      }
      promotable_classes: {
        Args: { p_from_year: number; p_to_year: number }
        Returns: {
          class_id: number
          class_level: number
          class_name: string
          promoted: number
          students: number
        }[]
      }
      promotion_roster: {
        Args: { p_class: number; p_from_year: number; p_to_year: number }
        Returns: {
          full_name: string
          outcome: string
          roll_no: number
          section_id: number
          section_name: string
          status: string
          student_id: number
          to_section_id: number
        }[]
      }
      promotion_summary: {
        Args: { p_to_year: number }
        Returns: {
          class_id: number
          class_level: number
          class_name: string
          graduated: number
          promoted: number
          retained: number
          total: number
          transferred: number
        }[]
      }
      purge_old_pings: { Args: never; Returns: number }
      recompute_route_distances: {
        Args: { p_route: number }
        Returns: undefined
      }
      refresh_slippage_flags: {
        Args: { p_threshold?: number; p_window?: number }
        Returns: number
      }
      release_login_email: {
        Args: { p_email: string; p_keep: string }
        Returns: undefined
      }
      school_overview: {
        Args: { p_year: number }
        Returns: {
          attendance_pct: number
          avg_percent: number
          slippage: number
          students: number
        }[]
      }
      school_report_summary: {
        Args: {
          p_end?: string
          p_exam?: string
          p_start?: string
          p_year: number
        }
        Returns: {
          avg_percent: number
          present: number
          section_id: number
          student_id: number
          total: number
        }[]
      }
      section_attendance_range: {
        Args: {
          p_end: string
          p_section: number
          p_start: string
          p_year: number
        }
        Returns: {
          full_name: string
          present: number
          roll_no: number
          student_id: number
          total: number
        }[]
      }
      section_comparison: {
        Args: { p_class: number; p_subject: number; p_year: number }
        Returns: {
          avg_percent: number
          n_students: number
          section_id: number
          section_name: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      student_standing: {
        Args: { p_student: number; p_year: number }
        Returns: {
          class_avg: number
          class_rank: number
          class_size: number
          section_avg: number
          section_rank: number
          section_size: number
          student_avg: number
        }[]
      }
      top_performers: {
        Args: {
          p_limit?: number
          p_section: number
          p_subject?: number
          p_year: number
        }
        Returns: {
          avg_percent: number
          n_marks: number
          student_id: number
          student_name: string
        }[]
      }
      top_performers_class: {
        Args: {
          p_class: number
          p_limit?: number
          p_subject?: number
          p_year: number
        }
        Returns: {
          avg_percent: number
          n_marks: number
          section_name: string
          student_id: number
          student_name: string
        }[]
      }
      university_overview: {
        Args: never
        Returns: {
          campus_id: number
          campus_name: string
          slug: string
          staff: number
          status: string
          students: number
        }[]
      }
      university_school_ids: { Args: never; Returns: number[] }
      university_school_ids_university: { Args: never; Returns: number[] }
    }
    Enums: {
      announcement_scope: "school" | "class" | "section"
      attendance_status: "present" | "absent" | "late" | "leave" | "holiday"
      event_type: "holiday" | "exam" | "ptm" | "activity" | "other"
      feedback_status: "new" | "read" | "responded"
      gender_type: "male" | "female" | "other"
      hpc_source: "self" | "peer" | "parent" | "teacher"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      nep_stage: "foundational" | "preparatory" | "middle" | "senior"
      observation_category:
        | "strength"
        | "difficulty"
        | "progress"
        | "behaviour"
        | "general"
      profile_role: "student" | "guardian" | "staff"
      staff_role:
        | "subject_teacher"
        | "class_teacher"
        | "principal"
        | "office"
        | "transport"
      stop_event_kind: "approaching" | "arrived" | "departed" | "skipped"
      transport_alert_kind:
        | "trip_started"
        | "approaching"
        | "arrived"
        | "delayed"
        | "trip_ended"
      trip_shift: "morning" | "afternoon"
      trip_status: "running" | "completed" | "cancelled" | "auto_closed"
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
  public: {
    Enums: {
      announcement_scope: ["school", "class", "section"],
      attendance_status: ["present", "absent", "late", "leave", "holiday"],
      event_type: ["holiday", "exam", "ptm", "activity", "other"],
      feedback_status: ["new", "read", "responded"],
      gender_type: ["male", "female", "other"],
      hpc_source: ["self", "peer", "parent", "teacher"],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      nep_stage: ["foundational", "preparatory", "middle", "senior"],
      observation_category: [
        "strength",
        "difficulty",
        "progress",
        "behaviour",
        "general",
      ],
      profile_role: ["student", "guardian", "staff"],
      staff_role: [
        "subject_teacher",
        "class_teacher",
        "principal",
        "office",
        "transport",
      ],
      stop_event_kind: ["approaching", "arrived", "departed", "skipped"],
      transport_alert_kind: [
        "trip_started",
        "approaching",
        "arrived",
        "delayed",
        "trip_ended",
      ],
      trip_shift: ["morning", "afternoon"],
      trip_status: ["running", "completed", "cancelled", "auto_closed"],
    },
  },
} as const
