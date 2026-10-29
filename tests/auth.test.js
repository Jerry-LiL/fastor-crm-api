const request = require('supertest');
const app = require('../src/app');
const { ensureMigrated, truncateTables, closeDb } = require('./helpers');

describe('Auth Endpoints', () => {
  beforeAll(async () => {
    await ensureMigrated();
  });

  beforeEach(async () => {
    await truncateTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('POST /api/auth/register', () => {
    it('registers a new employee successfully and returns token', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Sarah Connor',
          email: 'sarah@example.com',
          password: 'securepassword123',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('token');
      expect(typeof res.body.token).toBe('string');
      expect(res.body).toHaveProperty('employee');
      expect(res.body.employee).toMatchObject({
        id: expect.any(Number),
        name: 'Sarah Connor',
        email: 'sarah@example.com',
      });
      expect(res.body.employee).not.toHaveProperty('password_hash');
    });

    it('returns 409 when registering with an existing email (case-insensitive)', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Sarah Connor',
          email: 'sarah@example.com',
          password: 'securepassword123',
        });

      const duplicateRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Sarah Duplicate',
          email: 'SARAH@EXAMPLE.COM',
          password: 'differentpassword123',
        });

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body).toHaveProperty('error', 'Email is already registered');
    });

    it('returns 400 when validation fails on name, email, or password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: '   ',
          email: 'not-an-email',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(res.body).toHaveProperty('details');
      expect(Array.isArray(res.body.details)).toBe(true);

      const fields = res.body.details.map((d) => d.field);
      expect(fields).toContain('name');
      expect(fields).toContain('email');
      expect(fields).toContain('password');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'mypassword123',
        });
    });

    it('logs in successfully with valid credentials and returns token', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'john@example.com',
          password: 'mypassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
      expect(res.body).toHaveProperty('employee');
      expect(res.body.employee).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
      });
      expect(res.body.employee).not.toHaveProperty('password_hash');
    });

    it('logs in successfully with case-insensitive email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'JOHN@EXAMPLE.COM',
          password: 'mypassword123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('token');
    });

    it('returns 401 for incorrect password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'john@example.com',
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('returns 401 for non-existent email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'ghost@example.com',
          password: 'mypassword123',
        });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('returns 400 when missing credentials or invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'bad-email',
          password: '',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Validation failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });
});
