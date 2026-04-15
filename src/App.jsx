import { useState, useEffect } from "react";
import "./App.css";

const API_KEY = import.meta.env.VITE_TRELLO_API_KEY;
const APP_NAME = import.meta.env.VITE_POWER_UP_NAME ?? "Secure Notes";

function getView() {
  return new URLSearchParams(window.location.search).get("view") ?? "init";
}

function InitFrame() {
  useEffect(() => {
    if (!window.TrelloPowerUp) return;

    window.TrelloPowerUp.initialize({
      // Board button for authentication
      "board-buttons": () => [
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

      // ✅ Add Private Notes section to each card
      "card-back-section": async (t) => {
        const token = await t.loadSecret("trello_token").catch(() => null);

        // Only show the section if the user is authenticated
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
      {/* <div className="popup__header">
        <span className="popup__lock">🔒</span>
        <h2 className="popup__title">{APP_NAME}</h2>
      </div> */}

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
  const t = window.TrelloPowerUp.iframe();

  // Load the existing private note
  useEffect(() => {
    async function loadNote() {
      const existingNote = await t.get("card", "private", "secureNote");
      if (existingNote) setNote(existingNote);
      t.sizeTo(document.body); // Adjust iframe height
    }
    loadNote();
  }, []);

  // Save the note
  const handleSave = async () => {
    await t.set("card", "private", "secureNote", note);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Copy note to clipboard
  const handleCopy = async () => {
    await navigator.clipboard.writeText(note);
  };

  // Optional: Share note to card comments
  const handleShare = async () => {
    if (!note.trim()) return;
    await t.card("id").then(async (card) => {
      const token = await t.loadSecret("trello_token");
      await fetch(
        `https://api.trello.com/1/cards/${card.id}/actions/comments?text=${encodeURIComponent(
          note,
        )}&key=${import.meta.env.VITE_TRELLO_API_KEY}&token=${token}`,
        { method: "POST" },
      );
    });
  };

  return (
    <div className="card-notes">
      <div className="card-notes__header">
        <h3>Secure Notes</h3>
        <div className="actions">
          <button onClick={handleCopy} className="btn-save">
            Copy
          </button>
          <button onClick={handleShare} className="btn-save">
            Share
          </button>
        </div>
      </div>

      <textarea
        className="card-notes__textarea"
        placeholder="Write your private note here..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="card-notes__footer">
        <button className="btn-save" onClick={handleSave}>
          Save
        </button>
        <span className="hint">Only you can see this private note</span>
        {saved && <span className="saved">Saved!</span>}
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
