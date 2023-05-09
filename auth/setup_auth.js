const sql = require('mssql')

const setupAuth = async () => {
  await new sql.Request().query(`
IF object_id('RedMiteUsers') is null
  CREATE TABLE RedMiteUsers ( 
    id UNIQUEIDENTIFIER PRIMARY KEY, 
    username NVARCHAR(50) UNIQUE not null, 
    hashedPassword varBinary(MAX) not null, 
    salt varBinary(MAX),
    createdAt datetime2(3),
    settings NVARCHAR(MAX)
  )

IF object_id('Sessions') is null
  CREATE TABLE Sessions ( 
    session UNIQUEIDENTIFIER not null, 
    token UNIQUEIDENTIFIER PRIMARY KEY, 
    userID UNIQUEIDENTIFIER not null, 
    createdAt datetime2(3) not null,
    validUntil datetime2(3) not null,
    invalid bit 
  )
`)
  await new sql.Request().query(`
CREATE OR ALTER TRIGGER Expire_Sessions_Trigger ON Sessions
FOR INSERT, UPDATE, DELETE
AS DELETE FROM Sessions WHERE validUntil < GETDATE()
`)
}

module.exports = setupAuth
