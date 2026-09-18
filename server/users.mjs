import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { roles } from "../shared/permissions.mjs";

export function createUserStore(path, bootstrapPassword) {
  path = resolve(path);
  function save(rows) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  }
  if (!existsSync(path)) {
    if (!bootstrapPassword || bootstrapPassword.length < 6)
      throw new Error(
        "Set CMMS_APP_PASSWORD (at least 6 characters) to bootstrap the administrator account.",
      );
    save([
      {
        id: randomBytes(12).toString("hex"),
        username: "admin",
        displayName: "Administrator",
        role: "ADMINISTRATOR",
        active: true,
        version: 1,
        passwordHash: hashPassword(bootstrapPassword),
      },
    ]);
  }
  const read = () => JSON.parse(readFileSync(path, "utf8"));
  const publicUser = ({ passwordHash, ...row }) => row;
  return {
    list: () => read().filter(u=>!u.deletedAt).map(publicUser),
    get: (id) => {
      const u = read().find((u) => u.id === id);
      return u ? publicUser(u) : null;
    },
    authenticate(username, password) {
      const u = read().find(
        (u) => u.username === String(username).trim().toLowerCase(),
      );
      if (!u || !u.active) {
        scryptSync(String(password), "unrecognized-user", 64);
        return null;
      }
      return verifyPassword(password, u.passwordHash) ? publicUser(u) : null;
    },
    deleteUser(id,actorId,version){const rows=read();const u=prepareUserDeletion(rows,id,actorId,version);save(rows.map(x=>x.id===id?u:x));return publicUser(u)},
    saveUser(id, body, actorId) {
      const rows = read();
      const u = prepareUser(rows, id, body, actorId);
      const old = rows.find(u => u.id === id);
      save(old ? rows.map((x) => (x.id === id ? u : x)) : [...rows, u]);
      return publicUser(u);
    },
  };
}

export function hashPassword(password) {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  }
export function verifyPassword(password, encoded) {
    const [salt, digest] = encoded.split(":");
    const actual = scryptSync(String(password), salt, 64);
    const expected = Buffer.from(digest, "hex");
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

export function publicUser({passwordHash,...row}) { return row; }
export function prepareUser(rows,id,body,actorId) {
      const old = id ? rows.find((u) => u.id === id) : null;
      if (id && (!old||old.deletedAt)) throw new Error("ไม่พบบัญชีผู้ใช้");
      if (
        Object.keys(body).some(
          (k) =>
            !["username", "displayName", "role", "active", "password", "department"].includes(
              k,
            ),
        )
      )
        throw new Error("ข้อมูลบัญชีไม่ถูกต้อง");
      const username = String(body.username ?? old?.username ?? "")
        .trim()
        .toLowerCase();
      const displayName = String(
        body.displayName ?? old?.displayName ?? "",
      ).trim();
      const role = body.role ?? old?.role;
      const department=body.department??old?.department??'';
      if(department&&!['Maintenance','Slurry','Coating','Warehouse','PD Office','QA/QC','SCM'].includes(department))throw Error('Department ไม่ถูกต้อง');
      const active = body.active ?? old?.active ?? true;
      if (!/^[a-z0-9._-]{3,50}$/.test(username))
        throw new Error(
          "ชื่อบัญชีต้องเป็น a-z, 0-9, จุด ขีด หรือขีดล่าง 3–50 ตัว",
        );
      if (
        !displayName ||
        displayName.length > 100 ||
        !roles.includes(role) ||
        typeof active !== "boolean"
      )
        throw new Error("ชื่อหรือสิทธิ์ผู้ใช้ไม่ถูกต้อง");
      if (rows.some((u) => u.id !== id && u.username === username))
        throw new Error("ชื่อบัญชีนี้ถูกใช้แล้ว");
      if (!old && !body.password) throw new Error("กรุณาตั้งรหัสผ่าน");
      if (
        body.password !== undefined &&
        (typeof body.password !== "string" ||
          body.password.length < 6 ||
          body.password.length > 128)
      )
        throw new Error("รหัสผ่านต้องมี 6–128 ตัวอักษร");
      if (old?.id === actorId && old.role === "ADMINISTRATOR" && (!active || role !== "ADMINISTRATOR"))
        throw new Error("ไม่สามารถปิดบัญชีหรือลดสิทธิ์ของตัวเอง");
      if (
        old?.active &&
        old.role === "ADMINISTRATOR" &&
        (!active || role !== "ADMINISTRATOR") &&
        !rows.some((u) => u.id !== id && u.active && u.role === "ADMINISTRATOR")
      )
        throw new Error("ต้องเหลือ Administrator อย่างน้อยหนึ่งบัญชี");
      const u = {
        id: old?.id || randomBytes(12).toString("hex"),
        username,
        displayName,
        department,
        role,
        active,
        version: (old?.version || 0) + 1,
        passwordHash: body.password ? hashPassword(body.password) : old.passwordHash,
      };

return u;
}

export function prepareUserDeletion(rows,id,actorId,version){const actor=rows.find(u=>u.id===actorId);if(!actor?.active||actor.deletedAt||actor.role!=='ADMINISTRATOR')throw Object.assign(Error('เฉพาะ Administrator เท่านั้น'),{status:403});if(id===actorId)throw Error('ไม่สามารถลบบัญชีตัวเอง');const u=rows.find(u=>u.id===id&&!u.deletedAt);if(!u)throw Object.assign(Error('ไม่พบผู้ใช้'),{status:404});if(!Number.isSafeInteger(version)||version!==u.version)throw Object.assign(Error('บัญชีถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่'),{status:409});if(u.active&&u.role==='ADMINISTRATOR'&&!rows.some(x=>x.id!==id&&x.active&&!x.deletedAt&&x.role==='ADMINISTRATOR'))throw Error('ต้องเหลือ Administrator อย่างน้อยหนึ่งบัญชี');return {...u,username:archivedUsername(u),active:false,deletedAt:new Date().toISOString(),version:u.version+1};}

export function archivedUsername(user){return user.username.slice(0,17)+'.deleted.'+user.id;}
