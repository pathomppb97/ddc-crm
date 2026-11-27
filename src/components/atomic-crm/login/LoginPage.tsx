import { useEffect, useRef, useState } from "react";
import {
  Form,
  required,
  useLocaleState,
  useLogin,
  useNotify,
  useTranslate,
} from "ra-core";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import type { SubmitHandler, FieldValues } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { Notification } from "@/components/admin/notification";
import officialLogo from "@/assets/login/ddc-official-logo.png";
import "./login-page.css";
import { lanAccountsEnabled } from "@/ddc/providers/lanAuth";
import { SSOAuthButton } from "./SSOAuthButton";
import {
  disableEmailPasswordAuthentication,
  googleWorkplaceDomain,
} from "./authConfig";

/**
 * Login page displayed when authentication is enabled and the user is not authenticated.
 *
 * Automatically shown when an unauthenticated user tries to access a protected route.
 * Handles login via authProvider.login() and displays inline errors on failure.
 *
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/loginpage LoginPage documentation}
 * @see {@link https://marmelab.com/shadcn-admin-kit/docs/security Security documentation}
 */
export const LoginPage = (props: { redirectTo?: string }) => {
  const { redirectTo } = props;
  const [loading, setLoading] = useState(false);
  const submitPending = useRef(false);
  const [authError, setAuthError] = useState<string>();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [locale] = useLocaleState();
  const isThai = locale === "th";
  const passwordAction = passwordVisible
    ? isThai
      ? "ซ่อนรหัสผ่าน"
      : "Hide password"
    : isThai
      ? "แสดงรหัสผ่าน"
      : "Show password";
  const hasDisplayedRecoveryNotification = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const login = useLogin();
  const notify = useNotify();
  const translate = useTranslate();
  const signInLabel = translate("ra.auth.sign_in");

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const shouldNotify = searchParams.get("passwordRecoveryEmailSent") === "1";

    if (!shouldNotify || hasDisplayedRecoveryNotification.current) {
      return;
    }

    hasDisplayedRecoveryNotification.current = true;
    notify("crm.auth.recovery_email_sent", {
      type: "success",
      messageArgs: {
        _: "If you're a registered user, you should receive a password recovery email shortly.",
      },
    });

    searchParams.delete("passwordRecoveryEmailSent");
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, notify]);

  const handleSubmit: SubmitHandler<FieldValues> = async (values) => {
    if (submitPending.current) return;
    submitPending.current = true;
    setLoading(true);
    setAuthError(undefined);

    try {
      await login(values, redirectTo);
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : error &&
                typeof error === "object" &&
                "message" in error &&
                typeof error.message === "string"
              ? error.message
              : "";
      setAuthError(
        translate(message || "ra.auth.sign_in_error", {
          _: message || undefined,
        }),
      );
    } finally {
      submitPending.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <main className="ag-login" lang={locale}>
        <section className="ag-login__auth" aria-labelledby="crm-login-heading">
          <div className="ag-login__content">
            <header className="ag-login__intro">
              <div className="ag-login__brand">
                <img src={officialLogo} alt="DDC" />
                <p className="ag-login__system" lang="en">
                  AGRICULTURE CRM
                </p>
              </div>
              <h1 id="crm-login-heading">
                {isThai ? "ยินดีต้อนรับ" : "Welcome"}
              </h1>
            </header>

            {(lanAccountsEnabled || !disableEmailPasswordAuthentication) && (
              <>
                <Form
                  className="ag-login__form"
                  onSubmit={handleSubmit}
                  aria-busy={loading}
                >
                  <TextInput
                    label={
                      lanAccountsEnabled
                        ? isThai
                          ? "ชื่อผู้ใช้"
                          : "Username"
                        : "ra.auth.email"
                    }
                    source={lanAccountsEnabled ? "username" : "email"}
                    type={lanAccountsEnabled ? "text" : "email"}
                    placeholder={
                      lanAccountsEnabled
                        ? isThai
                          ? "รหัสพนักงาน"
                          : "Employee ID"
                        : "name@company.com"
                    }
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    validate={required()}
                  />
                  <div className="ag-login__password">
                    <TextInput
                      id="crm-login-password"
                      label="ra.auth.password"
                      source="password"
                      type={passwordVisible ? "text" : "password"}
                      placeholder={
                        isThai ? "กรอกรหัสผ่านของคุณ" : "Enter your password"
                      }
                      autoComplete="current-password"
                      autoCapitalize="none"
                      spellCheck={false}
                      validate={required()}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="ag-login__reveal"
                      aria-controls="crm-login-password"
                      aria-label={passwordAction}
                      onClick={() => setPasswordVisible((visible) => !visible)}
                    >
                      {passwordVisible ? (
                        <EyeOff aria-hidden="true" />
                      ) : (
                        <Eye aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  {lanAccountsEnabled ? (
                    <p className="text-sm text-[#96a69a]">
                      {isThai
                        ? "ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ"
                        : "Forgot your password? Contact your administrator."}
                    </p>
                  ) : (
                    <Link className="ag-login__recovery" to="/forgot-password">
                      {isThai
                        ? "ลืมรหัสผ่าน?"
                        : translate("ra-supabase.auth.forgot_password", {
                            _: "Forgot password?",
                          })}
                    </Link>
                  )}
                  <Button
                    type="submit"
                    className="ag-login__submit"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <LoaderCircle
                          className="ag-login__spinner"
                          aria-hidden="true"
                        />
                        {isThai ? "กำลังเข้าสู่ระบบ…" : "Signing in…"}
                      </>
                    ) : (
                      <>
                        {signInLabel}
                        <ArrowRight aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </Form>
                <div role="status" className="sr-only">
                  {loading
                    ? isThai
                      ? "กำลังเข้าสู่ระบบ…"
                      : "Signing in…"
                    : ""}
                </div>
                {authError && (
                  <p className="ag-login__error" role="alert">
                    {authError}
                  </p>
                )}
              </>
            )}

            {!lanAccountsEnabled && googleWorkplaceDomain && (
              <SSOAuthButton
                className="mt-4 min-h-11 w-full"
                domain={googleWorkplaceDomain}
              >
                {translate("crm.auth.sign_in_google_workspace", {
                  _: "Sign in with Google Workplace",
                })}
              </SSOAuthButton>
            )}

            <footer className="ag-login__footer" lang="en">
              © {new Date().getFullYear()} DDC Sprocket Co., Ltd.
            </footer>
          </div>
        </section>
      </main>
      <Notification />
    </>
  );
};
