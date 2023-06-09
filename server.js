const express = require('express')
const cors = require('cors')
const passport = require('passport')
const status = require('statuses')
const expressWs = require('express-ws')
const got = require('got')

const { authenticate, localStrategy } = require('./auth/login')
const { createUser, findUserByID, updateSettings } = require('./auth/db_user')
const {
  getLoginSession,
  getWSSession,
  setLoginSession,
  clearLoginSession,
  refreshLoginSession,
} = require('./auth/session')
const setupAuth = require('./auth/setup_auth')
const {
  adminUsers,
  mqttServers,
  pushConfUpdate,
  setupMqtt,
  pushOtaUpdate,
  pushHiddenDevice,
  getOperations,
  getDetections,
} = require('./mqtt/mqtt')
const { setupSQL } = require('./sql_pools')

const app = express()
expressWs(app)

app.use(
  cors({
    credentials: true,
    origin:
      process.env.NODE_ENV === 'dev'
        ? true
        : ['https://yieldx-biosec.com', 'https://www.yieldx-biosec.com'],
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
  if (res.locals.session) next()
  else next('Unauthorized')
}

const storeData = {}
const store = {
  get: (key) => storeData[key],
  set: (key, data) => {
    if (data.status && data.conf)
      store.updateHooks.forEach((func) => func(data))
    storeData[key] = data
  },
  getAll: () =>
    Object.values(storeData).filter((item) => item.status && item.conf),
  onUpdate: (func) => store.updateHooks.push(func),
  updateHooks: [],
}

app.ws('/mqtt', (ws) => {
  let token, user
  ws.on('message', async (msg) => {
    if (!token) {
      token = msg
      user = await getWSSession(token)
        .then(findUserByID)
        .catch(() => ws.close(4004, 'Unauthorized'))
      if (user?.username) {
        ws.send('authorized')
        const sendIfCustomer = (item) => {
          const server = mqttServers.includes(user.settings?.mqtt)
            ? user.settings?.mqtt
            : mqttServers[0]
          const isCustomer = user.customer && item.customer === user.customer
          if (
            item.server === server &&
            (adminUsers.includes(user.username) || isCustomer)
          )
            ws.send(JSON.stringify(item))
        }
        store.getAll().forEach(sendIfCustomer)
        store.onUpdate(sendIfCustomer)
      }
    }
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
  const { username, id, settings } = await authenticate(
    'local',
    req,
    res
  ).catch((err) => {
    if (err.message === 'Bad request') res.status(400).send('Bad login details')
    else throw err
  })
  const accessToken = await setLoginSession(req, res, id)
  res.json({
    user: { username, id, settings, admin: adminUsers.includes(username) },
    token: accessToken,
  })
})

// Creates new access and refresh tokens if user has valid refresh token
app.post('/auth/refresh', async (req, res) => {
  const accessToken = await refreshLoginSession(req, res).catch((err) => {
    if (err.message === 'Session expired') res.sendStatus(401)
    else throw err
  })
  if (accessToken) res.json({ token: accessToken })
})

// Gets user information if authenticated
app.post('/user', withAuth, async (req, res) => {
  const { username, id, settings } = await findUserByID(res.locals.session)
  res.json({
    user: { username, id, settings, admin: adminUsers.includes(username) },
  })
})

app.post('/update-settings', withAuth, async (req, res) => {
  const { username } = await findUserByID(res.locals.session)
  if (!adminUsers.includes(username)) res.sendStatus(401)
  if (!req.body.settings) res.sendStatus(400)
  else
    await updateSettings(res.locals.session, req.body.settings).then(
      (newSettings) => res.json({ settings: newSettings })
    )
})

app.post('/update-device-conf', withAuth, async (req, res) => {
  const user = await findUserByID(res.locals.session)
  await pushConfUpdate(req.body, user)
  res.sendStatus(200)
})

app.post('/hide-device', withAuth, async (req, res) => {
  if (!req.body.id) res.status(400).send('Missing required parameters')
  else {
    const user = await findUserByID(res.locals.session)
    await pushHiddenDevice(req.body, user, store)
    res.sendStatus(200)
  }
})

app.post('/update-device-ota', withAuth, async (req, res) => {
  const { id, version } = req.body
  if (!id || !version) res.status(400).send('Missing required parameters')
  else {
    const user = await findUserByID(res.locals.session)
    await pushOtaUpdate(id, version, user, store)
    res.sendStatus(200)
  }
})

app.post('/auth/signup', async (req, res) => {
  const user = await createUser(req.body) // TODO custom errors
  await setLoginSession(req, res, user.id)
  res.json({
    user: {
      username: user.username,
      id: user.id,
      settings: {},
      admin: adminUsers.includes(user.username),
    },
  })
})

app.post('/auth/logout', async (req, res) => {
  await clearLoginSession(req, res)
  res.sendStatus(200)
})

app.get('/list-ota', withAuth, async (req, res) => {
  const versions = await got
    .get('http://3.127.195.30/RedMite/OTA/')
    .text()
    .then(
      (r) =>
        r
          .match(/a href="\/RedMite\/OTA\/[^"]+.bin/gi)
          ?.map((item) =>
            item.replace(/a href="\/RedMite\/OTA\/|\.bin/gi, '')
          ) || []
    )
    .catch((err) => {
      console.log(err)
      return []
    })
  res.json({ otaList: versions })
})

app.get('/get-device-history', withAuth, async (req, res) => {
  const { id, server } = req.query
  if (!id || !server) res.status(400).send('Missing required parameters')
  else {
    const user = await findUserByID(res.locals.session)
    await getOperations({ id, server }, user, store)
      .then((operations) => res.json({ deviceHistory: operations }))
      .catch((err) => {
        if (err.message === 'Unauthorized') res.status(401).send(err.message)
        else if (err.message === 'Device not found')
          res.status(404).send(err.message)
        else throw err
      })
  }
})

app.get('/get-device-detections', withAuth, async (req, res) => {
  const { id, server } = req.query
  if (!id || !server) res.status(400).send('Missing required parameters')
  else {
    const user = await findUserByID(res.locals.session)
    await getDetections({ id, server }, user, store)
      .then((detections) => res.json({ detections }))
      .catch((err) => {
        if (err.message === 'Unauthorized') res.status(401).send(err.message)
        else if (err.message === 'Device not found')
          res.status(404).send(err.message)
        else throw err
      })
  }
})

app.use((err, req, res, next) => {
  console.error(err)
  if (res?.headersSent) return next(err)
  if (res?.status) {
    if (err?.message) res.status(500).send(err.message)
    else res.sendStatus(500)
  }
})

setupSQL().then(async () => {
  await setupAuth()
  setupMqtt(store)
  app.listen(process.env.PORT || 4000, () => {
    console.log('Server Running on PORT', process.env.PORT || 4000)
  })
})
