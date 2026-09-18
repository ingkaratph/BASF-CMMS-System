import { useEffect, useState } from "react";
import { Plus, Save, X, UserRoundCog } from "lucide-react";
import { roles, roleLabels } from "../shared/permissions.mjs";
import type { User, Role } from "./api";
import {PermissionEditor} from './permission-editor';
import './permissions.css';

export function UserManagement({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<User[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{
    id?: string;
    username: string;
    displayName: string;
    department: string;
    role: Role;
    active: boolean;
    password: string;
  } | null>(null);
  const load = () =>
    fetch("/api/users")
      .then(async (r) => {
        const j = await r.json();
        if (r.status === 401)
          window.dispatchEvent(new Event("cmms-session-expired"));
        if (!r.ok) throw new Error(j.error?.message || "โหลดผู้ใช้ไม่สำเร็จ");
        setUsers(j.data);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function removeUser(user:User){if(!window.confirm('ลบผู้ใช้ '+user.username+' หรือไม่? บัญชีนี้จะเข้าสู่ระบบไม่ได้ โดยยังเก็บประวัติงานเดิมไว้'))return;setBusy(true);setError('');setNotice('');try{const r=await fetch('/api/users/'+user.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:user.version})});const j=await r.json();if(!r.ok)throw Error(j.error?.message||'ลบไม่สำเร็จ');if(draft?.id===user.id)setDraft(null);setNotice('ลบผู้ใช้ '+user.username+' แล้ว');await load()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { id, password, ...body } = draft;
    try {
      const r = await fetch("/api/users" + (id ? "/" + id : ""), {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ...(password ? { password } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || "บันทึกไม่สำเร็จ");
      setDraft(null);
      setNotice("บันทึกบัญชีและสิทธิ์เรียบร้อยแล้ว");
      if (id === currentUser.id) {
        window.dispatchEvent(new Event("cmms-session-expired"));
        return;
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PermissionEditor />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>บัญชีผู้ใช้</h2>
            <p>
              กำหนดบทบาทต่อบัญชี การเปลี่ยนสิทธิ์หรือรหัสผ่านจะยกเลิกเซสชันเดิม
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => {
              setError("");
              setDraft({
                username: "",
                displayName: "",
                department: "",
                role: "TECHNICIAN",
                active: true,
                password: "",
              });
            }}
          >
            <Plus size={17} />
            เพิ่มผู้ใช้
          </button>
        </div>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <p className="data-note" role="status">
            {notice}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>ชื่อผู้ใช้</th>
                <th>ชื่อแสดง</th>
                <th>Department</th><th>สิทธิ์</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{u.department||"ยังไม่ระบุ"}</td><td>{roleLabels[u.role]}</td>
                  <td>{u.active ? "ใช้งาน" : "ปิดใช้งาน"}</td>
                  <td>
                    <button
                      className="button"
                      onClick={() => {
                        setError("");
                        setDraft({
                          id: u.id,
                          username: u.username,
                          displayName: u.displayName,
                          department: u.department||"",
                          role: u.role,
                          active: u.active,
                          password: "",
                        });
                      }}
                    >
                      <UserRoundCog size={16} />
                      แก้ไขสิทธิ์
                    </button>{u.id!==currentUser.id&&<button className="button danger" disabled={busy} aria-label={"ลบผู้ใช้ "+u.username} onClick={()=>removeUser(u)}>ลบผู้ใช้</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {draft && (
        <section className="panel report-panel" aria-label="แก้ไขบัญชี">
          <div className="panel-heading">
            <h2>{draft.id ? "แก้ไขบัญชี" : "เพิ่มบัญชี"}</h2>
            <button
              className="icon-button"
              aria-label="ปิดฟอร์มผู้ใช้"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              <X size={20} />
            </button>
          </div>
          <form onSubmit={save}>
            <div className="form-grid"><label>Department<select aria-label="Department" required value={draft.department} onChange={e=>setDraft({...draft,department:e.target.value})}><option value="">เลือกแผนก</option>{["Maintenance","Slurry","Coating","Warehouse","PD Office","QA/QC","SCM"].map(d=><option key={d}>{d}</option>)}</select></label>
              <label>
                ชื่อผู้ใช้
                <input
                  autoComplete="off"
                  required
                  pattern="[a-zA-Z0-9._-]{3,50}"
                  value={draft.username}
                  onChange={(e) =>
                    setDraft({ ...draft, username: e.target.value })
                  }
                />
              </label>
              <label>
                ชื่อแสดง
                <input
                  required
                  maxLength={100}
                  value={draft.displayName}
                  onChange={(e) =>
                    setDraft({ ...draft, displayName: e.target.value })
                  }
                />
              </label>
              <label>
                บทบาท
                <select
                  disabled={draft.id === currentUser.id}
                  value={draft.role}
                  onChange={(e) =>
                    setDraft({ ...draft, role: e.target.value as Role })
                  }
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabels[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {draft.id
                  ? "รหัสผ่านใหม่ (เว้นว่างเพื่อใช้รหัสเดิม)"
                  : "รหัสผ่าน"}
                <input
                  type="password"
                  autoComplete="new-password"
                  required={!draft.id}
                  aria-describedby="user-password-help"
                  minLength={6}
                  maxLength={128}
                  value={draft.password}
                  onChange={(e) =>
                    setDraft({ ...draft, password: e.target.value })
                  }
                />
              </label>
              <p id="user-password-help">รหัสผ่าน 6–128 ตัวอักษร</p>
              <label>
                เปิดใช้งาน
                <input
                  type="checkbox"
                  disabled={draft.id === currentUser.id}
                  checked={draft.active}
                  onChange={(e) =>
                    setDraft({ ...draft, active: e.target.checked })
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="button primary" disabled={busy}>
                <Save size={17} />
                {busy ? "กำลังบันทึก…" : "บันทึกผู้ใช้"}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
