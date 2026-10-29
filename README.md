# Fastor CRM API

Backend REST API for a Customer Relationship Management (CRM) system designed for educational counseling teams. The service allows prospective students to submit enquiry forms publicly, and gives counselors an authenticated workspace to browse unclaimed leads, claim leads atomically, and manage their assigned enquiries.

## Stack

- Runtime: Node.js 20+
- Framework: Express 4
- Database: PostgreSQL (using plain `pg` with parameterized SQL, no ORM)
- Authentication: JWT (`jsonwebtoken`) and password hashing (`bcryptjs`)
- Testing: Jest and Supertest against a live Postgres database
- Containerization: Docker & Docker Compose

## Quick Start

### Prerequisites
- Node.js 20 or higher
- Docker and Docker Compose (or local PostgreSQL 16+)

### Setup in 5 Commands

```bash
# 1. Start the PostgreSQL container
docker compose up -d db

# 2. Copy the sample environment file
cp .env.example .env

# 3. Install dependencies
npm install

# 4. Run database migrations
npm run migrate

# 5. Start the development server
npm run dev
```

The server starts on `http://localhost:3000`.

## API Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| GET | `/health` | No | Service health check |
| POST | `/api/auth/register` | No | Register a counselor account |
| POST | `/api/auth/login` | No | Log in with credentials and receive JWT |
| POST | `/api/enquiries` | No | Public enquiry intake form |
| GET | `/api/enquiries/public` | Yes | List unclaimed enquiries (newest first, paginated) |
| POST | `/api/enquiries/:id/claim` | Yes | Atomically claim an enquiry |
| GET | `/api/enquiries/mine` | Yes | List enquiries claimed by authenticated counselor |

---

### Curl Examples

#### 1. Register a Counselor
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Counselor",
    "email": "jane@example.com",
    "password": "password123"
  }'
