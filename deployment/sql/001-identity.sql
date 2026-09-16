-- Additive migration, scoped to the existing CMMS database.
USE [BASF_CHEMCAT_CMMS];
GO
IF SCHEMA_ID('cmms_auth') IS NULL EXEC('CREATE SCHEMA cmms_auth AUTHORIZATION dbo');
GO
IF OBJECT_ID('cmms_auth.Users','U') IS NULL
CREATE TABLE cmms_auth.Users (
  UserId varchar(24) NOT NULL PRIMARY KEY,
  Username varchar(50) NOT NULL UNIQUE,
  DisplayName nvarchar(100) NOT NULL,
  RoleCode varchar(30) NOT NULL CHECK(RoleCode IN ('ADMINISTRATOR','PLANNER','TECHNICIAN','PRODUCTION')),
  IsActive bit NOT NULL,
  Version int NOT NULL CHECK(Version>0),
  PasswordHash varchar(200) NOT NULL,
  CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('cmms_auth.IdentityState','U') IS NULL
CREATE TABLE cmms_auth.IdentityState (
  Id tinyint NOT NULL PRIMARY KEY CHECK(Id=1),
  UsersRevision int NOT NULL DEFAULT 0,
  PermissionsJson nvarchar(max) NOT NULL CHECK(ISJSON(PermissionsJson)=1)
);
IF OBJECT_ID('cmms_auth.AuditLog','U') IS NULL
CREATE TABLE cmms_auth.AuditLog (
  AuditId bigint IDENTITY PRIMARY KEY,
  OccurredAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
  Actor nvarchar(100) NOT NULL,
  Operation varchar(30) NOT NULL,
  Target nvarchar(100) NOT NULL,
  Details nvarchar(max) NULL
);
GO
CREATE OR ALTER PROCEDURE cmms_auth.usp_IdentityStorage
  @Operation varchar(30), @BodyJson nvarchar(max)=N'{}'
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @Operation NOT IN ('READ','SAVE_USER','SAVE_PERMISSIONS') THROW 51000,'Unsupported operation',1;
  IF ISJSON(@BodyJson)<>1 THROW 51000,'Invalid JSON',1;
  IF NOT EXISTS(SELECT 1 FROM cmms_auth.IdentityState WHERE Id=1) THROW 51000,'Identity storage not initialized',1;
  IF @Operation <> 'READ'
  BEGIN
    BEGIN TRANSACTION;
    BEGIN TRY
      DECLARE @UsersRevision int,@Policy nvarchar(max),@Expected int=TRY_CONVERT(int,JSON_VALUE(@BodyJson,'$.revision'));
      SELECT @UsersRevision=UsersRevision,@Policy=PermissionsJson FROM cmms_auth.IdentityState WITH(UPDLOCK,HOLDLOCK) WHERE Id=1;
      DECLARE @Actor nvarchar(100)=JSON_VALUE(@BodyJson,'$.actor');
      IF @Actor IS NULL THROW 51000,'Actor required',1;
      IF @Operation='SAVE_USER'
      BEGIN
        IF @Expected IS NULL OR @Expected<>@UsersRevision THROW 51009,'Revision conflict',1;
        DECLARE @Id varchar(24)=JSON_VALUE(@BodyJson,'$.user.id'),
          @Username varchar(50)=JSON_VALUE(@BodyJson,'$.user.username'),
          @DisplayName nvarchar(100)=JSON_VALUE(@BodyJson,'$.user.displayName'),
          @Role varchar(30)=JSON_VALUE(@BodyJson,'$.user.role'),
          @Active bit=CASE JSON_VALUE(@BodyJson,'$.user.active') WHEN 'true' THEN 1 WHEN 'false' THEN 0 END,
          @Version int=TRY_CONVERT(int,JSON_VALUE(@BodyJson,'$.user.version')),
          @Hash varchar(200)=JSON_VALUE(@BodyJson,'$.user.passwordHash');
        IF LEN(@Id)<>24 OR LEN(@Username)<3 OR NULLIF(@DisplayName,'') IS NULL OR @Active IS NULL OR @Version IS NULL OR LEN(@Hash)<>161 OR SUBSTRING(@Hash,33,1)<>':' THROW 51000,'Invalid user',1;
        IF @Id=@Actor AND (@Active=0 OR @Role<>'ADMINISTRATOR') THROW 51000,'Cannot disable own administrator',1;
        IF EXISTS(SELECT 1 FROM cmms_auth.Users WHERE UserId=@Id AND IsActive=1 AND RoleCode='ADMINISTRATOR') AND (@Active=0 OR @Role<>'ADMINISTRATOR')
          AND NOT EXISTS(SELECT 1 FROM cmms_auth.Users WHERE UserId<>@Id AND IsActive=1 AND RoleCode='ADMINISTRATOR') THROW 51000,'Last administrator required',1;
        IF EXISTS(SELECT 1 FROM cmms_auth.Users WHERE UserId=@Id)
        BEGIN
          IF @Version<>(SELECT Version+1 FROM cmms_auth.Users WHERE UserId=@Id) THROW 51009,'User version conflict',1;
          UPDATE cmms_auth.Users SET Username=@Username,DisplayName=@DisplayName,RoleCode=@Role,IsActive=@Active,Version=@Version,PasswordHash=@Hash,UpdatedAt=SYSUTCDATETIME() WHERE UserId=@Id;
        END
        ELSE
        BEGIN
          IF @Version<>1 THROW 51000,'Invalid initial version',1;
          INSERT cmms_auth.Users(UserId,Username,DisplayName,RoleCode,IsActive,Version,PasswordHash) VALUES(@Id,@Username,@DisplayName,@Role,@Active,@Version,@Hash);
        END;
        UPDATE cmms_auth.IdentityState SET UsersRevision=UsersRevision+1 WHERE Id=1;
        INSERT cmms_auth.AuditLog(Actor,Operation,Target,Details) VALUES(@Actor,@Operation,@Id,JSON_MODIFY(JSON_QUERY(@BodyJson,'$.user'),'$.passwordHash',NULL));
      END
      ELSE
      BEGIN
        IF @Expected IS NULL OR @Expected<>TRY_CONVERT(int,JSON_VALUE(@Policy,'$.revision')) THROW 51009,'Revision conflict',1;
        DECLARE @PolicyRole varchar(30)=JSON_VALUE(@BodyJson,'$.role'),@Value nvarchar(max)=JSON_QUERY(@BodyJson,'$.permissions');
        IF @PolicyRole NOT IN ('PLANNER','TECHNICIAN','PRODUCTION') OR @PolicyRole IS NULL OR @Value IS NULL THROW 51000,'Invalid role policy',1;
        DECLARE @RolePath nvarchar(100)='$.roles.'+@PolicyRole,@VersionPath nvarchar(100)='$.roleVersions.'+@PolicyRole;
        DECLARE @Change nvarchar(max)=(SELECT CONVERT(varchar(33),SYSUTCDATETIME(),126)+'Z' AS [at],@Actor AS [by],@PolicyRole AS [role],JSON_QUERY(@Policy,@RolePath) AS [before],JSON_QUERY(@Value) AS [after] FOR JSON PATH,WITHOUT_ARRAY_WRAPPER);
        SET @Policy=JSON_MODIFY(@Policy,@RolePath,JSON_QUERY(@Value));
        SET @Policy=JSON_MODIFY(@Policy,@VersionPath,CONVERT(int,JSON_VALUE(@Policy,@VersionPath))+1);
        SET @Policy=JSON_MODIFY(@Policy,'$.revision',@Expected+1);
        SET @Policy=JSON_MODIFY(@Policy,'append $.changes',JSON_QUERY(@Change));
        UPDATE cmms_auth.IdentityState SET PermissionsJson=@Policy WHERE Id=1;
        INSERT cmms_auth.AuditLog(Actor,Operation,Target,Details) VALUES(@Actor,@Operation,@PolicyRole,@Change);
      END;
      COMMIT;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT>0 ROLLBACK;
      THROW;
    END CATCH;
  END;
  SELECT (SELECT
    JSON_QUERY((SELECT UserId AS id,Username AS username,DisplayName AS displayName,RoleCode AS role,IsActive AS active,Version AS version,PasswordHash AS passwordHash FROM cmms_auth.Users ORDER BY Username FOR JSON PATH)) AS users,
    UsersRevision AS usersRevision,JSON_QUERY(PermissionsJson) AS permissions
    FROM cmms_auth.IdentityState WHERE Id=1 FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) AS Json;
END;
