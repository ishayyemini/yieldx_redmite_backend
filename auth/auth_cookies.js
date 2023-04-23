const { serialize, parse } = require('cookie')

const ACCESS_TOKEN_NAME = 'access-token'
const REFRESH_TOKEN_NAME = 'refresh-token'

const ACCESS_MAX_AGE = 60 * 60 * 8 // 8 hours
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30 // 1 month

const setTokenCookie = (res, accessToken, refreshToken) => {
  const accessCookie = serialize(ACCESS_TOKEN_NAME, accessToken, {
    maxAge: ACCESS_MAX_AGE,
    expires: new Date(Date.now() + ACCESS_MAX_AGE * 1000),
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: 'None',
  })
  const refreshCookie = serialize(REFRESH_TOKEN_NAME, refreshToken, {
    maxAge: REFRESH_MAX_AGE,
    expires: new Date(Date.now() + REFRESH_MAX_AGE * 1000),
    httpOnly: true,
    secure: true,
    path: '/',
    sameSite: 'None',
  })

  res.setHeader('Set-Cookie', [accessCookie, refreshCookie])
}

const removeTokenCookie = (res) => {
  const cookie = serialize(ACCESS_TOKEN_NAME, '', {
    maxAge: -1,
    path: '/',
  })

  res.setHeader('Set-Cookie', cookie)
}

const parseCookies = (req) => {
  // For API Routes we don't need to parse the cookies.
  if (req.cookies) return req.cookies

  // For pages we do need to parse the cookies.
  const cookie = req.headers?.cookie
  return parse(cookie || '')
}

const getTokenCookie = (req) => {
  const cookies = parseCookies(req)
  return [cookies[ACCESS_TOKEN_NAME], cookies[REFRESH_TOKEN_NAME]]
}

module.exports = {
  ACCESS_MAX_AGE,
  REFRESH_MAX_AGE,
  setTokenCookie,
  removeTokenCookie,
  parseCookies,
  getTokenCookie,
}
