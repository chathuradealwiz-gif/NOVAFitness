# Gym Management System — Claude Build Specification

## Goal
Build a production-ready gym management and biometric attendance/access system for ~200 daily users.

Hardware:
- ESP32-S3 DevKitC-1 N16R8
- R503Pro fingerprint sensor
- SIMCom A7670C FS-MCore 4G LTE
- 2.8" 240x320 ILI9341 SPI TFT resistive touchscreen
- 12V solenoid/electric lock + relay
- KY-025/reed door sensor
- buzzer
- physical emergency/manual exit hardware

## Architecture

```text
Fingerprint/TFT/Door Hardware
          |
       ESP32-S3
          |
       A7670C 4G
          |
       HTTPS
          |
Supabase Edge Functions
          |
Supabase PostgreSQL
          |
Next.js Web App
          |
        Vercel
```

**Never connect the ESP32 directly to PostgreSQL. Never put the Supabase service-role key on the ESP32.**


## Authentication and Role Model — UPDATED

The application has **three roles**:

```text
super_admin
admin
user
```

### Authentication rules

There are two authentication methods:

1. **Super Admin:** username + password
2. **Admin/User:** Supabase Magic Link authentication

### Super Admin

Create one initial Super Admin account for development/bootstrap:

```text
Username: nuwan
Password: 1234
Role: super_admin
```

**IMPORTANT:** `1234` is a temporary development password only. Do NOT hard-code this credential in frontend source code, Git, ESP32 firmware, or production configuration.

For production:
- Store the Super Admin credential securely.
- Force a password change on first login.
- Hash passwords if a custom username/password authentication layer is implemented.
- Prefer Supabase Auth for the actual identity and use a secure username/profile mapping.
- Put any bootstrap/admin secret in secure environment variables or Supabase secrets.
- Never expose the password to ordinary users.

The Super Admin has complete control over the system.

### Super Admin permissions

Super Admin can:

- Access all dashboard sections
- Create admins
- Disable/delete admins
- Create/deactivate members
- Manage memberships
- Manage fingerprints
- View all attendance
- Manage devices
- Configure gym settings
- View system logs
- Manage roles
- Reset/revoke access
- Manage other administrative permissions

### Admin authentication

Admins must authenticate using **Supabase Magic Link**.

Flow:

```text
Admin enters email
        ↓
Supabase Auth sends Magic Link
        ↓
Admin clicks link
        ↓
Supabase session created
        ↓
Backend checks profile.role
        ↓
role = admin
        ↓
Admin dashboard
```

Do not use passwords for ordinary Admin accounts unless explicitly enabled later.

### Member/User authentication

Members use the same Magic Link approach:

```text
Member enters registered email
        ↓
Supabase Magic Link
        ↓
User clicks link
        ↓
Supabase session
        ↓
Backend checks profile.role
        ↓
role = user
        ↓
Member dashboard
```

A member can only see their own profile, membership and attendance.

### Role enforcement

Never rely only on frontend route protection.

Enforce roles at:

1. Frontend UI
2. Edge Functions
3. PostgreSQL Row Level Security

Example:

```text
super_admin
    ↓
full system access

admin
    ↓
management access

user
    ↓
own data only
```

### Supabase Auth implementation

Use Supabase Auth for Magic Link users.

Recommended profile structure:

```text
profiles
---------
id UUID PK
user_id UUID UNIQUE
full_name
email
role
is_active
created_at
updated_at
```

Roles:

```text
super_admin
admin
user
```

The frontend should obtain the authenticated user's Supabase session and role from a secure profile query.

Edge Functions must verify the JWT before performing protected operations.

### Super Admin bootstrap

Do not create a separate insecure plaintext password table.

Prefer this bootstrap process:

```text
Supabase Auth user
       ↓
secure identity
       ↓
profiles.role = super_admin
       ↓
username = nuwan
```

If the requirement is specifically that the Super Admin logs in using `nuwan` instead of an email, implement a secure server-side username-to-auth-identity lookup through an Edge Function.

Never send the Super Admin password to the browser or store it in client-side code.

### Login UI

The login screen should support:

