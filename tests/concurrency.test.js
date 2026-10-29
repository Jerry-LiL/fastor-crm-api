const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db');
const { ensureMigrated, truncateTables, closeDb } = require('./helpers');

describe('Concurrency and Race Condition Tests', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('handles 10 concurrent claim requests for the same enquiry: exactly one 200 and nine 409s', async () => {
    // 1. Create a public enquiry
    const enquiryRes = await request(app)
      .post('/api/enquiries')
      .send({
        name: 'High Demand Lead',
        email: 'demand@example.com',
        phone: '+15551234567',
        courseInterest: 'AI / Machine Learning Fellowship',
        message: 'Ready to enroll immediately',
      });

    expect(enquiryRes.status).toBe(201);
    const enquiryId = enquiryRes.body.enquiry.id;

    // 2. Register 10 distinct counselors
    const counselorCount = 10;
    const counselors = [];

    for (let i = 1; i <= counselorCount; i++) {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: `Counselor ${i}`,
          email: `concurrent_counselor_${i}@example.com`,
          password: 'securePassword123',
        });

      expect(regRes.status).toBe(201);
      counselors.push({
        id: regRes.body.employee.id,
        token: regRes.body.token,
      });
    }

    // 3. Fire all 10 claim requests simultaneously
    const claimPromises = counselors.map((counselor) =>
      request(app)
        .post(`/api/enquiries/${enquiryId}/claim`)
        .set('Authorization', `Bearer ${counselor.token}`)
    );

    const responses = await Promise.all(claimPromises);

    // 4. Assert exactly one succeeded (200) and the rest failed with conflict (409)
    const successResponses = responses.filter((r) => r.status === 200);
    const conflictResponses = responses.filter((r) => r.status === 409);

    expect(successResponses.length).toBe(1);
    expect(conflictResponses.length).toBe(counselorCount - 1);

    const winnerResponse = successResponses[0];
    expect(winnerResponse.body).toHaveProperty('message', 'Enquiry claimed successfully');
    expect(winnerResponse.body.enquiry).toHaveProperty('claimed_by');
    expect(winnerResponse.body.enquiry.claimed_at).toBeTruthy();

    const winnerCounselorId = winnerResponse.body.enquiry.claimed_by;
    const registeredIds = counselors.map((c) => c.id);
    expect(registeredIds).toContain(winnerCounselorId);

    // Assert all 409s have the exact expected error message
    conflictResponses.forEach((res) => {
      expect(res.body).toEqual({ error: 'Enquiry has already been claimed' });
    });

    // 5. Query DB directly to verify persistence of winning claim
    const dbRecord = await db.query(
      'SELECT claimed_by, claimed_at FROM enquiries WHERE id = $1',
      [enquiryId]
    );

    expect(dbRecord.rows[0].claimed_by).toBe(winnerCounselorId);
    expect(dbRecord.rows[0].claimed_at).not.toBeNull();
  });
});
