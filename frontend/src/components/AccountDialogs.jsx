import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog.jsx";
import { Crown } from "./Artwork.jsx";
import GoogleSignIn from "./GoogleSignIn.jsx";
export function AccountDialog({
  api,
  initialMode = "login",
  onClose,
  onLogin,
  onRegister,
  onAuthenticated,
  registrationStatus,
  onRefreshControls,
}) {
  const [mode, setMode] = useState(initialMode),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [flow, setFlow] = useState(null),
    [resetId, setResetId] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [now, setNow] = useState(Date.now());
  const locked = useRef(false),
    live = useRef(true),
    op = useRef(null);
  const register = mode === "register",
    recovery = mode === "recovery";
  useEffect(() => {
    live.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    api
      ?.pendingAuth?.()
      .then((data) => {
        if (live.current && data?.flowId) setFlow(data);
      })
      .catch(() => {});
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [api]);
  useEffect(() => {
    if (!flow?.flowId || !api?.pendingAuth) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const update = await api.pendingAuth();
        if (active && update?.flowId === flow.flowId)
          setFlow((current) =>
            current?.flowId === update.flowId
              ? { ...current, ...update }
              : current,
          );
      } catch {
        /* Keep the code usable through a temporary connection failure. */
      }
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [api, flow?.flowId]);
  function switchMode(next) {
    setMode(next);
    setFlow(null);
    setResetId(null);
    setPassword("");
    setCode("");
    setError("");
    op.current = null;
  }
  async function run(action) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (live.current) setError(e.message);
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function authenticated(data) {
    await onAuthenticated(data);
    onClose("authenticated");
  }
  async function submit(event) {
    event.preventDefault();
    await run(async () => {
      if (resetId) {
        await api.authAction("/password/recovery/complete", {
          resetId,
          password,
        });
        setNotice("Password saved. Sign in with your new password.");
        switchMode("login");
        return;
      }
      if (flow) {
        const path =
          flow.purpose === "register"
            ? "/register/verify"
            : flow.purpose === "link"
              ? "/google/link/verify"
              : "/password/recovery/verify";
        const data = await api.authAction(path, { flowId: flow.flowId, code });
        if (flow.purpose === "recovery") {
          setResetId(data.resetId);
          setFlow(null);
          setPassword("");
          setCode("");
        } else await authenticated(data);
        return;
      }
      if (recovery) {
        op.current ||= crypto.randomUUID();
        setFlow(
          await api.authAction("/password/recovery/start", {
            email,
            password: undefined,
            operationId: op.current,
          }),
        );
        op.current = null;
      } else if (register) {
        if (registrationStatus !== "open")
          throw new Error("Registration is closed.");
        op.current ||= crypto.randomUUID();
        const data = await onRegister(email, password, op.current);
        if (data?.flowId) {
          setFlow(data);
          setPassword("");
          op.current = null;
        } else {
          setNotice("Account created. Sign in below.");
          switchMode("login");
        }
      } else {
        await onLogin(email, password);
        onClose("authenticated");
      }
    });
  }
  const wait = flow
    ? Math.max(0, Math.ceil((new Date(flow.resendAt).getTime() - now) / 1000))
    : 0;
  const expired = flow && new Date(flow.expiresAt).getTime() <= now;
  return (
    <Dialog
      title={
        resetId
          ? "Choose a new password."
          : flow
            ? "Check your Gmail."
            : recovery
              ? "Recover your account."
              : register
                ? "Join the celebration."
                : "Welcome back."
      }
      onClose={onClose}
      locked={busy}
      className="account-dialog"
    >
      <div className="dialog-ornament">
        <Crown />
      </div>
      <p className="dialog-intro">
        One Gmail inbox. One account. Your votes stay with you.
      </p>
      {!flow && !resetId && !recovery && (
        <>
          <GoogleSignIn
            api={api}
            disabled={busy}
            onSignIn={(perform) =>
              run(async () => {
                const data = await perform();
                if (data.flowId) {
                  setFlow(data);
                  setPassword("");
                  op.current = null;
                } else await authenticated(data);
              })
            }
          />
          <p className="fine-print">
            Or use your Gmail address and website password.
          </p>
        </>
      )}
      {!flow && !resetId && (
        <div className="auth-tabs">
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode("register")}
          >
            Register
          </button>
        </div>
      )}
      {register && !flow && (
        <p className="schedule-note">
          {registrationStatus === "open"
            ? "Registration is open."
            : "Registration is closed or being checked."}
        </p>
      )}
      {registrationStatus === "unknown" && register && (
        <button type="button" onClick={onRefreshControls}>
          Refresh status
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={submit}>
        {flow ? (
          <>
            <p>
              {flow.purpose === "link"
                ? "Confirm this code to connect Google to your existing account."
                : "Enter the code sent for this request."}{" "}
              Destination: <strong>{flow.email}</strong>
            </p>
            <p className="fine-print">
              If eligible, an email will arrive shortly. Use the latest code.
              Check Spam too. An existing account should use sign-in or
              recovery.
            </p>
            {flow.delivery === "sent" && (
              <p role="status" className="fine-print">
                Email sent. Check Gmail and Spam.
              </p>
            )}
            {flow.delivery === "failed" && (
              <p role="alert" className="inline-error">
                {flow.deliveryMessage}
              </p>
            )}
            <label htmlFor="account-code">6-digit email code</label>
            <input
              id="account-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              disabled={busy}
            />
            {expired && <p role="alert" className="inline-error">This code has expired. Go back to sign in to start again.</p>}
            <p className="fine-print">
              Expires {new Date(flow.expiresAt).toLocaleTimeString()}.
            </p>
          </>
        ) : (
          <>
            {!resetId && (
              <>
                <label htmlFor="account-email">Gmail address</label>
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    op.current = null;
                  }}
                  required
                  disabled={busy}
                />
              </>
            )}
            {(!recovery || resetId) && (
              <>
                <label htmlFor="account-password">
                  {register || resetId ? "Create password" : "Password"}
                </label>
                <input
                  id="account-password"
                  type={show ? "text" : "password"}
                  autoComplete={
                    register || resetId ? "new-password" : "current-password"
                  }
                  minLength={register || resetId ? 8 : undefined}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); op.current = null; }}
                  required
                  disabled={busy}
                />
                <label className="show-password">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                  />{" "}
                  Show password
                </label>
                {(register || resetId) && (
                  <p className="fine-print">Use at least 8 characters.</p>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn primary full-width"
          disabled={
            busy || expired ||
            (register && !flow && !resetId && registrationStatus !== "open")
          }
        >
          {busy
            ? "Please wait…"
            : resetId
              ? "Save password"
              : flow
                ? "Verify code"
                : recovery
                  ? "Send recovery code"
                  : register
                    ? "Send verification code"
                    : "Sign in"}
        </button>
      </form>
      {flow && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy || expired || wait > 0}
          onClick={() =>
            run(async () => {
              op.current ||= crypto.randomUUID();
              const data = await api.authAction("/otp/resend", {
                flowId: flow.flowId,
                operationId: op.current,
              });
              setFlow(data);
              setCode("");
              op.current = null;
            })
          }
        >
          {wait ? `Resend in ${wait}s` : "Resend code"}
        </button>
      )}
      {!flow && !resetId && mode === "login" && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => switchMode("recovery")}
        >
          Forgot password / add a password
        </button>
      )}
      {(flow || resetId || recovery) && (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => switchMode("login")}
        >
          Back to sign in
        </button>
      )}
      <p className="fine-print">
        Email sends are limited. Google registration usually needs no email
        code.{" "}
        <a href="#privacy" onClick={() => onClose()}>
          Privacy
        </a>
      </p>
    </Dialog>
  );
}
