
ALTER VIEW inv.vwSparePartListAPI
AS
WITH LatestSnapshot AS
(
    SELECT
        S.PartID,
        S.WarehouseID,
        S.Quantity,
        S.SnapshotDate,
        ROW_NUMBER() OVER
        (
            PARTITION BY S.PartID,S.WarehouseID
            ORDER BY S.SnapshotDate DESC,S.StockSnapshotID DESC
        ) AS rn
    FROM inv.StockSnapshot S
),
SnapshotTotal AS
(
    SELECT PartID,SUM(Quantity) AS SnapshotQty
    FROM LatestSnapshot
    WHERE rn=1
    GROUP BY PartID
),
LiveMovement AS
(
    SELECT
        T.PartID,
        SUM(T.Quantity * TT.QuantitySign) AS LiveMovement
    FROM inv.StockTransaction T
    INNER JOIN ref.InventoryTransactionType TT
        ON TT.TransactionTypeID=T.TransactionTypeID
    WHERE ISNULL(T.IsHistorical,0)=0
    GROUP BY T.PartID
),
LastMovement AS
(
    SELECT
        PartID,
        MAX(TransactionDate) AS LastTransaction
    FROM inv.StockTransaction
    WHERE TransactionDate IS NOT NULL
    GROUP BY PartID
)
SELECT
    P.PartID,
    P.PartCode,
    P.SAPMaterial,
    P.PartName,
    P.Description,
    P.Brand,
    P.Department,
    P.PartType,
    P.Unit,
    COALESCE(ST.SnapshotQty,0) + COALESCE(LM.LiveMovement,0) AS Quantity,
    P.MinimumStock,
    P.MaximumStock,
    P.ReorderPoint,
    P.StandardCost,
    P.CurrencyCode,
    MV.LastTransaction,
    CASE
        WHEN MV.LastTransaction IS NULL THEN NULL
        ELSE DATEDIFF(DAY,MV.LastTransaction,GETDATE())
    END AS DaysSinceLastTransaction,
    CASE
        WHEN COALESCE(ST.SnapshotQty,0)+COALESCE(LM.LiveMovement,0) <= 0
            THEN N'NO STOCK'
        WHEN MV.LastTransaction IS NULL
            THEN N'NO HISTORY'
        WHEN DATEDIFF(DAY,MV.LastTransaction,GETDATE()) >= 365
            THEN N'DEAD STOCK'
        WHEN DATEDIFF(DAY,MV.LastTransaction,GETDATE()) >= 180
            THEN N'SLOW MOVING'
        ELSE N'ACTIVE'
    END AS MovementStatus,
    CASE
        WHEN P.ReorderPoint IS NOT NULL
         AND COALESCE(ST.SnapshotQty,0)+COALESCE(LM.LiveMovement,0) <= P.ReorderPoint
            THEN N'REORDER'
        WHEN P.MinimumStock IS NOT NULL
         AND COALESCE(ST.SnapshotQty,0)+COALESCE(LM.LiveMovement,0) <= P.MinimumStock
            THEN N'LOW'
        ELSE N'OK'
    END AS StockStatus,
    P.IsActive,
    P.DataQualityStatus
FROM inv.Part P
LEFT JOIN SnapshotTotal ST ON ST.PartID=P.PartID
LEFT JOIN LiveMovement LM ON LM.PartID=P.PartID
LEFT JOIN LastMovement MV ON MV.PartID=P.PartID;

GO

/* =========================================================================
   Gateway Stored Procedure
   @Operation = SELECT / INSERT / EDIT / DELETE
   @Resource =
      assets
      maintenance-plans
      work-orders
      spare-parts
      stock-transactions
      calibration-history
   ========================================================================= */

