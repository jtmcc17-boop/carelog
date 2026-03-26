import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import "./App.css";

const API = "http://localhost:8000/api";

const DEFAULT_REPORTERS = ["Mom", "Jack", "Nurse Amy", "Nurse Beth", "PT Mike"];

const REPORTER_PALETTE = [
  { hue: 152, accent: "#68d391", rgb: "104,211,145" },
  { hue: 28,  accent: "#f6ad55", rgb: "246,173,85" },
  { hue: 330, accent: "#f687b3", rgb: "246,135,179" },
  { hue: 270, accent: "#b794f4", rgb: "183,148,244" },
  { hue: 0,   accent: "#fc8181", rgb: "252,129,129" },
  { hue: 207, accent: "#63b3ed", rgb: "99,179,237" },
  { hue: 185, accent: "#76e4f7", rgb: "118,228,247" },
  { hue: 45,  accent: "#fbd38d", rgb: "251,211,141" },
  { hue: 290, accent: "#d6bcfa", rgb: "214,188,250" },
  { hue: 15,  accent: "#feb2b2", rgb: "254,178,178" },
];

function getReporterColor(name, reporters) {
  const idx = reporters.indexOf(name);
  const palette = REPORTER_PALETTE[idx >= 0 ? idx % REPORTER_PALETTE.length : 5];
  return palette;
}

const CATEGORY_STYLES = {
  mood: "tag-mood",
  cognition: "tag-cognition",
  medication: "tag-medication",
  meals: "tag-meals",
  physical_activity: "tag-physical_activity",
  sleep: "tag-sleep",
  incidents: "tag-incidents",
  social: "tag-social",
  other: "tag-other",
};

function CategoryTag({ category, onClick, active }) {
  const cls = CATEGORY_STYLES[category] || CATEGORY_STYLES.other;
  return (
    <span
      className={`category-tag clickable ${cls} ${active ? "tag-active" : ""}`}
      onClick={onClick}
    >
      {category.replace("_", " ")}
    </span>
  );
}

function ReporterAvatar({ name, reporters }) {
  const pal = getReporterColor(name, reporters);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
  return (
    <div
      className="reporter-avatar"
      style={{
        background: `rgba(${pal.rgb},0.15)`,
        color: pal.accent,
        borderColor: `rgba(${pal.rgb},0.25)`,
      }}
    >
      {initials}
    </div>
  );
}

