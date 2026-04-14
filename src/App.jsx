import { useState, useEffect } from "react";
import "./App.css";

const API_KEY = import.meta.env.VITE_TRELLO_API_KEY;
const APP_NAME = import.meta.env.VITE_POWER_UP_NAME ?? "Secure Notes";

function getView() {
  return new URLSearchParams(window.location.search).get("view") ?? "init";
}

// ===========================================================================
// VIEW: Init frame — registers Power-Up capabilities (invisible to user)
// ===========================================================================
function InitFrame() {
  useEffect(() => {
    window.TrelloPowerUp.initialize({
      "board-buttons": (t) => [
        {
          text: APP_NAME,
          callback: (t) =>
            t.popup({
              title: APP_NAME,
              url: "./index.html?view=popup",
              height: 220,
            }),
        },
      ],
    });
  }, []);

  return null;
}

// ===========================================================================
// VIEW: Board-button popup (?view=popup)
// ===========================================================================
function PopupFrame() {
  const [authState, setAuthState] = useState("idle"); // "idle"|"connecting"|"authenticated"|"error"

  const t = window.TrelloPowerUp.iframe();

  // Check for an existing stored token on mount
  useEffect(() => {
    t.loadSecret("trello_token")
      .then((token) => {
        if (token) setAuthState("authenticated");
      })
      .catch(() => {});
  }, []);

  // Open Trello OAuth popup; auth.html posts the token back via postMessage
  function handleConnect() {
    setAuthState("connecting");

    const authUrl =
      `https://trello.com/1/authorize?` +
      `expiration=never` +
      `&name=${encodeURIComponent(APP_NAME)}` +
      `&scope=read,write` +
      `&response_type=token` +
      `&key=${API_KEY}` +
      `&return_url=${encodeURIComponent(window.location.origin + "/auth.html")}`;

    window.open(authUrl, "trello-auth", "width=500,height=600");

    function handler(event) {
      if (event.data?.type !== "trello-token") return;
      window.removeEventListener("message", handler);

      const { token } = event.data;
      if (!token) {
        setAuthState("error");
        return;
      }

      t.storeSecret("trello_token", token)
        .then(() => setAuthState("authenticated"))
        .catch(() => setAuthState("error"));
    }

    window.addEventListener("message", handler);
  }

  async function handleDisconnect() {
    await t.storeSecret("trello_token", "").catch(() => {});
    setAuthState("idle");
  }

  return (
    <div className="popup">
      <div className="popup__header">
        <span className="popup__lock">🔒</span>
        <h2 className="popup__title">{APP_NAME}</h2>
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

// ===========================================================================
// Root router
// ===========================================================================
export default function App() {
  const view = getView();
  if (view === "popup") return <PopupFrame />;
  return <InitFrame />;
}
