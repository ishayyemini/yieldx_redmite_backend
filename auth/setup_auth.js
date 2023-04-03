const sql = require('mssql')

const setupAuth = async () =>
  await new sql.Request().query(`
IF object_id('RedMiteUsers') is null
  CREATE TABLE RedMiteUsers ( 
    id UNIQUEIDENTIFIER PRIMARY KEY, 
    username NVARCHAR(50) UNIQUE not null, 
    hashedPassword varBinary(MAX) not null, 
    salt varBinary(MAX),
    createdAt datetime2(3)
  )
`)

module.exports = setupAuth
