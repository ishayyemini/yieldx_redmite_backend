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

const findUser = ({ username }) => {
  return new sql.Request()
    .query(`SELECT * FROM RedMiteUsers WHERE username = '${username}'`)
    .then((res) => {
      const row = res?.recordset?.[0]
      if (!row) throw new Error('User not found')
      else return row
    })
}

const findUserByID = async ({ userID }) => {
  return await new sql.Request()
    .query(`SELECT * FROM RedMiteUsers WHERE id = '${userID}'`)
    .then((res) => {
      const row = res?.recordset?.[0]
      if (!row) throw new Error('User not found')
      else return row
    })
}

const updateSettings = async ({ userID }, settings) => {
  let newSettings = `(CASE WHEN ISJSON(RedMiteUsers.settings) = 1 
                         THEN RedMiteUsers.settings
                         ELSE '{}' END)`
  Object.entries(settings).forEach(
    ([key, value]) =>
      (newSettings = `JSON_MODIFY(${newSettings}, '$.${key}', '${value}')`)
  )
  return new sql.Request()
    .query(
      `
  UPDATE RedMiteUsers
  SET settings = ${newSettings}
  OUTPUT INSERTED.settings
  WHERE id = '${userID}'  
`
    )
    .then((res) => JSON.parse(res?.recordset?.[0]?.settings || '{}'))
}

const createSession = async ({ session, token, userID, createdAt, maxAge }) => {
  await new sql.Request()
    .input('session', sql.TYPES.UniqueIdentifier, session)
    .input('token', sql.TYPES.UniqueIdentifier, token)
    .input('userID', sql.TYPES.NVarChar(50), userID)
    .input('createdAt', sql.TYPES.DateTime2(3), new Date(createdAt))
    .input(
      'validUntil',
      sql.TYPES.DateTime2(3),
      new Date(createdAt + 1000 * maxAge)
    )
    .query(
      `
  INSERT INTO Sessions (session, token, userID, createdAt, validUntil)
  VALUES (@session, @token, @userID, @createdAt, @validUntil)
  `
    )
}

const deleteSessions = (session) => {
  return new sql.Request().query(`DELETE Sessions WHERE session = '${session}'`)
}

const findAndInvalidateSession = ({ session, token }) => {
  return new sql.Request()
    .query(
      `
  SELECT * 
  FROM Sessions 
  WHERE COALESCE(invalid, 'false') != 'true' and session = '${session}' and
        token = '${token}'

  UPDATE Sessions 
  SET invalid = 1 
  WHERE COALESCE(invalid, 'false') != 'true' and session = '${session}' and
        token = '${token}'
    `
    )
    .then((res) => res?.recordset?.[0])
}

module.exports = {
  createUser,
  findUser,
  findUserByID,
  createSession,
  findAndInvalidateSession,
  deleteSessions,
  updateSettings,
}
