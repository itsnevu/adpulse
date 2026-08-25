// Small helper to create HTTP errors carrying a status code. The central
// error handler in app.js turns these into the {error:{message}} envelope.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Wrap an async express handler so rejections reach the error middleware.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { httpError, asyncHandler };
