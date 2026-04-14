import { useState, useEffect } from "react";
import "./App.css";

const TrelloPowerUp = window.TrelloPowerUp;

function getView() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") ?? "init";
}

function getAuthReturnUrl() {
  const url = new URL(window.location.href);
  url.search = "?view=auth";
  url.hash = "";
  return url.toString();
}

const TRELLO_APP_KEY =
  import.meta.env.VITE_TRELLO_API_KEY ?? "YOUR_TRELLO_APP_KEY";
const POWER_UP_NAME = import.meta.env.VITE_POWER_UP_NAME ?? "Secure Notes";

function buildTrelloAuthUrl() {
  const params = new URLSearchParams({
    expiration: "never",
    name: POWER_UP_NAME,
    scope: "read,write",
    response_type: "token",
    key: TRELLO_APP_KEY,
    return_url: getAuthReturnUrl(),
    callback_method: "fragment", // token delivered in URL hash
  });
  return `https://trello.com/1/authorize?${params.toString()}`;
}

function InitFrame() {
  useEffect(() => {
    if (!TrelloPowerUp) return;

    TrelloPowerUp.initialize({
      "board-buttons": (t) => [
        {
          icon: { dark: "/icon-dark.svg", light: "/icon-light.svg" },
          text: "Secure Notes",
          callback: (t) =>
            t.popup({
              title: "Secure Notes",
              url: "./index.html?view=popup",
              height: 220,
            }),
        },
      ],
    });
  }, []);

  return null; // invisible init frame
}

function AuthReturnFrame() {
  const [status, setStatus] = useState("processing"); // processing | ok | error

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("token");

    if (!token) {
      setStatus("error");
      return;
    }

    // If this tab was opened by the Power-Up popup it can reach back via opener
    if (window.opener && window.opener.onTrelloAuthComplete) {
      window.opener.onTrelloAuthComplete(token);
      window.close();
      return;
    }

    // Fallback: store directly if we have a Trello context
    if (TrelloPowerUp) {
      const t = TrelloPowerUp.iframe();
      t.set("member", "private", "token", token)
        .then(() => {
          setStatus("ok");
          window.close();
        })
        .catch(() => setStatus("error"));
    } else {
      // Outside Trello (e.g. dev preview) — just signal success
      setStatus("ok");
    }
  }, []);

  return (
    <div className="auth-return">
      {status === "processing" && (
        <p className="auth-msg">Completing sign-in…</p>
      )}
      {status === "ok" && (
        <p className="auth-msg auth-msg--ok">
          ✓ Authenticated! You may close this tab.
        </p>
      )}
      {status === "error" && (
        <p className="auth-msg auth-msg--err">
          ⚠ Could not retrieve token. Please try again.
        </p>
      )}
    </div>
  );
}

function PopupFrame() {
  // "idle" | "connecting" | "authenticated" | "error"
  const [authState, setAuthState] = useState("idle");

  // On mount, check whether we already have a stored token
  useEffect(() => {
    if (!TrelloPowerUp) return;
    const t = TrelloPowerUp.iframe();
    t.get("member", "private", "token")
      .then((token) => {
        if (token) setAuthState("authenticated");
      })
      .catch(() => {});
  }, []);

  function handleConnect() {
    setAuthState("connecting");

    const width = 600;
    const height = 680;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const authWindow = window.open(
      buildTrelloAuthUrl(),
      "trello-auth",
      `width=${width},height=${height},left=${left},top=${top},toolbar=0,menubar=0`,
    );

    // Callback invoked by the auth-return page (same origin)
    window.onTrelloAuthComplete = async (token) => {
      window.onTrelloAuthComplete = null;

      if (!token) {
        setAuthState("error");
        return;
      }

      if (TrelloPowerUp) {
        try {
          const t = TrelloPowerUp.iframe();
          await t.set("member", "private", "token", token);
        } catch {
          // non-fatal in dev; token already captured
        }
      }

      setAuthState("authenticated");
    };

    // Poll in case the popup closes without calling the callback
    const timer = setInterval(() => {
      if (authWindow?.closed) {
        clearInterval(timer);
        // If state is still "connecting" the user closed without authing
        setAuthState((prev) => (prev === "connecting" ? "idle" : prev));
      }
    }, 500);
  }

  async function handleDisconnect() {
    if (TrelloPowerUp) {
      const t = TrelloPowerUp.iframe();
      await t.remove("member", "private", "token").catch(() => {});
    }
    setAuthState("idle");
  }

  return (
    <div className="popup">
      <div className="popup__header">
        <span className="popup__lock">🔒</span>
        <h2 className="popup__title">Secure Notes</h2>
      </div>

      <div className="popup__body">
        {authState === "idle" && (
          <>
            <p className="popup__hint">
              Connect your Trello account to encrypt and manage secure notes on
              this board.
            </p>
            <button className="btn btn--primary" onClick={handleConnect}>
              Connect to Trello
            </button>
          </>
        )}

        {authState === "connecting" && (
          <div className="popup__connecting">
            <span className="spinner" />
            <p className="popup__hint">Waiting for Trello authorisation…</p>
          </div>
        )}

        {authState === "authenticated" && (
          <>
            <div className="pill pill--ok">
              <span>✓</span> Authenticated
            </div>
            <p className="popup__hint popup__hint--sm">
              Your Trello account is connected. Secure Notes is ready.
            </p>
            <button className="btn btn--ghost" onClick={handleDisconnect}>
              Disconnect
            </button>
          </>
        )}

        {authState === "error" && (
          <>
            <p className="popup__hint popup__hint--err">
              Something went wrong. Please try again.
            </p>
            <button className="btn btn--primary" onClick={handleConnect}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const view = getView();

  if (view === "auth") return <AuthReturnFrame />;
  if (view === "popup") return <PopupFrame />;
  return <InitFrame />;
}
