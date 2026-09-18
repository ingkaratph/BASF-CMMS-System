import { useEffect, useState } from "react";

async function responseData(response: Response) {
  const result = await response.json();
  if (!response.ok) throw Error(result.error?.message || "โหลดข้อมูลไม่สำเร็จ");
  return result.data;
}

export function Notifications({ logger = false }: { logger?: boolean }) {
  const [data, setData] = useState<any>({ activities: [], missing: [], rows: [], unread: 0, total: 0 });
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [showRead, setShowRead] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await responseData(await fetch(logger ? `/api/datalogger?page=${page}` : "/api/notifications")));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [logger, page]);

  async function markRead(url: string) {
    setBusy(true);
    setError("");
    try {
      await responseData(await fetch(url, { method: "POST" }));
      await load();
      window.dispatchEvent(new Event("cmms-notifications-read"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = logger ? data.rows : data.activities.filter((row: any) => showRead || !row.IsRead);
  const technician = data.audience === "TECHNICIAN";
  const entityLabel: Record<string, string> = { StockTransaction: "คลังอะไหล่", WorkOrder: "ใบแจ้งซ่อม", PartLoan: "ยืมอะไหล่" };
  const actionLabel: Record<string, string> = { CREATE: "รายการใหม่", UPDATE: "อัปเดต", DELETE: "ลบ" };
  return (
    <section className="panel report-panel">
      <h2>{logger ? "Datalogger · กิจกรรมระบบ" : "Notification"}</h2>
      <p>อัปเดตทุก 30 วินาที</p>
      {error && <p role="alert" className="error-box">{error}</p>}
      {!logger && <>
        <div className={`report-toolbar notification-summary${data.unread || data.missing.length ? " has-alerts" : ""}`}>
          <div>
            <span className="notification-summary-label">สถานะการแจ้งเตือน</span>
            <h3>{technician ? `ยังไม่อ่าน ${data.unread} · ใบแจ้งซ่อมใหม่และการคืนของ` : `ยังไม่อ่าน ${data.unread} · รอ SAPMaterial ${data.missing.length}`}</h3>
          </div>
          <button className="button primary" disabled={busy || !data.unread} onClick={() => markRead("/api/notifications/read-all")}>
            {busy ? "กำลังบันทึก…" : "อ่านแล้วทั้งหมด"}
          </button>
        </div>
        {data.missing.map((part: any) => <div className="error-box" key={part.PartID}>
          <strong>{part.PartCode} · {part.PartName}</strong>
          <p>ยังไม่มี SAPMaterial — แจ้งเตือนต่อจนกว่าจะกรอกข้อมูล</p>
          <a href="#spare-parts">เปิดคลังอะไหล่</a>
        </div>)}
        <label><input type="checkbox" checked={showRead} onChange={(event) => setShowRead(event.target.checked)} />แสดงรายการที่อ่านแล้ว</label>
        <p>แสดงกิจกรรมล่าสุด 200 รายการ</p>
      </>}
      <div className="table-scroll"><table>
        <thead><tr><th>เวลา</th><th>หมวด</th><th>กิจกรรม</th><th>รายละเอียด</th><th /></tr></thead>
        <tbody>{rows.map((row: any) => <tr key={row.ActivityID} className={!logger && !row.IsRead ? "notification-unread" : undefined}>
          <td>{new Date(row.OccurredAt + "Z".repeat(!String(row.OccurredAt).endsWith("Z") ? 1 : 0)).toLocaleString("th-TH")}</td>
          <td>{entityLabel[row.Entity] || row.Entity}</td><td>{actionLabel[row.Action] || row.Action}</td><td>{row.Summary}</td>
          <td>{!logger && !row.IsRead && <button className="button" disabled={busy} onClick={() => markRead(`/api/notifications/${row.ActivityID}/read`)}>อ่านแล้ว</button>}</td>
        </tr>)}</tbody>
      </table></div>
      {logger && <div className="report-toolbar">
        <button className="button" disabled={page === 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
        <span>{page} / {Math.max(1, Math.ceil(data.total / 100))}</span>
        <button className="button" disabled={page * 100 >= data.total} onClick={() => setPage(page + 1)}>ถัดไป</button>
      </div>}
    </section>
  );
}

export function NotificationCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/notifications").then((response) => response.ok ? response.json() : null).then((result) => {
      if (alive && result?.data) setCount(result.data.unread + result.data.missing.length);
    }).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    window.addEventListener("cmms-notifications-read", load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("cmms-notifications-read", load);
    };
  }, []);
  return count ? <strong aria-label={`ยังมีแจ้งเตือน ${count}`} className="count">{count}</strong> : null;
}
