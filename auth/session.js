const Iron = require('@hapi/iron')
const jwt = require('jsonwebtoken')
const { v4: uuid } = require('uuid')

const {
  createSession,
  findAndInvalidateSession,
  deleteSessions,
} = require('./db_user')
const {
  getTokens,
  setTokenCookie,
  removeTokenCookie,
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
} = require('./auth_cookies')
const { TOKEN_SECRET } = require('../tokens.json')

const setLoginSession = async (req, res, userID, prevSession) => {
  const createdAt = Date.now()
  const session = prevSession || uuid()
  const token = uuid()

  const accessToken = jwt.sign({ userID }, TOKEN_SECRET, {
    expiresIn: ACCESS_MAX_AGE,
  })

  const isValidSub =
    req.body.subscription?.endpoint && req.body.subscription?.keys

  const refreshObj = { session, token, createdAt, maxAge: REFRESH_MAX_AGE }
  const refreshToken = await Iron.seal(refreshObj, TOKEN_SECRET, Iron.defaults)
  await createSession({
    ...refreshObj,
    subscription: isValidSub ? JSON.stringify(req.body.subscription) : null,
    userID,
  })
  setTokenCookie(req, res, refreshToken)

  return accessToken
}

const getLoginSession = async (req) => {
  const [token] = getTokens(req)

  let session
  if (token) session = jwt.verify(token, TOKEN_SECRET)

  if (!token || !session) throw new Error('Unauthorized')

  return session
}

const getWSSession = async (token) => {
  let session
  if (token) session = jwt.verify(token, TOKEN_SECRET)
  if (!token || !session) throw new Error('Unauthorized')
  return session
}

const refreshLoginSession = async (req, res) => {
  const [, refreshToken] = getTokens(req)

  const refresh = await Iron.unseal(
    refreshToken,
    TOKEN_SECRET,
    Iron.defaults
  ).catch(() => {})
  if (!refresh?.session) throw new Error('Session expired')

  const dbSession = await findAndInvalidateSession(refresh)
  if (
    !dbSession ||
    Date.now() >
      new Date(dbSession.createdAt).getTime() + dbSession.maxAge * 1000
  ) {
    await deleteSessions(refresh.session)
    throw new Error('Session expired')
  }

  return await setLoginSession(req, res, dbSession.userID, dbSession.session)
}

const clearLoginSession = async (req, res) => {
  const [, refreshToken] = getTokens(req)
  const refresh = await Iron.unseal(
    refreshToken,
    TOKEN_SECRET,
    Iron.defaults
  ).catch(() => {})
  if (refresh?.session) await deleteSessions(refresh.session)
  removeTokenCookie(res)
}

module.exports = {
  getLoginSession,
  getWSSession,
  setLoginSession,
  clearLoginSession,
  refreshLoginSession,
}
