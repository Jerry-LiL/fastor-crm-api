const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { generateToken } = require('../middleware/auth');
const { validateRegisterInput, validateLoginInput } = require('../utils/validation');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    const { isValid, details } = validateRegisterInput({ name, email, password });

    if (!isValid) {
      return res.status(400).json({ error: 'Validation failed', details });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      'INSERT INTO employees (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [trimmedName, normalizedEmail, passwordHash]
    );

    const employee = result.rows[0];
    const token = generateToken(employee);

    return res.status(201).json({ employee, token });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email is already registered' });
    }
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { isValid, details } = validateLoginInput({ email, password });

    if (!isValid) {
      return res.status(400).json({ error: 'Validation failed', details });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const result = await db.query(
      'SELECT id, name, email, password_hash, created_at FROM employees WHERE email = $1',
      [normalizedEmail]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const employee = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, employee.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(employee);

    return res.status(200).json({
      token,
      employee: {
        id: employee.id,
        name: employee.name,
        email: employee.email,
        created_at: employee.created_at,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
