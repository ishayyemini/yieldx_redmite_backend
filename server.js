const express = require('express')
const sql = require('mssql')
const cors = require('cors')
const passport = require('passport')
const status = require('statuses')
const expressWs = require('express-ws')

const { authenticate, localStrategy } = require('./auth/login')
const { createUser, findUserByID } = require('./auth/db_user')
const {
  getLoginSession,
  setLoginSession,
  clearLoginSession,
  refreshLoginSession,
} = require('./auth/session')
const setupAuth = require('./auth/setup_auth')

const app = express()
expressWs(app)

app.use(
  cors({
    credentials: true,
    origin: ['https://yieldx-biosec.com', 'http://localhost:3000'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
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
      res.statusCode !== 200 && !data.startsWith('{')
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
  // For now, session contains just the userID
  res.locals.session = await getLoginSession(req).catch((e) => {
    console.log(e)
    res.sendStatus(401)
  })
  next()
}

app.ws('/echo', (ws) => {
  ws.on('message', (msg) => {
    ws.send(msg)
  })
})

app.get('/test', (req, res) => {
  res.send('test ok!')
})

app.get('/', (req, res) => {
  res.send('welcome to the redmite backend (:')
})

app.get('/fail', (req, res) => {
  res.send('failed to login')
})

// Validates user credentials, creates session and returns tokens
app.post('/auth/login', async (req, res) => {
  const { username, id } = await authenticate('local', req, res).catch(
    (err) => {
      if (err.message === 'Bad request')
        res.status(400).send('Bad login details')
      else throw err
    }
  )
  const accessToken = await setLoginSession(req, res, id)
  res.json({ user: { username, id }, token: accessToken })
})

// Creates new access and refresh tokens if user has valid refresh token
app.post('/auth/refresh', async (req, res) => {
  const accessToken = await refreshLoginSession(req, res).catch((err) => {
    if (err.message === 'Session expired') res.sendStatus(401)
    else throw err
  })
  res.json({ token: accessToken })
})

// Gets user information if authenticated
app.post('/user', withAuth, async (req, res) => {
  const { username, id } = await findUserByID(res.locals.session)
  res.json({ user: { username, id } })
})

app.post('/auth/signup', async (req, res) => {
  const user = await createUser(req.body) // TODO custom errors
  await setLoginSession(req, res, user.id)
  res.json({ user: { username: user.username, id: user.id } })
})

app.post('/auth/logout', async (req, res) => {
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
