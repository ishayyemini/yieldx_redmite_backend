const express = require('express')
const sql = require('mssql')
const cors = require('cors')
const passport = require('passport')
const status = require('statuses')

const { authenticate, localStrategy } = require('./auth/login')
const { createUser, findUserByID } = require('./auth/db_user')
const {
  getLoginSession,
  setLoginSession,
  clearLoginSession,
} = require('./auth/session')
const setupAuth = require('./auth/setup_auth')

const app = express()

app.use(cors({ credentials: true, origin: true }))
app.use(express.json())
app.use((req, res, next) => {
  const oldJson = res.json
  const oldSend = res.send
  res.sendStatus = (...args) => {
    res.status(args[0]).json(
      args[0] === 200
        ? { data: {} }
        : {
            error: {
              code: args[0],
              message: status(args[0]),
            },
          }
    )
  }
  res.send = (data, ...args) => {
    oldSend.apply(res, [
      res.statusCode !== 200
        ? JSON.stringify({ error: { code: res.statusCode, message: data } })
        : data,
      ...args,
    ])
  }
  res.json = (data, ...args) => {
    oldJson.apply(res, [data.error || data.data ? data : { data }, ...args])
  }
  next()
})
passport.use('local', localStrategy)

const withAuth = async (req, res, next) => {
  res.locals.session = await getLoginSession(req, res).catch((e) => {
    console.log(e)
    res.sendStatus(401)
  })
  next()
}

app.get('/test', (req, res) => {
  res.send('test ok!')
})

app.get('/', (req, res) => {
  res.send('welcome to the redmite backend (:')
})

app.get('/fail', (req, res) => {
  res.send('failed to login')
})

app.post('/login', async (req, res) => {
  const user = await authenticate('local', req, res).catch((err) => {
    if (err.message === 'Bad request') res.status(400).send('Bad login details')
    else throw err
  })
  await setLoginSession(res, user.id)
  res.json({ user: { username: user.username, id: user.id } })
})

app.post('/user', withAuth, async (req, res) => {
  const user = await findUserByID(res.locals.session)
  res.json({ user: { username: user.username, id: user.id } })
})

app.post('/signup', async (req, res) => {
  const user = await createUser(req.body) // TODO custom errors
  await setLoginSession(res, user.id)
  res.json({ user: { username: user.username, id: user.id } })
})

app.post('/logout', async (req, res) => {
  await clearLoginSession(req, res)
  res.sendStatus(200)
})
app.use((err, req, res, next) => {
  if (res?.headersSent) return next(err)
  if (res?.status) {
    if (err?.message) res.status(500).send(err.message)
    else res.sendStatus(500)
  }
})

const config = {
  user: 'sa',
  password: 'Yieldxbiz2021',
  server: 'localhost',
  database: 'ishay',
  options: { encrypt: false },
}
sql.connect(config).then(async () => {
  await setupAuth()
  app.listen(process.env.PORT || 4000, () => {
    console.log('Server Running on PORT', process.env.PORT || 4000)
  })
})

sql.on('error', (err) => {
  console.log(err)
})