```

Response (201 Created):
```json
{
  "employee": {
    "id": 1,
    "name": "Jane Counselor",
    "email": "jane@example.com",
    "created_at": "2026-10-29T15:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 2. Log In
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jane@example.com",
    "password": "password123"
  }'
```

Response (200 OK):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "employee": {
    "id": 1,
    "name": "Jane Counselor",
    "email": "jane@example.com",
    "created_at": "2026-10-29T15:00:00.000Z"
  }
}
```

#### 3. Submit Public Enquiry (No Auth)
```bash
curl -X POST http://localhost:3000/api/enquiries \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alex Student",
    "email": "alex@example.com",
    "phone": "+14155552671",
    "courseInterest": "Full Stack Web Development",
    "message": "Interested in the upcoming batch."
  }'
```

Response (201 Created):
```json
{
  "enquiry": {
    "id": 1,
    "name": "Alex Student",
    "email": "alex@example.com",
    "phone": "+14155552671",
    "course_interest": "Full Stack Web Development",
    "message": "Interested in the upcoming batch.",
    "claimed_by": null,
    "claimed_at": null,
    "created_at": "2026-10-29T15:01:00.000Z"
  }
}
```

#### 4. Fetch Unclaimed Enquiries (Authenticated)
```bash
curl -X GET "http://localhost:3000/api/enquiries/public?page=1&limit=10" \
  -H "Authorization: Bearer <TOKEN>"
```

Response (200 OK):
```json
{
  "enquiries": [
    {
      "id": 1,
      "name": "Alex Student",
      "email": "alex@example.com",
      "phone": "+14155552671",
      "course_interest": "Full Stack Web Development",
      "message": "Interested in the upcoming batch.",
      "claimed_by": null,
      "claimed_at": null,
      "created_at": "2026-10-29T15:01:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

#### 5. Claim an Enquiry (Authenticated)
```bash
curl -X POST http://localhost:3000/api/enquiries/1/claim \
  -H "Authorization: Bearer <TOKEN>"
```

Response (200 OK):
```json
{
  "message": "Enquiry claimed successfully",
  "enquiry": {
    "id": 1,
    "name": "Alex Student",
    "email": "alex@example.com",
    "phone": "+14155552671",
    "course_interest": "Full Stack Web Development",
    "message": "Interested in the upcoming batch.",
    "claimed_by": 1,
    "claimed_at": "2026-10-29T15:02:00.000Z",
    "created_at": "2026-10-29T15:01:00.000Z"
  }
}
```

If already claimed:
Response (409 Conflict):
```json
{
  "error": "Enquiry has already been claimed"
}
```

If enquiry does not exist:
Response (404 Not Found):
```json
{
  "error": "Enquiry not found"
}
```

#### 6. Fetch Claimed Leads (Authenticated)
```bash
curl -X GET http://localhost:3000/api/enquiries/mine \
  -H "Authorization: Bearer <TOKEN>"
```

Response (200 OK):
```json
{
  "enquiries": [
    {
      "id": 1,
      "name": "Alex Student",
      "email": "alex@example.com",
      "phone": "+14155552671",
      "course_interest": "Full Stack Web Development",
      "message": "Interested in the upcoming batch.",
      "claimed_by": 1,
      "claimed_at": "2026-10-29T15:02:00.000Z",
      "created_at": "2026-10-29T15:01:00.000Z"
    }
  ]
}
```

---

## Concurrency and Atomic Claim Implementation

### The Problem
When multiple counselors view the public pool of leads, they may click "Claim" on the same prospective client simultaneously. A naive implementation that first runs `SELECT` to see if `claimed_by IS NULL` and then executes `UPDATE` is subject to a classic time-of-check to time-of-use (TOCTOU) race condition: both requests read `claimed_by IS NULL` before either update commits, resulting in two counselors believing they claimed the lead.

### The Solution
We use a single conditional `UPDATE` query:

```sql
UPDATE enquiries
SET claimed_by = $1, claimed_at = NOW()
WHERE id = $2 AND claimed_by IS NULL
RETURNING *;
```

Postgres evaluates this query using row-level write locks. The first transaction to acquire the lock matches `claimed_by IS NULL`, updates the row, and returns the modified record (`rowCount === 1`). Any concurrent transaction waiting on that row lock re-evaluates the `WHERE` clause once the lock is released; because `claimed_by` is now populated, the predicate evaluates to false and zero rows are updated (`rowCount === 0`).

If `rowCount === 0`, our application runs a quick read to differentiate between:
- 404 Not Found (the enquiry ID does not exist)
- 409 Conflict (the enquiry was already claimed)

This eliminates the need for distributed locks, external queues, or heavy isolation levels, while delivering strict linearizability at the database layer.

---

## Design Choices

1. **Plain `pg` driver without an ORM**:
   Keeps database access transparent, predictable, and free from ORM overhead. Complex transactional behavior like conditional atomic updates is expressed cleanly in standard SQL.
2. **Postgres `CITEXT` and lowercasing**:
   The `citext` extension ensures email lookups are case-insensitive by default in the database, avoiding duplicate accounts from varying casing (e.g., `Jane@example.com` vs `jane@example.com`).
3. **Index on `enquiries(claimed_by)`**:
   Enables efficient index scans when querying unclaimed leads (`WHERE claimed_by IS NULL`) as well as counselor-specific leads (`WHERE claimed_by = $1`).
4. **Stateless JWT authentication**:
   The token payload stores counselor identity (`sub: employeeId, email`). Middleware validates the signature and populates `req.user` without incurring database queries on every protected request.
5. **Standardized error contracts**:
   All errors follow `{ error: string, details?: Array<{ field: string, message: string }> }` for consistent client consumption.

---

## Running Tests

Tests run against a real Postgres database using Jest and Supertest (`--runInBand`):

```bash
# Set up test database (if not already existing)
# export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:5432/fastor_crm_test"

npm test
```

The test suite covers:
- Registration happy and failure paths (validation errors, duplicate email conflict)
- Login happy and failure paths (invalid credentials, missing fields)
- Public lead form validation (phone format, email format, required fields)
- Authentication enforcement (401 on missing, malformed, or invalid tokens)
- Unclaimed lead filtering (ensuring claimed leads do not appear in public listing)
- Successful claim and conflict rejection (409 on second claim)
- 404 handling on missing records
- Lead segregation (`/api/enquiries/mine` only returns leads claimed by the requesting counselor)
- Race condition test firing 10 simultaneous claims from different counselors for the same enquiry, asserting exactly one 200 and nine 409s

---

## What I'd Add Next

- **Refresh token rotation**: Short-lived access tokens (15m) paired with httpOnly cookie-based refresh tokens stored in a revoked tokens table.
- **Rate limiting and abuse prevention**: IP-based rate limiting on the unauthenticated public form and auth routes using `express-rate-limit` or Redis.
- **Spam protection**: Cloudflare Turnstile or reCAPTCHA v3 on the public enquiry endpoint.
- **Lead reassignment and release**: Ability for managers to reassign leads, or for counselors to release uncontacted leads back into the public pool.
- **Audit logging**: An append-only `enquiry_events` table recording when leads are submitted, viewed, claimed, or modified.
- **Cursor pagination**: Keyset pagination (`WHERE id < $last_id`) for higher efficiency under large lead volumes compared to `OFFSET`.

---

Built with AI assistance (Google Antigravity) and reviewed by me.
