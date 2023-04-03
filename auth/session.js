const Iron = require('@hapi/iron')

const { getTokenCookie } = require('./auth_cookies')

const TOKEN_SECRET = process.env.TOKEN_SECRET

const getLoginSession = async (req) => {
  const token = getTokenCookie(req)

  if (!token) return

  const session = await Iron.unseal(token, TOKEN_SECRET, Iron.defaults)
  const expiresAt = session.createdAt + session.maxAge * 1000

  // Validate the expiration date of the session
  if (Date.now() > expiresAt) {
    throw new Error('Session expired')
  }

  return session
}

module.exports = { getLoginSession }
