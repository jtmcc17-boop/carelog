from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic
import json
from datetime import datetime

app = FastAPI()

# Allow the React frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic()
LOG_FILE = "care_entries.json"

def load_entries():
    try:
        with open(LOG_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return []

def save_entries(entries):
    with open(LOG_FILE, "w") as f:
        json.dump(entries, f, indent=2)

class LogEntry(BaseModel):
    reporter: str
    raw_text: str

class AskQuestion(BaseModel):
    question: str

class SummaryRequest(BaseModel):
    start_date: str = ""
    end_date: str = ""
    length: str = "long"

# GET all entries
@app.get("/api/entries")
def get_entries():
    return load_entries()

# POST a new entry
@app.post("/api/entries")
def create_entry(entry: LogEntry):
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=f"""You parse caregiver notes into structured JSON.
Today's date is {datetime.now().strftime("%Y-%m-%d")}.

RULES:
1. Extract ALL relevant categories from the text. Only include categories that are actually mentioned.
2. A single entry can contain MULTIPLE categories. Always check for: mood, cognition, medication, meals, physical_activity, sleep, incidents, social, other.
3. If the text mentions emotions, feelings, or temperament, that is MOOD.
4. If the text mentions memory, forgetfulness, confusion, word-finding difficulty, or clarity of thought, that is COGNITION.
5. Only use "other" for information that truly does not fit any named category.
7. Look for phrases like "yesterday", "last week", "on the 23rd", "I forgot to mention" — these indicate backdated information.

For date extraction: Convert any mentioned dates to YYYY-MM-DD format.
If no date is mentioned, use today's date.

Respond with ONLY valid JSON, no other text. Example format:
{{"event_date": "2026-03-23", "categories": {{"mood": "Seemed to be in a good mood", "cognition": "Was a bit forgetful"}}}}""",
        messages=[{"role": "user", "content": entry.raw_text}]
    )

    try:
        parsed = json.loads(response.content[0].text)
        event_date = parsed.get("event_date", datetime.now().strftime("%Y-%m-%d"))
        categories = parsed.get("categories", {})
    except json.JSONDecodeError:
        event_date = datetime.now().strftime("%Y-%m-%d")
        categories = {"other": entry.raw_text}

    new_entry = {
        "timestamp": event_date,
        "reporter": entry.reporter,
        "raw_text": entry.raw_text,
        "categories": categories
    }

    entries = load_entries()
    entries.append(new_entry)
    save_entries(entries)

    return new_entry

# POST ask a question
@app.post("/api/ask")
def ask_question(req: AskQuestion):
    entries = load_entries()
    if not entries:
        return {"answer": "No entries yet."}

    entries_text = ""
    for e in entries:
        entries_text += f"\n[{e['timestamp']}] {e['reporter']}:\n"
        entries_text += f"  Raw: {e['raw_text']}\n"
        for cat, detail in e['categories'].items():
            entries_text += f"  {cat}: {detail}\n"

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="""You are a care log assistant. You answer questions based ONLY on the
log entries provided. Always note who reported what and when. If perspectives
conflict, highlight the difference — don't pick a side. This is important for
medical accuracy.""",
        messages=[
            {"role": "user", "content": f"Here are the care log entries:\n{entries_text}\n\nQuestion: {req.question}"}
        ]
    )

    return {"answer": response.content[0].text}

# POST generate doctor summary
@app.post("/api/summary")
def generate_summary(req: SummaryRequest):
    entries = load_entries()
    if not entries:
        return {"summary": "No entries yet."}

    # Filter by date range if provided
    if req.start_date and req.end_date:
        entries = [e for e in entries if req.start_date <= e['timestamp'][:10] <= req.end_date]

    if not entries:
        return {"summary": "No entries found in that date range."}

    entries_text = ""
    for e in entries:
        entries_text += f"\n[{e['timestamp']}] {e['reporter']}:\n"
        entries_text += f"  Raw: {e['raw_text']}\n"
        for cat, detail in e['categories'].items():
            entries_text += f"  {cat}: {detail}\n"

    if req.length == "short":
        system_prompt = """You are preparing a brief care summary for a doctor's visit.
Your job is to RELAY information, not to diagnose or interpret.
Create a SHORT summary (5-8 sentences max) that covers:
- Key trends or patterns across reporters
- Any notable incidents with dates
- Where the patient's self-reports differ from caregiver observations
Be direct and concise. No headers or sections — just a tight paragraph.
Do NOT diagnose or use clinical terminology."""
        max_tok = 512
    else:
        system_prompt = """You are preparing a factual care summary for a doctor's visit.
Your job is to RELAY information from the log entries, not to diagnose or interpret.
Based on the log entries provided, create a structured briefing that includes:
1. OVERVIEW: A 2-3 sentence factual snapshot of what has been reported recently and by whom.
2. WHAT THE PATIENT REPORTS: Summarize what the patient has said about their own experience, in their own words.
3. WHAT FAMILY AND CAREGIVERS REPORT: Summarize what others have observed, attributed to each reporter.
4. WHERE ACCOUNTS DIFFER: Note any differences between the patient's self-reports and what others observed. Present both sides without interpreting which is correct.
5. NOTABLE EVENTS: Any specific incidents mentioned (falls, missed medications, confusion episodes, etc.) with dates and who reported them.
Do NOT diagnose, suggest conditions, or use clinical terminology. Do NOT speculate about causes.
Simply relay what each person reported, when they reported it, and where accounts differ.
The doctor will draw their own conclusions."""
        max_tok = 2048

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tok,
        system=system_prompt,
        messages=[
            {"role": "user", "content": f"Here are all care log entries:\n{entries_text}\n\nPlease generate a doctor visit summary."}
        ]
    )

    return {"summary": response.content[0].text}
