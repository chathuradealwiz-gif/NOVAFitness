# NOVA FITNESS — Testing Plan

## Automated

Currently in place:

```bash
npm run typecheck    # strict TypeScript, zero errors
npm run build        # production build of all routes
```

Recommended next (not yet written): Playwright end-to-end covering the auth
redirect matrix and the payment → reactivation flow, plus pgTAP for the RLS
assertions below, which are the highest-value tests in the system.

---

## Authentication and roles

| Case | Expected |
|------|----------|
| Magic link, role `user` | lands on `/member` |
| Magic link, role `admin` | lands on `/dashboard` |
| Super admin username/password | lands on `/dashboard` |
| Wrong super-admin password | "Invalid username or password" |
| Unknown super-admin username | identical message and status to wrong password |
| 9 rapid failed attempts | 9th returns 429 |
| Member navigates to `/dashboard` | redirected to `/member` |
| Admin navigates to `/dashboard/admins` | redirected to `/dashboard` |
| Profile `is_active = false` | Access Denied page |
| Signed out, any protected URL | redirected to `/login?next=…` |
| `next` set to `https://evil.com` | ignored; role-based redirect used |

## RLS (run as a member's JWT, not as service role)

| Query | Expected |
|-------|----------|
| `select * from members` | only their own row |
| `select * from payments` | only their own payments |
| `select * from attendance` | only their own events |
| `update profiles set role='admin' where user_id=auth.uid()` | rejected |
| `update members set status='active' where id=<own>` | rejected (not in policy columns for staff-only fields) |
| `select * from audit_logs` | empty |
| `delete from payments where id=…` | rejected — no DELETE policy |
| `select * from broadcast_messages` | only live, non-archived banners |

## Membership period maths

| Payment date | Expected period | Next payment |
|--------------|-----------------|--------------|
| 16 Aug 2026 | 16 Aug – 15 Sep | 16 Sep |
| 31 Jan 2026 | 31 Jan – 27 Feb | 28 Feb |
| 29 Feb 2028 (leap) | 29 Feb – 28 Mar | 29 Mar |
| Renew on 1 Sep while paid to 15 Sep | 16 Sep – 15 Oct | 16 Oct |

The last row is the important one: early renewal must not discard the remaining
paid days.

## Payments and membership state

- Recording a monthly payment for an expired member → status `active`, period and
  next payment date updated.
- Recording a coaching payment → separate record; the monthly fee and membership
  period are untouched.
- Registration payment → recorded, no membership period created.
- Voiding a monthly payment (super admin) → row retained with status `voided`,
  excluded from revenue, membership recomputed, entry in `financial_audit_logs`.
- Editing a payment's amount directly in SQL → rejected by trigger.
- A member on `suspended` who pays → stays `suspended` (administrative hold wins).
- A brand-new member (created `inactive`) who pays → becomes `active`, and
  `member_access_decision` returns allowed. **Regression test:** treating `inactive`
  as a hold once made every paying member undeployable at the door.
- Manual status change without a reason → rejected.

## Fingerprint mapping

- Enroll a member → `members.fingerprint_id` and `fingerprint_device_id` both set.
- Enroll a second member onto the same slot → the first member's mapping is
  cleared, their attendance history is intact.
- Remove a fingerprint → mapping cleared, member and history retained.
- Two enrollment requests on one device → the second is refused.
- Abandon an enrollment → marked failed after 10 minutes, sensor freed.
- Assign the same slot on two different devices → both allowed (slots are
  per-device).

## Attendance and the door

| Scenario | Expected |
|----------|----------|
| Active member scans | granted, event recorded |
| Expired member scans | denied `MEMBERSHIP_EXPIRED`, denial still recorded |
| Suspended member scans | denied `MEMBERSHIP_SUSPENDED` |
| Unenrolled finger | denied `FINGERPRINT_NOT_REGISTERED` |
| Same member rescans within cooldown | `duplicate: true`, no second row |
| Same `event_id` posted twice | one row, original decision returned |
| Replay a whole offline queue twice | no duplicates |
| Wrong `x-device-key` | 401, nothing recorded |
| Disabled device with a valid key | 401 |

## Offline operation (once firmware exists)

- Pull the 4G antenna → scans still grant access from the cache, events queue,
  the TFT shows offline mode.
- Restore connectivity → queue drains, Attendance shows the events with the
  original timestamps and an "offline" marker.
- Power-cycle mid-queue → the queue survives in flash and still drains exactly once.
- Expire a membership while the device is offline → access is granted from the
  stale cache until the next sync. This is the accepted trade-off for keeping the
  door working; the sync interval bounds the window.

## Mobile UI

Test at 360 px and 430 px widths:

- bottom navigation reachable one-handed, targets ≥ 44 px
- no horizontal page scroll anywhere (wide tables scroll inside their card)
- membership card, today's workout and today's meals visible without scrolling far
- WhatsApp button opens the configured link, and is absent when unset
- broadcast banner dismisses and stays dismissed; a non-dismissible banner has no
  dismiss control

## Manual smoke test (end to end)

1. Bootstrap super admin, sign in.
2. Set fees, logo and WhatsApp link in Gym Settings.
3. Create member `34`, record a registration payment.
4. Record a monthly payment → member becomes Active with the right period.
5. Provision a device, enroll a fingerprint, confirm the mapping.
6. Scan → granted; check the dashboard counts and attendance list.
7. Assign a workout and a meal plan.
8. Post a broadcast message.
9. Sign in as that member on a phone → membership, today's plan, payment history
   and the banner all correct, and no other member's data is reachable.
10. Check the monthly financial report totals against the payments recorded.