function loadReporters() {
  try {
    const saved = localStorage.getItem("carelog-reporters");
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_REPORTERS;
}

function App() {
  const [tab, setTab] = useState("timeline");
  const [entries, setEntries] = useState([]);
  const [reporters, setReporters] = useState(loadReporters);
  const [reporter, setReporter] = useState(() => loadReporters()[0] || "Mom");
  const [rawText, setRawText] = useState("");
  const [journalText, setJournalText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryLength, setSummaryLength] = useState("long");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [newReporterName, setNewReporterName] = useState("");
  const [showAddReporter, setShowAddReporter] = useState(false);
  const [filterCategory, setFilterCategory] = useState(null);

  useEffect(() => {
    localStorage.setItem("carelog-reporters", JSON.stringify(reporters));
  }, [reporters]);

  useEffect(() => {
    fetch(`${API}/entries`)
      .then((r) => r.json())
      .then(setEntries)
      .catch(console.error);
  }, []);

  const activeColor = useMemo(
    () => getReporterColor(reporter, reporters),
    [reporter, reporters]
  );

  const accentStyle = useMemo(() => ({
    "--accent": activeColor.accent,
    "--accent-glow": `rgba(${activeColor.rgb},0.15)`,
    "--accent-glow-strong": `rgba(${activeColor.rgb},0.25)`,
    "--border-focus": `rgba(${activeColor.rgb},0.4)`,
  }), [activeColor]);

  const addReporter = () => {
    const name = newReporterName.trim();
    if (!name || reporters.includes(name)) return;
    setReporters((prev) => [...prev, name]);
    setReporter(name);
    setNewReporterName("");
    setShowAddReporter(false);
  };

  const removeReporter = (name) => {
    setReporters((prev) => prev.filter((r) => r !== name));
    if (reporter === name) {
      setReporter(reporters.find((r) => r !== name) || "");
    }
  };

  const submitEntry = async (reporterName, text) => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reporter: reporterName, raw_text: text }),
      });
      const newEntry = await res.json();
      setEntries((prev) => [newEntry, ...prev]);
      setRawText("");
      setJournalText("");
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleTextareaKeyDown = (e, reporterName, text) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitEntry(reporterName, text);
    }
  };

  const askQuestion = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAnswer(data.answer);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const getSummary = async () => {
    setLoading(true);
    setSummary("");
    try {
      const res = await fetch(`${API}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          length: summaryLength,
        }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const filteredEntries = filterCategory
    ? entries.filter((e) => e.categories && filterCategory in e.categories)
    : entries;

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
    ? entries.filter((e) => e.categories && filterCategory in e.categories).length
    : 0;

  const patientEntries = entries
    .filter((e) => ["patient", "dad", "mark"].includes(e.reporter.toLowerCase()))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const tabs = [
    { id: "timeline", label: "Timeline", icon: <ClipboardList size={15} /> },
    { id: "journal", label: "Journal", icon: <BookHeart size={15} /> },
    { id: "summary", label: "Summary", icon: <FileText size={15} /> },
    { id: "ask", label: "Ask AI", icon: <Sparkles size={15} /> },
  ];

  return (
    <div className="app" style={accentStyle}>
      <header className="header">
        <div className="header-left">
          <div>
            <h1 className="brand-title">
              <span className="brand-hey">I Said Hey!</span>
              <span className="brand-dots">...</span>
              <span className="brand-whats">What&rsquo;s Going On?</span>
            </h1>
            <p className="subtitle">A journal to keep track of what&rsquo;s going on with Mark</p>
          </div>
        </div>
        <div className="header-right">
          <span className="badge badge-blue">{entries.length} entries</span>
          <span className="badge badge-green">
            {new Set(entries.map((e) => e.reporter)).size} reporters
          </span>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <main className="content">
        {/* ── Timeline ─────────────────────── */}
        {tab === "timeline" && (
          <div>
            <div className="card entry-form">
              <p className="form-label">New entry</p>
              <div className="reporter-chips">
                {reporters.map((r) => {
                  const pal = getReporterColor(r, reporters);
                  return (
                    <div key={r} className="chip-wrapper">
                      <button
                        className={`chip ${reporter === r ? "active" : ""}`}
                        onClick={() => setReporter(r)}
                        style={
                          reporter === r
                            ? {
                                background: `rgba(${pal.rgb},0.15)`,
                                color: pal.accent,
                                borderColor: `rgba(${pal.rgb},0.3)`,
                                boxShadow: `0 0 12px rgba(${pal.rgb},0.15)`,
                              }
                            : undefined
                        }
                      >
                        {r}
                      </button>
                      <button
                        className="chip-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeReporter(r);
                        }}
                        title={`Remove ${r}`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                {showAddReporter ? (
                  <div className="add-reporter-inline">
                    <input
                      type="text"
                      className="add-reporter-input"
                      placeholder="Name..."
                      value={newReporterName}
                      onChange={(e) => setNewReporterName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addReporter();
                        if (e.key === "Escape") {
                          setShowAddReporter(false);
                          setNewReporterName("");
                        }
                      }}
                      autoFocus
                    />
                    <button className="chip add-chip" onClick={addReporter}>
                      <Plus size={12} /> Add
                    </button>
                    <button
                      className="chip"
                      onClick={() => {
                        setShowAddReporter(false);
                        setNewReporterName("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="chip add-chip"
                    onClick={() => setShowAddReporter(true)}
                  >
                    <Plus size={12} />
                  </button>
                )}
              </div>
              <textarea
                placeholder="Describe what happened in plain language... (Enter to save, Shift+Enter for new line)"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                onKeyDown={(e) => handleTextareaKeyDown(e, reporter, rawText)}
                rows={3}
              />
              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={() => submitEntry(reporter, rawText)}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Save entry
                </button>
              </div>
            </div>

            {filterCategory && (
              <div className="filter-bar">
                <div className="filter-bar-left">
                  <Filter size={13} />
                  <span>
                    Showing <strong>{filterCount}</strong> entries with
                  </span>
                  <CategoryTag
                    category={filterCategory}
                    onClick={() => {}}
                    active
                  />
                </div>
                <button
                  className="filter-clear"
                  onClick={() => setFilterCategory(null)}
                >
                  <X size={12} />
                  Clear filter
                </button>
              </div>
            )}

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
                    <div className="timeline-entry" key={i}>
                      <div className="timeline-left">
                        <ReporterAvatar name={entry.reporter} reporters={reporters} />
                        {i < dayEntries.length - 1 && (
                          <div className="timeline-line" />
                        )}
                      </div>
                      <div className="card timeline-card">
                        <div className="timeline-header">
                          <div className="reporter-name">
                            {entry.reporter}
                            {["Dad", "Patient", "Mark"].includes(
                              entry.reporter
                            ) && (
                              <span className="self-report-badge">
                                self-report
                              </span>
                            )}
                          </div>
                          <span className="entry-time">
                            {entry.timestamp}
                          </span>
                        </div>
                        <p className="entry-text">{entry.raw_text}</p>
                        <div className="tags">
                          {Object.keys(entry.categories || {}).map((cat) => (
                            <CategoryTag
                              key={cat}
                              category={cat}
                              active={filterCategory === cat}
                              onClick={() =>
                                setFilterCategory(
                                  filterCategory === cat ? null : cat
                                )
                              }
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Journal ──────────────────────── */}
        {tab === "journal" && (
          <div>
            <div className="card">
              <h3>How are you feeling today?</h3>
              <p className="hint">
                This is your private space. Write whatever is on your mind.
              </p>
              <textarea
                placeholder="I'm feeling... (Enter to save, Shift+Enter for new line)"
                value={journalText}
                onChange={(e) => setJournalText(e.target.value)}
                onKeyDown={(e) => handleTextareaKeyDown(e, "Patient", journalText)}
                rows={4}
              />
              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={() => submitEntry("Patient", journalText)}
                  disabled={loading}
                >
                  {loading && <Loader2 size={14} className="spin" />}
                  <BookHeart size={14} />
                  Save to journal
                </button>
              </div>
            </div>

            <h3 className="section-title">Your entries</h3>
            <div className="journal-timeline">
              {patientEntries.length === 0 ? (
                <p className="hint">No journal entries yet.</p>
              ) : (
                patientEntries.map((e, i) => (
                  <div key={i} className="journal-entry">
                    <p className="date-small">
                      {formatDate(e.timestamp.slice(0, 10))}
                    </p>
                    <p className="entry-text">{e.raw_text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Summary ──────────────────────── */}
        {tab === "summary" && (
          <div>
            <div className="stats-grid">
              <div className="stat-card">
                <p className="stat-label">Total entries</p>
                <p className="stat-value">{entries.length}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Date range</p>
                <p className="stat-value-sm">
                  {entries.length > 0
                    ? `${entries[0].timestamp.slice(0, 10)} — ${entries[entries.length - 1].timestamp.slice(0, 10)}`
                    : "—"}
                </p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Reporters</p>
                <p className="stat-value">
                  {new Set(entries.map((e) => e.reporter)).size}
                </p>
              </div>
            </div>

            <div className="card">
              <p className="form-label">Filter by date range (optional)</p>
              <div className="date-filters">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="date-separator">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>

              <p className="form-label">Summary length</p>
              <div className="length-toggle">
                <button
                  className={`length-btn ${summaryLength === "short" ? "active" : ""}`}
                  onClick={() => setSummaryLength("short")}
                >
                  Short
                </button>
                <button
                  className={`length-btn ${summaryLength === "long" ? "active" : ""}`}
                  onClick={() => setSummaryLength("long")}
                >
                  Detailed
                </button>
              </div>

              <button
                className="btn-primary"
                onClick={getSummary}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <FileText size={14} />
                )}
                Generate {summaryLength === "short" ? "quick" : "detailed"} summary
              </button>
            </div>

            {summary && (
              <div className="card summary-result">
                <div className="answer-header">
                  <div className="answer-icon">AI</div>
                  <span className="answer-label">
                    Doctor Summary
                    <span className="summary-length-badge">
                      {summaryLength === "short" ? "quick" : "detailed"}
                    </span>
                  </span>
                </div>
                <div className="summary-text">{summary}</div>
              </div>
            )}
          </div>
        )}

        {/* ── Ask AI ───────────────────────── */}
        {tab === "ask" && (
          <div>
            <div className="card">
              <div className="ask-input">
                <input
                  type="text"
                  placeholder="Ask anything about Mark's care log..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && askQuestion()}
                />
                <button
                  className="btn-primary"
                  onClick={askQuestion}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Ask
                </button>
              </div>
              <div className="suggested-questions">
                {[
                  "Tell me about the fall",
                  "How is medication compliance?",
                  "Where do self-reports differ?",
                ].map((q) => (
                  <button
                    key={q}
                    className="chip-outline"
                    onClick={() => setQuestion(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {answer && (
              <div className="card answer-card">
                <div className="answer-header">
                  <div className="answer-icon">AI</div>
                  <span className="answer-label">Answer</span>
                </div>
                <div className="answer-text">{answer}</div>
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
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default App;
