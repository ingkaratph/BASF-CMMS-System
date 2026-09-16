import { CategoryReports } from './category-reports';
import { IssueParts } from './issue-parts';
import {ImageViewer} from './image-viewer';
import React, { useEffect, useState, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Factory,
  ClipboardList,
  CalendarDays,
  Package,
  ArrowLeftRight,
  ShieldCheck,
  BarChart3,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Download,
  X,
  Menu,
  Check,
  AlertCircle,
  Clock,
  LogOut,
  Filter,
  Wrench,
  ArrowRight,
  Database,
  FileText,
  Sun,
  Moon,
  Users,
} from "lucide-react";
import {
  api,
  ApiError,
  canWrite,
  display,
  validDate,
  value,
  str,
  num,
  type Row,
  type Resource,
  type Role,
  type User,
} from "./api";
import { modules, type Field } from "./config";
import { SpareAnalytics } from "./spare-analytics";
import "./styles.css";
import "./theme.css";
import {roleLabels} from "../shared/permissions.mjs";
import {canAccess,applyPermissions} from "./access";
import { UserManagement } from "./users";
import {MediaGallery} from "./media-gallery";

type Page = Resource | "overview" | "reports" | "settings" | "users" | "none";
const navigation: [Page, string, typeof Factory][] = [
  ["overview", "ภาพรวม", LayoutDashboard],
  ["work-orders", "ใบงานซ่อมบำรุง", ClipboardList],
  ["maintenance-plans", "แผนบำรุงรักษา", CalendarDays],
  ["assets", "ทะเบียนเครื่องจักร", Factory],
  ["spare-parts", "คลังอะไหล่", Package],
  ["stock-transactions", "รับ–เบิกอะไหล่", ArrowLeftRight],
  ["calibration-history", "การสอบเทียบ", ShieldCheck],
  ["reports", "รายงานและวิเคราะห์", BarChart3],
  ["users", "ผู้ใช้และสิทธิ์", Users],
];
function inputDate(v: unknown, type?: string) {
  if (!v) return "";
  if (!/date|datetime-local/.test(type || "")) return v;
  const d = new Date(String(v));
  if (!Number.isFinite(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return type === "date"
    ? parts.slice(0, 10)
    : parts.replace(" ", "T").slice(0, 16);
}
const isClosed = (r: Row) =>
  ["COMPLETED", "CANCELLED", "CLOSED"].includes(
    str(r, "StatusCode").toUpperCase(),
  );
const overdue = (r: Row, k = "DueDate") =>
  validDate(value(r, k)) &&
  new Date(str(r, k)).getTime() < new Date(new Date().toDateString()).getTime();
function Badge({ children }: { children: React.ReactNode }) {
  const s = String(children || "").toUpperCase();
  const tone =
    /COMPLETE|PASS|ACTIVE|NORMAL|RECEIVE|AVAILABLE/.test(s) &&
    !/INACTIVE/.test(s)
      ? "green"
      : /HIGH|CRITICAL|FAIL|OVERDUE|LOW STOCK|DEAD|OUT OF|REORDER/.test(s)
        ? "red"
        : /PROGRESS|MEDIUM|SLOW|ISSUE|OPEN/.test(s)
          ? "amber"
          : "gray";
  return <span className={`badge ${tone}`}>{children || "ไม่ระบุ"}</span>;
}
function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>ยังโหลดข้อมูลไม่ได้</strong>
        <p>{error.message}</p>
        {error instanceof ApiError && error.requestId && (
          <small>Request ID: {error.requestId}</small>
        )}
      </div>
      {onRetry && (
        <button className="button small" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}
function Empty() {
  return (
    <div className="empty">
      <Database size={30} />
      <h3>ไม่พบรายการ</h3>
      <p>ลองเปลี่ยนคำค้นหาหรือตัวกรอง</p>
    </div>
  );
}
function exportCsv(rows: Row[], name: string) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const escape = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  const csv =
    "\uFEFF" +
    [
      keys.map(escape).join(","),
      ...rows.map((r) => keys.map((k) => escape(r[k])).join(",")),
    ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `cmms-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [issueSelection,setIssueSelection]=useState<Row[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("cmms-theme", theme);
    } catch {
      /* Keep working without browser storage. */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#101923" : "#004a96");
  }, [theme]);
  const [requestedPage, setPage] = useState<Page>(() => {
    const p = location.hash.slice(1);
    return [...navigation.map((n) => n[0]), "settings"].includes(p as Page)
      ? (p as Page)
      : "overview";
  });
  const [session, setSession] = useState<{
    authenticated: boolean;
    loginRequired: boolean;
    configured: boolean;
    user?: User;
    role?: Role;
  } | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [connected, setConnected] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sidebarHidden,setSidebarHidden]=useState(()=>{try{return localStorage.getItem('cmms-sidebar-hidden')==='true'}catch{return false}});
  useEffect(()=>{try{localStorage.setItem('cmms-sidebar-hidden',String(sidebarHidden))}catch{}},[sidebarHidden]);
  useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(false)};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);
  const [role, setRole] = useState<Role>();
  const page:Page=canAccess(role,requestedPage)?requestedPage:([...navigation.map(n=>n[0]),'settings'] as Page[]).find(p=>canAccess(role,p))||'none';
  const dataConnected = (verifiedRole: Role) => {
    setRole(verifiedRole);
    setConnected(true);
  };
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState("");
  useEffect(()=>{const changed=()=>setRefresh(v=>v+1);window.addEventListener("cmms-media-updated",changed);return()=>window.removeEventListener("cmms-media-updated",changed)},[]);
  const [form, setForm] = useState<{ resource: Resource; row?: Row } | null>(
    null,
  );
  const [detail, setDetail] = useState<{ resource: Resource; row: Row } | null>(
    null,
  );
  useEffect(() => {
    fetch("/api/session")
      .then(async r => { const j=await r.json(); if(!r.ok)throw new Error(j.error?.message||"เชื่อมต่อฐานข้อมูลไม่ได้");return j; })
      .then((s) => {
        applyPermissions(s.permissions);
        setSession(s);
        setRole(s.role);
      })
      .catch(() =>
        setSessionError("เชื่อมต่อฐานข้อมูลไม่ได้ กรุณารีเฟรชหน้า"),
      );
  }, []);
  useEffect(()=>{
    const update=()=>fetch('/api/session').then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error?.message||'เชื่อมต่อฐานข้อมูลไม่ได้');return j}).then(s=>{
      applyPermissions(s.permissions);setSession(s);setRole(s.role);
      if(!s.authenticated){setDetail(null);setForm(null);setConnected(false)}
    }).catch(()=>{});
    const changed=()=>{update();setRefresh(v=>v+1)};
    window.addEventListener('focus',update);window.addEventListener('cmms-permissions-updated',changed);
    const timer=setInterval(update,30000);
    return()=>{clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('cmms-permissions-updated',changed)};
  },[]);
  useEffect(() => {
    const cb = () => {
      const p = location.hash.slice(1) as Page;
      setPage(
        [...navigation.map((n) => n[0]), "settings"].includes(p)
          ? p
          : "overview",
      );
      setMenu(false);
    };
    window.addEventListener("hashchange", cb);
    return () => window.removeEventListener("hashchange", cb);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const expire = () => {
      setSession((s) =>
        s
          ? { ...s, authenticated: false, user: undefined, role: undefined }
          : s,
      );
      setRole(undefined);
      setConnected(false);
      setDetail(null);
      setForm(null);
    };
    window.addEventListener("cmms-session-expired", expire);
    return () => window.removeEventListener("cmms-session-expired", expire);
  }, []);
  const go = (p: Page) => {
    if (!canAccess(role, p)) return;
    location.hash = p;
    setPage(p);
    setMenu(false);
  };
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setSessionError("");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message);
      applyPermissions(j.permissions);
      setSession((s) =>
        s ? { ...s, authenticated: true, user: j.user, role: j.role } : s,
      );
      setRole(j.role);
      setConnected(false);
      setPassword("");
    } catch (e) {
      setSessionError((e as Error).message);
    }
  }
  if (!session)
    return (
      <div className="login">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <div className="login-card">
          <h2>BASF CHEMCAT</h2>
          <p>{sessionError || "กำลังเชื่อมต่อระบบ…"}</p>
        </div>
      </div>
    );
  if (!session.authenticated)
    return (
      <div className="login">
        <ThemeToggle theme={theme} onChange={setTheme} />
        <form className="login-card" onSubmit={login}>
          <img src="/basf-logo.png" alt="BASF We create chemistry" />
          <span className="eyebrow">CHEMCAT · MAINTENANCE</span>
          <h1>เข้าสู่ระบบ CMMS</h1>
          <label>
            ชื่อผู้ใช้
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            รหัสผ่านเข้าใช้งาน
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {sessionError && <p role="alert">{sessionError}</p>}
          <button className="button primary">
            เข้าสู่ระบบ <ArrowRight size={18} />
          </button>
        </form>
      </div>
    );
  const title =
    navigation.find((n) => n[0] === page)?.[1] || "การเชื่อมต่อระบบ";
  return (
    <div className={`app-shell ${sidebarHidden?"sidebar-hidden":""}`}>
      <ThemeToggle theme={theme} onChange={setTheme} />
      {menu && <div className="sidebar-scrim" onClick={() => setMenu(false)} />}
      <aside id="main-sidebar" className={`sidebar ${menu ? "open" : ""}`}>
        <button className="sidebar-close icon-button" aria-label="ซ่อนเมนูด้านข้าง" onClick={()=>{setMenu(false);setSidebarHidden(true)}}><X size={18}/></button>
        <a className="brand" href="#overview">
          <img src="/basf-logo.png" alt="BASF — We create chemistry" />
        </a>
        <div className="plant-label">
          <span className="plant-mark">C</span>
          <div>
            <strong>CHEMCAT</strong>
            <small>Maintenance workspace</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          {navigation
            .filter(([id]) => canAccess(role, id))
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => go(id)}
              >
                <Icon size={19} />
                <span>{label}</span>
                {page === id && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="site-indicator">
            <span /> BASF CHEMCAT<span className="internal">INTERNAL</span>
          </div>
          {/* {canAccess(role, "settings") && (
            <>
              <button
                className={page === "settings" ? "active" : ""}
                onClick={() => go("settings")}
              >
                <Settings size={19} />
                การเชื่อมต่อระบบ
              </button>
            </>
          )} */}
          <div className="profile">
            <div className="avatar">MT</div>
            <div>
              <strong>{session.user?.displayName || "Maintenance team"}</strong>
              <small>{role ? roleLabels[role] : "ยังไม่ยืนยันสิทธิ์"}</small>
            </div>
            {session.loginRequired && (
              <button
                aria-label="ออกจากระบบ"
                onClick={async () => {
                  await fetch("/api/logout", { method: "POST" });
                  location.reload();
                }}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button sidebar-toggle"
              aria-label="ซ่อนหรือเปิดเมนูด้านข้าง"
              aria-controls="main-sidebar"
              onClick={() => {if(window.matchMedia("(max-width: 720px)").matches)setMenu(!menu);else setSidebarHidden(!sidebarHidden)}}
            >
              <Menu size={22} />
            </button>
            <span>Maintenance</span>
            <ChevronRight size={15} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <span className="desktop-date">
              {new Intl.DateTimeFormat("th-TH", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date())}
            </span>
            <span
              className={`connection-dot ${connected ? "connected" : ""}`}
            />
            <span>
              {connected ? "เชื่อมต่อฐานข้อมูลแล้ว" : "รอการเชื่อมต่อ"}
            </span>
            <div className="avatar small-avatar">MT</div>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                BASF CHEMCAT /{" "}
                {page === "overview"
                  ? "OPERATIONS"
                  : page.replaceAll("-", " ").toUpperCase()}
              </span>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === "overview"
                  ? "ติดตามงานบำรุงรักษา ความพร้อมเครื่องจักร และอะไหล่ในที่เดียว"
                  : page === "reports"
                    ? "วิเคราะห์งานและคลังอะไหล่จากรายการที่โหลด"
                    : page === "settings"
                      ? "สถานะการเชื่อมต่อและสิทธิ์การใช้งาน"
                      : modules[page as Resource]?.english}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                onClick={() => setRefresh((v) => v + 1)}
              >
                <RefreshCw size={16} />
                รีเฟรช
              </button>
              {(page === "overview" || page === "work-orders") && (
                <button
                  className="button primary"
                  disabled={!canWrite(role, "POST", "work-orders")}
                  onClick={() => setForm({ resource: "work-orders" })}
                >
                  <Plus size={18} />
                  เปิดใบงาน
                </button>
              )}
            </div>
          </div>
          {!session.configured && (
            <div className="connection-banner">
              <div className="banner-icon">
                <Database size={20} />
              </div>
              <div>
                <strong>พร้อมเชื่อมต่อข้อมูลโรงงาน</strong>
                <p>
                  ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล ·
                  ตั้งค่าฝั่งเซิร์ฟเวอร์เพื่อเริ่มอ่านและบันทึกข้อมูลจริง
                </p>
              </div>
              <button onClick={() => go("settings")}>
                ดูการเชื่อมต่อ <ArrowUpRight size={17} />
              </button>
            </div>
          )}
          {page === "none" ? <section className="panel report-panel"><h2>ยังไม่ได้รับสิทธิ์เข้าถึงฟังก์ชัน</h2><p>กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสิทธิ์ให้บัญชีนี้</p></section> : page === "overview" || page === "reports" ? (
            <Overview
              role={role}
              report={page === "reports"}
              refresh={refresh}
              onRole={dataConnected}
              go={go}
              onDetail={(resource, row) => setDetail({ resource, row })}
            />
          ) : page === "users" ? (
            <UserManagement currentUser={session.user!} />
          ) : page === "settings" ? (
            <SettingsPage
              configured={session.configured}
              role={role}
              loginRequired={session.loginRequired}
            />
          ) : (
            <ModulePage
              key={page}
              resource={page}
              issueSelection={issueSelection}
              onIssue={(row)=>{setIssueSelection([row]);go('stock-transactions')}}
              onIssueConsumed={()=>setIssueSelection([])}
              refresh={refresh}
              role={role}
              onRole={dataConnected}
              onNew={() => setForm({ resource: page })}
              onDetail={(row) => setDetail({ resource: page, row })}
            />
          )}
          <footer>
            <span>BASF CHEMCAT · CMMS</span>
            <span>Maintenance, connected.</span>
          </footer>
        </main>
      </div>
      {form && (
        <RecordForm
          resource={form.resource}
          row={form.row}
          close={() => setForm(null)}
          saved={() => {
            setForm(null);
            setDetail(null);
            setRefresh((v) => v + 1);
            setToast("บันทึกข้อมูลเรียบร้อยแล้ว");
          }}
        />
      )}
      {detail && !form && (
        <Detail
          key={`${detail.resource}-${str(detail.row, modules[detail.resource].id)}`}
          resource={detail.resource}
          row={detail.row}
          role={role}
          openRelated={(row) => setDetail({resource:"work-orders",row})}
          close={() => setDetail(null)}
          edit={() => setForm(detail)}
          removed={() => {
            setDetail(null);
            setRefresh((v) => v + 1);
            setToast("ยกเลิกรายการเรียบร้อยแล้ว");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={19} />
          {toast}
        </div>
      )}
    </div>
  );
}

function ThemeToggle({
  theme,
  onChange,
}: {
  theme: "light" | "dark";
  onChange: (theme: "light" | "dark") => void;
}) {
  const label =
    theme === "dark" ? "เปลี่ยนเป็นธีม Light" : "เปลี่ยนเป็นธีม Dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onChange(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function Overview({
  role,
  refresh,
  onRole,
  go,
  onDetail,
  report,
}: {
  role:Role|undefined;
  refresh: number;
  onRole: (r: Role) => void;
  go: (p: Page) => void;
  onDetail: (r: Resource, row: Row) => void;
  report: boolean;
}) {
  const [data, setData] = useState<Partial<Record<Resource, Row[]>>>({});
  const [errors, setErrors] = useState<Partial<Record<Resource, Error>>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErrors({});
    setData({});
    if (report) {
      fetch("/api/reports", { signal: ctrl.signal })
        .then(async (response) => {
          const j = await response.json();
          if (response.status === 401)
            window.dispatchEvent(new Event("cmms-session-expired"));
          if (!response.ok)
            throw new Error(j.error?.message || "โหลดรายงานไม่ได้");
          setData(j.data);
          onRole(j.role);
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setErrors({ "work-orders": e });
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
      return () => ctrl.abort();
    }
    Promise.all(
      (
        [
          "assets",
          "work-orders",
          "maintenance-plans",
          "spare-parts",
        ] as Resource[]
      ).filter(resource=>canAccess(role,resource)).map(async (resource) => {
        try {
          const j = await api(
            resource,
            { limit: 2000 },
            "GET",
            undefined,
            ctrl.signal,
          );
          if (!ctrl.signal.aborted) {
            setData((d) => ({ ...d, [resource]: j.data }));
            onRole(j.role);
          }
        } catch (e) {
          if (!ctrl.signal.aborted)
            setErrors((d) => ({ ...d, [resource]: e as Error }));
        }
      }),
    ).then(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });
    return () => ctrl.abort();
  }, [refresh, report, role]);
  const assets = data.assets;
  const wo = data["work-orders"];
  const plans = data["maintenance-plans"];
  const parts = data["spare-parts"];
  const open = wo?.filter((r) => !isClosed(r));
  const due = open?.filter((r) => overdue(r));
  const low = parts?.filter(
    (r) =>
      (value(r, "ReorderPoint") !== null &&
        num(r, "Quantity") <= num(r, "ReorderPoint")) ||
      (value(r, "MinimumStock") !== null &&
        num(r, "Quantity") < num(r, "MinimumStock")),
  );
  const done =
    wo?.filter((r) => str(r, "StatusCode") === "COMPLETED").length || 0;
  const metrics = [
    {
      label: "เครื่องจักรที่โหลด",
      val: assets?.length,
      unit: "รายการ",
      icon: Factory,
      foot: "ทะเบียนเครื่องจักร",
      page: "assets" as Page,
      color: "blue",
    },
    {
      label: "ใบงานที่ยังเปิดอยู่",
      val: open?.length,
      unit: "งาน",
      icon: ClipboardList,
      foot: due ? `${due.length} งานเกินกำหนด` : "รอข้อมูลใบงาน",
      page: "work-orders" as Page,
      color: "orange",
    },
    {
      label: "แผน PM เกินกำหนด",
      val: plans?.filter(
        (r) =>
          overdue(r, "NextDueDate") &&
          value(r, "IsActive") !== false &&
          value(r, "IsActive") !== 0,
      ).length,
      unit: "แผน",
      icon: CalendarDays,
      foot: "ติดตามกำหนดบำรุงรักษา",
      page: "maintenance-plans" as Page,
      color: "purple",
    },
    {
      label: "อะไหล่ต้องเติมสต็อก",
      val: low?.length,
      unit: "รายการ",
      icon: Package,
      foot: "เทียบขั้นต่ำ / จุดสั่งซื้อ",
      page: "spare-parts" as Page,
      color: "teal",
    },
  ];
  const firstError = Object.values(errors)[0];
  if(report) return <CategoryReports data={data} loading={loading} error={firstError} onExport={exportCsv}/>;
  return (
    <>
      <div className="section-kicker">
        <span>
          <span className="live-line" />
          ภาพรวมการปฏิบัติงาน
        </span>
        <span>
          ข้อมูลสูงสุด 2000 รายการ / หมวด{loading ? " · กำลังโหลด…" : ""}
        </span>
      </div>
      <div className="metrics">
        {metrics.map((m) => (
          <button className="metric" key={m.label} onClick={() => go(m.page)}>
            <div className="metric-top">
              <span>{m.label}</span>
              <div className={`metric-icon ${m.color}`}>
                <m.icon size={20} />
              </div>
            </div>
            <div className="metric-value">
              {m.val === undefined ? "—" : m.val.toLocaleString()}
              <span>{m.unit}</span>
            </div>
            <div className="metric-foot">
              {m.foot}
              <ArrowUpRight size={16} />
            </div>
          </button>
        ))}
      </div>
      {firstError && <ErrorBox error={firstError} />}
      {Object.keys(errors).length > 0 && (
        <p className="data-note">
          ยังไม่พร้อม:{" "}
          {Object.keys(errors)
            .map((k) => modules[k as Resource].title)
            .join(" · ")}
        </p>
      )}
      <div className="overview-grid">
        <section className="panel work-panel">
          <div className="panel-heading">
            <div>
              <h2>
                งานที่ต้องติดตาม{" "}
                <span className="count">{open?.length ?? "—"}</span>
              </h2>
              <p>เรียงจากงานเกินกำหนดและวันที่ใกล้ถึง</p>
            </div>
            <button className="text-button" onClick={() => go("work-orders")}>
              ใบงานทั้งหมด <ArrowRight size={16} />
            </button>
          </div>
          {loading ? (
            <Loading />
          ) : wo ? (
            <>
              <div className="mini-table-head">
                <span>ใบงาน / เครื่องจักร</span>
                <span>ความเร่งด่วน</span>
                <span>กำหนดเสร็จ</span>
              </div>
              {open?.length ? (
                open
                  .slice()
                  .sort(
                    (a, b) =>
                      (Date.parse(str(a, "DueDate")) || Infinity) -
                      (Date.parse(str(b, "DueDate")) || Infinity),
                  )
                  .slice(0, 6)
                  .map((r, i) => (
                    <button
                      className="work-row"
                      key={i}
                      onClick={() => onDetail("work-orders", r)}
                    >
                      <div className="work-main">
                        <span className="work-symbol">
                          <Wrench size={18} />
                        </span>
                        <div>
                          <strong>
                            {str(r, "Title") || str(r, "WorkOrderNo")}
                          </strong>
                          <small>
                            {str(r, "WorkOrderNo")}
                            <span> / </span>
                            {str(r, "MachineCode")} · {str(r, "TagNo")}
                          </small>
                        </div>
                      </div>
                      <Badge>{str(r, "PriorityCode")}</Badge>
                      <span className={overdue(r) ? "overdue" : ""}>
                        {display(value(r, "DueDate"), "DueDate")}
                      </span>
                    </button>
                  ))
              ) : (
                <Empty />
              )}
            </>
          ) : (
            <Unavailable text="ใบงานซ่อมบำรุงจะปรากฏเมื่อเชื่อมต่อข้อมูลสำเร็จ" />
          )}
        </section>
        <section className="panel completion-panel">
          <div className="panel-heading">
            <div>
              <h2>สถานะงานซ่อม</h2>
              <p>สัดส่วนจากใบงานที่โหลด</p>
            </div>
            <BarChart3 size={20} />
          </div>
          <div className="ring-wrap">
            <div
              className="progress-ring"
              style={
                {
                  "--progress": `${wo?.length ? (done / wo.length) * 100 : 0}%`,
                } as React.CSSProperties
              }
            >
              <div>
                <strong>
                  {wo?.length
                    ? Math.round((done / wo.length) * 100) + "%"
                    : "—"}
                </strong>
                <span>ดำเนินการเสร็จ</span>
              </div>
            </div>
          </div>
          <div className="legend">
            <div>
              <i className="legend-dot blue-dot" />
              <span>เสร็จสมบูรณ์</span>
              <strong>{wo ? done : "—"}</strong>
            </div>
            <div>
              <i className="legend-dot amber-dot" />
              <span>กำลังดำเนินการ / เปิด</span>
              <strong>{open?.length ?? "—"}</strong>
            </div>
            <div>
              <i className="legend-dot gray-dot" />
              <span>ปิด / ยกเลิก</span>
              <strong>
                {wo ? wo.length - done - (open?.length || 0) : "—"}
              </strong>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>กำหนดบำรุงรักษาถัดไป</h2>
              <p>รายการที่ถึงกำหนดเร็วที่สุด</p>
            </div>
            <button
              className="text-button"
              onClick={() => go("maintenance-plans")}
            >
              ดูแผน <ArrowRight size={16} />
            </button>
          </div>
          {plans ? (
            plans
              .filter(
                (r) =>
                  value(r, "IsActive") !== false &&
                  value(r, "IsActive") !== 0 &&
                  validDate(value(r, "NextDueDate")),
              )
              .sort(
                (a, b) =>
                  (Date.parse(str(a, "NextDueDate")) || Infinity) -
                  (Date.parse(str(b, "NextDueDate")) || Infinity),
              )
              .slice(0, 4)
              .map((r, i) => (
                <button
                  className="plan-row"
                  key={i}
                  onClick={() => onDetail("maintenance-plans", r)}
                >
                  <div className="date-tile">
                    <CalendarDays size={20} />
                  </div>
                  <div>
                    <strong>
                      {str(r, "TaskDescription") || "แผนบำรุงรักษา"}
                    </strong>
                    <small>
                      {str(r, "MachineCode")} · {str(r, "TagNo")}
                    </small>
                  </div>
                  <span className={overdue(r, "NextDueDate") ? "overdue" : ""}>
                    {display(value(r, "NextDueDate"), "NextDueDate")}
                  </span>
                </button>
              ))
          ) : (
            <Unavailable text="รอข้อมูลแผนบำรุงรักษา" />
          )}
          {plans?.length === 0 && <Empty />}
        </section>
        <section className="panel stock-panel">
          <div className="panel-heading">
            <div>
              <h2>สุขภาพคลังอะไหล่</h2>
              <p>เฝ้าระวังสต็อกและการเคลื่อนไหว</p>
            </div>
            <Package size={20} />
          </div>
          {[
            ["ต้องเติมสต็อก", low?.length, "red"],
            [
              "เคลื่อนไหวช้า (180–364 วัน)",
              parts?.filter(
                (r) =>
                  num(r, "Quantity") > 0 &&
                  num(r, "DaysSinceLastTransaction") >= 180 &&
                  num(r, "DaysSinceLastTransaction") < 365,
              ).length,
              "amber",
            ],
            [
              "ไม่เคลื่อนไหว ≥ 365 วัน",
              parts?.filter(
                (r) =>
                  num(r, "Quantity") > 0 &&
                  num(r, "DaysSinceLastTransaction") >= 365,
              ).length,
              "gray",
            ],
          ].map(([label, count, color]) => (
            <button
              key={label}
              className="stock-health"
              onClick={() => go("spare-parts")}
            >
              <span className={`status-square ${color}`} />
              <span>{label}</span>
              <strong>{count ?? "—"}</strong>
              <ChevronRight size={16} />
            </button>
          ))}
          <div className="inventory-link">
            <span>วางแผนอะไหล่ให้พร้อมใช้งาน</span>
            <button className="text-button" onClick={() => go("spare-parts")}>
              เปิดคลังอะไหล่ <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
      </div>
      {report && (
        <section className="panel report-panel">
          <h2>ส่งออกรายงาน</h2>
          <p>ข้อมูลที่โหลดสูงสุด 2000 รายการต่อหมวด ไม่ใช่ผลรวมทั้งฐานข้อมูล</p>
          <div className="report-cards">
            {(
              [
                "assets",
                "work-orders",
                "maintenance-plans",
                "spare-parts",
              ] as Resource[]
            ).map((r) => (
              <button
                className="button"
                key={r}
                disabled={!data[r]?.length}
                onClick={() => exportCsv(data[r]!, r)}
              >
                <Download size={17} />
                {modules[r].title}
              </button>
            ))}
          </div>
          <p>
            เวลาหยุดเครื่องรวมในใบงานที่โหลด:{" "}
            <strong>
              {wo
                ? wo
                    .reduce((sum, r) => sum + num(r, "DowntimeMinutes"), 0)
                    .toLocaleString()
                : "—"}{" "}
              นาที
            </strong>
          </p>
        </section>
      )}
      <p className="data-note">
        ค่ารวมคำนวณจากข้อมูลที่ API ส่งกลับ สูงสุด 2000 รายการต่อหมวด ·
        เมื่อข้อมูลไม่พร้อมจะแสดง —
      </p>
    </>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <RefreshCw className="spin" size={22} />
      กำลังโหลดข้อมูล…
    </div>
  );
}
function Unavailable({ text }: { text: string }) {
  return (
    <div className="empty unavailable">
      <div className="ghost-lines">
        <i />
        <i />
        <i />
      </div>
      <Database size={26} />
      <p>{text}</p>
    </div>
  );
}

function newestRequest(a:Row,b:Row){
 const stamp=(r:Row)=>validDate(value(r,'RequestedDate'))?Date.parse(str(r,'RequestedDate')):Number.NEGATIVE_INFINITY;
 return (stamp(b)-stamp(a)) || Number(value(b,'WorkOrderID'))-Number(value(a,'WorkOrderID'));
}
function PartReference({row}:{row:Row}) {
 const [failed,setFailed]=useState(false),[open,setOpen]=useState(false);
 const url=str(row,'ReferenceImageUrl');
 const label=str(row,'PartName')||str(row,'AssetName');
 useEffect(()=>setFailed(false),[url]);
 return url&&!failed?<><button className="part-reference" type="button" aria-label={`ดูรูป ${label}`} onClick={()=>setOpen(true)}><img src={url} alt={`รูป ${label}`} loading="lazy" onError={()=>setFailed(true)}/><small>ดูรูปภาพ</small></button>{open&&<ImageViewer images={[{url,alt:label}]} initial={0} close={()=>setOpen(false)}/>}</>:<span className="part-reference empty-reference" title="ยังไม่มีภาพที่ยืนยันความใกล้เคียง"><Package size={22}/><small>ไม่มีภาพ</small></span>;
}
function ModulePage({
  issueSelection, onIssue, onIssueConsumed,
  resource,
  refresh,
  role,
  onRole,
  onNew,
  onDetail,
}: {
  issueSelection: Row[];
  onIssue:(row:Row)=>void;
  onIssueConsumed:()=>void;
  resource: Resource;
  refresh: number;
  role: Role | undefined;
  onRole: (r: Role) => void;
  onNew: () => void;
  onDetail: (r: Row) => void;
}) {
  const config = modules[resource];
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(2000);
  const [status, setStatus] = useState("all");
  const [department,setDepartment]=useState('');
  const [partType,setPartType]=useState('');
  const [facets,setFacets]=useState<{departments:string[];partTypes:string[]}>({departments:[],partTypes:[]});
  const [total,setTotal]=useState<number>();
  const [index, setIndex] = useState(0);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState("list");
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setIndex(0);
      setStatus("all");
    }, 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(undefined);
    setRows([]);
    api(resource, { search: query, limit, ...(resource==="spare-parts"?{...(department?{department}:{}),...(partType?{partType}:{})}:{}) }, "GET", undefined, ctrl.signal)
      .then((j) => {
        setRows(resource === "work-orders" ? [...j.data].sort(newestRequest) : j.data);
        setTotal(j.total);if(j.facets)setFacets(j.facets);
        onRole(j.role);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [resource, refresh, query, limit, retry, department, partType]);
  const statuses = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((r) => str(r, config.status || "StatusCode"))
            .filter(Boolean),
        ),
      ].sort(),
    [rows, config],
  );
  const filtered = rows.filter(
    (r) =>
      status === "all" ||
      (status === "overdue"
        ? overdue(
            r,
            resource === "maintenance-plans" ? "NextDueDate" : "DueDate",
          ) && !isClosed(r)
        : str(r, config.status || "StatusCode") === status),
  );
  const visible = filtered.slice(index * 15, index * 15 + 15);
  return (
    <>
      {resource === 'stock-transactions' && canWrite(role,'POST','stock-transactions') && <IssueParts initial={issueSelection} onConsumed={onIssueConsumed} role={role} onSaved={()=>setRetry(n=>n+1)}/>}
      <section className="panel resource-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label="ค้นหา"
              maxLength={100}
              placeholder={
                resource === "assets"
                  ? "ค้นหา Machine code, Tag no. หรือชื่อ…"
                  : "ค้นหารายการ…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="ล้างการค้นหา" onClick={() => setSearch("")}>
                <X size={16} />
              </button>
            )}
          </div>
          <div className="toolbar-right">
            <label className="filter-control">
              <Filter size={16} />
              <select
                aria-label="กรองสถานะ"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setIndex(0);
                }}
              >
                <option value="all">ทุกสถานะ</option>
                {["work-orders", "maintenance-plans"].includes(resource) && (
                  <option value="overdue">เกินกำหนด</option>
                )}
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={!filtered.length || !canAccess(role, "reports")}
              onClick={() => exportCsv(filtered, resource)}
            >
              <Download size={16} />
              <span>ส่งออก</span>
            </button>
            {config.fields.length > 0 && (
              <button
                className="button primary"
                disabled={!canWrite(role, "POST", resource)}
                onClick={onNew}
              >
                <Plus size={17} />
                เพิ่ม{config.singular}
              </button>
            )}
          </div>
        </div>
        {resource==='spare-parts'&&<div className="parts-filters">
          <label>Department<select aria-label="กรอง Department" value={department} onChange={e=>{setDepartment(e.target.value);setIndex(0);setStatus("all")}}><option value="">ทุก Department</option>{facets.departments.map(v=><option key={v} value={v}>{v==='__missing__'?'ไม่ระบุ':v}</option>)}</select></label>
          <label>PartType<select aria-label="กรอง PartType" value={partType} onChange={e=>{setPartType(e.target.value);setIndex(0);setStatus("all")}}><option value="">ทุก PartType</option>{facets.partTypes.map(v=><option key={v} value={v}>{v==='__missing__'?'ไม่ระบุ':v}</option>)}</select></label>
          {(department||partType)&&<button className="button" onClick={()=>{setDepartment('');setPartType('');setIndex(0);setStatus('all')}}><X size={16}/>ล้างตัวกรองกลุ่ม</button>}
          <small>กรอง Department และ PartType จากฐานข้อมูลทั้งหมด{total!==undefined?` · พบ ${total.toLocaleString()} รายการ`:''}</small>
        </div>}
        <div className="table-subbar">
          <span>
            {config.english}
            <span className="count">{loading ? "…" : filtered.length}</span>
          </span>
          <div>
            {resource === "maintenance-plans" && (
              <div className="segmented">
                <button
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                >
                  รายการ
                </button>
                <button
                  className={view === "calendar" ? "selected" : ""}
                  onClick={() => setView("calendar")}
                >
                  ปฏิทิน
                </button>
              </div>
            )}
            <label>
              โหลดสูงสุด{" "}
              <select
                aria-label="จำนวนรายการสูงสุด"
                value={limit}
                onChange={(e) => {
                  setLimit(+e.target.value);
                  setIndex(0);
                }}
              >
                {[100, 250, 500, 1000, 2000].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {error ? (
          <ErrorBox error={error} onRetry={() => setRetry((v) => v + 1)} />
        ) : loading ? (
          <Loading />
        ) : view === "calendar" ? (
          <Calendar
            rows={filtered}
            month={month}
            setMonth={setMonth}
            onDetail={onDetail}
          />
        ) : filtered.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {["spare-parts","assets"].includes(resource)&&<th>รูปภาพ</th>}
                    {config.columns.map(([k, l]) => (
                      <th key={k}>{l}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => (
                    <tr key={str(r, config.id) || i}>
                      {["spare-parts","assets"].includes(resource)&&<td><PartReference row={r}/></td>}
                      {config.columns.map(([k]) => (
                        <td key={k}>
                          {k === config.columns[0][0] ? (
                            <button
                              className="record-link"
                              onClick={() => onDetail(r)}
                            >
                              {display(value(r, k) ?? value(r, "TagNo"), k)}
                            </button>
                          ) : /Status|Priority|Criticality|Result/i.test(k) ? (
                            <Badge>
                              {value(r, k) === null ? "ไม่ระบุ" : str(r, k)}
                            </Badge>
                          ) : (
                            <span
                              className={
                                /DueDate/.test(k) &&
                                overdue(r, k) &&
                                !isClosed(r)
                                  ? "overdue"
                                  : ""
                              }
                            >
                              {display(value(r, k), k)}
                            </span>
                          )}
                        </td>
                      ))}
                      <td>
                        {resource==='spare-parts'&&canWrite(role,'POST','stock-transactions')&&<button className="button" onClick={()=>onIssue(r)}>เบิก</button>}
                        <button
                          className="icon-button"
                          aria-label="ดูรายละเอียด"
                          onClick={() => onDetail(r)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                แสดง {index * 15 + 1}–
                {Math.min((index + 1) * 15, filtered.length)} จาก{" "}
                {filtered.length} รายการที่โหลด
              </span>
              <div>
                <button
                  aria-label="หน้าก่อนหน้า"
                  disabled={!index}
                  onClick={() => setIndex((v) => v - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  {index + 1} / {Math.ceil(filtered.length / 15)}
                </span>
                <button
                  aria-label="หน้าถัดไป"
                  disabled={(index + 1) * 15 >= filtered.length}
                  onClick={() => setIndex((v) => v + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <Empty />
        )}
      </section>
      {((total!==undefined&&total>rows.length)||rows.length>=limit) && (
        <p className="data-note warning">
          โหลดแล้ว {rows.length.toLocaleString()} รายการ{total!==undefined?` จากทั้งหมด ${total.toLocaleString()} รายการที่ตรงตัวกรอง`:" อาจมีข้อมูลเพิ่มเติม"} · เลือกโหลดสูงสุด {limit.toLocaleString()} รายการ
          กรุณาใช้คำค้นหาหรือตัวกรองเพื่อเจาะจงรายการที่ต้องการ
        </p>
      )}
      {resource === "spare-parts" &&
        canAccess(role, "reports") &&
        !loading &&
        !error && <SpareAnalytics rows={filtered} />}
      {resource === "maintenance-plans" &&
        rows.some(
          (r) => value(r, "NextDueDate") && !validDate(value(r, "NextDueDate")),
        ) && (
          <p className="data-note warning">
            มี{" "}
            {
              rows.filter(
                (r) =>
                  value(r, "NextDueDate") &&
                  !validDate(value(r, "NextDueDate")),
              ).length
            }{" "}
            แผนที่วันที่ผิดปกติ (ปี 1900/1901)
            แสดงให้ตรวจสอบและไม่นับเป็นงานเกินกำหนด
          </p>
        )}
      {resource === "spare-parts" && (
        <p className="data-note">
          คลิกอะไหล่เพื่อดู Min / Max, SAP Material, ต้นทุน และข้อมูลเพิ่มเติม ·
          ปรับยอดผ่านรายการรับ–เบิกเพื่อรักษาประวัติ · ภาพอ้างอิงจากภายนอก ไม่ใช่ภาพสต็อกจริง คลิกภาพเพื่อเปิด Gallery
        </p>
      )}
      {resource === "calibration-history" && (
        <p className="data-note">
          ผลสอบเทียบที่ไม่ระบุไม่ถือว่า FAIL · ตรวจสอบ DataQualityStatus
          สำหรับข้อมูลที่ย้ายเข้าระบบ
        </p>
      )}
    </>
  );
}

function Calendar({
  rows,
  month,
  setMonth,
  onDetail,
}: {
  rows: Row[];
  month: Date;
  setMonth: (d: Date) => void;
  onDetail: (r: Row) => void;
}) {
  const year = month.getFullYear(),
    m = month.getMonth(),
    days = new Date(year, m + 1, 0).getDate(),
    offset = (new Date(year, m, 1).getDay() + 6) % 7;
  return (
    <div className="calendar">
      <div className="calendar-nav">
        <button
          className="icon-button"
          aria-label="เดือนก่อน"
          onClick={() => setMonth(new Date(year, m - 1, 1))}
        >
          <ChevronLeft />
        </button>
        <h2>
          {new Intl.DateTimeFormat("th-TH", {
            month: "long",
            year: "numeric",
          }).format(month)}
        </h2>
        <button
          className="icon-button"
          aria-label="เดือนถัดไป"
          onClick={() => setMonth(new Date(year, m + 1, 1))}
        >
          <ChevronRight />
        </button>
      </div>
      <div className="calendar-grid">
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d) => (
          <div className="day-name" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div className="calendar-day muted-day" key={"e" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${year}-${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
          return (
            <div className="calendar-day" key={date}>
              <strong>{i + 1}</strong>
              {rows
                .filter(
                  (r) => inputDate(value(r, "NextDueDate"), "date") === date,
                )
                .map((r, j) => (
                  <button
                    key={j}
                    onClick={() => onDetail(r)}
                    title={str(r, "TaskDescription")}
                  >
                    {str(r, "MachineCode") || str(r, "TaskDescription")}
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    el?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && el) {
        const nodes = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea,select,a[href],[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === el)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="eyebrow">MAINTENANCE WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" aria-label="ปิด" onClick={close}>
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function RecordForm({
  resource,
  row,
  close,
  saved,
}: {
  resource: Resource;
  row?: Row;
  close: () => void;
  saved: () => void;
}) {
  const c = modules[resource];
  const fields = row ? c.edit || c.fields : c.fields;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        row
          ? (inputDate(value(row, f.key), f.type) ?? "")
          : f.type === "checkbox"
            ? false
            : "",
      ]),
    ),
  );
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body: Record<string, unknown> = {};
    for (const field of fields) {
      const v = values[field.key];
      if (v !== "" && v !== undefined && v !== null)
        body[field.key] = field.type === "number" ? Number(v) : v;
    }
    if (
      body.statusCode === "COMPLETED" &&
      (!body.actualFinish || !body.actionTaken)
    ) {
      setError(new Error("กรุณาระบุการแก้ไขและเวลาที่เสร็จงานก่อนปิดใบงาน"));
      return;
    }
    setBusy(true);
    try {
      await api(
        resource,
        row ? { id: str(row, c.id) } : {},
        row ? "PUT" : "POST",
        body,
      );
      saved();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${row ? "แก้ไข" : "เพิ่ม"}${c.singular}`}
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={save}>
        <div className="form-body">
          {error && <ErrorBox error={error} />}
          <div className="form-grid">
            {fields.map((f) => (
              <label
                className={f.type === "textarea" ? "full-width" : ""}
                key={f.key}
              >
                {f.label}
                {f.required && <span className="required"> *</span>}
                {["warehouseId", "vendorId"].includes(f.key) ? (
                  <LookupField
                    field={f}
                    val={String(values[f.key] ?? "")}
                    change={(v) => setValues({ ...values, [f.key]: v })}
                  />
                ) : f.ref ? (
                  <ReferenceField
                    field={f}
                    val={String(values[f.key] ?? "")}
                    change={(v) => setValues({ ...values, [f.key]: v })}
                  />
                ) : f.type === "select" ? (
                  <select
                    required={f.required}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  >
                    <option value="">เลือกรายการ</option>
                    {f.options?.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    rows={3}
                    required={f.required}
                    value={String(values[f.key] ?? "")}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                ) : f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.checked })
                    }
                  />
                ) : (
                  <input
                    type={f.type}
                    required={f.required}
                    min={f.min}
                    maxLength={f.type === "text" ? 500 : undefined}
                    step={f.type === "number" ? "any" : undefined}
                    value={
                      f.type === "date"
                        ? String(values[f.key] ?? "").slice(0, 10)
                        : f.type === "datetime-local"
                          ? String(values[f.key] ?? "").slice(0, 16)
                          : String(values[f.key] ?? "")
                    }
                    onChange={(e) =>
                      setValues({ ...values, [f.key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {resource === "stock-transactions" && (
            <p className="data-note">
              รายการนี้เป็นประวัติถาวร กรุณาตรวจสอบจำนวน คลัง
              และเอกสารอ้างอิงก่อนบันทึก
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={close}
          >
            ยกเลิก
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <RefreshCw className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ReferenceField({
  field,
  val,
  change,
}: {
  field: Field;
  val: string;
  change: (v: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api(field.ref!, { search, limit: 50 }, "GET", undefined, ctrl.signal)
        .then((j) => {
          setRows(j.data);
          setError("");
        })
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [search, field.ref]);
  const config = modules[field.ref!];
  return (
    <div className="reference-field">
      <input
        aria-label={`ค้นหา${field.label}`}
        value={search}
        maxLength={100}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="พิมพ์เพื่อค้นหา…"
      />
      <select
        aria-label={field.label}
        required={field.required}
        value={val}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">เลือกรายการ</option>
        {val && !rows.some((r) => str(r, config.id) === val) && (
          <option value={val}>รายการที่เลือก #{val}</option>
        )}
        {rows.map((r, i) => (
          <option key={str(r, config.id) || i} value={str(r, config.id)}>
            {field.ref === "assets"
              ? `${str(r, "MachineCode")} · ${str(r, "TagNo")} — ${str(r, "AssetName")}`
              : field.ref === "spare-parts"
                ? `${str(r, "PartCode")} — ${str(r, "PartName")}`
                : field.ref === "work-orders"
                  ? `${str(r, "WorkOrderNo")} — ${str(r, "Title")}`
                  : `${str(r, "MachineCode")} — ${str(r, "TaskDescription")}`}
          </option>
        ))}
      </select>
      {error && <small className="overdue">{error}</small>}
    </div>
  );
}
function Detail({
  resource,
  row,
  role,
  close,
  edit,
  removed,
  openRelated,
}: {
  resource: Resource;
  row: Row;
  role: Role | undefined;
  close: () => void;
  edit: () => void;
  removed: () => void;
  openRelated: (row:Row) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const c = modules[resource];
  const id = str(row, c.id);
  return (
    <Modal
      title={
        str(row, "AssetName") ||
        str(row, "PartName") ||
        str(row, "Title") ||
        c.singular
      }
      close={close}
      wide
    >
      <div className="detail-body">
        <div className="detail-identity">
          <FileText size={22} />
          <strong>
            {str(row, "MachineCode") ||
              str(row, "PartCode") ||
              str(row, "WorkOrderNo") ||
              c.english}
            {str(row, "TagNo") && ` · ${str(row, "TagNo")}`}
          </strong>
          <Badge>{str(row, c.status || "StatusCode")}</Badge>
        </div>
        {error && <ErrorBox error={error} />}
        {["spare-parts","assets"].includes(resource)&&<MediaGallery resource={resource} id={id} role={role} row={row}/>}
        <dl className="detail-grid">
          {Object.entries(row)
            .filter(([k]) => !/ID$/i.test(k)&&!/^Reference|^ImageOrigin/.test(k))
            .map(([k, v]) => (
              <div key={k}>
                <dt>
                  {c.columns.find(
                    (x) => x[0].toLowerCase() === k.toLowerCase(),
                  )?.[1] || k}
                </dt>
                <dd>{display(v, k)}</dd>
              </div>
            ))}
        </dl>
        {resource === "assets" && canAccess(role, "maintenance-plans") && (
          <RelatedAsset row={row} openRelated={openRelated} />
        )}
      </div>
      <div className="modal-actions">
        {canWrite(role, "DELETE", resource, row) && id && (
          <button
            className="button danger"
            disabled={busy}
            onClick={async () => {
              if (!confirm) {
                setConfirm(true);
                return;
              }
              setBusy(true);
              try {
                await api(resource, { id }, "DELETE");
                removed();
              } catch (e) {
                setError(e as Error);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm
              ? "ยืนยันยกเลิกรายการนี้"
              : resource === "assets"
                ? "ปลดระวาง"
                : resource === "maintenance-plans"
                  ? "ปิดใช้แผน"
                  : "ยกเลิกรายการ"}
          </button>
        )}
        <button className="button" onClick={close}>
          ปิด
        </button>
        {canWrite(role, "PUT", resource, row) && id && c.fields.length > 0 && (
          <button className="button primary" onClick={edit}>
            แก้ไข{c.singular}
          </button>
        )}
      </div>
    </Modal>
  );
}
function RelatedAsset({ row, openRelated }: { row: Row; openRelated:(row:Row)=>void }) {
  const [records, setRecords] = useState<Partial<Record<Resource, Row[]>>>({});
  const [error, setError] = useState<Error>();
  useEffect(() => {
    const ctrl = new AbortController();
    for (const r of ["maintenance-plans", "work-orders"] as Resource[])
      api(
        r,
        { search: str(row, "MachineCode") || str(row, "TagNo"), limit: 2000 },
        "GET",
        undefined,
        ctrl.signal,
      )
        .then((j) =>
          setRecords((prev) => ({
            ...prev,
            [r]: (r === "work-orders" ? [...j.data].sort(newestRequest) : j.data).filter(
              (x) => str(x, "AssetID") === str(row, "AssetID"),
            ),
          })),
        )
        .catch((e) => {
          if (!ctrl.signal.aborted) setError(e);
        });
    return () => ctrl.abort();
  }, [row]);
  return (
    <div className="related">
      <h3>แผน PM และประวัติการซ่อม</h3>
      <p className="data-note">จากผลการค้นหาสูงสุด 2000 รายการต่อหมวด</p>
      {error && <ErrorBox error={error} />}{" "}
      {(["maintenance-plans", "work-orders"] as Resource[]).map((r) => (
        <section key={r}>
          <h4>
            {modules[r].title} ({records[r]?.length ?? "…"})
          </h4>
          {records[r]?.map((item, i) => (
            <div className={`related-row ${r === "work-orders" ? "related-work-order" : ""}`} key={i} role={r === "work-orders" ? "button" : undefined} tabIndex={r === "work-orders" ? 0 : undefined} title={r === "work-orders" ? "ดับเบิ้ลคลิกเพื่อดูใบงาน หรือกด Enter" : undefined} onDoubleClick={()=>{if(r === "work-orders")openRelated(item)}} onKeyDown={e=>{if(r === "work-orders" && (e.key === "Enter" || e.key === " ")){e.preventDefault();openRelated(item)}}}>
              <span>{str(item, "TaskDescription") || str(item, "Title")}</span>
              <span>
                {display(
                  value(item, r === "work-orders" ? "RequestedDate" : "NextDueDate"),
                  "DueDate",
                )}
              </span>
            </div>
          ))}
          {records[r]?.length === 0 && (
            <p>ไม่พบรายการที่สัมพันธ์กับเครื่องจักรนี้</p>
          )}
        </section>
      ))}
    </div>
  );
}
function SettingsPage({
  configured,
  role,
  loginRequired,
}: {
  configured: boolean;
  role: Role | undefined;
  loginRequired: boolean;
}) {
  return (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="settings-icon">
          <Database size={28} />
        </div>
        <h2>การเชื่อมต่อฐานข้อมูล CMMS</h2>
        <p>สถานะการเชื่อมต่อฐานข้อมูล</p>
        <dl>
          <div>
            <dt>การตั้งค่า API Key</dt>
            <dd>
              <Badge>{configured ? "CONFIGURED" : "รอ API KEY"}</Badge>
            </dd>
          </div>
          <div>
            <dt>สิทธิ์ที่ระบบยืนยัน</dt>
            <dd>{role || "ยังไม่ยืนยัน"}</dd>
          </div>
          <div>
            <dt>การเข้าสู่ระบบ</dt>
            <dd>{loginRequired ? "เปิดใช้งาน" : "เฉพาะเครื่องนี้"}</dd>
          </div>
          <div>
            <dt>แหล่งข้อมูล</dt>
            <dd>BASF_CHEMCAT_CMMS</dd>
          </div>
        </dl>
      </section>
      <section className="panel settings-panel">
        <h2>การตั้งค่าโดยผู้ดูแล</h2>
        <ol>
          <li>
            นำ Key สำหรับฐานข้อมูลมาใส่ใน <code>CMMS_API_KEY</code> ของไฟล์{" "}
            <code>.env</code> บนเซิร์ฟเวอร์
          </li>
          <li>เริ่มเซิร์ฟเวอร์ใหม่ แล้วกดรีเฟรชเพื่อยืนยันการเชื่อมต่อ</li>
          <li>
            สำหรับมือถือใน LAN ให้ตั้งรหัสผ่านเข้าใช้งาน และเปิดเซิร์ฟเวอร์ที่{" "}
            <code>HOST=0.0.0.0</code>
          </li>
        </ol>
        <p>
          Key เก็บอยู่ฝั่งเซิร์ฟเวอร์ สิทธิ์สร้าง แก้ไข และยกเลิกอ้างอิงจาก
          ระบบฐานข้อมูล
        </p>
        <div className="notice">
          <ShieldCheck size={22} />
          <span>
            ข้อมูลจะแสดงตามจริงเมื่อ API พร้อมใช้งาน
            ไม่มีข้อมูลจำลองปะปนกับฐานข้อมูล
          </span>
        </div>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

function LookupField({
  field,
  val,
  change,
}: {
  field: Field;
  val: string;
  change: (v: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/lookups")
      .then((r) => {
        if (!r.ok) throw new Error("โหลดรายการอ้างอิงไม่ได้");
        return r.json();
      })
      .then((j) => setRows(field.key === "vendorId" ? j.vendors : j.warehouses))
      .catch((e) => setError(e.message));
  }, [field.key]);
  const id = field.key === "vendorId" ? "VendorID" : "WarehouseID",
    label = field.key === "vendorId" ? "VendorName" : "WarehouseName";
  return (
    <>
      <select
        aria-label={field.label}
        required={field.required}
        value={val}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">เลือกรายการ</option>
        {rows.map((r) => (
          <option key={str(r, id)} value={str(r, id)}>
            {str(r, label)}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </>
  );
}


