import { num, value, str, type Row } from "./api";
export function SpareAnalytics({ rows }: { rows: Row[] }) {
  const dead = rows.filter(
    (r) =>
      num(r, "Quantity") > 0 &&
      value(r, "DaysSinceLastTransaction") !== null &&
      num(r, "DaysSinceLastTransaction") >= 365,
  );
  const currencies: Record<string, number> = {};
  for (const r of dead)
    if (value(r, "StandardCost") !== null && str(r, "CurrencyCode"))
      currencies[str(r, "CurrencyCode")] =
        (currencies[str(r, "CurrencyCode")] || 0) +
        num(r, "Quantity") * num(r, "StandardCost");
  const unknown = dead.filter(
    (r) => value(r, "StandardCost") === null || !str(r, "CurrencyCode"),
  ).length;
  return (
    <section className="panel report-panel">
      <h2>วิเคราะห์อะไหล่ที่โหลด</h2>
      <div className="inventory-stats">
        <div>
          <span>รายการอะไหล่</span>
          <strong>{rows.length.toLocaleString()}</strong>
        </div>
        <div>
          <span>ไม่มีประวัติการเคลื่อนไหว</span>
          <strong>
            {rows
              .filter(
                (r) => num(r, "Quantity") > 0 && !value(r, "LastTransaction"),
              )
              .length.toLocaleString()}
          </strong>
        </div>
        <div>
          <span>Dead stock ≥ 365 วัน</span>
          <strong>{dead.length.toLocaleString()}</strong>
        </div>
        <div>
          <span>มูลค่า Dead stock ที่มีต้นทุน</span>
          <strong className="money">
            {Object.keys(currencies).length
              ? Object.entries(currencies)
                  .map(
                    ([c, v]) =>
                      `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c}`,
                  )
                  .join(" / ")
              : "—"}
          </strong>
        </div>
      </div>
      {unknown > 0 && (
        <p>{unknown} รายการไม่มีต้นทุนหรือสกุลเงิน จึงยังรวมมูลค่าไม่ได้</p>
      )}
      <p>
        คำนวณจากรายการที่โหลดก่อนกรองสถานะ · ไม่รวมมูลค่าคนละสกุลเงินเข้าด้วยกัน
      </p>
    </section>
  );
}
