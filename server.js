const express = require('express')
const sql = require('mssql')
const cors = require('cors')
const passport = require('passport')

const { authenticate, localStrategy, setLoginSession } = require('./auth/login')
const { createUser, findUser } = require('./auth/db_user')
const { getLoginSession } = require('./auth/session')
const setupAuth = require('./auth/setup_auth')

const app = express()

app.use(cors())
app.use(express.json())
passport.use('local', localStrategy)

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
  try {
    const user = await authenticate('local', req, res)
    await setLoginSession(res, { ...user })
    res.status(200).send({ done: true })
  } catch (error) {
    console.error(error)
    res.status(401).send(error.message)
  }
})

app.post('/user', async (req, res) => {
  try {
    const session = await getLoginSession(req)
    const user = (session && (await findUser(session))) ?? null
    res.status(200).json({ user })
  } catch (error) {
    console.error(error)
    res.status(500).send('Authentication token is invalid, please log in')
  }
})

app.post('/signup', async (req, res) => {
  try {
    const user = await createUser(req.body)
    await setLoginSession(res, { ...user })
    res.status(200).send({ done: true })
  } catch (error) {
    console.error(error)
    res.status(500).send(error.message)
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
    console.log('Server Running on PORT', process.env.PORT)
  })
})

sql.on('error', (err) => {
  console.log(err)
})
