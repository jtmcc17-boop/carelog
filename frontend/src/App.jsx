import { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";
import {
  Send,
  FileText,
  ClipboardList,
  BookHeart,
  Loader2,
  Sparkles,
  CalendarDays,
  Plus,
  X,
  Filter,
  Mic,
  Square,
  Stethoscope,
  ChevronDown,
  ChevronUp,
  Settings,
  LogOut,
  Trash2,
  UserPlus,
  Shield,
  User as UserIcon,
  Heart,
  Info,
  MessageSquare,
} from "lucide-react";
import "./App.css";

const API = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000/api`;

/** Prod DB sometimes still has "Margaret" for the demo patient; Railway may not run latest API migrations. */
const DEMO_BOOBOO_USERNAME = "demo_booboo";
const DEMO_PATIENT_UI_NAME = "Booboo";

function isDemoBoobooUser(u) {
  return u?.username === DEMO_BOOBOO_USERNAME;
}

/** Thread title: demo accounts in the legacy Margaret circle see Booboo. */
function uiPatientName(circle, user) {
  if (user?.username?.startsWith("demo_") && circle?.patient_name === "Margaret") {
    return DEMO_PATIENT_UI_NAME;
  }
  return circle?.patient_name || "your patient";
}

/** Badge / "new entry as" for demo patient only. */
function uiDisplayName(user) {
  if (isDemoBoobooUser(user)) return DEMO_PATIENT_UI_NAME;
  return user.display_name;
}

/** Journal + check-in rows may still be stored as reporter Margaret. */
function patientEntryReporterMatches(user, reporter) {
  if (!isDemoBoobooUser(user)) {
    return reporter.toLowerCase() === user.display_name.toLowerCase();
  }
  const r = reporter;
  const dn = (user.display_name || "").toLowerCase();
  return r === "Booboo" || r === "Margaret" || r.toLowerCase() === dn;
}

function entryShowsSelfReportBadge(entry, patientNameUi) {
  if (["Dad", "Patient"].includes(entry.reporter)) return true;
  if (entry.reporter === patientNameUi) return true;
  return patientNameUi === DEMO_PATIENT_UI_NAME && entry.reporter === "Margaret";
}

/* ── Auth Context ────────────────────────── */

const AuthContext = createContext(null);

function useAuth() {
  return useContext(AuthContext);
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/* ── Color System ────────────────────────── */

const REPORTER_PALETTE = [
  { hue: 207, accent: "#3182ce", rgb: "49,130,206" },
  { hue: 28,  accent: "#c05621", rgb: "192,86,33" },
  { hue: 330, accent: "#b83280", rgb: "184,50,128" },
  { hue: 270, accent: "#6b46c1", rgb: "107,70,193" },
  { hue: 0,   accent: "#c53030", rgb: "197,48,48" },
  { hue: 185, accent: "#0987a0", rgb: "9,135,160" },
  { hue: 45,  accent: "#b7791f", rgb: "183,121,31" },
  { hue: 290, accent: "#805ad5", rgb: "128,90,213" },
  { hue: 15,  accent: "#c05621", rgb: "192,86,33" },
  { hue: 340, accent: "#d53f8c", rgb: "213,63,140" },
];

function getReporterColor(name, reporters) {
  const idx = reporters.indexOf(name);
  return REPORTER_PALETTE[idx >= 0 ? idx % REPORTER_PALETTE.length : 5];
}

/* ── Shared Components ───────────────────── */

const CATEGORY_STYLES = {
  mood: "tag-mood", cognition: "tag-cognition", medication: "tag-medication",
  meals: "tag-meals", physical_activity: "tag-physical_activity", sleep: "tag-sleep",
  incidents: "tag-incidents", social: "tag-social", other: "tag-other",
};

function CategoryTag({ category, onClick, active }) {
  const cls = CATEGORY_STYLES[category] || CATEGORY_STYLES.other;
  return (
    <span className={`category-tag clickable ${cls} ${active ? "tag-active" : ""}`} onClick={onClick}>
      {category.replace("_", " ")}
    </span>
  );
}

/** Map AI section titles (e.g. **Conflicting mood reports**) to the same palette as Thread category tags. */
function agentLabelToTagClass(label) {
  const s = label.toLowerCase().replace(/\s+/g, " ");
  const tryRules = [
    { cls: "tag-mood", ok: /\bmood\b|emotional|affect|morale|anxiety|depress|spirit/.test(s) },
    { cls: "tag-cognition", ok: /\bcognition\b|memory|confus|disorient|forget|foggy|mental clarity|deliri/.test(s) },
    { cls: "tag-medication", ok: /\bmedication\b|\bmeds?\b|prescription|pill|dose|pharm|compliance/.test(s) },
    { cls: "tag-meals", ok: /\bmeal\b|food|eat|nutrition|appetite|diet|hydrat/.test(s) },
    { cls: "tag-physical_activity", ok: /\bphysical\b|mobility|walk|exercise|strength|stiff|ache\b|pain\b|weak/.test(s) },
    { cls: "tag-sleep", ok: /\bsleep\b|rest|insomnia|nap|tired|fatigue|drowsy/.test(s) },
    { cls: "tag-incidents", ok: /\bincident\b|fall|accident|injury|urgent|emergency|wander|safety|conflict|contradict|discrepan|\bdiffer\b|notable events?/.test(s) },
    { cls: "tag-social", ok: /\bsocial\b|visitor|isolat|lonely|\bfamily\b.*\breport|\bcaregiver|\baide\b|nurse|observed by/.test(s) },
  ];
  for (const { cls, ok } of tryRules) {
    if (ok) return cls;
  }
  if (/\boverview\b|snapshot|at a glance|highlights?\b/.test(s)) return "tag-medication";
  if (/\bpatient\b/.test(s) && /report|self|journal|check-?in/.test(s)) return "tag-mood";
  if (/\bcare\s?circle|team|staff|other reporters?/.test(s)) return "tag-social";
  return "tag-other";
}

function parseAgentBoldSegments(text) {
  const raw = text == null ? "" : String(text);
  if (!raw) return [];
  const parts = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) parts.push({ kind: "text", value: raw.slice(last, m.index) });
    parts.push({ kind: "tag", value: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push({ kind: "text", value: raw.slice(last) });
  return parts;
}

function AgentMessageBody({ text, className }) {
  const segments = useMemo(() => parseAgentBoldSegments(text), [text]);
  if (!segments.length) return <div className={className} />;

  return (
    <div className={`agent-message-body ${className || ""}`.trim()}>
      {segments.map((seg, i) =>
        seg.kind === "tag" ? (
          <span key={i} className={`category-tag agent-report-tag ${agentLabelToTagClass(seg.value)}`}>
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </div>
  );
}

function ReporterAvatar({ name, reporters }) {
  const pal = getReporterColor(name, reporters);
  const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  return (
    <div className="reporter-avatar" style={{ background: `rgba(${pal.rgb},0.15)`, color: pal.accent, borderColor: `rgba(${pal.rgb},0.25)` }}>
      {initials}
    </div>
  );
}

/* ── Speech Recognition Hook ─────────────── */

function useSpeechRecognition() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition is not supported in this browser. Try Chrome or Safari."); return; }
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t + " ";
        else interim = t;
      }
      setTranscript(finalTranscript + interim);
    };
    recognition.onerror = (event) => { if (event.error !== "no-speech") console.error("Speech recognition error:", event.error); };
    recognition.onend = () => { if (recognitionRef.current) try { recognitionRef.current.start(); } catch {} };
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    setSeconds(0);
    setTranscript("");
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
  }, []);

  const reset = useCallback(() => { stop(); setTranscript(""); setSeconds(0); }, [stop]);

  return { isRecording, transcript, seconds, start, stop, reset, setTranscript };
}

function formatTimer(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/* ── Login Page ──────────────────────────── */

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Login failed");
      }
      const data = await res.json();
      onLogin(data.token, data.user, data.circle);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="brand-title" style={{ textAlign: "center", marginBottom: 4 }}>
          <span className="brand-hey">I Said Hey!</span>
          <span className="brand-dots">...</span>
          <span className="brand-whats">What&rsquo;s Going On?</span>
        </h1>
        <p className="subtitle" style={{ textAlign: "center", marginBottom: 28 }}>
          Multi-perspective care tracking
        </p>
        <form onSubmit={handleSubmit}>
          <label className="form-label">Username</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          <label className="form-label" style={{ marginTop: 12 }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          {error && <p className="login-error">{error}</p>}
          <button className="btn-primary login-btn" type="submit" disabled={loading}>
            {loading ? <Loader2 size={14} className="spin" /> : null}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

/** Local calendar date YYYY-MM-DD */
function formatLocalYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Turn free text (e.g. "show me info for the last week") into { start, end } for Recap.
 * "Last week" and similar map to the last 7 days ending today (inclusive).
 */
function parseRecapDatePhrase(phrase) {
  const p = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (!p) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const addDays = (base, delta) => {
    const d = new Date(base);
    d.setDate(d.getDate() + delta);
    return d;
  };
  const rangeDays = (n) => {
    const end = new Date(today);
    const start = addDays(today, -(n - 1));
    return { start: formatLocalYMD(start), end: formatLocalYMD(end) };
  };

  if (/\btoday\b/.test(p)) {
    const d = formatLocalYMD(today);
    return { start: d, end: d };
  }
  if (/\byesterday\b/.test(p)) {
    const y = addDays(today, -1);
    const d = formatLocalYMD(y);
    return { start: d, end: d };
  }

  const numDays = p.match(/\b(?:last|past)\s+(\d+)\s+days?\b/);
  if (numDays) {
    let n = parseInt(numDays[1], 10);
    if (Number.isNaN(n) || n < 1) n = 1;
    if (n > 366) n = 366;
    return rangeDays(n);
  }

  if (
    /\b(?:last|past)\s+week\b/.test(p)
    || /\blast\s+7\s+days?\b/.test(p)
    || /\bpast\s+7\s+days?\b/.test(p)
    || /\bseven\s+days\b/.test(p)
  ) {
    return rangeDays(7);
  }

  if (/\b(?:last|past)\s+(?:two|2)\s+weeks?\b/.test(p) || /\blast\s+14\s+days?\b/.test(p) || /\bpast\s+14\s+days?\b/.test(p)) {
    return rangeDays(14);
  }

  if (/\b(?:last|past)\s+month\b/.test(p) || /\blast\s+30\s+days?\b/.test(p) || /\bpast\s+30\s+days?\b/.test(p)) {
    return rangeDays(30);
  }

  if (/\bthis\s+month\b/.test(p)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    start.setHours(12, 0, 0, 0);
    return { start: formatLocalYMD(start), end: formatLocalYMD(today) };
  }

  return null;
}

/* ── Main App ────────────────────────────── */

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("carelog-token"));
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("carelog-user")); } catch { return null; }
  });

  const [circle, setCircle] = useState(() => {
    try { return JSON.parse(localStorage.getItem("carelog-circle")); } catch { return null; }
  });

  const handleLogin = (newToken, newUser, newCircle) => {
    localStorage.setItem("carelog-token", newToken);
    localStorage.setItem("carelog-user", JSON.stringify(newUser));
    localStorage.setItem("carelog-circle", JSON.stringify(newCircle));
    setToken(newToken);
    setUser(newUser);
    setCircle(newCircle);
  };

  const handleLogout = useCallback(() => {
    localStorage.removeItem("carelog-token");
    localStorage.removeItem("carelog-user");
    localStorage.removeItem("carelog-circle");
    setToken(null);
    setUser(null);
    setCircle(null);
  }, []);

  /** Sync user + circle from server so localStorage (e.g. old patient_name / display_name) cannot go stale after DB migrations. */
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    fetch(`${API}/auth/me`, { headers: authHeaders(token) })
      .then((res) => {
        if (res.status === 401) {
          handleLogout();
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!data || cancelled) return;
        const { circle: nextCircle, ...rest } = data;
        const nextUser = {
          id: rest.id,
          username: rest.username,
          display_name: rest.display_name,
          role: rest.role,
          relationship: rest.relationship ?? "",
          circle_id: rest.circle_id,
          active: rest.active,
          journal_public: rest.journal_public !== false,
          created_at: rest.created_at ?? "",
        };
        setUser(nextUser);
        setCircle(nextCircle ?? null);
        localStorage.setItem("carelog-user", JSON.stringify(nextUser));
        localStorage.setItem("carelog-circle", JSON.stringify(nextCircle ?? null));
      })
      .catch((err) => {
        if (!cancelled) console.error(err);
      });
    return () => {
      cancelled = true;
    };
  }, [token, handleLogout]);

  const updateUser = useCallback((partial) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      localStorage.setItem("carelog-user", JSON.stringify(next));
      return next;
    });
  }, []);

  if (!token || !user) return <LoginPage onLogin={handleLogin} />;

  return (
    <AuthContext.Provider value={{ token, user, circle, logout: handleLogout, updateUser }}>
      <MainApp />
    </AuthContext.Provider>
  );
}

function MainApp() {
  const { token, user, circle, logout, updateUser } = useAuth();
  const isAdmin = user.role === "admin";
  const isPatient = user.role === "patient";
  const patientName = uiPatientName(circle, user);
  const displayNameUi = uiDisplayName(user);

  const [tab, setTab] = useState(() => (user.role === "patient" ? "journal" : "timeline"));
  const [entries, setEntries] = useState([]);
  /** Avoid flashing Daily Check-In before /entries returns (empty array looks like "not checked in"). */
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [allReporters, setAllReporters] = useState([]);
  const [rawText, setRawText] = useState("");
  const [journalText, setJournalText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryLength, setSummaryLength] = useState("long");
  const [last24hRecap, setLast24hRecap] = useState("");
  const [last24hRecapLoading, setLast24hRecapLoading] = useState(false);
  const last24hFetchRef = useRef(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [recapDatePhrase, setRecapDatePhrase] = useState("");
  const [recapDateFeedback, setRecapDateFeedback] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState(null);
  const [filterReporters, setFilterReporters] = useState([]);

  // Daily check-in state
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showQuickCheckIn, setShowQuickCheckIn] = useState(false);
  const [mentalRating, setMentalRating] = useState(null);
  const [mentalTags, setMentalTags] = useState([]);
  const [physicalRating, setPhysicalRating] = useState(null);
  const [physicalTags, setPhysicalTags] = useState([]);

  // Doctor visits state
  const [visits, setVisits] = useState([]);
  const [visitConversation, setVisitConversation] = useState([]);
  const [visitStep, setVisitStep] = useState("idle");
  const [visitLoading, setVisitLoading] = useState(false);
  const [visitReply, setVisitReply] = useState("");
  const [expandedVisit, setExpandedVisit] = useState(null);
  const [pendingVisitData, setPendingVisitData] = useState(null);

  // Admin state
  const [users, setUsers] = useState([]);
  const [changelog, setChangelog] = useState([]);
  const [settingsTab, setSettingsTab] = useState("users");
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "", role: "user", relationship: "" });
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ display_name: "", role: "", relationship: "", password: "", active: true });
  const [journalVisSaving, setJournalVisSaving] = useState(false);
  const [journalPrivacyInfoOpen, setJournalPrivacyInfoOpen] = useState(false);
  const journalPrivacyInfoRef = useRef(null);

  const speech = useSpeechRecognition();
  const hdrs = useMemo(() => authHeaders(token), [token]);

  const refreshLast24hRecap = useCallback(async () => {
    const id = ++last24hFetchRef.current;
    setLast24hRecapLoading(true);
    try {
      const res = await fetch(`${API}/summary`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ recap_mode: "last_24h" }),
      });
      const data = await res.json();
      if (id !== last24hFetchRef.current) return;
      setLast24hRecap(typeof data.summary === "string" ? data.summary : "No major updates");
    } catch (err) {
      console.error(err);
      if (id !== last24hFetchRef.current) return;
      setLast24hRecap("Could not load recap.");
    } finally {
      if (id === last24hFetchRef.current) setLast24hRecapLoading(false);
    }
  }, [hdrs]);

  useEffect(() => {
    if (tab !== "summary") return undefined;
    refreshLast24hRecap();
    return undefined;
  }, [tab, hdrs, refreshLast24hRecap]);

  useEffect(() => {
    let cancelled = false;
    setEntriesLoaded(false);
    fetch(`${API}/entries`, { headers: hdrs })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setEntriesLoaded(true);
      });
    fetch(`${API}/visits`, { headers: hdrs }).then((r) => (r.ok ? r.json() : [])).then(setVisits).catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [hdrs]);

  useEffect(() => {
    const names = [...new Set(entries.map((e) => e.reporter))];
    setAllReporters(names);
  }, [entries]);

  // Admin data loading
  useEffect(() => {
    if (isAdmin && tab === "settings") {
      fetch(`${API}/admin/users`, { headers: hdrs }).then((r) => r.ok ? r.json() : []).then(setUsers).catch(console.error);
      fetch(`${API}/admin/changelog`, { headers: hdrs }).then((r) => r.ok ? r.json() : []).then(setChangelog).catch(console.error);
    }
  }, [isAdmin, tab, hdrs]);

  useEffect(() => {
    if (!journalPrivacyInfoOpen) return;
    const close = (e) => {
      if (journalPrivacyInfoRef.current && !journalPrivacyInfoRef.current.contains(e.target)) {
        setJournalPrivacyInfoOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [journalPrivacyInfoOpen]);

  const activeColor = useMemo(
    () => getReporterColor(displayNameUi, allReporters),
    [displayNameUi, allReporters]
  );

  const accentStyle = useMemo(() => ({}), []);

  const journalIsPublic = user.journal_public !== false;

  const setJournalVisibility = async (nextPublic) => {
    setJournalVisSaving(true);
    try {
      const res = await fetch(`${API}/me/journal-visibility`, {
        method: "PATCH",
        headers: hdrs,
        body: JSON.stringify({ journal_public: nextPublic }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const d = err.detail;
        const msg = Array.isArray(d) ? d.map((x) => x.msg || x).join(" ") : (d || res.statusText);
        throw new Error(msg);
      }
      const u = await res.json();
      updateUser({ journal_public: u.journal_public });
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not update journal visibility.");
    }
    setJournalVisSaving(false);
  };

  // ── Entry Actions ──────────────────────────

  const submitEntry = async (text, { isJournal = false } = {}) => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/entries`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ raw_text: text, is_journal: isJournal }),
      });
      const newEntry = await res.json();
      setEntries((prev) => [newEntry, ...prev]);
      setRawText("");
      setJournalText("");
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const deleteEntry = async (entryId) => {
    if (!confirm("Delete this entry? It will appear in the changelog.")) return;
    try {
      await fetch(`${API}/entries/${entryId}`, { method: "DELETE", headers: hdrs });
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) { console.error(err); }
  };

  const handleTextareaKeyDown = (e, text, entryOpts) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEntry(text, entryOpts); }
  };

  const toggleTag = (list, setList, tag) => {
    setList(list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);
  };

  const submitCheckIn = async () => {
    const parts = [];
    if (mentalRating) {
      parts.push(`Mental: ${mentalRating}/7`);
      if (mentalTags.length) parts.push(`Feeling: ${mentalTags.join(", ")}`);
    }
    if (physicalRating) {
      parts.push(`Physical: ${physicalRating}/7`);
      if (physicalTags.length) parts.push(`Body: ${physicalTags.join(", ")}`);
    }
    if (journalText.trim()) parts.push(journalText.trim());
    if (!parts.length) return;
    await submitEntry(`Daily Check-In:\n${parts.join("\n")}`);
    setMentalRating(null);
    setMentalTags([]);
    setPhysicalRating(null);
    setPhysicalTags([]);
    setShowCheckIn(false);
  };

  const submitQuickCheckIn = async () => {
    const parts = [];
    if (mentalRating) {
      parts.push(`Mental: ${mentalRating}/7`);
      if (mentalTags.length) parts.push(`Feeling: ${mentalTags.join(", ")}`);
    }
    if (physicalRating) {
      parts.push(`Physical: ${physicalRating}/7`);
      if (physicalTags.length) parts.push(`Body: ${physicalTags.join(", ")}`);
    }
    if (journalText.trim()) parts.push(journalText.trim());
    if (!parts.length) return;
    await submitEntry(parts.join("\n"));
    setMentalRating(null);
    setMentalTags([]);
    setPhysicalRating(null);
    setPhysicalTags([]);
    setShowQuickCheckIn(false);
  };

  // ── AI Actions ────────────────────────────

  const askQuestion = async () => {
    if (!question.trim()) return;
    setLoading(true); setAnswer("");
    try {
      const res = await fetch(`${API}/ask`, { method: "POST", headers: hdrs, body: JSON.stringify({ question }) });
      const data = await res.json();
      setAnswer(data.answer);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const getSummary = async (dateOverride = null) => {
    const start = dateOverride?.start ?? startDate;
    const end = dateOverride?.end ?? endDate;
    setLoading(true); setSummary("");
    try {
      const res = await fetch(`${API}/summary`, { method: "POST", headers: hdrs, body: JSON.stringify({ start_date: start, end_date: end, length: summaryLength }) });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  /** Parse optional phrase, update date fields when matched, then generate summary (used by Enter + Generate). */
  const submitRecapWithPhrase = async () => {
    const t = recapDatePhrase.trim();
    let dateOverride = null;
    if (t) {
      const r = parseRecapDatePhrase(recapDatePhrase);
      if (r) {
        dateOverride = r;
        setStartDate(r.start);
        setEndDate(r.end);
        setRecapDateFeedback("");
      } else {
        setRecapDateFeedback("Could not match that range; using the full care log.");
      }
    } else {
      setRecapDateFeedback("");
    }
    await getSummary(dateOverride);
  };

  // ── Doctor Visit Functions ────────────────

  const processVisitTranscript = async (transcript, conversation = []) => {
    setVisitLoading(true);
    try {
      const res = await fetch(`${API}/visits/process`, { method: "POST", headers: hdrs, body: JSON.stringify({ transcript, conversation }) });
      const data = await res.json();
      if (data.status === "need_info") {
        setVisitConversation([...conversation, { role: "user", content: transcript }, { role: "assistant", content: JSON.stringify(data) }]);
        setPendingVisitData(data);
        setVisitStep("chat");
      } else if (data.status === "complete") {
        const saved = await fetch(`${API}/visits`, { method: "POST", headers: hdrs, body: JSON.stringify({ doctor_name: data.doctor_name, date: data.date, transcript: speech.transcript, key_takeaways: data.key_takeaways }) });
        const visit = await saved.json();
        setVisits((prev) => [visit, ...prev]);
        setPendingVisitData(data);
        setVisitStep("saved");
      }
    } catch (err) { console.error(err); }
    setVisitLoading(false);
  };

  const handleVisitReply = async () => {
    if (!visitReply.trim()) return;
    const newConv = [...visitConversation, { role: "user", content: visitReply }];
    setVisitReply("");
    await processVisitTranscript(visitReply, newConv);
  };

  const startNewVisit = () => { speech.reset(); setVisitConversation([]); setPendingVisitData(null); setVisitStep("idle"); setVisitReply(""); };

  // ── Admin Actions ─────────────────────────

  const createNewUser = async () => {
    if (!newUser.username || !newUser.password || !newUser.display_name) return;
    try {
      const res = await fetch(`${API}/admin/users`, { method: "POST", headers: hdrs, body: JSON.stringify(newUser) });
      if (!res.ok) { const d = await res.json(); alert(d.detail); return; }
      const created = await res.json();
      setUsers((prev) => [...prev, created]);
      setNewUser({ username: "", password: "", display_name: "", role: "user", relationship: "" });
      setShowNewUser(false);
    } catch (err) { console.error(err); }
  };

  const startEditUser = (u) => {
    setEditingUser(u.id);
    setEditForm({ display_name: u.display_name, role: u.role, relationship: u.relationship || "", password: "", active: u.active });
  };

  const saveEditUser = async () => {
    if (!editingUser) return;
    const payload = {};
    if (editForm.display_name) payload.display_name = editForm.display_name;
    if (editForm.role) payload.role = editForm.role;
    payload.relationship = editForm.relationship;
    payload.active = editForm.active;
    if (editForm.password) payload.password = editForm.password;
    try {
      const res = await fetch(`${API}/admin/users/${editingUser}`, { method: "PATCH", headers: hdrs, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); alert(d.detail); return; }
      const updated = await res.json();
      setUsers((prev) => prev.map((x) => x.id === updated.id ? updated : x));
      setEditingUser(null);
    } catch (err) { console.error(err); }
  };

  const migrateJsonData = async () => {
    if (!confirm("Import entries from care_entries.json and doctor_visits.json into the database?")) return;
    try {
      const res = await fetch(`${API}/admin/migrate-json`, { method: "POST", headers: hdrs });
      const data = await res.json();
      alert(`Imported ${data.entries} entries and ${data.visits} visits.`);
      fetch(`${API}/entries`, { headers: hdrs }).then((r) => r.json()).then(setEntries);
      fetch(`${API}/visits`, { headers: hdrs }).then((r) => r.json()).then(setVisits);
    } catch (err) { console.error(err); }
  };

  // ── Computed Data ─────────────────────────

  const filteredEntries = entries.filter((e) => {
    if (e.is_journal) return false;
    if (filterReporters.length > 0 && !filterReporters.includes(e.reporter)) return false;
    if (filterCategory && !(e.categories && filterCategory in e.categories)) return false;
    return true;
  });

  const groupedEntries = filteredEntries
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .reduce((groups, entry) => {
      const date = entry.timestamp.slice(0, 10);
      if (!groups[date]) groups[date] = [];
      groups[date].push(entry);
      return groups;
    }, {});

  const filterCount = filterCategory
    ? entries.filter((e) => !e.is_journal && e.categories && filterCategory in e.categories).length
    : 0;

  const patientEntries = entries
    .filter((e) => patientEntryReporterMatches(user, e.reporter) && isPatient)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const now = new Date();
  const checkinCutoff = new Date(now);
  checkinCutoff.setHours(6, 0, 0, 0);
  if (now < checkinCutoff) checkinCutoff.setDate(checkinCutoff.getDate() - 1);
  const todayStr = checkinCutoff.toISOString().slice(0, 10);
  const todayCheckedIn = entries.some(
    (e) =>
      e.timestamp >= todayStr &&
      patientEntryReporterMatches(user, e.reporter) &&
      e.raw_text.startsWith("Daily Check-In:")
  );

  const renderJournalPrivacyCluster = () => (
    <div className="journal-privacy-cluster">
      <div className="journal-privacy-toggle-stack">
        <button
          type="button"
          className={`journal-privacy-toggle ${journalIsPublic ? "is-public" : "is-private"}`}
          onClick={() => setJournalVisibility(!journalIsPublic)}
          disabled={journalVisSaving}
          aria-pressed={journalIsPublic}
          aria-label={journalIsPublic ? "Journal shared with family, click to make private" : "Private journal, click to share with family"}
          title={journalIsPublic ? "Shared with family" : "Private"}
        >
          <span className="journal-privacy-toggle-track" aria-hidden>
            <span className="journal-privacy-toggle-thumb" />
          </span>
        </button>
        <span className={`journal-privacy-toggle-caption ${journalIsPublic ? "is-public" : "is-private"}`}>
          {journalIsPublic ? "Public" : "Private"}
        </span>
      </div>
      {journalVisSaving && <Loader2 size={16} className="spin journal-privacy-saving-icon" aria-hidden />}
      <div ref={journalPrivacyInfoRef} className={`journal-privacy-info-wrap ${journalPrivacyInfoOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="btn-icon journal-privacy-info-btn"
          aria-label="About journal sharing"
          aria-expanded={journalPrivacyInfoOpen}
          aria-controls="journal-privacy-tip"
          onClick={() => setJournalPrivacyInfoOpen((o) => !o)}
        >
          <Info size={17} strokeWidth={2.25} />
        </button>
        <div id="journal-privacy-tip" className="journal-privacy-tooltip" role="tooltip">
          <strong>Shared:</strong> family can read your journal in Recap and Ask Questions (not on Thread).
          <strong> Private:</strong> only you can see them.
        </div>
      </div>
    </div>
  );

  const tabs = isPatient
    ? [
        { id: "journal", label: "My Journal", icon: <BookHeart size={18} strokeWidth={2.25} /> },
        { id: "summary", label: "Recap", icon: <FileText size={18} strokeWidth={2.25} /> },
        { id: "ask", label: "Ask Questions", icon: <Sparkles size={18} strokeWidth={2.25} /> },
        { id: "visits", label: "Doctor Visits", icon: <Stethoscope size={18} strokeWidth={2.25} /> },
        { id: "timeline", label: "Thread", icon: <ClipboardList size={18} strokeWidth={2.25} /> },
      ]
    : [
        { id: "timeline", label: "Thread", icon: <ClipboardList size={18} strokeWidth={2.25} /> },
        { id: "summary", label: "Recap", icon: <FileText size={18} strokeWidth={2.25} /> },
        { id: "ask", label: "Ask Questions", icon: <Sparkles size={18} strokeWidth={2.25} /> },
        { id: "visits", label: "Doctor Visits", icon: <Stethoscope size={18} strokeWidth={2.25} /> },
      ];

  const ROLE_ICON = { admin: <Shield size={13} />, user: <UserIcon size={13} />, patient: <Heart size={13} /> };

  return (
    <div className="app" style={accentStyle}>
      <header className="header">
        <div className="header-left">
          <div>
            <h1 className="brand-title" onClick={() => setTab("timeline")} style={{ cursor: "pointer" }}>
              <span className="brand-hey">I Said Hey!</span>
              <span className="brand-dots">...</span>
              <span className="brand-whats">What&rsquo;s Going On?</span>
            </h1>
            <p className="subtitle">{patientName}&rsquo;s Care Thread</p>
          </div>
        </div>
        <div className="header-right">
          <span className="user-badge">
            {ROLE_ICON[user.role]}
            {displayNameUi}
          </span>
          {isAdmin && (
            <button className="btn-icon" onClick={() => setTab("settings")} title="Settings">
              <Settings size={16} />
            </button>
          )}
          <button className="btn-icon btn-icon-logout" onClick={logout} title="Sign out"><LogOut size={16} /></button>
        </div>
      </header>

      <main className="content">
        {isPatient && !todayCheckedIn && showCheckIn && (
          <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowCheckIn(false); }}>
            <div className="modal-content">
              <div className="checkin-card">
                <div className="checkin-section">
                  <h3 className="checkin-question">How are you feeling <em>mentally</em> today?</h3>
                  <div className="rating-row">
                    {[1,2,3,4,5,6,7].map((n) => (
                      <button key={n} type="button" className={`rating-btn ${mentalRating === n ? "active" : ""}`} onClick={() => setMentalRating(n)}>{n}</button>
                    ))}
                  </div>
                  <div className="rating-labels"><span>Not great</span><span>Great</span></div>
                  <div className="checkin-tags">
                    {["Happy","Normal","Calm","Confused","Foggy","Anxious","Sad","Irritable","Forgetful","Restless","Hopeful","Overwhelmed"].map((t) => (
                      <button key={t} type="button" className={`checkin-tag ${mentalTags.includes(t) ? "active" : ""}`} onClick={() => toggleTag(mentalTags, setMentalTags, t)}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="checkin-divider" />
                <div className="checkin-section">
                  <h3 className="checkin-question">How are you feeling <em>physically</em> today?</h3>
                  <div className="rating-row">
                    {[1,2,3,4,5,6,7].map((n) => (
                      <button key={n} type="button" className={`rating-btn ${physicalRating === n ? "active" : ""}`} onClick={() => setPhysicalRating(n)}>{n}</button>
                    ))}
                  </div>
                  <div className="rating-labels"><span>Not great</span><span>Great</span></div>
                  <div className="checkin-tags">
                    {["Normal","Strong","Weak","Achy","Stiff","Tired","Energetic","Dizzy","Nauseous","Shaky","Well-Rested","Sore"].map((t) => (
                      <button key={t} type="button" className={`checkin-tag ${physicalTags.includes(t) ? "active" : ""}`} onClick={() => toggleTag(physicalTags, setPhysicalTags, t)}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="checkin-divider" />
                <div className="checkin-section">
                  <h3 className="checkin-question">Anything else on your mind?</h3>
                  <textarea placeholder="Write whatever you'd like..." value={journalText} onChange={(e) => setJournalText(e.target.value)} rows={4} />
                </div>
                <div className="checkin-actions">
                  <button type="button" className="chip" onClick={() => setShowCheckIn(false)}>Cancel</button>
                  <button type="button" className="btn-primary btn-checkin-save" onClick={submitCheckIn} disabled={loading || (!mentalRating && !physicalRating && !journalText.trim())}>
                    {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                    Save Check-In
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="app-top-shell">
          <nav className="tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`tab ${tab === t.id ? "active" : ""}`}
                onClick={() => {
                  if (t.id === "summary" && tab === "summary") {
                    refreshLast24hRecap();
                    return;
                  }
                  setTab(t.id);
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          {tab === "timeline" && (
            <div className="entry-section">
              <p className="entry-as-label">New entry as <strong className="entry-as-name">{displayNameUi}</strong></p>
              <textarea
                placeholder="Describe what happened in plain language... (Enter to save, Shift+Enter for new line)"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => handleTextareaKeyDown(e, rawText)}
                rows={3}
              />
              <div className="entry-bottom-row">
                <div className="reporter-filter-bar">
                  {allReporters.map((name) => {
                    const pal = getReporterColor(name, allReporters);
                    const isActive = filterReporters.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        className={`reporter-filter-chip ${isActive ? "active" : ""}`}
                        onClick={() => setFilterReporters(isActive ? filterReporters.filter((r) => r !== name) : [...filterReporters, name])}
                        style={isActive ? { background: `rgba(${pal.rgb},0.15)`, color: pal.accent, borderColor: `rgba(${pal.rgb},0.3)` } : undefined}
                      >
                        {name}
                        {isActive && <X size={11} />}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="btn-primary" onClick={() => submitEntry(rawText)} disabled={loading}>
                  {loading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  Save entry
                </button>
              </div>
              <div className="entry-count">
                {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
                {filterCategory && <> in <CategoryTag category={filterCategory} onClick={() => setFilterCategory(null)} active /></>}
              </div>
            </div>
          )}
        </div>

        {/* ── Notes / Timeline ──────────────── */}
        {tab === "timeline" && (
          <div className="timeline">
              {Object.keys(groupedEntries).length === 0 && !filterCategory && (
                <div className="empty-state">
                  <CalendarDays size={48} className="empty-state-icon" />
                  <p>No entries yet. Add your first observation above.</p>
                </div>
              )}
              {Object.keys(groupedEntries).length === 0 && filterCategory && (
                <div className="empty-state">
                  <Filter size={48} className="empty-state-icon" />
                  <p>No entries match this filter.</p>
                </div>
              )}
              {Object.entries(groupedEntries).map(([date, dayEntries]) => (
                <div key={date}>
                  <p className="date-label">{formatDate(date)}</p>
                  {dayEntries.map((entry, i) => (
                    <div className="timeline-entry" key={entry.id || i}>
                      <div className="timeline-left">
                        <ReporterAvatar name={entry.reporter} reporters={allReporters} />
                        {i < dayEntries.length - 1 && <div className="timeline-line" />}
                      </div>
                      <div className="card timeline-card">
                        <div className="timeline-header">
                          <div className="reporter-name">
                            {entry.reporter}
                            {entryShowsSelfReportBadge(entry, patientName) && (
                              <span className="self-report-badge">self-report</span>
                            )}
                          </div>
                          <div className="timeline-header-right">
                            <span className="entry-time">{entry.timestamp}</span>
                            {isAdmin && (
                              <button className="btn-icon-sm" onClick={() => deleteEntry(entry.id)} title="Delete entry">
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="entry-text">{entry.raw_text}</p>
                        <div className="tags">
                          {Object.keys(entry.categories || {}).map((cat) => (
                            <CategoryTag key={cat} category={cat} active={filterCategory === cat} onClick={() => setFilterCategory(filterCategory === cat ? null : cat)} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}

        {/* ── Journal (patient) ────────────── */}
        {tab === "journal" && isPatient && (
          <div>
            {!entriesLoaded && (
              <div className="my-journal-toolbar my-journal-toolbar--loading" aria-busy="true" aria-live="polite">
                <Loader2 size={20} className="spin" aria-hidden />
                <span className="hint">Loading journal…</span>
              </div>
            )}
            {entriesLoaded && !todayCheckedIn && (
              <div className="my-journal-toolbar">
                <div className="my-journal-toolbar-left">
                  <button type="button" className="btn-daily-checkin-cta btn-daily-checkin-cta--toolbar" onClick={() => setShowCheckIn(true)}>
                    <BookHeart size={22} strokeWidth={2.25} className="btn-daily-checkin-cta-icon" />
                    <span className="toolbar-cta-text">
                      <span className="btn-daily-checkin-cta-label">Daily Check-In</span>
                      <span className="btn-daily-checkin-cta-hint">Tap to record how you&rsquo;re feeling today</span>
                    </span>
                  </button>
                </div>
                <div className="my-journal-toolbar-right">
                  {renderJournalPrivacyCluster()}
                </div>
              </div>
            )}

            {entriesLoaded && todayCheckedIn && !showQuickCheckIn && (
              <div className="card journal-add-note-card">
                <div className="journal-add-note-header">
                  <div className="journal-add-note-header-text">
                    <h3>Add a note</h3>
                    <p className="hint">Write anything on your mind — it&rsquo;ll be added to your journal.</p>
                  </div>
                  <div className="journal-add-note-header-privacy">
                    {renderJournalPrivacyCluster()}
                  </div>
                </div>
                <textarea placeholder="I'm feeling... (Enter to save, Shift+Enter for new line)" value={journalText} onChange={(e) => setJournalText(e.target.value)} onKeyDown={(e) => handleTextareaKeyDown(e, journalText, { isJournal: true })} rows={4} />
                <div className="form-actions form-actions-journal-pair">
                  <button type="button" className="btn-primary btn-journal-action-size" onClick={() => submitEntry(journalText, { isJournal: true })} disabled={loading}>
                    {loading ? <Loader2 size={18} className="spin" /> : <Send size={18} strokeWidth={2.25} />}
                    Save to Journal
                  </button>
                  <button type="button" className="btn-quick-click-entry btn-journal-action-size" onClick={() => setShowQuickCheckIn(true)}>
                    <ClipboardList size={18} strokeWidth={2.25} /> Quick Click Entry
                  </button>
                </div>
              </div>
            )}

            {entriesLoaded && todayCheckedIn && showQuickCheckIn && (
              <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowQuickCheckIn(false); setMentalRating(null); setMentalTags([]); setPhysicalRating(null); setPhysicalTags([]); } }}>
                <div className="modal-content">
                  <div className="checkin-card">
                    <div className="checkin-section">
                      <h3 className="checkin-question">How are you feeling <em>mentally</em>?</h3>
                      <div className="rating-row">
                        {[1,2,3,4,5,6,7].map((n) => (
                          <button key={n} className={`rating-btn ${mentalRating === n ? "active" : ""}`} onClick={() => setMentalRating(n)}>{n}</button>
                        ))}
                      </div>
                      <div className="rating-labels"><span>Not great</span><span>Great</span></div>
                      <div className="checkin-tags">
                        {["Happy","Normal","Calm","Confused","Foggy","Anxious","Sad","Irritable","Forgetful","Restless","Hopeful","Overwhelmed"].map((t) => (
                          <button key={t} className={`checkin-tag ${mentalTags.includes(t) ? "active" : ""}`} onClick={() => toggleTag(mentalTags, setMentalTags, t)}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="checkin-divider" />
                    <div className="checkin-section">
                      <h3 className="checkin-question">How are you feeling <em>physically</em>?</h3>
                      <div className="rating-row">
                        {[1,2,3,4,5,6,7].map((n) => (
                          <button key={n} className={`rating-btn ${physicalRating === n ? "active" : ""}`} onClick={() => setPhysicalRating(n)}>{n}</button>
                        ))}
                      </div>
                      <div className="rating-labels"><span>Not great</span><span>Great</span></div>
                      <div className="checkin-tags">
                        {["Normal","Strong","Weak","Achy","Stiff","Tired","Energetic","Dizzy","Nauseous","Shaky","Well-Rested","Sore"].map((t) => (
                          <button key={t} className={`checkin-tag ${physicalTags.includes(t) ? "active" : ""}`} onClick={() => toggleTag(physicalTags, setPhysicalTags, t)}>{t}</button>
                        ))}
                      </div>
                    </div>
                    <div className="checkin-divider" />
                    <div className="checkin-section">
                      <h3 className="checkin-question">Anything else on your mind?</h3>
                      <textarea placeholder="Write whatever you'd like..." value={journalText} onChange={(e) => setJournalText(e.target.value)} rows={4} />
                    </div>
                    <div className="checkin-actions">
                      <button className="chip" onClick={() => { setShowQuickCheckIn(false); setMentalRating(null); setMentalTags([]); setPhysicalRating(null); setPhysicalTags([]); }}>Cancel</button>
                      <button className="btn-primary btn-checkin-save" onClick={submitQuickCheckIn} disabled={loading || (!mentalRating && !physicalRating && !journalText.trim())}>
                        {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                        Save Entry
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <h3 className="section-title">Your entries</h3>
            <div className="journal-timeline">
              {!entriesLoaded ? (
                <p className="hint journal-entries-loading">
                  <Loader2 size={16} className="spin" aria-hidden /> Loading…
                </p>
              ) : patientEntries.length === 0 ? (
                <p className="hint">No journal entries yet.</p>
              ) : (
                patientEntries.map((e, i) => <PatientJournalListItem key={e.id || i} entry={e} />)
              )}
            </div>
          </div>
        )}

        {/* ── Doctor Visits ────────────────── */}
        {tab === "visits" && (
          <div>
            <div className="card">
              {visitStep === "idle" && (
                <div className="visit-start">
                  <div className="visit-start-icon"><Stethoscope size={22} /></div>
                  <h3>Record a Doctor Visit</h3>
                  <p className="hint">Tap record and set your device down during the appointment. The conversation will be transcribed automatically.</p>
                  <div className="visit-actions">
                    <button className="btn-record" onClick={() => { speech.start(); setVisitStep("recording"); }}>
                      <Mic size={18} /> Start Recording
                    </button>
                  </div>
                  <div className="visit-or"><span>or type / paste notes manually</span></div>
                  <textarea className="visit-manual-input" placeholder="Paste or type your doctor visit notes here..." rows={3} value={speech.transcript} onChange={(e) => speech.setTranscript(e.target.value)} />
                  {speech.transcript && (
                    <div className="form-actions">
                      <button className="btn-primary" onClick={() => processVisitTranscript(speech.transcript)} disabled={visitLoading}>
                        {visitLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Process notes
                      </button>
                    </div>
                  )}
                </div>
              )}
              {visitStep === "recording" && (
                <div className="visit-recording">
                  <div className="recording-pulse"><Mic size={28} /></div>
                  <div className="recording-timer">{formatTimer(speech.seconds)}</div>
                  <p className="recording-status">Listening...</p>
                  <div className="recording-transcript">{speech.transcript ? <p>{speech.transcript}</p> : <p className="hint">Waiting for speech...</p>}</div>
                  <button className="btn-stop" onClick={() => { speech.stop(); setVisitStep("review"); }}><Square size={14} /> Stop Recording</button>
                </div>
              )}
              {visitStep === "review" && (
                <div className="visit-review">
                  <p className="form-label">Transcript</p>
                  <textarea value={speech.transcript} onChange={(e) => speech.setTranscript(e.target.value)} rows={6} />
                  <p className="hint">Edit the transcript if needed, then save.</p>
                  <div className="form-actions" style={{ gap: 8 }}>
                    <button className="chip" onClick={startNewVisit}>Discard</button>
                    <button className="btn-primary" onClick={() => processVisitTranscript(speech.transcript)} disabled={visitLoading}>
                      {visitLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Save visit
                    </button>
                  </div>
                </div>
              )}
              {visitStep === "chat" && pendingVisitData && (
                <div className="visit-chat">
                  <div className="visit-warning">
                    <div className="visit-warning-icon">!</div>
                    <div className="visit-warning-body">
                      <p className="visit-warning-title">Missing Information</p>
                      <p className="visit-warning-text">{pendingVisitData.question}</p>
                    </div>
                  </div>
                  <div className="visit-chat-input">
                    <input type="text" placeholder="e.g. Dr. Smith, Dr. Patel..." value={visitReply} onChange={(e) => setVisitReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleVisitReply()} autoFocus />
                    <button className="btn-primary" onClick={handleVisitReply} disabled={visitLoading}>
                      {visitLoading ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                    </button>
                  </div>
                </div>
              )}
              {visitStep === "saved" && pendingVisitData && (
                <div className="visit-saved">
                  <div className="visit-saved-check">&#10003;</div>
                  <h3>Visit Saved</h3>
                  <p className="hint">{pendingVisitData.doctor_name} &middot; {pendingVisitData.date}</p>
                  <div className="visit-takeaways">
                    <p className="form-label">Key Takeaways</p>
                    <AgentMessageBody text={pendingVisitData.key_takeaways} className="answer-text" />
                  </div>
                  <div className="form-actions">
                    <button className="btn-primary" onClick={startNewVisit}><Plus size={14} /> Record another visit</button>
                  </div>
                </div>
              )}
            </div>

            <h3 className="section-title">Past Visits</h3>
            {visits.length === 0 ? (
              <p className="hint">No doctor visits recorded yet.</p>
            ) : (
              visits.map((v) => (
                <div key={v.id} className="card visit-card">
                  <div className="visit-card-header" onClick={() => setExpandedVisit(expandedVisit === v.id ? null : v.id)}>
                    <div className="visit-card-left">
                      <div className="visit-doctor-avatar"><Stethoscope size={14} /></div>
                      <div>
                        <p className="visit-doctor-name">{v.doctor_name}</p>
                        <p className="date-small">{formatDate(v.date)}</p>
                      </div>
                    </div>
                    {expandedVisit === v.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                  {expandedVisit === v.id && (
                    <div className="visit-card-body">
                      {v.key_takeaways && <div className="visit-takeaways"><p className="form-label">Key Takeaways</p><AgentMessageBody text={v.key_takeaways} className="answer-text" /></div>}
                      <div className="visit-transcript-section"><p className="form-label">Full Transcript</p><div className="visit-transcript-text">{v.transcript}</div></div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Summary ──────────────────────── */}
        {tab === "summary" && (
          <div>
            <div className="card recap-card">
              <h3 className="section-title recap-24h-heading">24 Hour Recap</h3>
              {last24hRecapLoading ? (
                <p className="hint journal-entries-loading recap-24h-loading" aria-busy="true" aria-live="polite">
                  <Loader2 size={16} className="spin" aria-hidden /> Loading…
                </p>
              ) : (
                <AgentMessageBody text={last24hRecap} className="summary-text recap-24h-body" />
              )}
              <div className="summary-date-hint-block">
                <div className="summary-search-header-row">
                  <p className="form-label summary-date-hint-label">Search Specific Date Range</p>
                  <div className="length-toggle length-toggle--inline">
                    <button type="button" className={`length-btn ${summaryLength === "short" ? "active" : ""}`} onClick={() => setSummaryLength("short")}>Short</button>
                    <button type="button" className={`length-btn ${summaryLength === "long" ? "active" : ""}`} onClick={() => setSummaryLength("long")}>Detailed</button>
                  </div>
                </div>
                <div className="summary-date-hint-row">
                  <input
                    type="text"
                    className="summary-date-hint-input"
                    value={recapDatePhrase}
                    onChange={(e) => { setRecapDatePhrase(e.target.value); if (recapDateFeedback) setRecapDateFeedback(""); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitRecapWithPhrase();
                      }
                    }}
                    placeholder="e.g. show me info for the last week"
                  />
                  <button type="button" className="btn-primary summary-date-hint-btn" onClick={submitRecapWithPhrase} disabled={loading}>
                    {loading ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
                    Generate
                  </button>
                </div>
                {recapDateFeedback && <p className="hint summary-date-hint-feedback">{recapDateFeedback}</p>}
              </div>
            </div>
            {summary && (
              <div className="card summary-result">
                <div className="answer-header"><div className="answer-icon">AI</div><span className="answer-label">Doctor Summary<span className="summary-length-badge">{summaryLength === "short" ? "quick" : "detailed"}</span></span></div>
                <AgentMessageBody text={summary} className="summary-text" />
              </div>
            )}
          </div>
        )}

        {/* ── Ask AI ───────────────────────── */}
        {tab === "ask" && (
          <div>
            <div className="card">
              <div className="ask-input">
                <input type="text" placeholder={`Ask anything about ${patientName}'s care log...`} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askQuestion()} />
                <button className="btn-primary" onClick={askQuestion} disabled={loading}>
                  {loading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} Ask
                </button>
              </div>
              <div className="suggested-questions">
                {["Tell me about the fall", "How is medication compliance?", "Where do self-reports differ?"].map((q) => (
                  <button key={q} className="chip-outline" onClick={() => setQuestion(q)}>{q}</button>
                ))}
              </div>
            </div>
            {answer && (
              <div className="card answer-card">
                <div className="answer-header"><div className="answer-icon">AI</div><span className="answer-label">Answer</span></div>
                <AgentMessageBody text={answer} className="answer-text" />
              </div>
            )}
          </div>
        )}

        {/* ── Settings (Admin) ─────────────── */}
        {tab === "settings" && isAdmin && (
          <div>
            <div className="settings-tabs">
              <button className={`length-btn ${settingsTab === "users" ? "active" : ""}`} onClick={() => setSettingsTab("users")}>
                <UserIcon size={13} /> Users
              </button>
              <button className={`length-btn ${settingsTab === "changelog" ? "active" : ""}`} onClick={() => setSettingsTab("changelog")}>
                <ClipboardList size={13} /> Changelog
              </button>
              <button className={`length-btn ${settingsTab === "tools" ? "active" : ""}`} onClick={() => setSettingsTab("tools")}>
                <Settings size={13} /> Tools
              </button>
            </div>

            {settingsTab === "users" && (
              <div>
                <div className="settings-header">
                  <h3 className="section-title" style={{ margin: 0 }}>Users</h3>
                  <button className="btn-primary" onClick={() => setShowNewUser(!showNewUser)}>
                    <UserPlus size={14} /> Add User
                  </button>
                </div>

                {showNewUser && (
                  <div className="card new-user-form">
                    <div className="new-user-grid">
                      <div>
                        <label className="form-label">Username</label>
                        <input type="text" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} placeholder="e.g. jackmac" />
                      </div>
                      <div>
                        <label className="form-label">Display Name</label>
                        <input type="text" value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} placeholder="e.g. Kate" />
                      </div>
                      <div>
                        <label className="form-label">Password</label>
                        <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Temporary password" />
                      </div>
                      <div>
                        <label className="form-label">Role</label>
                        <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                          <option value="patient">Patient</option>
                        </select>
                      </div>
                      {newUser.role !== "patient" && (
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label className="form-label">Relationship to patient</label>
                          <input type="text" value={newUser.relationship} onChange={(e) => setNewUser({ ...newUser, relationship: e.target.value })} placeholder="e.g. daughter, wife, nurse, physical therapist" />
                        </div>
                      )}
                    </div>
                    <div className="form-actions" style={{ marginTop: 12 }}>
                      <button className="chip" onClick={() => setShowNewUser(false)}>Cancel</button>
                      <button className="btn-primary" onClick={createNewUser}>Create User</button>
                    </div>
                  </div>
                )}

                <div className="users-list">
                  {users.map((u) => (
                    <div key={u.id} className={`card user-row-card ${!u.active ? "user-inactive" : ""}`}>
                      {editingUser === u.id ? (
                        <div className="edit-user-form">
                          <div className="new-user-grid">
                            <div>
                              <label className="form-label">Display Name</label>
                              <input type="text" value={editForm.display_name} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} />
                            </div>
                            <div>
                              <label className="form-label">Role</label>
                              <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}>
                                <option value="user">User</option>
                                <option value="admin">Admin</option>
                                <option value="patient">Patient</option>
                              </select>
                            </div>
                            {editForm.role !== "patient" && (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <label className="form-label">Relationship to patient</label>
                                <input type="text" value={editForm.relationship} onChange={(e) => setEditForm({ ...editForm, relationship: e.target.value })} placeholder="e.g. daughter, wife, nurse" />
                              </div>
                            )}
                            <div>
                              <label className="form-label">New Password <span className="hint">(leave blank to keep)</span></label>
                              <input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="New password..." />
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end" }}>
                              <label className="edit-toggle">
                                <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} />
                                <span>Active</span>
                              </label>
                            </div>
                          </div>
                          <div className="form-actions" style={{ marginTop: 12 }}>
                            <button className="chip" onClick={() => setEditingUser(null)}>Cancel</button>
                            <button className="btn-primary" onClick={saveEditUser}>Save Changes</button>
                          </div>
                        </div>
                      ) : (
                        <div className="user-row">
                          <div className="user-row-left">
                            <div className="user-row-avatar">{ROLE_ICON[u.role]}</div>
                            <div>
                              <p className="user-row-name">{u.display_name} <span className="user-row-username">@{u.username}</span></p>
                              <p className="user-row-meta">
                                <span className={`role-badge role-${u.role}`}>{u.role}</span>
                                {!u.active && <span className="role-badge role-inactive">deactivated</span>}
                              </p>
                            </div>
                          </div>
                          <button className="chip" onClick={() => startEditUser(u)}>Edit</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {settingsTab === "changelog" && (
              <div>
                <h3 className="section-title">Activity Log</h3>
                <div className="changelog-list">
                  {changelog.length === 0 ? (
                    <p className="hint">No activity recorded yet.</p>
                  ) : (
                    changelog.map((log) => (
                      <div key={log.id} className="changelog-row">
                        <div className="changelog-action">
                          <span className={`changelog-badge action-${log.action.split("_")[0]}`}>{log.action.replace(/_/g, " ")}</span>
                          <span className="changelog-user">{log.username}</span>
                        </div>
                        <div className="changelog-details">
                          {Object.entries(log.details || {}).map(([k, v]) => (
                            <span key={k} className="changelog-detail">{k}: {String(v)}</span>
                          ))}
                        </div>
                        <span className="changelog-time">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {settingsTab === "tools" && (
              <div>
                <h3 className="section-title">Admin Tools</h3>
                <div className="card">
                  <h4>Migrate JSON Data</h4>
                  <p className="hint">Import existing care_entries.json and doctor_visits.json into the database. Only run once.</p>
                  <div className="form-actions">
                    <button className="btn-primary" onClick={migrateJsonData}>Import JSON Data</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const DAILY_CHECKIN_PREFIX = "Daily Check-In:";

/** Parse structured Daily Check-In or Quick Check-In body; null = show as freeform entry. */
function tryParseCheckInPayload(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim();
  let body = "";

  if (t.startsWith(DAILY_CHECKIN_PREFIX)) {
    body = t.slice(DAILY_CHECKIN_PREFIX.length).trim();
  } else if (/^Mental:\s*\d+\s*\/\s*7/im.test(t) || /^Physical:\s*\d+\s*\/\s*7/im.test(t)) {
    body = t;
  } else {
    return null;
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const data = {
    mental: null,
    feelingTags: [],
    physical: null,
    bodyTags: [],
    freeNote: "",
  };
  const orphanLines = [];

  for (const line of lines) {
    let m = line.match(/^Mental:\s*(\d+)\s*\/\s*7$/i);
    if (m) {
      data.mental = Math.min(7, Math.max(1, parseInt(m[1], 10)));
      continue;
    }
    m = line.match(/^Feeling:\s*(.+)$/i);
    if (m) {
      data.feelingTags = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    m = line.match(/^Physical:\s*(\d+)\s*\/\s*7$/i);
    if (m) {
      data.physical = Math.min(7, Math.max(1, parseInt(m[1], 10)));
      continue;
    }
    m = line.match(/^Body:\s*(.+)$/i);
    if (m) {
      data.bodyTags = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    orphanLines.push(line);
  }

  data.freeNote = orphanLines.join("\n").trim();

  if (t.startsWith(DAILY_CHECKIN_PREFIX)) {
    const hasScores =
      data.mental != null ||
      data.physical != null ||
      data.feelingTags.length > 0 ||
      data.bodyTags.length > 0;
    if (hasScores || data.freeNote) return data;
    return { ...data, freeNote: "" };
  }

  if (data.mental != null || data.physical != null) return data;
  return null;
}

function CheckInMeter({ value }) {
  if (value == null) return null;
  return (
    <div className="journal-checkin-meter" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span key={i} className={`journal-checkin-meter-seg ${i < value ? "filled" : ""}`} />
      ))}
    </div>
  );
}

function PatientJournalListItem({ entry }) {
  const checkin = tryParseCheckInPayload(entry.raw_text);
  const dateStr = formatDate(entry.timestamp.slice(0, 10));

  if (checkin) {
    const hasScores =
      checkin.mental != null ||
      checkin.physical != null ||
      checkin.feelingTags.length > 0 ||
      checkin.bodyTags.length > 0;
    const showMentalPanel = checkin.mental != null || checkin.feelingTags.length > 0;
    const showPhysicalPanel = checkin.physical != null || checkin.bodyTags.length > 0;

    return (
      <div className="journal-entry journal-entry--checkin">
        <p className="date-small">{dateStr}</p>
        <div className="journal-checkin-card">
          <div className="journal-checkin-card-head">
            <div className="journal-checkin-badge">
              <ClipboardList size={15} strokeWidth={2.25} aria-hidden />
              <span>Daily Check-In</span>
            </div>
          </div>
          {hasScores ? (
            <div className="journal-checkin-panels">
              {showMentalPanel && (
                <div className="journal-checkin-panel journal-checkin-panel--mental">
                  <p className="journal-checkin-panel-label">Mental</p>
                  {checkin.mental != null && (
                    <div className="journal-checkin-scoreline">
                      <span className="journal-checkin-score-num">{checkin.mental}</span>
                      <span className="journal-checkin-score-den">/7</span>
                      <CheckInMeter value={checkin.mental} />
                    </div>
                  )}
                  {checkin.feelingTags.length > 0 && (
                    <div className="journal-checkin-tagrow">
                      {checkin.feelingTags.map((tag) => (
                        <span key={tag} className="journal-checkin-pill journal-checkin-pill--mental">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {showPhysicalPanel && (
                <div className="journal-checkin-panel journal-checkin-panel--physical">
                  <p className="journal-checkin-panel-label">Physical</p>
                  {checkin.physical != null && (
                    <div className="journal-checkin-scoreline">
                      <span className="journal-checkin-score-num">{checkin.physical}</span>
                      <span className="journal-checkin-score-den">/7</span>
                      <CheckInMeter value={checkin.physical} />
                    </div>
                  )}
                  {checkin.bodyTags.length > 0 && (
                    <div className="journal-checkin-tagrow">
                      {checkin.bodyTags.map((tag) => (
                        <span key={tag} className="journal-checkin-pill journal-checkin-pill--physical">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : !checkin.freeNote ? (
            <p className="hint journal-checkin-empty-hint">Check-in saved without ratings.</p>
          ) : null}
          {checkin.freeNote ? (
            <div className="journal-checkin-freenote">
              <span className="journal-checkin-freenote-label">Also noted</span>
              <p className="journal-checkin-freenote-text">{checkin.freeNote}</p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const journalNote = entry.is_journal === true;
  return (
    <div className={`journal-entry journal-entry--note ${journalNote ? "journal-entry--journal-only" : ""}`}>
      <p className="date-small">{dateStr}</p>
      <div className="journal-note-card">
        <div className="journal-note-card-head">
          {journalNote ? (
            <>
              <BookHeart size={15} strokeWidth={2.25} aria-hidden />
              <span>Journal note</span>
            </>
          ) : (
            <>
              <MessageSquare size={15} strokeWidth={2.25} aria-hidden />
              <span>Entry</span>
            </>
          )}
        </div>
        <p className="journal-note-body">{entry.raw_text}</p>
      </div>
    </div>
  );
}

export default App;