ALTER PROCEDURE api.usp_CMMS_Gateway
    @Operation NVARCHAR(10),
    @Resource NVARCHAR(50),
    @Id BIGINT = NULL,
    @BodyJson NVARCHAR(MAX) = N'{}',
    @Limit INT = 100,
    @Search NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    SET @Operation = UPPER(LTRIM(RTRIM(@Operation)));
    SET @Resource = LOWER(LTRIM(RTRIM(@Resource)));

    IF @Operation NOT IN (N'SELECT',N'INSERT',N'EDIT',N'DELETE')
        THROW 57001, 'Unsupported API operation.', 1;

    IF @Resource NOT IN
    (
        N'assets',
        N'maintenance-plans',
        N'work-orders',
        N'spare-parts',
        N'stock-transactions',
        N'calibration-history'
    )
        THROW 57002, 'Unsupported API resource.', 1;

    IF @Limit IS NULL OR @Limit < 1 SET @Limit=100;
    IF @Limit > 2000 SET @Limit=2000;

    IF ISJSON(@BodyJson)<>1
        THROW 57003, 'Request body is not valid JSON.', 1;

    /* ================================================================
       SELECT
       ================================================================ */
    IF @Operation=N'SELECT'
    BEGIN
        IF @Resource=N'assets'
        BEGIN
            SELECT TOP (@Limit) *
            FROM cmms.vwAsset_All
            WHERE (@Id IS NULL OR AssetID=@Id)
              AND
              (
                  @Search IS NULL
                  OR MachineCode LIKE N'%'+@Search+N'%'
                  OR TagNo LIKE N'%'+@Search+N'%'
                  OR AssetName LIKE N'%'+@Search+N'%'
              )
            ORDER BY AssetID;
            RETURN;
        END;

        IF @Resource=N'maintenance-plans'
        BEGIN
            SELECT TOP (@Limit)
                P.PlanID,P.PlanCode,
                A.AssetID,A.MachineCode,A.TagNo,A.AssetName,
                MT.TypeCode AS MaintenanceTypeCode,
                MT.TypeName AS MaintenanceType,
                P.TaskCode,P.TaskDescription,
                P.FrequencyValue,FU.UnitCode AS FrequencyUnit,
                P.LastMaintenanceDate,P.NextDueDate,
                P.ResponsibleMode,V.VendorName,
                P.Remark,P.IsActive
            FROM cmms.MaintenancePlan P
            INNER JOIN cmms.Asset A ON A.AssetID=P.AssetID
            INNER JOIN ref.MaintenanceType MT
                ON MT.MaintenanceTypeID=P.MaintenanceTypeID
            LEFT JOIN ref.FrequencyUnit FU
                ON FU.FrequencyUnitID=P.FrequencyUnitID
            LEFT JOIN cmms.Vendor V ON V.VendorID=P.VendorID
            WHERE (@Id IS NULL OR P.PlanID=@Id)
              AND
              (
                  @Search IS NULL
                  OR P.PlanCode LIKE N'%'+@Search+N'%'
                  OR P.TaskCode LIKE N'%'+@Search+N'%'
                  OR P.TaskDescription LIKE N'%'+@Search+N'%'
                  OR A.MachineCode LIKE N'%'+@Search+N'%'
                  OR A.TagNo LIKE N'%'+@Search+N'%'
              )
            ORDER BY P.PlanID;
            RETURN;
        END;

        IF @Resource=N'work-orders'
        BEGIN
            SELECT TOP (@Limit)
                W.WorkOrderID,W.WorkOrderNo,
                A.AssetID,A.MachineCode,A.TagNo,A.AssetName,
                MT.TypeCode AS WorkTypeCode,
                PR.PriorityCode,
                WS.StatusCode,
                W.Title,W.Description,
                W.RequestedDate,W.DueDate,
                W.ActualStart,W.ActualFinish,
                W.Finding,W.RootCause,W.ActionTaken,
                W.DowntimeMinutes,
                W.RequestorName,W.SectionName,
                W.DataQualityStatus
            FROM cmms.WorkOrder W
            INNER JOIN cmms.Asset A ON A.AssetID=W.AssetID
            INNER JOIN ref.MaintenanceType MT
                ON MT.MaintenanceTypeID=W.WorkTypeID
            LEFT JOIN ref.Priority PR ON PR.PriorityID=W.PriorityID
            INNER JOIN ref.WorkOrderStatus WS
                ON WS.WorkOrderStatusID=W.WorkOrderStatusID
            WHERE (@Id IS NULL OR W.WorkOrderID=@Id)
              AND
              (
                  @Search IS NULL
                  OR W.WorkOrderNo LIKE N'%'+@Search+N'%'
                  OR W.Title LIKE N'%'+@Search+N'%'
                  OR A.MachineCode LIKE N'%'+@Search+N'%'
                  OR A.TagNo LIKE N'%'+@Search+N'%'
              )
            ORDER BY W.WorkOrderID DESC;
            RETURN;
        END;

        IF @Resource=N'spare-parts'
        BEGIN
            DECLARE @FilterDepartment nvarchar(100)=NULLIF(LTRIM(RTRIM(JSON_VALUE(@BodyJson,'$.department'))),N''),
                    @FilterPartType nvarchar(100)=NULLIF(LTRIM(RTRIM(JSON_VALUE(@BodyJson,'$.partType'))),N'');
            SELECT * INTO #FilteredParts FROM inv.vwSparePartListAPI
            WHERE (@Id IS NULL OR PartID=@Id)
              AND (@Search IS NULL OR PartCode LIKE N'%'+@Search+N'%' OR SAPMaterial LIKE N'%'+@Search+N'%' OR PartName LIKE N'%'+@Search+N'%' OR Description LIKE N'%'+@Search+N'%' OR Brand LIKE N'%'+@Search+N'%')
              AND (@FilterDepartment IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(Department)),N''),N'__missing__')=@FilterDepartment)
              AND (@FilterPartType IS NULL OR COALESCE(NULLIF(LTRIM(RTRIM(PartType)),N''),N'__missing__')=@FilterPartType);
            SELECT TOP (@Limit) * FROM #FilteredParts ORDER BY PartCode;
            SELECT DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(Department)),N''),N'__missing__') AS Value FROM inv.Part ORDER BY Value;
            SELECT DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(PartType)),N''),N'__missing__') AS Value FROM inv.Part ORDER BY Value;
            SELECT COUNT(*) AS Total FROM #FilteredParts;
            RETURN;
        END;

        IF @Resource=N'stock-transactions'
        BEGIN
            SELECT TOP (@Limit)
                T.StockTransactionID,
                T.TransactionDate,
                TT.TypeCode AS TransactionType,
                P.PartID,P.PartCode,P.PartName,
                W.WarehouseID,W.WarehouseCode,W.WarehouseName,
                T.WorkOrderID,
                T.Quantity,T.UnitCost,
                T.ReferenceNo,T.Remark,
                T.IsHistorical,T.IssuedTo,
                T.DataQualityStatus
            FROM inv.StockTransaction T
            INNER JOIN ref.InventoryTransactionType TT
                ON TT.TransactionTypeID=T.TransactionTypeID
            INNER JOIN inv.Part P ON P.PartID=T.PartID
            INNER JOIN inv.Warehouse W ON W.WarehouseID=T.WarehouseID
            WHERE (@Id IS NULL OR T.StockTransactionID=@Id)
              AND
              (
                  @Search IS NULL
                  OR P.PartCode LIKE N'%'+@Search+N'%'
                  OR P.PartName LIKE N'%'+@Search+N'%'
                  OR T.ReferenceNo LIKE N'%'+@Search+N'%'
              )
            ORDER BY T.TransactionDate DESC,T.StockTransactionID DESC;
            RETURN;
        END;

        IF @Resource=N'calibration-history'
        BEGIN
            SELECT TOP (@Limit)
                CE.CalibrationEventID,
                A.AssetID,A.MachineCode,A.TagNo,A.AssetName,
                CE.PlanID,
                CE.CalibrationDate,
                CE.CertificateNo,
                CE.OverallResult,
                V.VendorName,
                CE.Remark,
                CE.WorkOrderID,
                CE.DataQualityStatus
            FROM cmms.CalibrationEvent CE
            INNER JOIN cmms.Asset A ON A.AssetID=CE.AssetID
            LEFT JOIN cmms.Vendor V ON V.VendorID=CE.VendorID
            WHERE (@Id IS NULL OR CE.CalibrationEventID=@Id)
              AND
              (
                  @Search IS NULL
                  OR A.MachineCode LIKE N'%'+@Search+N'%'
                  OR A.TagNo LIKE N'%'+@Search+N'%'
                  OR A.AssetName LIKE N'%'+@Search+N'%'
                  OR CE.CertificateNo LIKE N'%'+@Search+N'%'
              )
            ORDER BY CE.CalibrationDate DESC,CE.CalibrationEventID DESC;
            RETURN;
        END;
    END;

    /* ================================================================
       INSERT
       ================================================================ */
    IF @Operation=N'INSERT'
    BEGIN
        IF @Resource=N'assets'
        BEGIN
            DECLARE
                @AssetGroupCode NVARCHAR(10)=JSON_VALUE(@BodyJson,'$.assetGroupCode'),
                @AssetCategoryID INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.assetCategoryId')),
                @MachineCode NVARCHAR(50)=JSON_VALUE(@BodyJson,'$.machineCode'),
                @TagNo NVARCHAR(50)=JSON_VALUE(@BodyJson,'$.tagNo'),
                @AssetName NVARCHAR(255)=JSON_VALUE(@BodyJson,'$.assetName'),
                @AssetType NVARCHAR(100)=JSON_VALUE(@BodyJson,'$.assetType'),
                @LocationID INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.locationId')),
                @CriticalityCode NVARCHAR(20)=COALESCE(JSON_VALUE(@BodyJson,'$.criticalityCode'),N'LOW'),
                @PMRequired BIT=
                    CASE WHEN LOWER(COALESCE(JSON_VALUE(@BodyJson,'$.pmRequired'),N'false'))
                              IN (N'1',N'true',N'yes',N'y') THEN 1 ELSE 0 END;

            IF @AssetGroupCode IS NULL OR @AssetName IS NULL
                THROW 57101, 'assets INSERT requires assetGroupCode and assetName.', 1;

            DECLARE @AssetGroupID TINYINT=
                (SELECT AssetGroupID FROM ref.AssetGroup WHERE GroupCode=@AssetGroupCode);

            IF @AssetGroupID IS NULL
                THROW 57102, 'Unknown assetGroupCode.', 1;

            IF @AssetCategoryID IS NULL
                SELECT TOP(1) @AssetCategoryID=AssetCategoryID
                FROM ref.AssetCategory
                WHERE AssetGroupID=@AssetGroupID
                ORDER BY AssetCategoryID;

            DECLARE @CriticalityID TINYINT=
                (SELECT CriticalityID FROM ref.Criticality WHERE CriticalityCode=@CriticalityCode);
            DECLARE @ActiveStatusID TINYINT=
                (SELECT AssetStatusID FROM ref.AssetStatus WHERE StatusCode=N'ACTIVE');

            IF @CriticalityID IS NULL
                THROW 57103, 'Unknown criticalityCode.', 1;

            INSERT INTO cmms.Asset
            (
                AssetGroupID,AssetCategoryID,
                MachineCode,TagNo,AssetName,AssetType,
                LocationID,CriticalityID,AssetStatusID,
                PMRequired,DataQualityStatus,SourceName,CreatedBy
            )
            VALUES
            (
                @AssetGroupID,@AssetCategoryID,
                @MachineCode,@TagNo,@AssetName,@AssetType,
                @LocationID,@CriticalityID,@ActiveStatusID,
                @PMRequired,N'OK',N'API',SUSER_SNAME()
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT * FROM cmms.vwAsset_All WHERE AssetID=@Id;
            RETURN;
        END;

        IF @Resource=N'maintenance-plans'
        BEGIN
            DECLARE
                @PlanCode NVARCHAR(50)=JSON_VALUE(@BodyJson,'$.planCode'),
                @PlanAssetID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.assetId')),
                @TaskCode NVARCHAR(100)=JSON_VALUE(@BodyJson,'$.taskCode'),
                @MaintTypeCode NVARCHAR(30)=JSON_VALUE(@BodyJson,'$.maintenanceTypeCode'),
                @TaskDescription NVARCHAR(1000)=JSON_VALUE(@BodyJson,'$.taskDescription'),
                @FrequencyValue INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.frequencyValue')),
                @FrequencyUnitCode NVARCHAR(20)=JSON_VALUE(@BodyJson,'$.frequencyUnitCode'),
                @NextDueDate DATE=TRY_CONVERT(DATE,JSON_VALUE(@BodyJson,'$.nextDueDate')),
                @LastMaintenanceDate DATE=TRY_CONVERT(DATE,JSON_VALUE(@BodyJson,'$.lastMaintenanceDate')),
                @VendorID INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.vendorId'));

            IF @PlanAssetID IS NULL OR @MaintTypeCode IS NULL OR @TaskDescription IS NULL
                THROW 57110, 'maintenance-plans INSERT requires assetId, maintenanceTypeCode and taskDescription.', 1;

            IF @PlanCode IS NULL
                SET @PlanCode =
                    N'API-PLN-' + CONVERT(NVARCHAR(8),GETDATE(),112) + N'-'
                    + RIGHT(REPLACE(CONVERT(NVARCHAR(36),NEWID()),N'-',N''),8);

            DECLARE @MaintTypeID TINYINT=
                (SELECT MaintenanceTypeID FROM ref.MaintenanceType WHERE TypeCode=@MaintTypeCode);
            DECLARE @FrequencyUnitID TINYINT=
                (SELECT FrequencyUnitID FROM ref.FrequencyUnit WHERE UnitCode=@FrequencyUnitCode);

            IF @MaintTypeID IS NULL
                THROW 57111, 'Unknown maintenanceTypeCode.', 1;

            INSERT INTO cmms.MaintenancePlan
            (
                PlanCode,AssetID,TaskCode,MaintenanceTypeID,TaskDescription,
                FrequencyValue,FrequencyUnitID,
                LastMaintenanceDate,NextDueDate,VendorID,IsActive,SourceRow
            )
            VALUES
            (
                @PlanCode,@PlanAssetID,@TaskCode,@MaintTypeID,@TaskDescription,
                @FrequencyValue,@FrequencyUnitID,
                @LastMaintenanceDate,@NextDueDate,@VendorID,1,N'API'
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT P.*,A.MachineCode,A.TagNo,A.AssetName
            FROM cmms.MaintenancePlan P
            INNER JOIN cmms.Asset A ON A.AssetID=P.AssetID
            WHERE P.PlanID=@Id;
            RETURN;
        END;

        IF @Resource=N'work-orders'
        BEGIN
            DECLARE
                @WONo NVARCHAR(50)=JSON_VALUE(@BodyJson,'$.workOrderNo'),
                @WOAssetID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.assetId')),
                @WorkTypeCode NVARCHAR(30)=COALESCE(JSON_VALUE(@BodyJson,'$.workTypeCode'),N'CORRECTIVE'),
                @PriorityCode NVARCHAR(20)=COALESCE(JSON_VALUE(@BodyJson,'$.priorityCode'),N'MEDIUM'),
                @WOStatusCode NVARCHAR(30)=COALESCE(JSON_VALUE(@BodyJson,'$.statusCode'),N'OPEN'),
                @Title NVARCHAR(255)=JSON_VALUE(@BodyJson,'$.title'),
                @Description NVARCHAR(2000)=JSON_VALUE(@BodyJson,'$.description'),
                @DueDate DATETIME2(0)=TRY_CONVERT(DATETIME2(0),JSON_VALUE(@BodyJson,'$.dueDate')),
                @RequestorName NVARCHAR(150)=JSON_VALUE(@BodyJson,'$.requestorName');

            IF @WOAssetID IS NULL OR @Title IS NULL
                THROW 57120, 'work-orders INSERT requires assetId and title.', 1;

            IF @WONo IS NULL
                SET @WONo=
                    N'WO-' + CONVERT(NVARCHAR(8),GETDATE(),112) + N'-'
                    + RIGHT(REPLACE(CONVERT(NVARCHAR(36),NEWID()),N'-',N''),8);

            DECLARE @WorkTypeID TINYINT=
                (SELECT MaintenanceTypeID FROM ref.MaintenanceType WHERE TypeCode=@WorkTypeCode);
            DECLARE @PriorityID TINYINT=
                (SELECT PriorityID FROM ref.Priority WHERE PriorityCode=@PriorityCode);
            DECLARE @WOStatusID TINYINT=
                (SELECT WorkOrderStatusID FROM ref.WorkOrderStatus WHERE StatusCode=@WOStatusCode);

            IF @WorkTypeID IS NULL OR @WOStatusID IS NULL
                THROW 57121, 'Unknown workTypeCode or statusCode.', 1;

            INSERT INTO cmms.WorkOrder
            (
                WorkOrderNo,AssetID,WorkTypeID,PriorityID,WorkOrderStatusID,
                Title,Description,DueDate,RequestorName,SourceSystem,DataQualityStatus,CreatedBy
            )
            VALUES
            (
                @WONo,@WOAssetID,@WorkTypeID,@PriorityID,@WOStatusID,
                @Title,@Description,@DueDate,@RequestorName,N'API',N'OK',SUSER_SNAME()
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT * FROM cmms.WorkOrder WHERE WorkOrderID=@Id;
            RETURN;
        END;

        IF @Resource=N'spare-parts'
        BEGIN
            DECLARE
                @PartCode NVARCHAR(60)=JSON_VALUE(@BodyJson,'$.partCode'),
                @PartName NVARCHAR(255)=JSON_VALUE(@BodyJson,'$.partName'),
                @Unit NVARCHAR(30)=JSON_VALUE(@BodyJson,'$.unit'),
                @SAPMaterial NVARCHAR(50)=JSON_VALUE(@BodyJson,'$.sapMaterial'),
                @DescriptionPart NVARCHAR(1000)=JSON_VALUE(@BodyJson,'$.description'),
                @MinimumStock DECIMAL(18,4)=TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.minimumStock')),
                @MaximumStock DECIMAL(18,4)=TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.maximumStock')),
                @ReorderPoint DECIMAL(18,4)=TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.reorderPoint')),
                @StandardCost DECIMAL(18,2)=TRY_CONVERT(DECIMAL(18,2),JSON_VALUE(@BodyJson,'$.standardCost'));

            IF @PartCode IS NULL OR @PartName IS NULL OR @Unit IS NULL
                THROW 57130, 'spare-parts INSERT requires partCode, partName and unit.', 1;

            INSERT INTO inv.Part
            (
                PartCode,PartName,Unit,
                SAPMaterial,Description,
                MinimumStock,MaximumStock,ReorderPoint,StandardCost,
                IsActive,SourceSystem,DataQualityStatus
            )
            VALUES
            (
                @PartCode,@PartName,@Unit,
                @SAPMaterial,@DescriptionPart,
                @MinimumStock,@MaximumStock,@ReorderPoint,@StandardCost,
                1,N'API',N'OK'
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT * FROM inv.Part WHERE PartID=@Id;
            RETURN;
        END;

        IF @Resource=N'stock-transactions'
        BEGIN
            DECLARE
                @TxnTypeCode NVARCHAR(30)=JSON_VALUE(@BodyJson,'$.transactionTypeCode'),
                @TxnPartID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.partId')),
                @WarehouseID INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.warehouseId')),
                @TxnWorkOrderID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.workOrderId')),
                @Qty DECIMAL(18,4)=TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.quantity')),
                @UnitCost DECIMAL(18,2)=TRY_CONVERT(DECIMAL(18,2),JSON_VALUE(@BodyJson,'$.unitCost')),
                @ReferenceNo NVARCHAR(100)=JSON_VALUE(@BodyJson,'$.referenceNo'),
                @TxnRemark NVARCHAR(1000)=JSON_VALUE(@BodyJson,'$.remark');

            IF @TxnTypeCode IS NULL OR @TxnPartID IS NULL OR @WarehouseID IS NULL OR @Qty IS NULL OR @Qty<=0
                THROW 57140, 'stock-transactions INSERT requires transactionTypeCode, partId, warehouseId and positive quantity.', 1;

            DECLARE @TxnTypeID TINYINT=
                (SELECT TransactionTypeID
                 FROM ref.InventoryTransactionType
                 WHERE TypeCode=@TxnTypeCode);

            IF @TxnTypeID IS NULL
                THROW 57141, 'Unknown transactionTypeCode.', 1;

            INSERT INTO inv.StockTransaction
            (
                TransactionDate,TransactionTypeID,PartID,WarehouseID,WorkOrderID,
                Quantity,UnitCost,ReferenceNo,Remark,
                IsHistorical,SourceSystem,DataQualityStatus
            )
            VALUES
            (
                GETDATE(),@TxnTypeID,@TxnPartID,@WarehouseID,@TxnWorkOrderID,
                @Qty,@UnitCost,@ReferenceNo,@TxnRemark,
                0,N'API',N'OK'
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT * FROM inv.StockTransaction WHERE StockTransactionID=@Id;
            RETURN;
        END;

        IF @Resource=N'calibration-history'
        BEGIN
            DECLARE
                @CalAssetID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.assetId')),
                @CalSpecID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.calibrationSpecId')),
                @CalPlanID BIGINT=TRY_CONVERT(BIGINT,JSON_VALUE(@BodyJson,'$.planId')),
                @CalVendorID INT=TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.vendorId')),
                @CalDate DATE=TRY_CONVERT(DATE,JSON_VALUE(@BodyJson,'$.calibrationDate')),
                @CertificateNo NVARCHAR(100)=JSON_VALUE(@BodyJson,'$.certificateNo'),
                @OverallResult NVARCHAR(20)=JSON_VALUE(@BodyJson,'$.overallResult'),
                @CalRemark NVARCHAR(1000)=JSON_VALUE(@BodyJson,'$.remark');

            IF @CalAssetID IS NULL OR @CalDate IS NULL
                THROW 57150, 'calibration-history INSERT requires assetId and calibrationDate.', 1;

            IF @CalSpecID IS NULL
                SELECT @CalSpecID=CalibrationSpecID
                FROM cmms.CalibrationSpec
                WHERE AssetID=@CalAssetID;

            IF @CalSpecID IS NULL
                THROW 57151, 'No CalibrationSpec found for this Asset.', 1;

            INSERT INTO cmms.CalibrationEvent
            (
                WorkOrderID,AssetID,CalibrationSpecID,VendorID,
                CalibrationDate,CertificateNo,OverallResult,Remark,
                PlanID,SourceType,SourceReference,DataQualityStatus
            )
            VALUES
            (
                NULL,@CalAssetID,@CalSpecID,@CalVendorID,
                @CalDate,@CertificateNo,@OverallResult,@CalRemark,
                @CalPlanID,N'API',N'API',N'OK'
            );

            SET @Id=SCOPE_IDENTITY();
            SELECT * FROM cmms.CalibrationEvent WHERE CalibrationEventID=@Id;
            RETURN;
        END;
    END;

    /* ================================================================
       EDIT
       ================================================================ */
    IF @Operation=N'EDIT'
    BEGIN
        IF @Id IS NULL
            THROW 57200, 'EDIT requires id query parameter.', 1;

        IF @Resource=N'assets'
        BEGIN
            DECLARE @EditStatusCode NVARCHAR(20)=JSON_VALUE(@BodyJson,'$.statusCode');
            DECLARE @EditStatusID TINYINT=
                (SELECT AssetStatusID FROM ref.AssetStatus WHERE StatusCode=@EditStatusCode);

            UPDATE cmms.Asset
            SET
                MachineCode=COALESCE(JSON_VALUE(@BodyJson,'$.machineCode'),MachineCode),
                TagNo=COALESCE(JSON_VALUE(@BodyJson,'$.tagNo'),TagNo),
                AssetName=COALESCE(JSON_VALUE(@BodyJson,'$.assetName'),AssetName),
                AssetType=COALESCE(JSON_VALUE(@BodyJson,'$.assetType'),AssetType),
                LocationID=COALESCE(TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.locationId')),LocationID),
                PMRequired=CASE
                    WHEN JSON_VALUE(@BodyJson,'$.pmRequired') IS NULL THEN PMRequired
                    WHEN LOWER(JSON_VALUE(@BodyJson,'$.pmRequired')) IN (N'1',N'true',N'yes',N'y') THEN 1
                    ELSE 0 END,
                AssetStatusID=COALESCE(@EditStatusID,AssetStatusID),
                UpdatedAt=SYSUTCDATETIME(),
                UpdatedBy=SUSER_SNAME()
            WHERE AssetID=@Id;

            IF @@ROWCOUNT=0 THROW 57201, 'Asset not found.', 1;
            SELECT * FROM cmms.vwAsset_All WHERE AssetID=@Id;
            RETURN;
        END;

        IF @Resource=N'maintenance-plans'
        BEGIN
            UPDATE cmms.MaintenancePlan
            SET
                TaskCode=COALESCE(JSON_VALUE(@BodyJson,'$.taskCode'),TaskCode),
                TaskDescription=COALESCE(JSON_VALUE(@BodyJson,'$.taskDescription'),TaskDescription),
                FrequencyValue=COALESCE(TRY_CONVERT(INT,JSON_VALUE(@BodyJson,'$.frequencyValue')),FrequencyValue),
                LastMaintenanceDate=COALESCE(TRY_CONVERT(DATE,JSON_VALUE(@BodyJson,'$.lastMaintenanceDate')),LastMaintenanceDate),
                NextDueDate=COALESCE(TRY_CONVERT(DATE,JSON_VALUE(@BodyJson,'$.nextDueDate')),NextDueDate),
                Remark=COALESCE(JSON_VALUE(@BodyJson,'$.remark'),Remark)
            WHERE PlanID=@Id;

            IF @@ROWCOUNT=0 THROW 57210, 'Maintenance Plan not found.', 1;
            SELECT * FROM cmms.MaintenancePlan WHERE PlanID=@Id;
            RETURN;
        END;

        IF @Resource=N'work-orders'
        BEGIN
            DECLARE @EditWOStatusCode NVARCHAR(30)=JSON_VALUE(@BodyJson,'$.statusCode');
            DECLARE @EditWOStatusID TINYINT=
                (SELECT WorkOrderStatusID FROM ref.WorkOrderStatus WHERE StatusCode=@EditWOStatusCode);

            UPDATE cmms.WorkOrder
            SET
                Title=COALESCE(JSON_VALUE(@BodyJson,'$.title'),Title),
                Description=COALESCE(JSON_VALUE(@BodyJson,'$.description'),Description),
                DueDate=COALESCE(TRY_CONVERT(DATETIME2(0),JSON_VALUE(@BodyJson,'$.dueDate')),DueDate),
                ActualStart=COALESCE(TRY_CONVERT(DATETIME2(0),JSON_VALUE(@BodyJson,'$.actualStart')),ActualStart),
                ActualFinish=COALESCE(TRY_CONVERT(DATETIME2(0),JSON_VALUE(@BodyJson,'$.actualFinish')),ActualFinish),
                Finding=COALESCE(JSON_VALUE(@BodyJson,'$.finding'),Finding),
                RootCause=COALESCE(JSON_VALUE(@BodyJson,'$.rootCause'),RootCause),
                ActionTaken=COALESCE(JSON_VALUE(@BodyJson,'$.actionTaken'),ActionTaken),
                DowntimeMinutes=COALESCE(TRY_CONVERT(DECIMAL(12,2),JSON_VALUE(@BodyJson,'$.downtimeMinutes')),DowntimeMinutes),
                RequestorName=COALESCE(JSON_VALUE(@BodyJson,'$.requestorName'),RequestorName),
                WorkOrderStatusID=COALESCE(@EditWOStatusID,WorkOrderStatusID)
            WHERE WorkOrderID=@Id;

            IF @@ROWCOUNT=0 THROW 57220, 'Work Order not found.', 1;
            SELECT * FROM cmms.WorkOrder WHERE WorkOrderID=@Id;
            RETURN;
        END;

        IF @Resource=N'spare-parts'
        BEGIN
            UPDATE inv.Part
            SET
                PartCode=COALESCE(JSON_VALUE(@BodyJson,'$.partCode'),PartCode),
                PartName=COALESCE(JSON_VALUE(@BodyJson,'$.partName'),PartName),
                Unit=COALESCE(JSON_VALUE(@BodyJson,'$.unit'),Unit),
                SAPMaterial=COALESCE(JSON_VALUE(@BodyJson,'$.sapMaterial'),SAPMaterial),
                Description=COALESCE(JSON_VALUE(@BodyJson,'$.description'),Description),
                MinimumStock=COALESCE(TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.minimumStock')),MinimumStock),
                MaximumStock=COALESCE(TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.maximumStock')),MaximumStock),
                ReorderPoint=COALESCE(TRY_CONVERT(DECIMAL(18,4),JSON_VALUE(@BodyJson,'$.reorderPoint')),ReorderPoint),
                StandardCost=COALESCE(TRY_CONVERT(DECIMAL(18,2),JSON_VALUE(@BodyJson,'$.standardCost')),StandardCost)
            WHERE PartID=@Id;

            IF @@ROWCOUNT=0 THROW 57230, 'Spare Part not found.', 1;
            SELECT * FROM inv.Part WHERE PartID=@Id;
            RETURN;
        END;

        THROW 57299, 'EDIT is not allowed for this resource.', 1;
    END;

    /* ================================================================
       DELETE = soft delete / cancel
       ================================================================ */
    IF @Operation=N'DELETE'
    BEGIN
        IF @Id IS NULL
            THROW 57300, 'DELETE requires id query parameter.', 1;

        IF @Resource=N'assets'
        BEGIN
            DECLARE @RetiredID TINYINT=
                (SELECT AssetStatusID FROM ref.AssetStatus WHERE StatusCode=N'RETIRED');

            UPDATE cmms.Asset
            SET AssetStatusID=@RetiredID,
                UpdatedAt=SYSUTCDATETIME(),
                UpdatedBy=SUSER_SNAME()
            WHERE AssetID=@Id;

            IF @@ROWCOUNT=0 THROW 57301, 'Asset not found.', 1;
            SELECT * FROM cmms.vwAsset_All WHERE AssetID=@Id;
            RETURN;
        END;

        IF @Resource=N'maintenance-plans'
        BEGIN
            UPDATE cmms.MaintenancePlan SET IsActive=0 WHERE PlanID=@Id;
            IF @@ROWCOUNT=0 THROW 57310, 'Maintenance Plan not found.', 1;
            SELECT * FROM cmms.MaintenancePlan WHERE PlanID=@Id;
            RETURN;
        END;

        IF @Resource=N'work-orders'
        BEGIN
            DECLARE @CancelledID TINYINT=
                (SELECT WorkOrderStatusID FROM ref.WorkOrderStatus WHERE StatusCode=N'CANCELLED');

            UPDATE cmms.WorkOrder
            SET WorkOrderStatusID=@CancelledID
            WHERE WorkOrderID=@Id;

            IF @@ROWCOUNT=0 THROW 57320, 'Work Order not found.', 1;
            SELECT * FROM cmms.WorkOrder WHERE WorkOrderID=@Id;
            RETURN;
        END;

        IF @Resource=N'spare-parts'
        BEGIN
            UPDATE inv.Part SET IsActive=0 WHERE PartID=@Id;
            IF @@ROWCOUNT=0 THROW 57330, 'Spare Part not found.', 1;
            SELECT * FROM inv.Part WHERE PartID=@Id;
            RETURN;
        END;

        THROW 57399, 'DELETE is not allowed for this resource.', 1;
    END;
END;
