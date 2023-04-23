const Iron = require('@hapi/iron')
const { v4: uuid } = require('uuid')

const { createSession, findAndDeleteSession } = require('./db_user')
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
  await createSession(sid, userID, createdAt, REFRESH_MAX_AGE)

  setTokenCookie(res, accessToken, refreshToken)

  return { userID, createdAt, maxAge: ACCESS_MAX_AGE }
}

const getLoginSession = async (req, res) => {
  const [token, refreshToken] = getTokenCookie(req)

  let session, expiresAt
  if (token) {
    session = await Iron.unseal(token, TOKEN_SECRET, Iron.defaults)
    expiresAt = session.createdAt + session.maxAge * 1000
  }
  if ((!token || Date.now() > expiresAt) && refreshToken)
    session = replaceLoginSession(res, refreshToken)

  return session
}

const replaceLoginSession = async (res, refreshToken) => {
  const refresh = await Iron.unseal(refreshToken, TOKEN_SECRET, Iron.defaults)
  if (!refresh?.sid) throw new Error('Session expired')

  const dbSession = await findAndDeleteSession(refresh)
  if (
    !dbSession ||
    Date.now() >
      new Date(dbSession.createdAt).getTime() + dbSession.maxAge * 1000
  )
    throw new Error('Session expired')

  return await setLoginSession(res, dbSession.userID)
}

module.exports = { getLoginSession, setLoginSession }