```text
GYM MANAGEMENT SYSTEM

Email
[_____________________]

[ Send Magic Link ]

---------------------

Super Admin
[ Username ]
[ Password ]

[ Super Admin Login ]
```

Do not show Super Admin credentials anywhere in the UI.

For normal Admin/User login, only show the Magic Link form.

### Session handling

Implement:

- Supabase Auth session
- automatic session refresh
- logout
- protected routes
- role-based redirects
- inactive-account handling

Redirect rules:

```text
super_admin → /dashboard
admin       → /dashboard
user        → /member
```

If an account is inactive:

```text
Access Denied
Please contact the gym administrator.
```

### Security requirements for the Super Admin

The provided development credential:

```text
nuwan / 1234
```

must be treated as a **bootstrap credential only**.

Before production deployment:

- change the password
- enable a strong password
- preferably add MFA
- never commit the credential to Git
- never place it in `.env` files that are committed
- never put it in ESP32 firmware
- never expose it through an API response
- never display it in the dashboard


## Roles

### Admin
Authenticated through Magic Link. Can:
- log in
- manage members
- create/edit/deactivate members
- renew memberships
- enroll/remove/reassign fingerprints
- view/filter/export attendance
- view dashboard statistics
- view device status and synchronization
- manage gym settings

### User/Member
Authenticated through Magic Link. Can:
- log in if member accounts are enabled
- view own profile
- view own membership
- view own attendance

Members must never access admin data or other members.

## Database

Use Supabase PostgreSQL + Auth + RLS + Edge Functions.

Recommended tables:

### profiles
```text
id UUID PK
user_id UUID
full_name
email
phone
role: admin | user
created_at
updated_at
```

### members
```text
id UUID PK
member_code
full_name
email
phone
date_of_birth
gender
address
join_date
membership_start
membership_end
status: active | expired | suspended | inactive
fingerprint_id
created_at
updated_at
```

### memberships
```text
id UUID PK
member_id UUID
plan_name
start_date
end_date
amount
status
created_at
```

### attendance
```text
id UUID PK
event_id UNIQUE
member_id UUID
fingerprint_id
device_id
event_type: entry | exit
timestamp
sync_status
created_at
```

### devices
```text
id UUID PK
device_code UNIQUE
name
location
status
last_seen_at
firmware_version
created_at
updated_at
```

Do not store raw fingerprint templates/images in PostgreSQL. The R503Pro should manage its fingerprint templates; PostgreSQL stores the mapping between `fingerprint_id` and `member_id`.

Add indexes on fingerprint_id, member status, membership_end, attendance timestamp/member/device, and device heartbeat.

## Fingerprint Enrollment

```text
Admin creates member
 -> choose Enroll Fingerprint
 -> device enters enrollment mode
 -> member scans finger
 -> R503Pro creates local template
 -> fingerprint_id returned
 -> backend associates fingerprint_id with member_id
```

When a member leaves:
- deactivate the member
- remove/reuse the fingerprint slot
- retain historical attendance

## Attendance / Door Flow

```text
Scan finger
 -> R503Pro identifies fingerprint
 -> ESP32 determines fingerprint_id
 -> verify member/membership
 -> valid: unlock relay/lock
 -> door sensor confirms opening
 -> record attendance
 -> send event to Edge Function
```

Invalid/expired:
```text
ACCESS DENIED
Membership Expired / Fingerprint Not Registered
```

Valid:
```text
ACCESS GRANTED
Welcome, Member
Membership Active
Door Unlocking...
```

Do not create duplicate events from repeated scans within a configurable cooldown window.

## Offline Operation

The physical terminal must continue basic operation when 4G/Supabase is unavailable.

```text
Fingerprint
 -> local authorization/cache
 -> unlock if valid
 -> save attendance locally
 -> Internet returns
 -> synchronize queue
```

Use unique `event_id` values and idempotent Edge Functions so queued events cannot be duplicated.

## ESP32 Responsibilities

ESP32-S3 is the local controller for:
- R503Pro UART
- TFT SPI/touch
- A7670C UART
- relay
- door sensor
- buzzer
- local queue/storage
- device heartbeat
- offline synchronization

