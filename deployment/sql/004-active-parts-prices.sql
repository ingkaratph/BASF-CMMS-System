
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
    P.CabinetClass,
    P.Unit,
    COALESCE(ST.SnapshotQty,0) + COALESCE(LM.LiveMovement,0) AS Quantity,
    P.MinimumStock,
    P.MaximumStock,
    P.ReorderPoint,
    P.StandardCost,
    P.PriceText,
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
LEFT JOIN LastMovement MV ON MV.PartID=P.PartID
WHERE P.IsActive=1;
