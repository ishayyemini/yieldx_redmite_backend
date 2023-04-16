const Iron = require('@hapi/iron')
const { v4: uuid } = require('uuid')

const { createSession } = require('./db_user')
const {
  getTokenCookie,
  setTokenCookie,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
} = require('./auth_cookies')

const TOKEN_SECRET = process.env.TOKEN_SECRET

const setLoginSession = async (res, userID) => {
  const createdAt = Date.now()
  const sid = uuid()

  const accessToken = await Iron.seal(
    { userID, createdAt, maxAge: ACCESS_MAX_AGE },
    TOKEN_SECRET,
    Iron.defaults
  )
  const refreshToken = await Iron.seal(
    { sid, createdAt, maxAge: REFRESH_MAX_AGE },
    TOKEN_SECRET,
    Iron.defaults
  )
  await createSession(sid, userID, createdAt)

  setTokenCookie(res, accessToken, refreshToken)
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