Do not store privileged cloud credentials on the device.

Use device-specific authentication/credentials and HTTPS.

## TFT UI

Main:
```text
GYM ACCESS
SCAN FINGER

[ ADMIN ]
[ HELP ]

4G ONLINE
```

Success:
```text
ACCESS GRANTED
Welcome, Member
Membership Active
Door Unlocking...
```

Failure:
```text
ACCESS DENIED
Membership Expired
Please contact reception.
```

Admin menu:
```text
[ Enroll Finger ]
[ Remove Finger ]
[ Device Status ]
[ Network Status ]
[ Sync Status ]
[ Restart Device ]
```

Protect admin functions with authentication/PIN.

## Supabase Edge Functions

Implement secure functions such as:
```text
attendance
device-heartbeat
device-sync
member-lookup
fingerprint-assignment
admin-members
admin-attendance
```

Example:
```http
POST /functions/v1/attendance
```

Example payload:
```json
{
  "device_id": "GYM-001",
  "event_id": "unique-event-id",
  "fingerprint_id": 37,
  "event_type": "entry",
  "timestamp": "2026-08-16T14:30:00Z"
}
```

Validate device, event, fingerprint/member, membership and duplicate state server-side.

## Web Application

Use:
- Next.js
- TypeScript
- Tailwind CSS
- responsive UI
- Supabase Auth
- clean component architecture
- Vercel-compatible deployment

Pages:
```text
/login
/dashboard
/dashboard/members
/dashboard/members/[id]
/dashboard/attendance
/dashboard/memberships
/dashboard/devices
/dashboard/settings
```

Dashboard should show:
- total members
- active members
- expired members
- today's attendance
- entry/exit counts
- attendance trends
- online/offline devices
- pending synchronization

Members:
- search/filter
- add/edit/deactivate
- renew membership
- enroll/remove fingerprint

Attendance:
- date filters
- member filters
- entry/exit filters
- pagination
- CSV export

Device page:
- online/offline
- last heartbeat
- firmware
- 4G status
- last synchronization
- pending events

Member dashboard:
- own profile
- membership status/expiry
- own attendance only

## Security

Use:
- Supabase Auth
- Row Level Security
- role-based authorization
- Edge Function validation
- HTTPS
- input validation
- rate limiting where useful
- device authentication
- environment variables
- no secrets in Git
- no service-role key in frontend or ESP32

Members must only query their own records.

## Vercel Free Hosting

Design the frontend to avoid unnecessary server workloads:
- use Supabase/Edge Functions for backend work
- paginate large queries
- aggregate dashboard statistics
- avoid excessive polling
- keep device traffic off Vercel where possible
- use Vercel mainly for the Next.js frontend

## Suggested Repository

```text
gym-management/
  app/
    login/
    dashboard/
      members/
      attendance/
      memberships/
      devices/
      settings/
  components/
  lib/
    api/
    auth/
    supabase/
    validation/
  types/
  supabase/
    migrations/
    functions/
  firmware/
    src/
      main.cpp
      fingerprint/
      display/
      cellular/
      attendance/
      door/
      network/
      storage/
      security/
      config/
```

## Development Stages

1. Create Supabase schema and RLS.
2. Implement authentication and roles.
3. Build admin/member frontend.
4. Implement Edge Functions.
5. Test ESP32 + TFT.
6. Integrate R503Pro.
7. Integrate relay/door sensor/lock.
8. Integrate A7670C 4G.
9. Implement attendance synchronization.
10. Implement offline queue.
11. Security testing.
12. Deploy to Vercel/Supabase.
13. Build soldered electronics and 3D enclosure.

Do not build everything at once. Verify each stage before continuing.

## Hardware Safety

The prototype may use a 12V solenoid + relay. For a real public gym entrance, use a commercially rated access-control lock and proper emergency egress/release hardware.

The emergency exit mechanism must not depend on:
- Internet
- Vercel
- Supabase
- A7670C
- ESP32 software

## Final UX

Member arrives:
```text
GYM ACCESS
SCAN FINGER
```

Valid:
```text
ACCESS GRANTED
Welcome, John
Membership Active
Expires: 30 Sep
DOOR UNLOCKING...
```

