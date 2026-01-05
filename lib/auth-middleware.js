/**
 * Authentication Middleware Module
 */

// Access token configuration
const ACCESS_TOKENS_RAW = process.env.YDC_OPENAI_ACCESS_TOKENS || '';
const ACCESS_TOKENS = ACCESS_TOKENS_RAW.split(',').map(t => t.trim()).filter(t => t);
const REQUIRE_TOKEN_AUTH = ACCESS_TOKENS.length > 0;

/**
 * Authentication middleware for Express
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        message: 'Invalid authentication credentials',
        type: 'invalid_request_error',
        code: 'invalid_api_key'
      }
    });
  }

  if (REQUIRE_TOKEN_AUTH) {
    const token = authHeader.slice(7);
    if (!ACCESS_TOKENS.includes(token)) {
      return res.status(401).json({
        error: {
          message: 'Invalid access token',
          type: 'invalid_request_error',
          code: 'invalid_access_token'
        }
      });
    }
  }

  next();
}

export const authConfig = {
  REQUIRE_TOKEN_AUTH,
  ACCESS_TOKENS_COUNT: ACCESS_TOKENS.length
};
