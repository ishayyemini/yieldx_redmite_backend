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
    .input('hashedPassword', sql.TYPES.VarBinary(sql.MAX), user.hashedPassword)
    .input('salt', sql.TYPES.VarBinary(sql.MAX), user.salt)
    .query(
      `
          INSERT INTO RedMiteUsers (id, username, hashedPassword, salt,
                                    createdAt)
          VALUES ('${user.id}', '${user.username}',
                  ${'@hashedPassword' + ', ' + '@salt'},
                  '${user.createdAt.toISOString()}')
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
      row.settings = JSON.parse(row.settings || '{}')
      return row
    })
}

const findUserByID = async ({ userID }) => {
  return await new sql.Request()
    .query(`SELECT * FROM RedMiteUsers WHERE id = '${userID}'`)
    .then((res) => {
      const row = res?.recordset?.[0]
      if (!row) throw new Error('User not found')
      row.settings = JSON.parse(row.settings || '{}')
      return row
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

const createSession = async ({
  session,
  token,
  userID,
  createdAt,
  maxAge,
  subscription,
}) => {
  await new sql.Request().query(
    `
          INSERT INTO Sessions (session, token, userID, createdAt, validUntil, 
                                subscription)
          VALUES ('${session}', '${token}', '${userID}', 
                  '${new Date(createdAt).toISOString()}', 
                  '${new Date(createdAt + 1000 * maxAge).toISOString()}', 
                  ${subscription ? `'${subscription}'` : 'null'})
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

const upsertMqttDevice = (device) => {
  const { deviceID, server, timestamp, mode, customer, expectedUpdateAt } =
    device
  return new sql.Request().query(
    `
  MERGE MqttStatus
  USING ( 
    VALUES ('${deviceID}', '${server}', '${timestamp}', '${mode}', 
            '${customer}', '${expectedUpdateAt}')
  ) AS foo (deviceID, server, timestamp, mode, customer, expectedUpdateAt) 
  ON MqttStatus.deviceID = foo.deviceID and MqttStatus.server = foo.server 
  WHEN MATCHED and MqttStatus.timestamp != foo.timestamp THEN
    UPDATE SET timestamp = foo.timestamp, mode = foo.mode, 
               customer = foo.customer, expectedUpdateAt = foo.expectedUpdateAt
  WHEN NOT MATCHED THEN
     INSERT (deviceID, server, timestamp, mode, customer, expectedUpdateAt)
     VALUES (foo.deviceID, foo.server, foo.timestamp, foo.mode, foo.customer,
             foo.expectedUpdateAt)
  ;
`
  )
}

const getMqttDevices = (from) => {
  return new sql.Request()
    .query(
      `
    SELECT * FROM MqttStatus
    WHERE timestamp >= '${from}'
  `
    )
    .then((res) => res?.recordset || [])
    .catch((err) => {
      console.log(err)
      return []
    })
}

const getPushSubscriptions = (customers) => {
  return new sql.Request()
    .query(
      `
    SELECT session, subscription
    FROM Sessions
    JOIN RedMiteUsers RMU on Sessions.userID = RMU.id
    WHERE subscription is not null and COALESCE(invalid, 'false') != 'true' and
          customer in (${"'" + customers.join("', '") + "'"})
  `
    )
    .then(
      (res) =>
        res?.recordset
          ?.filter((row) => row?.subscription)
          .map((row) => ({
            session: row.session,
            subscription: JSON.parse(row.subscription),
          })) || []
    )
    .catch((err) => {
      console.log(err)
      return []
    })
}

const clearBadSubscriptions = (sessions) =>
  new sql.Request()
    .query(
      `
    UPDATE Sessions
    SET subscription = null
    WHERE session in (${"'" + sessions.join("', '") + "'"})
  `
    )
    .catch((err) => console.log(err))

module.exports = {
  createUser,
  findUser,
  findUserByID,
  createSession,
  findAndInvalidateSession,
  deleteSessions,
  updateSettings,
  upsertMqttDevice,
  getMqttDevices,
  getPushSubscriptions,
  clearBadSubscriptions,
}