Expired:
```text
ACCESS DENIED
Membership Expired
Please contact reception.
```

Unknown:
```text
ACCESS DENIED
Fingerprint Not Registered
```

Offline:
```text
ACCESS GRANTED
Offline Mode
Attendance Saved
Will Sync Automatically
```

## Claude Instructions

Use this document as the master product/technical specification.

Priorities:
1. Reliability of physical access control
2. Security
3. Offline operation
4. Correct fingerprint/member mapping
5. Clean admin UX
6. Simple Vercel + Supabase deployment
7. Maintainable TypeScript/ESP32 code

Do not hard-code credentials.
Do not expose PostgreSQL directly to the ESP32.
Do not store raw biometric data unnecessarily.
Do not remove historical attendance when a member leaves.
Do not rely on cloud connectivity for emergency egress.

Provide:
- source code
- SQL migrations
- RLS policies
- Edge Functions
- ESP32 firmware
- API documentation
- environment variable example
- local setup guide
- Vercel deployment guide
- Supabase deployment guide
- device setup/enrollment guide
- testing plan
- security checklist


# NOVA FITNESS — Additional Product Requirements

## 36. Brand and Visual Design

The gym name is:

**NOVA FITNESS**

Use the uploaded NOVA FITNESS logo as the primary brand asset.

The application theme must be:

- Black
- Red
- White/light text
- Dark cards and surfaces
- Red used for primary actions, active states and important highlights
- High contrast
- Premium fitness/gym aesthetic

Do not use a generic blue SaaS theme.

The logo should be placed in:

- Login page
- Admin dashboard
- Member dashboard
- Mobile navigation
- Physical-device UI where appropriate

Make the branding configurable so the uploaded logo can be replaced later without changing application code.

---

# 37. Mobile-First Requirement

The majority of NOVA FITNESS members will use the application from mobile phones.

The member dashboard must therefore be designed **mobile-first**, not desktop-first.

Priorities:

1. Mobile phone
2. Tablet
3. Desktop

Use:

- responsive cards
- bottom navigation or compact mobile navigation
- large touch targets
- simple forms
- readable typography
- sticky important actions
- optimized images
- fast loading
- minimal unnecessary animations

Member pages should work comfortably on common 360px–430px wide phone screens.

The admin dashboard can have a more information-dense desktop layout, but it must remain responsive.

---

# 38. Profile Pictures

Members can upload a profile picture.

Use:

**Supabase Storage Bucket**

Suggested bucket:

```text
profile-images
```

Store only the storage path/URL reference in PostgreSQL.

Example:

```text
profiles.profile_image_url
```

Recommended behavior:

```text
Member
  ↓
Choose profile picture
  ↓
Client-side validation
  ↓
Compress/resize image
  ↓
Upload to Supabase Storage
  ↓
Save storage path
```

Requirements:

- validate file type
- validate file size
- resize large images
- use secure storage policies
- users can update their own profile image
- admins can view member profile images
- users cannot access another user's private data

Use an appropriate public/private bucket strategy. If the images are private, use signed URLs.

---

# 39. Gym Membership ID vs Fingerprint ID

This is a critical business requirement.

NOVA FITNESS already has its own **Gym Membership ID**.

The R503Pro generates/uses a completely different **fingerprint template ID**.

These must NOT be treated as the same identifier.

Example:

```text
NOVA Membership ID:
NOVA-00125

Fingerprint Sensor ID:
37
```

Database relationship:

```text
member_id
    |
    +-- membership_id = NOVA-00125
    |
    +-- fingerprint_id = 37
```

The fingerprint ID is a device-local biometric slot.

The NOVA Membership ID is the gym's business identifier.

Never expose fingerprint IDs as the member's official gym ID.

Recommended database fields:

```text
members.id                  UUID
members.membership_id      TEXT UNIQUE
members.fingerprint_id      INTEGER
members.fingerprint_device_id UUID
```

If multiple fingerprint devices are added later, the fingerprint mapping must also identify the device.

---

# 40. Member Signup Flow

Members authenticate using **Magic Link**.

However, authentication alone is not enough.

