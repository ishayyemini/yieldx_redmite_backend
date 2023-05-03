const { serialize, parse } = require('cookie')

const REFRESH_TOKEN_NAME = 'refresh-token'

const ACCESS_MAX_AGE = 60 * 15 // 15 minutes
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 1 month

const setTokenCookie = (req, res, refreshToken) => {
  const refreshCookie = serialize(REFRESH_TOKEN_NAME, refreshToken, {
    maxAge: REFRESH_MAX_AGE,
    expires: new Date(Date.now() + REFRESH_MAX_AGE * 1000),
    httpOnly: true,
    secure: true,
    path: '/refresh',
    sameSite:
      req.headers.origin === 'http://localhost:3000' ? 'None' : 'Strict',
  })

  res.setHeader('Set-Cookie', refreshCookie)
}

const removeTokenCookie = (res) => {
  const refreshCookie = serialize(REFRESH_TOKEN_NAME, '', {
    maxAge: -1,
    secure: true,
    path: '/',
    sameSite: 'Strict',
  })

  res.setHeader('Set-Cookie', refreshCookie)
}

const getTokens = (req) => {
  let accessToken
  if (req.headers.authorization?.split(' ')[0] === 'Bearer')
    accessToken = req.headers.authorization.split(' ')[1] ?? ''
  const cookies = req.cookies || parse(req.headers?.cookie || '')
  const refreshToken = cookies?.[REFRESH_TOKEN_NAME] ?? ''
  return [accessToken, refreshToken]
}

module.exports = {
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
  setTokenCookie,
  removeTokenCookie,
  getTokens,
}
