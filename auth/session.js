const Iron = require('@hapi/iron')

const { getTokenCookie, MAX_AGE, setTokenCookie } = require('./auth_cookies')

const TOKEN_SECRET = process.env.TOKEN_SECRET

const setLoginSession = async (res, userID) => {
  const createdAt = Date.now()
  // Create a session object with a max age that we can validate later
  const obj = { userID, createdAt, maxAge: MAX_AGE }
  const token = await Iron.seal(obj, TOKEN_SECRET, Iron.defaults)

  setTokenCookie(res, token)
}

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

module.exports = { getLoginSession, setLoginSession }
