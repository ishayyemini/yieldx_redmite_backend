const sql = require('mssql')
const crypto = require('crypto')
const { v4: uuid } = require('uuid')

const username = 'lior'
const password = '1234'

const config = {
  user: 'sa',
  password: 'Yieldxbiz2021',
  server: 'localhost',
  database: 'ishay',
  options: { encrypt: false },
}
sql.connect(config).then(() => {
  const salt = crypto.randomBytes(16)
  new sql.Request()
    .input('id', sql.TYPES.UniqueIdentifier(), uuid())
    .input('username', sql.TYPES.NVarChar(50), username)
    .input(
      'hashedPassword',
      sql.TYPES.VarBinary(sql.MAX),
      crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha512')
    )
    .input('salt', sql.TYPES.VarBinary(sql.MAX), salt)
    .query(
      `
  INSERT INTO RedMiteUsers (id, username, hashedPassword, salt)
  VALUES (@id, @username, @hashedPassword, @salt)
  `
    )
    .then(() => {
      sql.close()
    })
})
