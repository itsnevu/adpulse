// Factory middleware validasi zod untuk body, query, dan params.
// Gagal → 422 { error: { message: "Validasi gagal", details: [{path, message}] } }
const { ZodError } = require("zod");

function formatDetails(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function send422(res, error) {
  res.status(422).json({
    error: { message: "Validasi gagal", details: formatDetails(error) },
  });
}

function makeValidator(getter, setter) {
  return (schema) => (req, res, next) => {
    const result = schema.safeParse(getter(req));
    if (!result.success) {
      if (result.error instanceof ZodError) return send422(res, result.error);
      return next(result.error);
    }
    setter(req, result.data);
    return next();
  };
}

// validateBody(schema) — validasi req.body (JSON). Body kosong = {}.
const validateBody = makeValidator(
  (req) => req.body || {},
  (req, data) => {
    req.body = data;
  }
);

// validateQuery(schema) — validasi req.query.
const validateQuery = makeValidator(
  (req) => req.query || {},
  (req, data) => {
    req.query = data;
  }
);

// validateParams(schema) — validasi req.params (path params).
const validateParams = makeValidator(
  (req) => req.params || {},
  (req, data) => {
    req.params = data;
  }
);

module.exports = { validateBody, validateQuery, validateParams };
