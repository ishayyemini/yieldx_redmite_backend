const sql = require('mssql')
const crypto = require('crypto')

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
    .input(
      'hashed_password',
      sql.TYPES.VarBinary(sql.MAX),
      crypto.pbkdf2Sync('1234', salt, 310000, 32, 'sha512')
    )
    .input('salt', sql.TYPES.VarBinary(sql.MAX), salt)
    .query(
      `
  INSERT INTO RedMiteUsers (username, hashed_password, salt)
  VALUES ('ishay', @hashed_password, @salt)
  `
    )
    .then(() => {
      sql.close()
    })
})
