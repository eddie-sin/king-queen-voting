import { useLanguage, useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog.jsx";
import { Crown } from "./Artwork.jsx";
import GoogleSignIn from "./GoogleSignIn.jsx";
import "./account-dialog.css";

// SVG Icon set
function MailIcon({ className = "auth-input-icon" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon({ className = "auth-input-icon" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function SparkleKeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      <path d="M5 3v4" />
      <path d="M3 5h4" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function CopyIcon({ copied }) {
  return copied ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// Cryptographically secure strong password generator
function generateStrongPassword() {
  const length = 16;
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // Exclude ambiguous I, O
  const lower = "abcdefghijkmnopqrstuvwxyz"; // Exclude ambiguous l
  const digits = "23456789"; // Exclude ambiguous 0, 1
  const symbols = "!@#$%&*?_-+=";
  const all = upper + lower + digits + symbols;

  const required = [];
  const getChars = (set, count) => {
    const vals = new Uint32Array(count);
    window.crypto.getRandomValues(vals);
    for (let i = 0; i < count; i++) {
      required.push(set[vals[i] % set.length]);
    }
  };

  getChars(upper, 3);
  getChars(lower, 3);
  getChars(digits, 3);
  getChars(symbols, 2);

  const remaining = length - required.length;
  const remVals = new Uint32Array(remaining);
  window.crypto.getRandomValues(remVals);
  for (let i = 0; i < remaining; i++) {
    required.push(all[remVals[i] % all.length]);
  }

  // Fisher-Yates cryptographically secure shuffle
  const shuffleVals = new Uint32Array(length);
  window.crypto.getRandomValues(shuffleVals);
  for (let i = length - 1; i > 0; i--) {
    const j = shuffleVals[i] % (i + 1);
    [required[i], required[j]] = [required[j], required[i]];
  }

  return required.join("");
}

// Password strength analysis
function checkPasswordStrength(pwd) {
  if (!pwd) {
    return {
      level: 0,
      label: "Too short",
      rules: { length: false, upperLower: false, number: false, symbol: false },
    };
  }
  const rules = {
    length: pwd.length >= 8,
    upperLower: /[a-z]/.test(pwd) && /[A-Z]/.test(pwd),
    number: /\d/.test(pwd),
    symbol: /[^A-Za-z0-9]/.test(pwd),
  };
  let score = 0;
  if (rules.length) score++;
  if (rules.upperLower) score++;
  if (rules.number) score++;
  if (rules.symbol) score++;

  let level = 0;
  let label = "Weak";
  if (pwd.length < 8) {
    level = 0;
    label = "Too short";
  } else if (score <= 1) {
    level = 0;
    label = "Weak";
  } else if (score === 2) {
    level = 1;
    label = "Fair";
  } else if (score === 3) {
    level = 2;
    label = "Good";
  } else {
    level = 3;
    label = "Strong";
  }

  return { level, label, rules };
}

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
  const t = useT();
  const { language } = useLanguage();
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
    [copied, setCopied] = useState(false),
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
        if (active && update?.flowId === flow.flowId) {
          setFlow((current) =>
            current?.flowId === update.flowId
              ? { ...current, ...update }
              : current,
          );
        }
      } catch {
        /* Keep usable through temporary interruption */
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

  // One-click strong password generator
  function handleGeneratePassword() {
    const generated = generateStrongPassword();
    setPassword(generated);
    setShow(true);
    op.current = null;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(generated)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2600);
        })
        .catch(() => {});
    }
  }

  // Copy current password to clipboard
  function handleCopyPassword() {
    if (!password || !navigator?.clipboard?.writeText) return;
    navigator.clipboard.writeText(password)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2600);
      })
      .catch(() => {});
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
        } else {
          await authenticated(data);
        }
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
        if (registrationStatus !== "open") {
          throw new Error("Registration is closed.");
        }
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
  const strength = checkPasswordStrength(password);

  const titleText = resetId
    ? "Choose a new password."
    : flow
      ? "Check your Gmail."
      : recovery
        ? "Recover your account."
        : register
          ? "Join the celebration."
          : "Welcome back.";

  const eyebrowText = resetId
    ? "NEW CREDENTIALS"
    : flow
      ? "SECURITY VERIFICATION"
      : recovery
        ? "PASSWORD RECOVERY"
        : register
          ? "STUDENT REGISTRATION"
          : "FESTIVAL ACCOUNT";

  const subtitleText = resetId
    ? "Set a secure password for future festival sign-ins."
    : flow
      ? "Enter the 6-digit verification code sent to your inbox."
      : recovery
        ? "We'll send a verification code to restore your account access."
        : register
          ? "One Gmail inbox. One festival account. Your votes stay with you."
          : "Sign in with your Gmail to cast your crown and share festival wishes.";

  return (
    <Dialog
      title={t(titleText)}
      onClose={onClose}
      locked={busy}
      className="account-dialog"
    >
      {/* Visual Header */}
      <div className="auth-header">
        <div className="auth-medallion-wrap">
          <div className="auth-medallion" aria-hidden="true">
            <Crown />
          </div>
        </div>
        <span className="auth-eyebrow">{t(eyebrowText)}</span>
        <h2 className="auth-visual-title">{t(titleText)}</h2>
        <p className="auth-subtitle">{t(subtitleText)}</p>
      </div>

      {/* Segmented Mode Switcher (Sign in / Register) */}
      {!flow && !resetId && !recovery && (
        <div className="auth-tabs">
          <button
            type="button"
            aria-pressed={mode === "login"}
            className={mode === "login" ? "is-active" : ""}
            disabled={busy}
            onClick={() => switchMode("login")}
          >{t("Sign in")}</button>
          <button
            type="button"
            aria-pressed={mode === "register"}
            className={mode === "register" ? "is-active" : ""}
            disabled={busy}
            onClick={() => switchMode("register")}
          >{t("Register")}</button>
        </div>
      )}

      {/* Registration Status Pill */}
      {register && !flow && (
        <div className={`auth-status-card ${registrationStatus === "open" ? "is-open" : "is-closed"}`}>
          <div className="auth-status-indicator">
            <span className="auth-status-dot" aria-hidden="true" />
            <span>
              {t(registrationStatus === "open"
                ? "Registration is open."
                : "Registration is closed or being checked.")}
            </span>
          </div>
          {registrationStatus === "unknown" && (
            <button
              type="button"
              className="btn-refresh"
              onClick={onRefreshControls}
            >{t("Refresh status")}</button>
          )}
        </div>
      )}

      {/* Google Sign-In */}
      {!flow && !resetId && !recovery && (
        <div className="auth-google-wrapper">
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
                } else {
                  await authenticated(data);
                }
              })
            }
          />
          <div className="auth-divider">
            <span>{t("Or continue with email")}</span>
          </div>
        </div>
      )}

      {/* Notifications */}
      {notice && (
        <div className="auth-notice-box" role="status">
          <span>{t(notice)}</span>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={submit}>
        {flow ? (
          /* OTP Verification Flow */
          <div className="auth-otp-card">
            <div className="auth-otp-icon-wrap">
              <MailIcon className="auth-otp-mail-icon" />
            </div>
            <p className="auth-otp-guide">
              {t(flow.purpose === "link"
                ? "Confirm this code to connect Google to your existing account."
                : "Enter the code sent for this request.")}{" "}
            </p>
            <div className="auth-otp-destination">{t("Destination: ")}<strong>{flow.email}</strong>
            </div>
            <p className="fine-print">{t("If eligible, an email will arrive shortly. Use the latest code. Check Spam too. An existing account should use sign-in or recovery.")}</p>
            {flow.delivery === "sent" && (
              <span className="auth-otp-delivery-pill" role="status">{t("Email sent. Check Gmail and Spam.")}</span>
            )}
            {flow.delivery === "failed" && (
              <div role="alert" className="auth-error-box">
                <AlertIcon />
                <span>{t(flow.deliveryMessage)}</span>
              </div>
            )}

            <div className="auth-code-wrapper">
              <label htmlFor="account-code">{t("6-digit email code")}</label>
              <div className="auth-code-input-wrap">
                <input
                  id="account-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="······"
                  required
                  disabled={busy}
                  autoFocus
                />
              </div>
              <div className="auth-expiry-pill">
                <ClockIcon />
                <span>{t("Expires ")}{new Date(flow.expiresAt).toLocaleTimeString(language === 'my' ? 'my-MM' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Yangon' })}.
                </span>
              </div>
              {expired && (
                <div role="alert" className="auth-error-box">
                  <AlertIcon />
                  <span>{t("This code has expired. Go back to sign in to start again.")}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Credentials Flow */
          <>
            {/* Email Field */}
            {!resetId && (
              <div className="auth-field-group">
                <div className="auth-label-row">
                  <label htmlFor="account-email">{t("Gmail address")}</label>
                  <span className="auth-field-badge">{t("Gmail")}</span>
                </div>
                <div className="auth-input-wrapper">
                  <MailIcon />
                  <input
                    id="account-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    placeholder={t("yourname@gmail.com")}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      op.current = null;
                    }}
                    required
                    disabled={busy}
                  />
                </div>
              </div>
            )}

            {/* Password Field */}
            {(!recovery || resetId) && (
              <div className="auth-field-group">
                <div className="auth-label-row">
                  <label htmlFor="account-password">
                    {t(register || resetId ? "Create password" : "Password")}
                  </label>
                  {!register && !resetId && mode === "login" && (
                    <button
                      type="button"
                      className="auth-forgot-link"
                      disabled={busy}
                      onClick={() => switchMode("recovery")}
                    >{t("Forgot password / add a password")}</button>
                  )}
                </div>

                <div className="auth-input-wrapper">
                  <LockIcon />
                  <input
                    id="account-password"
                    type={show ? "text" : "password"}
                    autoComplete={
                      register || resetId ? "new-password" : "current-password"
                    }
                    minLength={register || resetId ? 8 : undefined}
                    placeholder={
                      t(register || resetId
                        ? "Create a strong password (8+ chars)"
                        : "Enter your password")
                    }
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      op.current = null;
                    }}
                    required
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="auth-eye-toggle"
                    aria-label={t(show ? "Hide password" : "Show password")}
                    onClick={() => setShow((s) => !s)}
                    tabIndex={-1}
                  >
                    <EyeIcon visible={show} />
                  </button>
                </div>

                {/* Accessible checkbox fallback for automated tools */}
                <label className="show-password">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                  />{" "}{t("Show password")}</label>

                {/* Strong Password Generator & Strength Indicator */}
                {(register || resetId) && (
                  <div className="auth-password-tools">
                    <div className="auth-generator-row">
                      <button
                        type="button"
                        className="btn-strong-generator"
                        onClick={handleGeneratePassword}
                        title={t("Generate a cryptographically secure 16-character password")}
                      >
                        <SparkleKeyIcon />
                        <span>{t("Create strong password")}</span>
                      </button>

                      {password.length > 0 && (
                        <button
                          type="button"
                          className={`btn-copy-password ${copied ? "is-copied" : ""}`}
                          onClick={handleCopyPassword}
                        >
                          <CopyIcon copied={copied} />
                          <span>{t(copied ? "Copied!" : "Copy password")}</span>
                        </button>
                      )}
                    </div>

                    {/* Live Strength Meter */}
                    {password.length > 0 && (
                      <div className="auth-strength-meter">
                        <div className="auth-strength-header">
                          <span className="auth-strength-title">{t("Password strength:")}</span>
                          <span className={`auth-strength-label lvl-${strength.level}`}>
                            {t(strength.label)}
                          </span>
                        </div>
                        <div className="auth-strength-bars">
                          {[0, 1, 2, 3].map((idx) => (
                            <div
                              key={idx}
                              className={`auth-strength-bar ${
                                idx <= strength.level ? `is-active lvl-${strength.level}` : ""
                              }`}
                            />
                          ))}
                        </div>
                        <div className="auth-strength-rules">
                          <span className={`auth-rule-pill ${strength.rules.length ? "is-met" : ""}`}>
                            {t(strength.rules.length ? "✓" : "○")}{t(" 8+ chars")}</span>
                          <span className={`auth-rule-pill ${strength.rules.upperLower ? "is-met" : ""}`}>
                            {t(strength.rules.upperLower ? "✓" : "○")}{t(" Upper & lower")}</span>
                          <span className={`auth-rule-pill ${strength.rules.number ? "is-met" : ""}`}>
                            {t(strength.rules.number ? "✓" : "○")}{t(" Number")}</span>
                          <span className={`auth-rule-pill ${strength.rules.symbol ? "is-met" : ""}`}>
                            {t(strength.rules.symbol ? "✓" : "○")}{t(" Symbol")}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Inline Error Box */}
        {error && (
          <div className="auth-error-box" role="alert">
            <AlertIcon />
            <span>{t(error)}</span>
          </div>
        )}

        {/* Primary Submit Button */}
        <button
          className="btn primary full-width auth-submit-btn"
          disabled={
            busy ||
            expired ||
            (register && !flow && !resetId && registrationStatus !== "open")
          }
        >
          {t(busy
            ? "Please wait…"
            : resetId
              ? "Save password"
              : flow
                ? "Verify code"
                : recovery
                  ? "Send recovery code"
                  : register
                    ? "Send verification code"
                    : "Sign in")}
        </button>
      </form>

      {/* Secondary Actions */}
      <div className={`auth-secondary-actions ${flow ? "is-dual" : ""}`}>
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
            {t(wait ? `Resend in ${wait}s` : "Resend code")}
          </button>
        )}

        {(flow || resetId || recovery) && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => switchMode("login")}
          >{t("Back to sign in")}</button>
        )}
      </div>

      {/* Footer */}
      <div className="auth-footer">
        <span>{t("Email verification requires a valid Gmail account.")}{" "}
          <a href="#privacy" onClick={() => onClose()}>{t("Privacy Policy")}</a>
        </span>
      </div>
    </Dialog>
  );
}
