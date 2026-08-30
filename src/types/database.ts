// Hand-written to match supabase/migrations. Regenerate with:
//   supabase gen types typescript --linked > src/types/database.ts

export type UserRole = "super_admin" | "admin" | "user";
export type MemberStatus = "active" | "expired" | "suspended" | "inactive";
export type PaymentType = "registration" | "monthly_membership" | "personal_coaching" | "other";
export type PaymentStatus = "paid" | "voided" | "refunded";
export type AttendanceEvent = "entry" | "exit";
export type DeviceStatus = "online" | "offline" | "disabled";
export type BannerType = "info" | "success" | "warning" | "danger";
export type PlanStatus = "active" | "completed" | "archived";
export type EnrollmentStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export type Profile = {
  id: string;
  user_id: string;
  username: string | null;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: UserRole;
  profile_image_url: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
}

export type Member = {
  id: string;
  user_id: string | null;
  membership_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  gender: string | null;
  address: string | null;
  emergency_contact: string | null;
  profile_image_url: string | null;
  join_date: string;
  status: MemberStatus;
  membership_start: string | null;
  membership_end: string | null;
  next_payment_date: string | null;
  fingerprint_id: number | null;
  fingerprint_device_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type Payment = {
  id: string;
  member_id: string;
  payment_type: PaymentType;
  amount: number;
  currency: string;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  coach_name: string | null;
  description: string | null;
  recorded_by: string | null;
  status: PaymentStatus;
  /** Idempotency key from the recording form; null on rows written before it. */
  client_token: string | null;
  created_at: string;
  updated_at: string;
}

export type Attendance = {
  id: string;
  event_id: string;
  member_id: string | null;
  fingerprint_id: number | null;
  device_id: string | null;
  event_type: AttendanceEvent;
  occurred_at: string;
  authorized: boolean;
  denial_reason: string | null;
  offline_event: boolean;
  sync_status: string;
  created_at: string;
}

export type Device = {
  id: string;
  device_code: string;
  name: string;
  location: string | null;
  status: DeviceStatus;
  last_seen_at: string | null;
  firmware_version: string | null;
  network_status: string | null;
  pending_events: number;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkoutPlan = {
  id: string;
  member_id: string;
  title: string;
  description: string | null;
  assigned_by: string | null;
  trainer_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}

export type WorkoutExercise = {
  id: string;
  workout_plan_id: string;
  day: string;
  exercise_name: string;
  sets: number | null;
  reps: string | null;
  duration: string | null;
  weight: string | null;
  notes: string | null;
  sort_order: number;
}

export type MealPlan = {
  id: string;
  member_id: string;
  title: string;
  description: string | null;
  assigned_by: string | null;
  start_date: string | null;
  end_date: string | null;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}

export type MealPlanItem = {
  id: string;
  meal_plan_id: string;
  day: string;
  meal_type: string;
  description: string;
  calories: number | null;
  notes: string | null;
  sort_order: number;
}

export type BroadcastMessage = {
  id: string;
  title: string;
  message: string;
  banner_type: BannerType;
  priority: number;
  dismissible: boolean;
  is_active: boolean;
  archived_at: string | null;
  start_at: string;
  end_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type GymSettings = {
  id: string;
  gym_name: string;
  logo_path: string | null;
  whatsapp_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  monthly_membership_fee: number;
  registration_fee: number;
  currency: string;
  scan_cooldown_seconds: number;
  updated_by: string | null;
  updated_at: string;
}

export type AuditLog = {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export type EnrollmentRequest = {
  id: string;
  member_id: string;
  device_id: string;
  status: EnrollmentStatus;
  fingerprint_id: number | null;
  error_message: string | null;
  requested_by: string | null;
  expires_at: string;
  progress_step: number;
  progress_total: number;
  progress_message: string | null;
  created_at: string;
  updated_at: string;
}

export type DashboardStats = {
  total_members: number;
  active_members: number;
  expired_members: number;
  suspended_members: number;
  today_attendance: number;
  today_entries: number;
  today_exits: number;
  devices_online: number;
  devices_offline: number;
  pending_sync: number;
  today_revenue: number;
  month_revenue: number;
  due_this_week: number;
}

// supabase-js requires each table to expose Row/Insert/Update *and* Relationships;
// without the last one the generic collapses to `never` at every call site.
type Row<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};

type Fn<A, R> = { Args: A; Returns: R };

export interface Database {
  public: {
    Tables: {
      profiles: Row<Profile>;
      members: Row<Member>;
      payments: Row<Payment>;
      attendance: Row<Attendance>;
      devices: Row<Device>;
      workout_plans: Row<WorkoutPlan>;
      workout_exercises: Row<WorkoutExercise>;
      meal_plans: Row<MealPlan>;
      meal_plan_items: Row<MealPlanItem>;
      broadcast_messages: Row<BroadcastMessage>;
      gym_settings: Row<GymSettings>;
      audit_logs: Row<AuditLog>;
      enrollment_requests: Row<EnrollmentRequest>;
      financial_audit_logs: Row<FinancialAuditLog>;
      memberships: Row<Membership>;
      workout_files: Row<WorkoutFile>;
    };
    Views: Record<string, never>;
    Functions: {
      dashboard_stats: Fn<Record<string, never>, DashboardStats>;
      attendance_trend: Fn<{ p_days?: number }, { day: string; entries: number; exits: number }[]>;
      financial_report: Fn<{ p_from: string; p_to: string }, FinancialReport>;
      revenue_trend: Fn<{ p_from: string; p_to: string }, { day: string; total: number }[]>;
      search_members: Fn<{ p_query: string; p_limit?: number }, Member[]>;
      next_membership_id: Fn<Record<string, never>, string>;
      member_access_decision: Fn<
        { p_member_id: string },
        { allowed: boolean; reason: string }[]
      >;
      expire_stale_enrollments: Fn<Record<string, never>, number>;
      claim_membership: Fn<
        { p_membership_id: string; p_full_name: string; p_phone: string },
        { status: string; member_id?: string }
      >;
      change_member_status: Fn<
        { p_member_id: string; p_status: MemberStatus; p_reason: string },
        { previous: MemberStatus; current: MemberStatus }
      >;
      void_payment: Fn<
        { p_payment_id: string; p_status: PaymentStatus; p_reason: string },
        { member_id: string }
      >;
      set_user_role: Fn<{ p_profile_id: string; p_role: UserRole }, { role: UserRole }>;
      set_profile_active: Fn<
        { p_profile_id: string; p_is_active: boolean },
        { is_active: boolean }
      >;
      update_own_member_profile: Fn<
        {
          p_full_name: string;
          p_phone: string;
          p_address?: string | null;
          p_profile_image_url?: string | null;
        },
        { member_id: string }
      >;
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Membership = {
  id: string;
  member_id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  amount: number | null;
  status: string;
  created_at: string;
}

export type FinancialAuditLog = {
  id: string;
  payment_id: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  performed_by: string | null;
  reason: string | null;
  created_at: string;
}

export type WorkoutFile = {
  id: string;
  workout_plan_id: string;
  file_path: string;
  file_type: string | null;
  created_at: string;
}

export type FinancialReport = {
  from: string;
  to: string;
  total: number;
  by_type: Partial<Record<PaymentType, number>>;
}
