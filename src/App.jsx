import { useState, useEffect } from "react";
import { Lock, Plus, Users, Paperclip } from "lucide-react";
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
        const boardId = ctx.board;

        // ── Install ──
        const installTracked = await t
          .get("board", "shared", "snInstallTracked")
          .catch(() => null);

        if (!installTracked) {
          // ✅ Set the flag FIRST before fetching — prevents race condition
          await t.set("board", "shared", "snInstallTracked", true);

          try {
            await fetch(`${ANALYTICS_API}/track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                externalAppId: POWER_UP_ID,
                boardId,
                event: "install",
              }),
            });
          } catch (e) {
            // If fetch fails, roll back the flag so it retries next time
            await t.set("board", "shared", "snInstallTracked", false);
            console.warn("⚠️ Install track failed", e);
          }
        }

        // ── Heartbeat ──
        const lastHeartbeat = await t
          .get("board", "shared", "snLastHeartbeat")
          .catch(() => null);

        if (
          !lastHeartbeat ||
          lastHeartbeat < Date.now() - 24 * 60 * 60 * 1000
        ) {
          // ✅ Set timestamp FIRST before fetching
          await t.set("board", "shared", "snLastHeartbeat", Date.now());

          try {
            await fetch(`${ANALYTICS_API}/track`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                externalAppId: POWER_UP_ID,
                boardId,
                event: "heartbeat",
              }),
            });
          } catch (e) {
            // Roll back so it retries tomorrow
            await t.set("board", "shared", "snLastHeartbeat", null);
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

    // board context IS available in popup iframe via t.getContext()
    try {
      const ctx = await t.getContext(); // ← await it
      await fetch(`${ANALYTICS_API}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalAppId: POWER_UP_ID,
          boardId: ctx.board,
          event: "uninstall",
        }),
      });
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

function generateNoteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function SecureNoteItem({ note, onSave }) {
  const [text, setText] = useState(note.text);
  const [isEditing, setIsEditing] = useState(!!note.isNew);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = window.TrelloPowerUp.iframe();

  const handleSave = async () => {
    await onSave(note.id, text);
    setSaved(true);
    setIsEditing(false);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleCopy = () => {
    if (!text || !text.trim()) return;
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "-1000px";
      textArea.style.left = "-1000px";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
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

  const handleShare = async () => {
    if (!text.trim()) return;
    const card = await t.card("id");
    const token = await t.loadSecret("trello_token");
    await fetch(
      `https://api.trello.com/1/cards/${card.id}/actions/comments?text=${encodeURIComponent(
        text,
      )}&key=${import.meta.env.VITE_TRELLO_API_KEY}&token=${token}`,
      { method: "POST" },
    );
  };

  return (
    <div className="card-notes__note">
      {!isEditing && (
        <>
          <div className="card-notes__display">
            <div className="card-notes__display-header">
              {/* TODO: wire up real file attachment support */}
              <button
                className="btn-attach"
                onClick={() => console.log("Attach - not implemented yet")}
              >
                <Paperclip size={14} /> Attach
              </button>
            </div>
            {text ? (
              <p className="note-text">{text}</p>
            ) : (
              <p className="note-placeholder">
                Click 'Edit' to add a private note...
              </p>
            )}
          </div>

          <div className="card-notes__footer">
            <button className="btn-save" onClick={() => setIsEditing(true)}>
              Edit Note
            </button>
            <div className="card-notes__share-info">
              <span className="hint">Only you can see this private note</span>
              <div className="avatar-group">
                <span className="avatar-dot" />
              </div>
              <a
                className="link-change"
                onClick={(e) => {
                  e.preventDefault();
                  console.log("Change access - not implemented yet");
                }}
              >
                Change
              </a>
            </div>
            {saved && <span className="saved">Saved!</span>}
          </div>
        </>
      )}

      {isEditing && (
        <>
          <textarea
            className="card-notes__textarea"
            placeholder="Write your private note here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
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

function CardNotesFrame() {
  const [notes, setNotes] = useState([]);
  const t = window.TrelloPowerUp.iframe();

  // Load notes, migrating the legacy single-note format if present
  useEffect(() => {
    async function loadNotes() {
      const existingNotes = await t
        .get("card", "private", "secureNotes")
        .catch(() => null);

      if (Array.isArray(existingNotes) && existingNotes.length > 0) {
        setNotes(existingNotes);
      } else {
        const legacyNote = await t
          .get("card", "private", "secureNote")
          .catch(() => null);

        if (legacyNote) {
          const migrated = [{ id: generateNoteId(), text: legacyNote }];
          setNotes(migrated);
          await t.set("card", "private", "secureNotes", migrated);
        }
      }
      t.sizeTo(document.body).catch(() => {});
    }
    loadNotes();
  }, []);

  useEffect(() => {
    t.sizeTo(document.body).catch(() => {});
  }, [notes]);

  const persistNotes = async (updatedNotes) => {
    setNotes(updatedNotes);
    await t.set("card", "private", "secureNotes", updatedNotes);
  };

  const handleSaveNote = async (id, text) => {
    const exists = notes.some((n) => n.id === id);
    const updated = exists
      ? notes.map((n) => (n.id === id ? { ...n, text, isNew: false } : n))
      : [...notes, { id, text, isNew: false }];
    await persistNotes(updated);
  };

  const handleAddNote = () => {
    setNotes((prev) => [
      ...prev,
      { id: generateNoteId(), text: "", isNew: true },
    ]);
    // Not persisted to storage until the user hits Save on it —
    // so an abandoned empty note doesn't clutter the stored list.
  };

  return (
    <div className="card-notes">
      <div className="card-notes__topbar">
        {/* <div className="card-notes__title-group">
          <Lock size={15} className="card-notes__lock" />
          <h3 className="card-notes__title">Secure Notes</h3>
          <span className="card-notes__badge">AES-256</span>
        </div> */}
        <div className="card-notes__header-actions">
          <button className="btn-add-note" onClick={handleAddNote}>
            <Plus size={14} /> Add Another Secure Note
          </button>
          <button
            className="btn-manage"
            onClick={() => console.log("Manage Access - not implemented yet")}
          >
            <Users size={14} /> Manage Access
          </button>
        </div>
      </div>

      <div className="card-notes__notes-list">
        {notes.length === 0 && (
          <div className="card-notes__note">
            <div className="card-notes__display">
              <p className="note-placeholder">
                Click 'Add Another Secure Note' to create your first private
                note...
              </p>
            </div>
          </div>
        )}

        {notes.map((note) => (
          <SecureNoteItem key={note.id} note={note} onSave={handleSaveNote} />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const view = getView();
  if (view === "popup") return <PopupFrame />;
  if (view === "card-notes") return <CardNotesFrame />;
  return <InitFrame />;
}
//test
