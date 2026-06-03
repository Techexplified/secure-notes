import { useState, useEffect } from "react";
import "./App.css";

const API_KEY = import.meta.env.VITE_TRELLO_API_KEY;
const APP_NAME = import.meta.env.VITE_POWER_UP_NAME ?? "Secure Notes";
const ANALYTICS_API = import.meta.env.VITE_ANALYTICS_API;
const POWER_UP_ID = import.meta.env.VITE_POWER_UP_ID;

function getView() {
  return new URLSearchParams(window.location.search).get("view") ?? "init";
}

function InitFrame() {
  useEffect(() => {
    if (!window.TrelloPowerUp) return;

    window.TrelloPowerUp.initialize({
      "board-buttons": async (t) => {
        const ctx = t.getContext();
        const boardId = ctx.board; // ← actual Trello board ID

        // ── Install (once per board) ──
        const installTracked = await t
          .get("board", "shared", "snInstallTracked")
          .catch(() => null);

        if (!installTracked) {
          try {
            await fetch(`${ANALYTICS_API}track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                externalAppId: POWER_UP_ID, // finds the app doc in DB
                boardId, //  identifies which board
                event: "install",
              }),
            });
            await t.set("board", "shared", "snInstallTracked", true);
          } catch (e) {
            console.warn("⚠️ Install track failed", e);
          }
        }

        // ── Heartbeat (once per day) ──
        const lastHeartbeat = await t
          .get("board", "shared", "snLastHeartbeat")
          .catch(() => null);

        if (
          !lastHeartbeat ||
          lastHeartbeat < Date.now() - 24 * 60 * 60 * 1000
        ) {
          try {
            await fetch(`${ANALYTICS_API}track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                externalAppId: POWER_UP_ID,
                boardId, // ✅ identifies which board
                event: "heartbeat",
              }),
            });
            await t.set("board", "shared", "snLastHeartbeat", Date.now());
          } catch (e) {
            console.warn("⚠️ Heartbeat failed", e);
          }
        }

        return [
          {
            icon: {
              dark: "https://secure-notes-flame.vercel.app/icon.svg",
              light: "https://secure-notes-flame.vercel.app/icon.svg",
            },
            text: APP_NAME,
            callback: (t) =>
              t.popup({
                title: APP_NAME,
                url: "./index.html?view=popup",
                height: 220,
              }),
          },
        ];
      },

      "card-back-section": async (t) => {
        const token = await t.loadSecret("trello_token").catch(() => null);

        if (!token) {
          return [];
        }

        return [
          {
            title: "Secure Notes",
            icon: "https://img.icons8.com/ios-filled/50/lock.png", // Optional icon
            content: {
              type: "iframe",
              url: t.signUrl("./index.html?view=card-notes"),
              height: 250,
            },
          },
        ];
      },
    });
  }, []);

  return null;
}

function PopupFrame() {
  const [authState, setAuthState] = useState("idle");

  const t = window.TrelloPowerUp.iframe();

  useEffect(() => {
    t.loadSecret("trello_token")
      .then((token) => {
        if (token) setAuthState("authenticated");
      })
      .catch(() => {});
  }, []);

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

    //Track uninstall
    try {
      const ctx = t.getContext();
      await fetch(`${ANALYTICS_API}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalAppId: POWER_UP_ID,
          boardId: ctx.board,
          event: "uninstall",
        }),
      });
      // Clear the install flag so if they reinstall it tracks again
      await t.set("board", "shared", "snInstallTracked", false);
    } catch (e) {
      console.warn("Uninstall track failed", e);
    }

    setAuthState("idle");
  }

  return (
    <div className="popup">
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

function CardNotesFrame() {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = window.TrelloPowerUp.iframe();

  // Load the existing private note
  useEffect(() => {
    async function loadNote() {
      const existingNote = await t.get("card", "private", "secureNote");
      if (existingNote) {
        setNote(existingNote);
      }
      t.sizeTo(document.body).catch(() => {});
    }
    loadNote();
  }, []);

  // Adjust iframe height when mode changes
  useEffect(() => {
    t.sizeTo(document.body).catch(() => {});
  }, [isEditing, note]);

  // Save the note
  const handleSave = async () => {
    await t.set("card", "private", "secureNote", note);
    setSaved(true);
    setIsEditing(false);
    setTimeout(() => setSaved(false), 2000);
  };

  // Copy note to clipboard
  const handleCopy = () => {
    if (!note || !note.trim()) return;

    try {
      // Create a temporary textarea element
      const textArea = document.createElement("textarea");
      textArea.value = note;

      // Prevent the textarea from affecting layout
      textArea.style.position = "fixed";
      textArea.style.top = "-1000px";
      textArea.style.left = "-1000px";
      textArea.style.opacity = "0";

      document.body.appendChild(textArea);

      // Select and copy the text
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");

      // Clean up
      document.body.removeChild(textArea);

      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        console.error("Copy command was unsuccessful.");
      }
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };
  // Share note to card comments
  const handleShare = async () => {
    if (!note.trim()) return;

    const card = await t.card("id");
    const token = await t.loadSecret("trello_token");

    await fetch(
      `https://api.trello.com/1/cards/${card.id}/actions/comments?text=${encodeURIComponent(
        note,
      )}&key=${import.meta.env.VITE_TRELLO_API_KEY}&token=${token}`,
      { method: "POST" },
    );
  };

  return (
    <div className="card-notes">
      {/* Header */}
      {/* <div className="card-notes__header">
        <h3>🔒 Secure Notes</h3>
      </div> */}

      {/* ----------- VIEW MODE ----------- */}
      {!isEditing && (
        <>
          <div className="card-notes__display">
            {note ? (
              <p className="note-text">{note}</p>
            ) : (
              <p className="note-placeholder">
                Click 'Edit' to add a private note...
              </p>
            )}
          </div>

          <div className="card-notes__footer">
            <button className="btn-save" onClick={() => setIsEditing(true)}>
              Edit
            </button>
            <span className="hint">Only you can see this private note</span>
            {saved && <span className="saved">Saved!</span>}
          </div>
        </>
      )}

      {/* ----------- EDIT MODE ----------- */}
      {isEditing && (
        <>
          <textarea
            className="card-notes__textarea"
            placeholder="Write your private note here..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="card-notes__actions">
            <button className="btn-save" onClick={handleSave}>
              Save
            </button>
            <button className="btn-secondary" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button className="btn-secondary" onClick={handleShare}>
              Share
            </button>
            <button className="btn-cancel" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>

          <div className="card-notes__footer">
            <span className="hint">Only you can see this private note</span>
            {saved && <span className="saved">Saved!</span>}
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const view = getView();
  if (view === "popup") return <PopupFrame />;
  if (view === "card-notes") return <CardNotesFrame />;
  return <InitFrame />;
}
