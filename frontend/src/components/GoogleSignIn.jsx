import { useLanguage, useT } from '../i18n/Language.jsx';
import { useEffect, useRef, useState } from "react";
let library;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!library)
    library = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        library = null;
        script.remove();
        reject(
          new Error("Google is taking too long. Retry or use email/password."),
        );
      }, 15000);
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        library = null;
        script.remove();
        reject(
          new Error("Google could not load. Use email/password or try again."),
        );
      };
      document.head.append(script);
    });
  return library;
}
export default function GoogleSignIn({ api, onSignIn, disabled }) {
  const t = useT();
  const { language } = useLanguage();
  const box = useRef(null),
    callback = useRef(onSignIn),
    blocked = useRef(disabled),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  callback.current = onSignIn;
  blocked.current = disabled;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!api?.authConfig) return;
        const config = await api.authConfig();
        if (!config?.googleClientId) return;
        await loadGoogle();
        if (!live) return;
        const flow = await api.authAction("/google/start", {});
        if (!live) return;
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          nonce: flow.nonce,
          auto_select: false,
          use_fedcm_for_button: true,
          callback: async (response) => {
            if (!live || blocked.current) return;
            setError("");
            await callback.current(async () => {
              try {
                return await api.authAction("/google/complete", {
                  flowId: flow.flowId,
                  credential: response.credential,
                  operationId: crypto.randomUUID(),
                });
              } catch (e) {
                if (live) setRetry((n) => n + 1);
                throw e;
              }
            });
          },
        });
        window.google.accounts.id.renderButton(box.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 300,
          locale: language === "my" ? "my" : "en",
        });
      } catch (e) {
        if (live) setError(e.message);
      }
    })();
    return () => {
      live = false;
      window.google?.accounts?.id?.cancel();
    };
  }, [api, retry, language]);
  return (
    <div className="google-sign-in">
      <div
        ref={box}
        style={disabled ? { pointerEvents: "none", opacity: 0.5 } : undefined}
      />
      {error && (
        <p role="alert" className="inline-error">
          {t(error)}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setRetry((n) => n + 1);
            }}
          >{t("Retry Google")}</button>
        </p>
      )}
    </div>
  );
}
