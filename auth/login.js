const passport = require('passport')
const Iron = require('@hapi/iron')
const Local = require('passport-local')

const { MAX_AGE, setTokenCookie } = require('./auth_cookies')
const { findUser, validatePassword } = require('./db_user')

const TOKEN_SECRET = process.env.TOKEN_SECRET

const localStrategy = new Local.Strategy({}, (username, password, cb) => {
  findUser({ username }, true)
    .then((user) => {
      if (user && validatePassword(user, password)) cb(null, user)
      else cb(new Error('Invalid username and password combination'))
    })
    .catch((error) => {
      console.log(error)
      cb(new Error('Invalid username and password combination'))
    })
})

const authenticate = (method, req, res) =>
  new Promise((resolve, reject) => {
    passport.authenticate(method, { session: false }, (error, token) => {
      if (error) {
        reject(error)
      } else {
        resolve(token)
      }
    })(req, res)
  })

const setLoginSession = async (res, session) => {
  const createdAt = Date.now()
  // Create a session object with a max age that we can validate later
  const obj = { ...session, createdAt, maxAge: MAX_AGE }
  const token = await Iron.seal(obj, TOKEN_SECRET, Iron.defaults)

  setTokenCookie(res, token)
}

module.exports = {
  authenticate,
  setLoginSession,
  localStrategy,
}