First-time signup:

```text
Member enters email
       ↓
Magic Link sent
       ↓
Member clicks Magic Link
       ↓
Supabase Auth session
       ↓
First-time profile setup
       ↓
Enter:
- Full Name
- NOVA Membership ID
- Mobile Number
- Profile Picture
       ↓
Validate Membership ID
       ↓
Create/complete member profile
       ↓
Member dashboard
```

Required fields:

```text
Full Name
NOVA Membership ID
Mobile Number
Email
```

Optional:

```text
Profile Picture
Date of Birth
Gender
Address
Emergency Contact
```

If the membership ID already exists, do not create a duplicate member.

---

# 41. Membership Status Management

Allowed membership statuses:

```text
active
expired
suspended
inactive
```

Super Admin and Admin can search a member by:

- NOVA Membership ID
- Name
- Mobile number
- Email
- Fingerprint ID

Admin/Super Admin can manually change:

```text
Active
Expired
Suspended
Inactive
```

Require confirmation before changing status.

Record every manual status change in an audit log.

Example:

```text
Member: NOVA-00125
Previous: expired
New: active
Changed by: Admin
Reason: Monthly payment received
Timestamp: ...
```

---

# 42. Monthly Membership Payment

NOVA FITNESS operates on a monthly membership model.

Members pay the gym directly/offline.

The application must record those payments.

The system must NOT require online payment processing for the current version.

Payment workflow:

```text
Member pays money to gym
       ↓
Admin/Super Admin opens member
       ↓
Record Payment
       ↓
Select payment type
       ↓
Enter amount
       ↓
Enter payment date
       ↓
System calculates membership period
       ↓
Membership becomes/re-mains ACTIVE
       ↓
Next payment date calculated
```

For a normal monthly payment:

```text
Payment date: 16 Aug 2026
Period start: 16 Aug 2026
Period end: 15 Sep 2026
Next payment date: 16 Sep 2026
```

Do not blindly add 30 days where calendar-month behavior is expected. Implement a clear monthly-period rule and document it.

---

# 43. Payment Types

The system must support at least:

```text
registration
monthly_membership
personal_coaching
other
```

Example:

### Registration payment

When a new member joins:

```text
Registration Fee
Amount: LKR X
```

### Monthly membership

```text
Monthly Membership
Amount: LKR X
Period: Aug 16 – Sep 15
```

### Personal coaching

```text
Personal Coaching
Amount: LKR X
Coach: Coach Name
Period: ...
```

Personal coaching is an additional paid service and must be recorded separately from the basic gym membership.

---

# 44. Payment Database

Create a payments table:

```text
payments
---------
id UUID PK
member_id UUID
payment_type
amount
currency
payment_date
period_start
period_end
description
recorded_by
status
created_at
updated_at
```

Payment status can include:

```text
paid
voided
refunded
```

Do not delete financial records.

If a payment was entered incorrectly, use a correction/void/audit process.

---

# 45. Membership Reactivation

When a member is expired and the monthly payment is received:

```text
Expired member
      ↓
Admin records monthly payment
      ↓
Payment period created
      ↓
Member status → ACTIVE
      ↓
Next payment date calculated
      ↓
Fingerprint access becomes authorized
```

Do not reactivate a member merely because an admin changes a status unless the business process explicitly requires it.

Payment history should be the source of truth for paid membership periods.

Manual status override can still exist for Admin/Super Admin, but the system should record the reason.

---

# 46. Member Dashboard — Payment Information

Members should see:

```text
Membership
----------------
Status: ACTIVE

Current Plan
Monthly Membership

Current Period
16 Aug 2026
to
15 Sep 2026

Next Payment
16 Sep 2026

Monthly Fee
LKR X
```

Payment history:

```text
Date         Type                 Amount
16 Aug       Monthly Membership  LKR X
16 Jul       Monthly Membership  LKR X
16 Jun       Monthly Membership  LKR X
```

Members should not see internal financial/admin information belonging to other members.

---

# 47. Financial Dashboard

Super Admin and Admin must have a financial section.

Dashboard metrics:

