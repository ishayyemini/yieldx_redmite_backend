const crypto = require('crypto')
const sql = require('mssql')
const { v4: uuid } = require('uuid')

const createUser = async ({ username, password }) => {
  const salt = crypto.randomBytes(16)
  const user = {
    id: uuid(),
    username,
    hashedPassword: crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512'),
    salt,
    createdAt: new Date(),
  }
  await new sql.Request()
    .input('id', sql.TYPES.UniqueIdentifier, user.id)
    .input('username', sql.TYPES.NVarChar(50), user.username)
    .input('hashedPassword', sql.TYPES.VarBinary(sql.MAX), user.hashedPassword)
    .input('salt', sql.TYPES.VarBinary(sql.MAX), user.salt)
    .input('createdAt', sql.TYPES.DateTime2(3), user.createdAt)
    .query(
      `
  INSERT INTO RedMiteUsers (id, username, hashedPassword, salt, createdAt)
  VALUES (@id, @username, @hashedPassword, @salt, @createdAt)
  `
    )

  return user
}

const findUser = async ({ username }, full = false) => {
  return await new sql.Request()
    .query(`SELECT * FROM RedMiteUsers WHERE username = '${username}'`)
    .then((res) => {
      const row = res?.recordset?.[0]
      if (!row) throw new Error('User not found')
      else return full ? row : { username: row.username, id: row.id }
    })
}

const validatePassword = (user, inputPassword) => {
  const inputHash = crypto.pbkdf2Sync(
    inputPassword,
    user.salt,
    1000,
    64,
    'sha512'
  )
  return crypto.timingSafeEqual(user.hashedPassword, inputHash)
}

module.exports = { createUser, findUser, validatePassword }
