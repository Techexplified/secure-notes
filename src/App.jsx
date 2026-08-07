import { useState, useEffect } from "react";
import {
  Lock,
  Plus,
  Users,
  Paperclip,
  UserPlus,
  Globe,
  X,
  Search,
  Info,
  Check,
} from "lucide-react";
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

function getNoteAccess(note) {
  // Legacy / never-shared notes default to private, owner-only
  return note?.access || { scope: "private", ownerId: null, permissions: {} };
}

function getMemberPermission(note, memberId) {
  const access = getNoteAccess(note);
  if (access.ownerId === memberId) return "full";
  if (access.scope === "board") return "full";
  if (access.scope === "custom") return access.permissions?.[memberId] || null;
  return null; // private scope, not the owner → no access
}

// ── NEW ACCESS MANAGEMENT MODAL COMPONENT ──
function ManageAccessFrame() {
  const t = window.TrelloPowerUp.iframe();
  const [scope, setScope] = useState("private");
  const [members, setMembers] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [accessLevels, setAccessLevels] = useState({});
  const noteId = new URLSearchParams(window.location.search).get("noteId");
  const [currentMemberId, setCurrentMemberId] = useState(null);

  useEffect(() => {
    t.board("members")
      .then((boardData) => {
        if (boardData && boardData.members) {
          setMembers(boardData.members);
        }
      })
      .catch((err) => console.error("Failed to load members from Trello", err));
  }, [t]);

  useEffect(() => {
    async function loadExistingAccess() {
      const memberId = await t
        .member("id")
        .then((m) => m.id)
        .catch(() => null);
      setCurrentMemberId(memberId);

      const [privateNotes, sharedNotes] = await Promise.all([
        t.get("card", "private", "secureNotes").catch(() => []),
        t.get("card", "shared", "secureNotes").catch(() => []),
      ]);

      const existingNote =
        (sharedNotes || []).find((n) => n.id === noteId) ||
        (privateNotes || []).find((n) => n.id === noteId);

      const access = existingNote?.access;
      if (access) {
        setScope(access.scope || "private");
        setSelectedMembers(new Set(Object.keys(access.permissions || {})));
        setAccessLevels(access.permissions || {});
      }
    }
    if (noteId) loadExistingAccess();
  }, [t, noteId]);

  const filteredMembers = members.filter(
    (m) =>
      m.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleMember = (id) => {
    const newSet = new Set(selectedMembers);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedMembers(newSet);
  };

  const setAccess = (id, level) => {
    setAccessLevels((prev) => ({ ...prev, [id]: level }));
  };

  const handleApply = async () => {
    const permissions = {};
    selectedMembers.forEach((id) => {
      permissions[id] = accessLevels[id] || "full";
    });

    const access = {
      scope,
      ownerId: currentMemberId,
      permissions: scope === "custom" ? permissions : {},
    };

    const [privateNotes, sharedNotes] = await Promise.all([
      t.get("card", "private", "secureNotes").catch(() => []),
      t.get("card", "shared", "secureNotes").catch(() => []),
    ]);
    const privateList = Array.isArray(privateNotes) ? privateNotes : [];
    const sharedList = Array.isArray(sharedNotes) ? sharedNotes : [];

    const existingNote =
      sharedList.find((n) => n.id === noteId) ||
      privateList.find((n) => n.id === noteId);

    if (!existingNote) {
      t.closeModal();
      return;
    }

    const updatedNote = { ...existingNote, access };

    if (scope === "private") {
      // Pull the note back into owner-only storage
      await t.set("card", "private", "secureNotes", [
        ...privateList.filter((n) => n.id !== noteId),
        updatedNote,
      ]);
      await t.set(
        "card",
        "shared",
        "secureNotes",
        sharedList.filter((n) => n.id !== noteId),
      );
    } else {
      // "custom" or "board": must live in shared storage so granted
      // members' clients can actually fetch it
      await t.set("card", "shared", "secureNotes", [
        ...sharedList.filter((n) => n.id !== noteId),
        updatedNote,
      ]);
      await t.set(
        "card",
        "private",
        "secureNotes",
        privateList.filter((n) => n.id !== noteId),
      );
    }

    t.closeModal();
  };

  const handleClose = () => {
    t.closeModal();
  };

  return (
    <div className="manage-access-frame">
      <div className="modal-header">
        <div className="modal-header-left">
          <div className="modal-header-icon">
            <Users size={18} />
          </div>
          <div className="modal-title-group">
            <h2>Board Access Management</h2>
            <p>Control access rights for this encrypted note</p>
          </div>
        </div>
      </div>

      <div className="modal-body">
        <div className="section-title">ACCESS SCOPE POLICY</div>
        <div className="scope-grid">
          <div
            className={`scope-btn ${scope === "private" ? "active" : ""}`}
            onClick={() => setScope("private")}
          >
            <Lock size={20} />
            <span className="scope-title">Private</span>
            <span className="scope-subtitle">Note Owner Only</span>
          </div>
          <div
            className={`scope-btn ${scope === "custom" ? "active" : ""}`}
            onClick={() => setScope("custom")}
          >
            <UserPlus size={20} />
            <span className="scope-title">Custom List</span>
            <span className="scope-subtitle">Selected Members</span>
          </div>
          <div
            className={`scope-btn ${scope === "board" ? "active" : ""}`}
            onClick={() => setScope("board")}
          >
            <Globe size={20} />
            <span className="scope-title">Entire Board</span>
            <span className="scope-subtitle">All Board Members</span>
          </div>
        </div>

        {scope === "board" && (
          <div className="info-banner">
            <Info size={16} />
            <p>
              <strong>Board Policy:</strong> All members on this Trello board
              will be able to view this secure note once decrypted.
            </p>
          </div>
        )}

        {scope === "custom" && (
          <div className="custom-list-container">
            <div className="custom-list-header">
              <h3>Grant Member Access</h3>
              <span className="granted-badge">
                {selectedMembers.size} member
                {selectedMembers.size !== 1 ? "s" : ""} granted
              </span>
            </div>
            <div className="search-input-wrapper">
              <Search size={14} />
              <input
                type="text"
                className="search-input"
                placeholder="Search board members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="members-list">
              {filteredMembers.map((member) => (
                <div
                  key={member.id}
                  className={`member-item ${
                    selectedMembers.has(member.id) ? "selected" : ""
                  }`}
                >
                  <div
                    className={`checkbox ${
                      selectedMembers.has(member.id) ? "checked" : ""
                    }`}
                    onClick={() => toggleMember(member.id)}
                  >
                    {selectedMembers.has(member.id) && <Check size={10} />}
                  </div>
                  <div className="member-avatar">
                    {member.avatarUrl ? (
                      <img src={member.avatarUrl} alt={member.fullName} />
                    ) : (
                      member.fullName.charAt(0)
                    )}
                  </div>
                  <div className="member-info">
                    <div className="member-name-row">
                      <span className="member-name">{member.fullName}</span>
                      {member.memberType === "admin" && (
                        <span className="role-badge owner">ADMIN</span>
                      )}
                    </div>
                    <span className="member-handle">
                      @{member.username} •{" "}
                      {member.memberType === "admin" ? "Admin" : "Member"}
                    </span>
                  </div>
                  {selectedMembers.has(member.id) && (
                    <select
                      className="access-dropdown"
                      value={accessLevels[member.id] || "full"}
                      onChange={(e) => setAccess(member.id, e.target.value)}
                    >
                      <option value="full">Full Access (Edit)</option>
                      <option value="view">View Only</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button className="btn-modal-cancel" onClick={handleClose}>
          Cancel
        </button>
        <button className="btn-modal-apply" onClick={handleApply}>
          <Check size={14} /> Apply Access Rules
        </button>
      </div>
    </div>
  );
}

function SecureNoteItem({ note, onSave, onAdd, permission = "full" }) {
  const [text, setText] = useState(note.text);
  const [isEditing, setIsEditing] = useState(!!note.isNew);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = window.TrelloPowerUp.iframe();

  const handleSave = async () => {
    if (permission === "view") return; // safety net
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

  const handleOpenAccessModal = () => {
    t.modal({
      url: `./index.html?view=manage-access&noteId=${note.id}`,
      height: 520,
    });
  };

  const access = getNoteAccess(note);
  const memberCount = Object.keys(access.permissions || {}).length;
  const shareHint =
    access.scope === "board"
      ? "Shared with the entire board"
      : access.scope === "custom" && memberCount > 0
        ? `Shared with ${memberCount} member${memberCount !== 1 ? "s" : ""}`
        : "Only you can see this private note";

  return (
    <div className="card-notes__note-card">
      <div className="card-notes__topbar">
        <div className="card-notes__header-actions">
          <button className="btn-add-note" onClick={onAdd}>
            <Plus size={14} /> Add Another Secure Note
          </button>

          <button className="btn-manage" onClick={handleOpenAccessModal}>
            <Users size={14} /> Manage Access
          </button>

          {/* <button
            className="btn-attach"
            onClick={() => console.log("Attach - not implemented yet")}
          >
            <Paperclip size={14} /> Attach
          </button> */}
        </div>
      </div>

      {!isEditing && (
        <>
          <div className="card-notes__display">
            {text ? (
              <p className="note-text">{text}</p>
            ) : (
              <p className="note-placeholder">
                Click 'Edit' to add a private note...
              </p>
            )}
          </div>

          <div className="card-notes__footer">
            {permission !== "view" && (
              <button className="btn-save" onClick={() => setIsEditing(true)}>
                Edit Note
              </button>
            )}
            <div className="card-notes__share-info">
              <span className="hint">{shareHint}</span>
              <div className="avatar-group"></div>
              <a
                className="link-change"
                onClick={(e) => {
                  e.preventDefault();
                  handleOpenAccessModal();
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

          {/* Restored Action Buttons Here */}
          <div className="card-notes__actions">
            <button className="btn-save" onClick={handleSave}>
              Save Note
            </button>
            <button className="btn-secondary" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <button className="btn-secondary" onClick={handleShare}>
              Share as Comment
            </button>
            <button className="btn-cancel" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>

          <div className="card-notes__footer">
            <span className="hint">{shareHint}</span>
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
  const [currentMemberId, setCurrentMemberId] = useState(null);

  useEffect(() => {
    async function loadNotes() {
      const memberId = await t
        .member("id")
        .then((m) => m.id)
        .catch(() => null);
      setCurrentMemberId(memberId);

      const [privateNotes, sharedNotesRaw] = await Promise.all([
        t.get("card", "private", "secureNotes").catch(() => null),
        t.get("card", "shared", "secureNotes").catch(() => null),
      ]);

      // Private storage is per-member — anything returned here is already
      // guaranteed to belong to the current user
      const ownPrivateNotes = (
        Array.isArray(privateNotes) ? privateNotes : []
      ).map((n) => ({ ...n, _permission: "full" }));

      // Shared storage is board-wide — filter to what this member was granted
      const visibleSharedNotes = (
        Array.isArray(sharedNotesRaw) ? sharedNotesRaw : []
      )
        .map((n) => ({ ...n, _permission: getMemberPermission(n, memberId) }))
        .filter((n) => n._permission !== null);

      if (ownPrivateNotes.length > 0) {
        setNotes([...ownPrivateNotes, ...visibleSharedNotes]);
      } else {
        const legacyNote = await t
          .get("card", "private", "secureNote")
          .catch(() => null);

        if (legacyNote) {
          const migrated = [
            { id: generateNoteId(), text: legacyNote, _permission: "full" },
          ];
          setNotes([...migrated, ...visibleSharedNotes]);
          await t.set("card", "private", "secureNotes", migrated);
        } else if (visibleSharedNotes.length > 0) {
          setNotes(visibleSharedNotes);
        } else {
          setNotes([
            {
              id: generateNoteId(),
              text: "",
              isNew: false,
              _permission: "full",
            },
          ]);
        }
      }
    }
    loadNotes();
  }, []);

  // Resize on every notes change, after the DOM has actually painted
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      t.sizeTo(document.body).catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [notes]);

  const persistNote = async (noteId, updater) => {
    const localNote = notes.find((n) => n.id === noteId);
    const bucket =
      getNoteAccess(localNote).scope === "private" ? "private" : "shared";

    const currentList = await t
      .get("card", bucket, "secureNotes")
      .catch(() => []);
    const list = Array.isArray(currentList) ? currentList : [];
    const base = list.find((n) => n.id === noteId) || localNote;
    const updatedNote = updater(base);

    const exists = list.some((n) => n.id === noteId);
    const updatedList = exists
      ? list.map((n) => (n.id === noteId ? updatedNote : n))
      : [...list, updatedNote];

    await t.set("card", bucket, "secureNotes", updatedList);

    setNotes((prev) =>
      prev.some((n) => n.id === noteId)
        ? prev.map((n) =>
            n.id === noteId
              ? { ...updatedNote, _permission: n._permission }
              : n,
          )
        : [...prev, { ...updatedNote, _permission: "full" }],
    );
  };

  const handleSaveNote = async (id, text) => {
    await persistNote(id, (existing) => ({
      ...(existing || { id }),
      text,
      isNew: false,
    }));
  };

  const handleAddNote = () => {
    setNotes((prev) => [
      ...prev,
      { id: generateNoteId(), text: "", isNew: true },
    ]);
  };

  return (
    <div className="card-notes">
      {notes.map((note) => (
        <SecureNoteItem
          key={note.id}
          note={note}
          onSave={handleSaveNote}
          onAdd={handleAddNote}
          permission={note._permission || "full"}
        />
      ))}
    </div>
  );
}

export default function App() {
  const view = getView();

  useEffect(() => {
    if (view === "popup") {
      document.body.classList.add("is-popup");
    }
    // Added body class handler for our new modal view
    if (view === "manage-access") {
      document.body.classList.add("is-modal");
    }
  }, [view]);

  if (view === "popup") return <PopupFrame />;
  if (view === "card-notes") return <CardNotesFrame />;
  if (view === "manage-access") return <ManageAccessFrame />; // Added new route
  return <InitFrame />;
}