```text
Today's Revenue
This Month Revenue
Registration Revenue
Membership Revenue
Personal Coaching Revenue
Other Revenue
Outstanding/Expired Members
```

Monthly report:

```text
MONTHLY FINANCIAL REPORT

Month: August 2026

Registration:
LKR X

Membership:
LKR X

Personal Coaching:
LKR X

Other:
LKR X

TOTAL:
LKR X
```

Include:

- date filters
- payment type filters
- member filters
- payment status
- monthly aggregation
- CSV export
- printable/report-friendly view

---

# 48. Financial Permissions

### Super Admin

Can:

- view all financial records
- record payments
- edit/correct payment records through controlled workflow
- void payments
- view monthly reports
- export reports

### Admin

Can:

- record member payments
- view relevant financial records
- view monthly reports
- record registration/monthly/coaching payments

If the gym later wants stricter financial controls, permissions should be configurable.

### User

Cannot:

- view gym-wide financial reports
- edit payment records
- view other members' payments

---

# 49. Financial Audit Log

Create:

```text
financial_audit_logs
--------------------
id
payment_id
action
old_value
new_value
performed_by
reason
created_at
```

Actions:

```text
created
updated
voided
refunded
```

This is important because Admins manually record cash payments.

---

# 50. Workout Plans

Admins and Super Admins can upload/create workout plans for individual members.

A member can have a personalized workout plan.

Example:

```text
WORKOUT PLAN

Member:
NOVA-00125

Plan:
Weight Loss — Beginner

Monday
- Treadmill 20 min
- Squats 3 × 12
- Leg Press 3 × 10

Tuesday
- Rest

Wednesday
- Bench Press 3 × 10
- Lat Pulldown 3 × 12
```

Support:

- workout plan title
- description
- assigned date
- start date
- end date
- trainer/coach
- exercises
- sets
- reps
- weight
- duration
- notes

---

# 51. Workout Plan Storage

For structured workout plans, prefer PostgreSQL records.

For uploaded PDFs/images/videos/documents, use Supabase Storage.

Suggested tables:

```text
workout_plans
-------------
id
member_id
title
description
assigned_by
start_date
end_date
status
created_at
updated_at
```

```text
workout_exercises
------------------
id
workout_plan_id
day
exercise_name
sets
reps
duration
weight
notes
sort_order
```

Optional uploaded resources:

```text
workout_files
-------------
id
workout_plan_id
file_path
file_type
created_at
```

---

# 52. Meal Plans

Admins/Super Admins can assign meal plans to individual members.

Example:

```text
MEAL PLAN

Breakfast
- Eggs
- Oats
- Fruit

Lunch
- Rice
- Chicken
- Vegetables

Snack
- Yogurt
- Fruit

Dinner
- Protein
- Vegetables
```

Suggested tables:

```text
meal_plans
----------
id
member_id
title
description
assigned_by
start_date
end_date
status
created_at
updated_at
```

```text
meal_plan_items
---------------
id
meal_plan_id
day
meal_type
description
calories
notes
sort_order
```

Do not present medical/dietary claims. Meal plans are gym-provided plans and should be editable by authorized staff.

---

# 53. Member Dashboard — Workout and Meal Plans

The mobile member dashboard should prominently show:

```text
WELCOME, JOHN

┌──────────────────────────┐
│ MEMBERSHIP               │
│ ACTIVE                   │
│ Next Payment: Sep 16     │
└──────────────────────────┘

┌──────────────────────────┐
│ TODAY'S WORKOUT          │
│                          │
│ Squats       3 × 12      │
│ Leg Press    3 × 10      │
│ Treadmill    20 min      │
│                          │
│ [ View Full Plan ]       │
└──────────────────────────┘

┌──────────────────────────┐
│ TODAY'S MEAL PLAN        │
│                          │
│ Breakfast                │
│ Lunch                    │
│ Dinner                   │
│                          │
│ [ View Full Plan ]       │
└──────────────────────────┘
```

---

# 54. WhatsApp Contact

The member dashboard must contain a visible WhatsApp contact button.

Example:

```text
[ WhatsApp Us ]
```

When clicked:

```text
WhatsApp
   ↓
External WhatsApp application/site
```

