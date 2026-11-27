import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Authenticated } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_ROLE_KEYS } from "@/ddc/domain/defaultPermissions";
import { lanAccountRequest, type LanAccount } from "@/ddc/providers/lanAuth";

const roles = DEFAULT_ROLE_KEYS.filter((role) => role !== "super_admin");
const fieldClass = "grid gap-2 text-sm font-medium";
const selectClass = "min-h-9 rounded-md border bg-background px-2 text-sm";

function AccountSettings() {
  const session = useQuery({
    queryKey: ["lan-account-session"],
    queryFn: () => lanAccountRequest<LanAccount>("session"),
    staleTime: 0,
  });
  const isAdmin = session.data?.roleKey === "super_admin";
  const accounts = useQuery({
    queryKey: ["lan-accounts"],
    queryFn: () => lanAccountRequest<LanAccount[]>("users"),
    enabled: isAdmin,
  });
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string }>();

  async function mutate(action: string, data: object, message: string) {
    if (pending) return false;
    setPending(true);
    setResult(undefined);
    try {
      await lanAccountRequest(action, data);
      if (isAdmin && action !== "password") await accounts.refetch();
      setResult({ error: false, text: message });
      return true;
    } catch (error) {
      setResult({
        error: true,
        text: error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ",
      });
      return false;
    } finally {
      setPending(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const newPassword = values.get("newPassword");
    if (newPassword !== values.get("confirmation")) {
      setResult({ error: true, text: "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน" });
      return;
    }
    if (
      await mutate(
        "password",
        { currentPassword: values.get("currentPassword"), newPassword },
        "เปลี่ยนรหัสผ่านแล้ว",
      )
    ) {
      form.reset();
    }
  }

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (
      await mutate(
        "users",
        { username: values.get("username"), roleKey: values.get("roleKey") },
        "สร้างบัญชีแล้ว รหัสผ่านเริ่มต้นตรงกับชื่อผู้ใช้",
      )
    ) {
      form.reset();
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">บัญชี LAN Demo</h1>
      {session.data && <p>ชื่อผู้ใช้ {session.data.username}</p>}
      {session.isError && (
        <p role="alert">ไม่สามารถโหลดข้อมูลบัญชี กรุณาเข้าสู่ระบบใหม่</p>
      )}
      {result && (
        <p
          role={result.error ? "alert" : "status"}
          className={result.error ? "text-destructive" : "text-foreground"}
        >
          {result.text}
        </p>
      )}
      <form
        onSubmit={changePassword}
        className="max-w-sm space-y-4 rounded-xl border p-4"
      >
        <h2 className="font-semibold">เปลี่ยนรหัสผ่าน</h2>
        <label className={fieldClass}>
          รหัสผ่านปัจจุบัน
          <Input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label className={fieldClass}>
          รหัสผ่านใหม่
          <Input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            maxLength={128}
          />
        </label>
        <label className={fieldClass}>
          ยืนยันรหัสผ่านใหม่
          <Input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            maxLength={128}
          />
        </label>
        <Button disabled={pending} type="submit">
          บันทึกรหัสผ่าน
        </Button>
      </form>
      {isAdmin && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">จัดการผู้ใช้</h2>
          <form
            onSubmit={createAccount}
            className="flex flex-wrap items-end gap-3 rounded-xl border p-4"
          >
            <label className={fieldClass}>
              รหัสพนักงาน
              <Input
                name="username"
                autoComplete="off"
                minLength={3}
                maxLength={32}
                required
              />
            </label>
            <label className={fieldClass}>
              ระดับสิทธิ์
              <select
                className={selectClass}
                name="roleKey"
                defaultValue="read_only"
              >
                {roles.map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <Button disabled={pending} type="submit">
              สร้างบัญชี
            </Button>
          </form>
          {accounts.isError && <p role="alert">โหลดรายการผู้ใช้ไม่สำเร็จ</p>}
          <ul className="divide-y rounded-xl border">
            {accounts.data?.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center gap-3 p-3"
              >
                <span className="mr-auto font-medium">
                  {account.username}
                  {account.disabled ? " (ปิดใช้งาน)" : ""}
                </span>
                {account.roleKey === "super_admin" ? (
                  <span>Super Admin</span>
                ) : (
                  <>
                    <select
                      className={selectClass}
                      aria-label={`ระดับสิทธิ์ ${account.username}`}
                      disabled={pending}
                      value={account.roleKey}
                      onChange={(event) =>
                        void mutate(
                          "manage",
                          {
                            id: account.id,
                            operation: "role",
                            roleKey: event.target.value,
                          },
                          "เปลี่ยนสิทธิ์แล้ว",
                        )
                      }
                    >
                      {roles.map((role) => (
                        <option key={role}>{role}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `รีเซ็ตรหัสผ่านของ ${account.username} เป็นรหัสเริ่มต้น?`,
                          )
                        ) {
                          void mutate(
                            "manage",
                            { id: account.id, operation: "reset" },
                            "รีเซ็ตรหัสผ่านแล้ว",
                          );
                        }
                      }}
                    >
                      รีเซ็ตรหัสผ่าน
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void mutate(
                          "manage",
                          {
                            id: account.id,
                            operation: account.disabled ? "enable" : "disable",
                          },
                          "อัปเดตสถานะบัญชีแล้ว",
                        )
                      }
                    >
                      {account.disabled ? "เปิดบัญชี" : "ปิดบัญชี"}
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const LanAccountsPage = () => (
  <Authenticated>
    <AccountSettings />
  </Authenticated>
);
