const express = require('express')
const sql = require('mssql')
const cors = require('cors')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const crypto = require('crypto')

const app = express()

app.use(cors())
app.use(express.json())

passport.use(
  new LocalStrategy((username, password, cb) => {
    console.log(username)
    new sql.Request().query(
      `SELECT * FROM RedMiteUsers WHERE username = '${username}'`,
      (err, res) => {
        const row = res?.recordset?.[0]
        if (err) {
          return cb(err)
        }
        if (!row) {
          return cb(null, false, { message: 'Incorrect username or password.' })
        }

        crypto.pbkdf2(
          password,
          row.salt,
          310000,
          32,
          'sha256',
          (err, hashedPassword) => {
            if (err) {
              return cb(err)
            }
            if (!crypto.timingSafeEqual(row.hashed_password, hashedPassword)) {
              return cb(null, false, {
                message: 'Incorrect username or password.',
              })
            }
            return cb(null, row)
          }
        )
      }
    )
  })
)

app.get('/test', (req, res) => {
  res.send('test ok!')
})

app.get('/', (req, res) => {
  res.send('welcome to the redmite backend (:')
})

app.get('/fail', (req, res) => {
  res.send('failed to login')
})

app.post(
  '/login',
  passport.authenticate('local', {}, (err, res) => {
    console.log(err)
    console.log(res)
  })
)

const config = {
  user: 'sa',
  password: 'Yieldxbiz2021',
  server: 'localhost',
  database: 'ishay',
  options: { encrypt: false },
}
sql.connect(config).then(() => {
  app.listen(process.env.PORT || 4000, () => {
    console.log('Server Running on PORT', process.env.PORT)
  })
})

sql.on('error', (err) => {
  console.log(err)
})