The WhatsApp URL must be configurable through Admin/Super Admin settings.

Do not hard-code the final WhatsApp account until the gym provides the official number/link.

Recommended setting:

```text
gym_settings.whatsapp_url
```

The user will provide the final WhatsApp link later.

---

# 55. Mobile Navigation

Member mobile navigation should prioritize:

```text
Home
Attendance
Workout
Meal Plan
Profile
```

Potential additional item:

```text
Payments
```

Admin mobile navigation can use:

```text
Dashboard
Members
Attendance
Payments
More
```

Use a bottom navigation or compact mobile menu.

---

# 56. Broadcast Messages / Notification Banner

NOVA FITNESS needs a way to display announcements to members.

Admins and Super Admins can create broadcast messages.

Example:

```text
⚠️ GYM NOTICE

The gym will be closed on Sunday
for maintenance.

[ Dismiss ]
```

The notification can appear as a banner at the top of the member dashboard.

---

# 57. Broadcast Message Database

Create:

```text
broadcast_messages
-------------------
id UUID PK
title
message
banner_type
priority
is_active
start_at
end_at
created_by
created_at
updated_at
```

Banner types:

```text
info
success
warning
danger
```

Admin can:

- create
- edit
- activate
- deactivate
- schedule
- delete/archive

Prefer soft deletion/archive for historical records.

---

# 58. Broadcast Behavior

If:

```text
start_at <= current time
AND
end_at >= current time
AND
is_active = true
```

show the banner.

Allow members to dismiss it locally.

For important messages, support:

```text
dismissible = false
```

Do not create unnecessary push-notification infrastructure for the first version.

The dashboard banner is sufficient.

---

# 59. Member Search

Admin and Super Admin must have a fast global member search.

Primary search:

```text
NOVA Membership ID
```

Also support:

```text
Name
Phone
Email
Fingerprint ID
```

Example:

```text
Search: NOVA-00125

→ John Perera
→ Active
→ Fingerprint ID: 37
→ Next Payment: 16 Sep
```

The Membership ID must be clearly displayed as the official gym identifier.

---

# 60. Fingerprint Synchronization

Maintain explicit mapping:

```text
NOVA Membership ID
        ↓
Member UUID
        ↓
Fingerprint Device ID
        ↓
Fingerprint Template ID
```

Example:

```text
NOVA-00125
   ↓
UUID: ...
   ↓
GYM-DEVICE-001
   ↓
Fingerprint ID: 37
```

If a fingerprint is removed:

```text
fingerprint_id = NULL
```

The member record remains.

If the sensor ID is reused for a new member, the old association must be removed before assigning the new member.

---

# 61. Payment + Fingerprint Access

Access authorization should depend on membership status/paid period.

Example:

```text
Monthly payment recorded
        ↓
Membership period active
        ↓
Member status ACTIVE
        ↓
Fingerprint authorized
```

When the membership expires:

```text
Membership period expired
        ↓
Access denied
```

The system should not delete the fingerprint template automatically just because membership expired.

The fingerprint can remain associated with the member but authorization should be denied.

When payment is received again:

```text
Payment recorded
        ↓
New active membership period
        ↓
Access automatically authorized
```

This makes reactivation easy.

---

# 62. Registration + Membership + Coaching Financial Model

A member may have:

```text
Registration payment
+
Monthly membership payments
+
Personal coaching payments
+
Other payments
```

Example:

```text
Member: NOVA-00125

Registration       LKR 5,000
August Membership  LKR 4,000
Personal Coaching  LKR 8,000

Total              LKR 17,000
```

These must remain separate payment records.

Do not overwrite the member's monthly fee when a coaching payment is recorded.

---

# 63. Monthly Financial Report

Admin dashboard should include:

```text
Financial Overview

August 2026

Total Revenue
LKR 450,000

Registration
LKR 50,000

Membership
LKR 300,000

Personal Coaching
LKR 90,000

Other
LKR 10,000
```

Charts:

- monthly revenue
- revenue by payment type
- daily revenue
- membership revenue trend

Tables:

```text
Date
Member ID
Member Name
Payment Type
Amount
Recorded By
Status
```

Allow:

