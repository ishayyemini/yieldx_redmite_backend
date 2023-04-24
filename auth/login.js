const passport = require('passport')
const Local = require('passport-local')
const crypto = require('crypto')

const { findUser } = require('./db_user')

const localStrategy = new Local.Strategy({}, (username, password, cb) => {
  findUser({ username })
    .then((user) => {
      if (validatePassword(user, password)) cb(null, user)
      else cb(new Error('Bad request'))
    })
    .catch((error) => {
      console.log(error)
      cb(
        new Error(
          error.message === 'User not found' ? 'Bad request' : 'Server error'
        )
      )
    })
})

const authenticate = (method, req, res) =>
  new Promise((resolve, reject) => {
    passport.authenticate(method, { session: false }, (error, token) => {
      if (error) reject(error)
      else if (!token) reject(new Error('Bad request'))
      else resolve(token)
    })(req, res)
  })

const validatePassword = (user, inputPassword) => {
  const inputHash = crypto.pbkdf2Sync(
    inputPassword,
    user.salt,
    1000,
    64,
    'sha512'
  )
  console.log(user.hashedPassword)
  return crypto.timingSafeEqual(user.hashedPassword, inputHash)
}

module.exports = { authenticate, localStrategy }
