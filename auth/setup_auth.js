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

IF object_id('MqttStatus') is null
  CREATE TABLE MqttStatus(
    deviceID NVARCHAR(12) NOT NULL,
    server NVARCHAR(255) NOT NULL,
    timestamp DATETIME2(3) NOT NULL,
    mode NVARCHAR(255) NOT NULL,
    userID UNIQUEIDENTIFIER,
    expectedUpdateAt DATETIME2(3) NOT NULL,
    PRIMARY KEY (deviceID, server),
    startTime DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    endTime DATETIME2(3) GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (startTime, endTime)
  )
  WITH (SYSTEM_VERSIONING = ON(HISTORY_TABLE = dbo.MqttHistory))

IF object_id('Sessions') is null
  CREATE TABLE Sessions ( 
    session UNIQUEIDENTIFIER not null, 
    token UNIQUEIDENTIFIER PRIMARY KEY, 
    userID UNIQUEIDENTIFIER not null, 
    createdAt datetime2(3) not null,
    validUntil datetime2(3) not null,
    invalid bit,
    subscription NVARCHAR(MAX)
  )
`)
  await new sql.Request().query(`
CREATE OR ALTER TRIGGER Expire_Sessions_Trigger ON Sessions
FOR INSERT, UPDATE, DELETE
AS DELETE FROM Sessions WHERE validUntil < GETDATE()
`)
}

module.exports = setupAuth
