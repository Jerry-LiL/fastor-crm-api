# Fastor CRM API

REST API for a small CRM: students submit enquiries through a public form, and counselors log in to see unclaimed leads, claim them and view the ones they own.

## Stack

Node 20, Express 4, PostgreSQL (`pg`, plain SQL), JWT + bcrypt, Jest + Supertest.

## Running

```bash
docker compose up
```

Or locally:

```bash
docker compose up -d db
cp .env.example .env
npm install
npm run migrate
npm run dev
```

The API runs on `http://localhost:3000`.

## Tests

Tests run against a real Postgres database (`TEST_DATABASE_URL`, default `fastor_crm_test`):

```bash
createdb -h localhost -U postgres fastor_crm_test
npm test
```

## Endpoints

```text
GET  /health
POST /api/auth/register          register a counselor
POST /api/auth/login             returns a JWT
POST /api/enquiries              public enquiry form, no auth
GET  /api/enquiries/public       unclaimed enquiries, ?page=&limit=   (auth)
POST /api/enquiries/:id/claim    claim an enquiry; 409 if already taken (auth)
GET  /api/enquiries/mine         enquiries I've claimed                (auth)
```

Example:

```bash
curl -X POST http://localhost:3000/api/enquiries \
  -H "Content-Type: application/json" \
  -d '{"name":"Riya","email":"riya@example.com","phone":"+919876543210","courseInterest":"Data Science"}'
```

## Notes

- Claiming is a single `UPDATE ... WHERE id = $1 AND claimed_by IS NULL`, so two counselors claiming at once can't both win. There's a test that fires concurrent claims at the same enquiry.
- Emails are `citext`, so `Jane@x.com` and `jane@x.com` count as the same.

## TODO

- Refresh tokens
- Rate limiting / captcha on the public form
- Keyset pagination instead of offset
