IF OBJECT_ID('cmms.InventoryActivity') IS NULL CREATE TABLE cmms.InventoryActivity(ActivityID bigint IDENTITY PRIMARY KEY,OccurredAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),Entity nvarchar(50) NOT NULL,RecordID bigint NULL,Action nvarchar(20) NOT NULL,Summary nvarchar(1000) NOT NULL);
IF OBJECT_ID('cmms.NotificationRead') IS NULL CREATE TABLE cmms.NotificationRead(UserId varchar(24) NOT NULL,ActivityID bigint NOT NULL REFERENCES cmms.InventoryActivity(ActivityID),ReadAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),PRIMARY KEY(UserId,ActivityID));
IF OBJECT_ID('inv.NewPartWatch') IS NULL CREATE TABLE inv.NewPartWatch(PartID bigint PRIMARY KEY,CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());
GO
CREATE OR ALTER TRIGGER inv.tr_CMMS_PartActivity ON inv.Part AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 INSERT inv.NewPartWatch(PartID) SELECT i.PartID FROM inserted i LEFT JOIN deleted d ON d.PartID=i.PartID WHERE d.PartID IS NULL AND NOT EXISTS(SELECT 1 FROM inv.NewPartWatch w WHERE w.PartID=i.PartID);
 INSERT cmms.InventoryActivity(Entity,RecordID,Action,Summary) SELECT 'Part',COALESCE(i.PartID,d.PartID),CASE WHEN i.PartID IS NULL THEN 'DELETE' WHEN d.PartID IS NULL THEN 'CREATE' ELSE 'UPDATE' END,CONCAT(COALESCE(i.PartCode,d.PartCode),' · ',COALESCE(i.PartName,d.PartName)) FROM inserted i FULL JOIN deleted d ON d.PartID=i.PartID;
END;
GO
CREATE OR ALTER TRIGGER inv.tr_CMMS_StockActivity ON inv.StockTransaction AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 INSERT cmms.InventoryActivity(Entity,RecordID,Action,Summary) SELECT 'StockTransaction',COALESCE(i.StockTransactionID,d.StockTransactionID),CASE WHEN i.StockTransactionID IS NULL THEN 'DELETE' WHEN d.StockTransactionID IS NULL THEN 'CREATE' ELSE 'UPDATE' END,CONCAT(p.PartCode,' · ',t.TypeCode,' · ',COALESCE(i.Quantity,d.Quantity),' · ',COALESCE(i.ReferenceNo,d.ReferenceNo,'')) FROM inserted i FULL JOIN deleted d ON d.StockTransactionID=i.StockTransactionID LEFT JOIN inv.Part p ON p.PartID=COALESCE(i.PartID,d.PartID) LEFT JOIN ref.InventoryTransactionType t ON t.TransactionTypeID=COALESCE(i.TransactionTypeID,d.TransactionTypeID);
END;
GO
CREATE OR ALTER TRIGGER inv.tr_CMMS_LoanActivity ON inv.PartLoan AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 INSERT cmms.InventoryActivity(Entity,RecordID,Action,Summary) SELECT 'PartLoan',COALESCE(i.LoanID,d.LoanID),CASE WHEN i.LoanID IS NULL THEN 'DELETE' WHEN d.LoanID IS NULL THEN 'CREATE' ELSE 'UPDATE' END,CONCAT(COALESCE(i.Username,d.Username),' · ',p.PartCode,' · ',COALESCE(i.Status,d.Status),' · ',COALESCE(i.Quantity,d.Quantity)) FROM inserted i FULL JOIN deleted d ON d.LoanID=i.LoanID LEFT JOIN inv.Part p ON p.PartID=COALESCE(i.PartID,d.PartID);
END;
GO
CREATE OR ALTER TRIGGER inv.tr_CMMS_SnapshotActivity ON inv.StockSnapshot AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 INSERT cmms.InventoryActivity(Entity,RecordID,Action,Summary) SELECT 'StockSnapshot',COALESCE(i.StockSnapshotID,d.StockSnapshotID),CASE WHEN i.StockSnapshotID IS NULL THEN 'DELETE' WHEN d.StockSnapshotID IS NULL THEN 'CREATE' ELSE 'UPDATE' END,CONCAT(p.PartCode,' · ',COALESCE(i.Quantity,d.Quantity)) FROM inserted i FULL JOIN deleted d ON d.StockSnapshotID=i.StockSnapshotID LEFT JOIN inv.Part p ON p.PartID=COALESCE(i.PartID,d.PartID);
END;

GO
CREATE OR ALTER TRIGGER cmms.tr_CMMS_WorkOrderActivity ON cmms.WorkOrder AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 INSERT cmms.InventoryActivity(Entity,RecordID,Action,Summary)
 SELECT 'WorkOrder',COALESCE(i.WorkOrderID,d.WorkOrderID),
  CASE WHEN i.WorkOrderID IS NULL THEN 'DELETE' WHEN d.WorkOrderID IS NULL THEN 'CREATE' ELSE 'UPDATE' END,
  CONCAT(COALESCE(i.WorkOrderNo,d.WorkOrderNo),' · ',COALESCE(i.Title,d.Title))
 FROM inserted i FULL JOIN deleted d ON d.WorkOrderID=i.WorkOrderID;
END;

GO
IF OBJECT_ID('cmms.SystemActivity') IS NULL CREATE TABLE cmms.SystemActivity(LogID bigint IDENTITY PRIMARY KEY,OccurredAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),Actor nvarchar(100),Path nvarchar(300),Method varchar(10),StatusCode int);