```text
CSV Export
Print Report
```

---

# 64. Admin Member Profile

Admin member detail page should contain:

```text
NOVA FITNESS

Member Profile

[Profile Image]

NOVA Membership ID: NOVA-00125
Name: John Perera
Phone: 07XXXXXXXX
Email: john@email.com

Status:
[ ACTIVE ]

Membership:
Monthly

Current Period:
16 Aug → 15 Sep

Next Payment:
16 Sep

Fingerprint:
Device GYM-001
Fingerprint ID 37

--------------------------------

[ Record Payment ]
[ Enroll Fingerprint ]
[ Remove Fingerprint ]
[ Edit Member ]
[ Assign Workout ]
[ Assign Meal Plan ]
[ Attendance ]
[ Payment History ]
```

---

# 65. Super Admin Dashboard

Super Admin should have additional system controls:

```text
System Overview
Administrators
Members
Payments
Financial Reports
Attendance
Devices
Broadcast Messages
Workout Plans
Meal Plans
Gym Settings
Audit Logs
```

The Super Admin can manage Admin accounts.

---

# 66. Admin Dashboard

Admin should have:

```text
Dashboard
Members
Attendance
Payments
Memberships
Workout Plans
Meal Plans
Broadcast Messages
Devices
```

Super Admin-only features should be visually/technically restricted.

---

# 67. Gym Settings

Create:

```text
gym_settings
------------
id
gym_name
logo_path
whatsapp_url
phone
email
address
monthly_membership_fee
registration_fee
updated_by
updated_at
```

Current values:

```text
gym_name = NOVA FITNESS
logo_path = uploaded logo
whatsapp_url = to be provided later
```

Keep fees configurable rather than hard-coded.

---

# 68. Audit Logs

Because Admins can change:

- membership status
- payments
- fingerprint assignments
- workout plans
- meal plans
- broadcast messages

create a general audit log:

```text
audit_logs
----------
id
actor_user_id
action
entity_type
entity_id
old_data
new_data
created_at
```

Record sensitive administrative changes.

---

# 69. Updated Member Lifecycle

```text
Magic Link signup
       ↓
Enter name + NOVA Membership ID + mobile
       ↓
Admin verifies/activates membership
       ↓
Registration payment recorded
       ↓
Fingerprint enrolled
       ↓
Member ACTIVE
       ↓
Member uses fingerprint for access
       ↓
Monthly payment recorded
       ↓
Next payment date updated
       ↓
Membership remains ACTIVE
       ↓
If payment not received:
membership period expires
       ↓
Access denied
       ↓
Member pays again
       ↓
Admin records payment
       ↓
New period begins
       ↓
Access automatically ACTIVE
```

---

# 70. Final NOVA FITNESS Application Structure

```text
NOVA FITNESS
│
├── Authentication
│   ├── Super Admin login
│   └── Magic Link login
│
├── Super Admin
│   ├── Dashboard
│   ├── Admin Management
│   ├── Members
│   ├── Attendance
│   ├── Payments
│   ├── Financial Reports
│   ├── Devices
│   ├── Broadcasts
│   ├── Workout Plans
│   ├── Meal Plans
│   ├── Settings
│   └── Audit Logs
│
├── Admin
│   ├── Dashboard
│   ├── Members
│   ├── Attendance
│   ├── Payments
│   ├── Memberships
│   ├── Workout Plans
│   ├── Meal Plans
│   ├── Broadcasts
│   └── Devices
│
└── Member
    ├── Home
    ├── Membership
    ├── Attendance
    ├── Workout Plan
    ├── Meal Plan
    ├── Payments
    └── Profile
```

---

# 71. Updated Priority

When implementing the application, prioritize:

1. Authentication and roles
2. Member registration/profile
3. Membership ID management
4. Payment records and membership periods
5. Fingerprint ID mapping
6. Attendance
7. ESP32 device integration
8. Mobile member dashboard
9. Workout and meal plans
10. Broadcast messages
11. Financial reports
12. Admin/Super Admin controls
13. Audit logs
14. UI polish and final branding

The application must remain simple enough for gym staff to operate quickly from a phone or desktop.

