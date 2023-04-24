const express = require('express')
const sql = require('mssql')
const cors = require('cors')
const passport = require('passport')

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
  const user = await authenticate('local', req, res).catch(
    () => res.sendStatus(400) // TODO accurate error
  )
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
  res.send('Logged out')
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
