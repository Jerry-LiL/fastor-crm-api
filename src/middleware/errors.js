function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const payload = {
    error: status >= 500 ? 'Internal server error' : (err.message || 'An error occurred'),
  };

  if (err.details) {
    payload.details = err.details;
  }

  if (status >= 500 && process.env.NODE_ENV !== 'test') {
    console.error(err);
  }

  res.status(status).json(payload);
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
