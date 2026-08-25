// JWT authentication middleware. Verifies the Bearer token and attaches the
// decoded payload as req.user ({id, email, name, role}).
const jwt = require("jsonwebtoken");
const config = require("../config");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return res
      .status(401)
      .json({ error: { message: "Token tidak ditemukan. Sertakan header Authorization: Bearer <token>." } });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
    return next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: { message: "Token tidak valid atau sudah kedaluwarsa." } });
  }
}

module.exports = requireAuth;
