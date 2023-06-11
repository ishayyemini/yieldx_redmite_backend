const { Request, ConnectionPool } = require('mssql')

const configs = {
  a: {
    user: 'sa',
    password: 'Yieldxbiz2021',
    server: process.env.NODE_ENV === 'dev' ? '3.127.195.30' : 'localhost',
    database: process.env.NODE_ENV === 'dev' ? 'ishay' : 'yx_rm',
    options: { encrypt: false },
  },
  b: {
    user: 'sa',
    password: 'Yieldxbiz2023',
    server: '3.64.31.133',
    database: 'Sensors',
    options: { encrypt: false },
  },
}

const pools = {}

const setupSQL = async () => {
  pools.a = await new ConnectionPool(configs.a).connect()
  pools.b = await new ConnectionPool(configs.b).connect()

  pools.a.on('error', (err) => {
    console.log(err)
  })
  pools.b.on('error', (err) => {
    console.log(err)
  })
}

const getPool = async (key) => {
  if (key === 'a' || key === 'b') {
    return new Request(
      pools[key] || (await new ConnectionPool(configs[key]).connect())
    )
  }
}

const closeAllPools = () => {
  pools.forEach((pool) => pool.close())
}

module.exports = {
  setupSQL,
  closeAllPools,
  getPool,
}
