# Fastor CRM - Architecture and Design Walkthrough

This document outlines key technical and architectural decisions for discussion in an engineering interview.

---

## 1. Schema Design and Rationale

### Tables
- **`employees`**:
  - `id`: Serial primary key.
  - `name`: Counselor full name (`varchar(255)`).
  - `email`: `CITEXT` unique column. Using PostgreSQL's `citext` extension enforces case-insensitivity at the storage layer, eliminating duplicate registrations like `counselor@domain.com` vs `Counselor@domain.com`.
  - `password_hash`: Bcrypt hashed password string (`varchar(255)`).
  - `created_at`: `timestamptz` default current timestamp.
- **`enquiries`**:
  - `id`: Serial primary key.
  - `name`, `email` (`citext`), `phone` (`varchar(32)`), `course_interest` (`varchar(255)`), `message` (`text`, nullable).
  - `claimed_by`: Integer foreign key referencing `employees(id)` with `ON DELETE SET NULL`. Nullable; null indicates an unclaimed public lead.
  - `claimed_at`: `timestamptz`, nullable. Timestamp when the claim occurred.
  - `created_at`: `timestamptz` default current timestamp.

### Indexing Strategy
- `idx_enquiries_claimed_by ON enquiries(claimed_by)`:
  - Supports filtering unclaimed enquiries (`WHERE claimed_by IS NULL`) for the public counselor feed.
  - Supports fetching counselor-specific claimed enquiries (`WHERE claimed_by = $1`) for the counselor's personal workspace.

### Why Plain `pg` Over an ORM
- Eliminates abstraction overhead and impedance mismatch.
- Complete control over SQL statements, query execution plans, and parameterized queries ($1, $2) to guarantee SQL injection safety.
- Exposes atomic conditional update behavior directly without ORM change-tracking quirks.

---

## 2. The Atomic Claim Mechanism: Concurrency Comparison

When multiple counselors attempt to claim the same enquiry at the same moment, the system must guarantee that exactly one succeeds and all others fail with conflict (409).

### Approach A: Naive SELECT then UPDATE (Race Prone)
```
Counselor A: SELECT claimed_by WHERE id = 1 -> NULL
Counselor B: SELECT claimed_by WHERE id = 1 -> NULL
Counselor A: UPDATE enquiries SET claimed_by = A WHERE id = 1
Counselor B: UPDATE enquiries SET claimed_by = B WHERE id = 1
```
**Outcome**: Classic TOCTOU (Time-of-Check to Time-of-Use) bug. Both counselors see the enquiry as unclaimed; Counselor B overwrites Counselor A's claim ("last write wins"), and both believe they own the lead.

### Approach B: `SELECT ... FOR UPDATE` (Heavyweight)
```sql
BEGIN;
SELECT * FROM enquiries WHERE id = $1 FOR UPDATE;
-- check if claimed_by IS NULL in application
UPDATE enquiries SET claimed_by = $2, claimed_at = NOW() WHERE id = $1;
COMMIT;
```
**Drawbacks**: Requires managing an explicit multi-step transaction. Database connections and exclusive row locks are held across application-server network hops. If the node crashes or delays, the row lock remains held until the transaction times out, degrading throughput.

### Approach C: Single Conditional `UPDATE` (Chosen Implementation)
```sql
UPDATE enquiries
SET claimed_by = $1, claimed_at = NOW()
WHERE id = $2 AND claimed_by IS NULL
RETURNING *;
```
**How it works**:
- Executes in a single query round-trip.
- PostgreSQL locks the target row during the `UPDATE` operation.
- The first arriving statement acquires the row lock, checks `claimed_by IS NULL` (true), updates the row, and returns the modified row (`rowCount === 1`).
- The competing concurrent statements wait for the lock. Once acquired, PostgreSQL evaluates the updated row where `claimed_by` is no longer `NULL`. The `WHERE` condition fails, and zero rows are updated (`rowCount === 0`).
- When `rowCount === 0`, our application runs a quick read:
  - If no row exists with that ID -> 404 Not Found.
  - If row exists -> 409 Conflict ("Enquiry has already been claimed").

This yields strict linearizability and high throughput with zero distributed locking complexity.

---

## 3. JWT Authentication Flow

1. **Counselor Registration / Login**:
   - Client sends credentials (`POST /api/auth/register` or `POST /api/auth/login`).
   - Server validates payload format.
   - Password verified against `password_hash` using `bcrypt.compare`.
   - Generates signed JWT with payload `{ sub: employee.id, email: employee.email }` and expiration (default `1d`).
2. **Middleware Verification (`authenticateToken`)**:
   - Extracts token from `Authorization: Bearer <token>`.
   - Rejects missing or malformed headers with 401 Unauthorized.
   - Verifies JWT cryptographic signature using `JWT_SECRET`.
   - On success, attaches `{ id: decoded.sub, email: decoded.email }` directly to `req.user` and calls `next()`.
   - Downstream route handlers (`/api/enquiries/public`, `/api/enquiries/:id/claim`, `/api/enquiries/mine`) consume `req.user.id` safely without extra database lookups.

---

## 4. Public Form Protection and Abuse Mitigation

### Why It Is Unauthenticated
Prospective students submitting an enquiry form from marketing pages, paid ads, or campus flyers do not have employee accounts. Adding authentication to lead capture forms introduces severe friction and destroys conversion rates.

### Production Abuse Protections
1. **Rate Limiting**:
   - Implement sliding-window rate limiting by client IP (e.g. 5 submissions per 10 minutes per IP) using Redis or memory store to prevent flooding.
2. **Bot Protection / CAPTCHA**:
   - Invisible challenge like Cloudflare Turnstile or Google reCAPTCHA v3. The client submits a token, and the backend verifies it with the CAPTCHA provider before inserting the enquiry.
3. **Honeypot Fields**:
   - An invisible form field (e.g., `<input name="website" style="display:none">`). Humans leave it blank, while naive scrapers fill it out. If populated, silently drop the request.
4. **Validation and Sanitization**:
   - Strict regex validation on email and phone numbers (+10 to 15 digits) rejects garbled spam entries upfront.
5. **Double Opt-In / Verification**:
   - Dispatch an automated email/SMS with a verification link to confirm the lead's contact information before notifying counselors.

---

## 5. What I'd Add Next

1. **Refresh Token Flow**:
   - Short-lived access tokens (15 minutes) in memory.
   - Long-lived refresh tokens stored in secure, `httpOnly`, `SameSite=Strict` cookies.
   - Token revocation table to handle logout and compromised device sessions.
2. **Role-Based Access Control (RBAC)**:
   - Introduce an `employees.role` enum (`counselor`, `lead_counselor`, `admin`).
   - Admins can view analytics, manage counselor accounts, and reassign leads.
3. **Lead Release and Reassignment**:
   - Allow a counselor to unclaim/release a lead if unable to contact them within 24 hours.
   - Automated cron worker to return uncontacted claimed leads back to the public pool after a configurable SLA.
4. **Audit Log Table**:
   - Append-only `enquiry_audit_events` recording timestamp, actor ID, action (`SUBMITTED`, `CLAIMED`, `RELEASED`, `STATUS_CHANGED`), and metadata for accountability.
5. **Cursor-Based Keyset Pagination**:
   - For high-volume lead pipelines, replace `OFFSET` with keyset pagination (`WHERE id < $last_id ORDER BY id DESC LIMIT $limit`) to maintain $O(1)$ query performance across deep pages.
