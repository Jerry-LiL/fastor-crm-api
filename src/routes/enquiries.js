const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { validateEnquiryInput } = require('../utils/validation');

const router = express.Router();

// Public enquiry capture form - no authentication required
router.post('/', async (req, res, next) => {
  try {
    const { isValid, details, data } = validateEnquiryInput(req.body);

    if (!isValid) {
      return res.status(400).json({ error: 'Validation failed', details });
    }

    const result = await db.query(
      `INSERT INTO enquiries (name, email, phone, course_interest, message)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, phone, course_interest, message, claimed_by, claimed_at, created_at`,
      [data.name, data.email, data.phone, data.courseInterest, data.message]
    );

    return res.status(201).json({ enquiry: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// Fetch unclaimed public enquiries (authenticated counselors only)
router.get('/public', authenticateToken, async (req, res, next) => {
  try {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    const offset = (page - 1) * limit;

    const countResult = await db.query(
      'SELECT COUNT(*)::int AS total FROM enquiries WHERE claimed_by IS NULL'
    );
    const total = countResult.rows[0].total;

    const dataResult = await db.query(
      `SELECT id, name, email, phone, course_interest, message, claimed_by, claimed_at, created_at
       FROM enquiries
       WHERE claimed_by IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return res.status(200).json({
      enquiries: dataResult.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err) {
    return next(err);
  }
});

// Fetch enquiries claimed by logged-in counselor
router.get('/mine', authenticateToken, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, email, phone, course_interest, message, claimed_by, claimed_at, created_at
       FROM enquiries
       WHERE claimed_by = $1
       ORDER BY claimed_at DESC, created_at DESC`,
      [req.user.id]
    );

    return res.status(200).json({ enquiries: result.rows });
  } catch (err) {
    return next(err);
  }
});

// Claim an unclaimed enquiry atomically
router.post('/:id/claim', authenticateToken, async (req, res, next) => {
  try {
    const enquiryId = parseInt(req.params.id, 10);
    if (isNaN(enquiryId) || enquiryId <= 0) {
      return res.status(400).json({ error: 'Invalid enquiry ID' });
    }

    const updateResult = await db.query(
      'UPDATE enquiries SET claimed_by = $1, claimed_at = NOW() WHERE id = $2 AND claimed_by IS NULL RETURNING *',
      [req.user.id, enquiryId]
    );

    if (updateResult.rowCount === 1) {
      return res.status(200).json({
        message: 'Enquiry claimed successfully',
        enquiry: updateResult.rows[0],
      });
    }

    // Row was not updated. Differentiate between not found (404) and already claimed (409)
    const checkResult = await db.query(
      'SELECT id, claimed_by FROM enquiries WHERE id = $1',
      [enquiryId]
    );

    if (checkResult.rowCount === 0) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    return res.status(409).json({ error: 'Enquiry has already been claimed' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
