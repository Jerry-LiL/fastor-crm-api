const express = require('express');
const authRoutes = require('./routes/auth');
const enquiriesRoutes = require('./routes/enquiries');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/enquiries', enquiriesRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
