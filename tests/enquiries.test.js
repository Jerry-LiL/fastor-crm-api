const request = require('supertest');
const app = require('../src/app');
const { ensureMigrated, truncateTables, closeDb } = require('./helpers');

describe('Enquiries Endpoints', () => {
  let counselor1Token;
  let counselor1Id;
  let counselor2Token;
  let counselor2Id;

  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateTables();

    // Register two counselors for testing access controls
    const c1Res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Counselor One',
        email: 'counselor1@example.com',
        password: 'password123',
      });
    counselor1Token = c1Res.body.token;
    counselor1Id = c1Res.body.employee.id;

    const c2Res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Counselor Two',
        email: 'counselor2@example.com',
        password: 'password123',
      });
    counselor2Token = c2Res.body.token;
    counselor2Id = c2Res.body.employee.id;
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('GET /health', () => {
    it('returns 200 { status: "ok" }', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('404 Not Found Handler', () => {
    it('returns 404 for unmatched routes', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Route not found' });
    });
  });

  describe('POST /api/enquiries (Public form)', () => {
    it('submits a new enquiry successfully without authentication', async () => {
      const payload = {
        name: 'Student Alice',
        email: 'alice@student.edu',
        phone: '+14155552671',
        courseInterest: 'Full Stack Web Development',
        message: 'Looking for upcoming cohort dates.',
      };

      const res = await request(app).post('/api/enquiries').send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('enquiry');
      expect(res.body.enquiry).toMatchObject({
        id: expect.any(Number),
        name: 'Student Alice',
        email: 'alice@student.edu',
        phone: '+14155552671',
        course_interest: 'Full Stack Web Development',
        message: 'Looking for upcoming cohort dates.',
        claimed_by: null,
        claimed_at: null,
      });
      expect(res.body.enquiry.created_at).toBeDefined();
    });

    it('accepts snake_case course_interest as well', async () => {
      const payload = {
        name: 'Student Bob',
        email: 'bob@student.edu',
        phone: '9876543210',
        course_interest: 'Data Science',
      };

      const res = await request(app).post('/api/enquiries').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.enquiry.course_interest).toBe('Data Science');
      expect(res.body.enquiry.message).toBeNull();
    });

    it('rejects submissions with invalid email', async () => {
      const res = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Student Bob',
          email: 'not-an-email',
          phone: '+14155552671',
          courseInterest: 'AI & ML',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      const emailErr = res.body.details.find((d) => d.field === 'email');
      expect(emailErr).toBeDefined();
    });

    it('rejects submissions with invalid phone numbers', async () => {
      const invalidPhones = ['123', 'abc12345678', '+', '+12345678901234567890'];

      for (const phone of invalidPhones) {
        const res = await request(app)
          .post('/api/enquiries')
          .send({
            name: 'Student',
            email: 'student@example.com',
            phone,
            courseInterest: 'AI & ML',
          });

        expect(res.status).toBe(400);
        const phoneErr = res.body.details.find((d) => d.field === 'phone');
        expect(phoneErr).toBeDefined();
      }
    });

    it('rejects submissions missing required fields', async () => {
      const res = await request(app).post('/api/enquiries').send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      const fields = res.body.details.map((d) => d.field);
      expect(fields).toContain('name');
      expect(fields).toContain('email');
      expect(fields).toContain('phone');
      expect(fields).toContain('courseInterest');
    });
  });

  describe('Authentication Requirement', () => {
    it('returns 401 when accessing protected endpoints without a token', async () => {
      const resPublic = await request(app).get('/api/enquiries/public');
      expect(resPublic.status).toBe(401);
      expect(resPublic.body).toHaveProperty('error');

      const resClaim = await request(app).post('/api/enquiries/1/claim');
      expect(resClaim.status).toBe(401);

      const resMine = await request(app).get('/api/enquiries/mine');
      expect(resMine.status).toBe(401);
    });

    it('returns 401 when token is invalid or malformed', async () => {
      const res = await request(app)
        .get('/api/enquiries/public')
        .set('Authorization', 'Bearer invalid-token-string');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid or expired token');
    });
  });

  describe('GET /api/enquiries/public (Counselor Unclaimed List)', () => {
    it('returns unclaimed enquiries newest first, and hides claimed enquiries', async () => {
      // Create 3 enquiries
      const r1 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Lead 1',
          email: 'lead1@example.com',
          phone: '1234567890',
          courseInterest: 'Web Dev',
        });
      const r2 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Lead 2',
          email: 'lead2@example.com',
          phone: '1234567891',
          courseInterest: 'Data Science',
        });
      const r3 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Lead 3',
          email: 'lead3@example.com',
          phone: '1234567892',
          courseInterest: 'Cloud Computing',
        });

      // Claim Lead 2
      await request(app)
        .post(`/api/enquiries/${r2.body.enquiry.id}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);

      // Fetch public list
      const res = await request(app)
        .get('/api/enquiries/public')
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.enquiries)).toBe(true);
      expect(res.body.enquiries.length).toBe(2);

      const returnedIds = res.body.enquiries.map((e) => e.id);
      expect(returnedIds).toContain(r1.body.enquiry.id);
      expect(returnedIds).toContain(r3.body.enquiry.id);
      expect(returnedIds).not.toContain(r2.body.enquiry.id);

      // Verify newest first (Lead 3 was created after Lead 1)
      expect(returnedIds[0]).toBe(r3.body.enquiry.id);
      expect(returnedIds[1]).toBe(r1.body.enquiry.id);
    });

    it('supports pagination via page and limit query params', async () => {
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post('/api/enquiries')
          .send({
            name: `Lead ${i}`,
            email: `lead${i}@example.com`,
            phone: `123456789${i}`,
            courseInterest: 'Course',
          });
      }

      const res = await request(app)
        .get('/api/enquiries/public?page=2&limit=2')
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.enquiries.length).toBe(2);
      expect(res.body.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 5,
        totalPages: 3,
      });
    });
  });

  describe('POST /api/enquiries/:id/claim', () => {
    it('claims an unclaimed enquiry successfully', async () => {
      const created = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Lead to Claim',
          email: 'claim@example.com',
          phone: '9876543210',
          courseInterest: 'Python',
        });
      const enquiryId = created.body.enquiry.id;

      const claimRes = await request(app)
        .post(`/api/enquiries/${enquiryId}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(claimRes.status).toBe(200);
      expect(claimRes.body).toHaveProperty('message', 'Enquiry claimed successfully');
      expect(claimRes.body.enquiry.claimed_by).toBe(counselor1Id);
      expect(claimRes.body.enquiry.claimed_at).toBeTruthy();
    });

    it('returns 409 when attempting to claim an already claimed enquiry', async () => {
      const created = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Contested Lead',
          email: 'contested@example.com',
          phone: '9876543210',
          courseInterest: 'Python',
        });
      const enquiryId = created.body.enquiry.id;

      // First claim succeeds
      const firstClaim = await request(app)
        .post(`/api/enquiries/${enquiryId}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);
      expect(firstClaim.status).toBe(200);

      // Second claim by counselor 2 fails with 409
      const secondClaim = await request(app)
        .post(`/api/enquiries/${enquiryId}/claim`)
        .set('Authorization', `Bearer ${counselor2Token}`);
      expect(secondClaim.status).toBe(409);
      expect(secondClaim.body).toHaveProperty('error', 'Enquiry has already been claimed');

      // Attempt by original claimant also returns 409
      const duplicateClaim = await request(app)
        .post(`/api/enquiries/${enquiryId}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);
      expect(duplicateClaim.status).toBe(409);
    });

    it('returns 404 when claiming a non-existent enquiry', async () => {
      const res = await request(app)
        .post('/api/enquiries/999999/claim')
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Enquiry not found');
    });

    it('returns 400 when enquiry ID parameter is invalid', async () => {
      const res = await request(app)
        .post('/api/enquiries/not-a-number/claim')
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid enquiry ID');
    });
  });

  describe('GET /api/enquiries/mine', () => {
    it('returns only enquiries claimed by the logged-in counselor', async () => {
      // Create 3 enquiries
      const e1 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Counselor 1 Lead A',
          email: 'c1a@example.com',
          phone: '1234567890',
          courseInterest: 'Design',
        });
      const e2 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Counselor 1 Lead B',
          email: 'c1b@example.com',
          phone: '1234567891',
          courseInterest: 'Product',
        });
      const e3 = await request(app)
        .post('/api/enquiries')
        .send({
          name: 'Counselor 2 Lead',
          email: 'c2@example.com',
          phone: '1234567892',
          courseInterest: 'Data',
        });

      // Counselor 1 claims e1 and e2
      await request(app)
        .post(`/api/enquiries/${e1.body.enquiry.id}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);
      await request(app)
        .post(`/api/enquiries/${e2.body.enquiry.id}/claim`)
        .set('Authorization', `Bearer ${counselor1Token}`);

      // Counselor 2 claims e3
      await request(app)
        .post(`/api/enquiries/${e3.body.enquiry.id}/claim`)
        .set('Authorization', `Bearer ${counselor2Token}`);

      // Counselor 1 checks 'mine'
      const mine1 = await request(app)
        .get('/api/enquiries/mine')
        .set('Authorization', `Bearer ${counselor1Token}`);
      expect(mine1.status).toBe(200);
      expect(mine1.body.enquiries.length).toBe(2);
      const mine1Ids = mine1.body.enquiries.map((e) => e.id);
      expect(mine1Ids).toContain(e1.body.enquiry.id);
      expect(mine1Ids).toContain(e2.body.enquiry.id);
      expect(mine1Ids).not.toContain(e3.body.enquiry.id);

      // Counselor 2 checks 'mine'
      const mine2 = await request(app)
        .get('/api/enquiries/mine')
        .set('Authorization', `Bearer ${counselor2Token}`);
      expect(mine2.status).toBe(200);
      expect(mine2.body.enquiries.length).toBe(1);
      expect(mine2.body.enquiries[0].id).toBe(e3.body.enquiry.id);
    });

    it('returns empty list if counselor has not claimed any enquiry', async () => {
      const res = await request(app)
        .get('/api/enquiries/mine')
        .set('Authorization', `Bearer ${counselor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.enquiries).toEqual([]);
    });
  });
});
