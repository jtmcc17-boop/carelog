import logging
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime
import anthropic
import json

from sqlalchemy import inspect, or_, text

from database import engine, get_db, Base
from models import CareCircle, User, Entry, Visit, ChangeLog
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

Base.metadata.create_all(bind=engine)


def ensure_journal_public_column():
    try:
        insp = inspect(engine)
        cols = [c["name"] for c in insp.get_columns("users")]
    except Exception:
        return
    if "journal_public" in cols:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            conn.execute(text("ALTER TABLE users ADD COLUMN journal_public BOOLEAN DEFAULT 1 NOT NULL"))
        else:
            conn.execute(text("ALTER TABLE users ADD COLUMN journal_public BOOLEAN DEFAULT true NOT NULL"))


ensure_journal_public_column()

_log = logging.getLogger("carelog.api")


def ensure_demo_booboo_branding():
    """Legacy demo used patient_name/display_name 'Margaret'; rebrand to Booboo for the demo circle."""
    from database import SessionLocal

    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == "demo_booboo").first()
        if not u:
            return
        c = db.query(CareCircle).filter(CareCircle.id == u.circle_id).first()
        if not c:
            return
        if u.display_name == "Margaret":
            u.display_name = "Booboo"
        if c.patient_name == "Margaret":
            c.patient_name = "Booboo"
            c.name = "Booboo's Care Circle"
        db.query(Entry).filter(
            Entry.circle_id == c.id,
            Entry.reporter == "Margaret",
        ).update({"reporter": "Booboo"}, synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        _log.exception("ensure_demo_booboo_branding failed")
    finally:
        db.close()


ensure_demo_booboo_branding()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

claude = anthropic.Anthropic()

# ── Pydantic Schemas ─────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str
    role: str = "user"
    relationship: str = ""

class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    relationship: Optional[str] = None
    journal_public: Optional[bool] = None


class JournalVisibilityRequest(BaseModel):
    journal_public: bool


class ResetPatientDailyCheckinsRequest(BaseModel):
    username: str


class LogEntryRequest(BaseModel):
    raw_text: str

class AskQuestion(BaseModel):
    question: str

class SummaryRequest(BaseModel):
    start_date: str = ""
    end_date: str = ""
    length: str = "long"

class VisitProcess(BaseModel):
    transcript: str
    conversation: list = []

class VisitSave(BaseModel):
    doctor_name: str
    date: str
    transcript: str
    key_takeaways: str = ""

# ── Helpers ──────────────────────────────────

def log_action(db: Session, action: str, details: dict, user: Optional[User] = None):
    entry = ChangeLog(
        action=action,
        details=details,
        circle_id=user.circle_id if user else None,
        user_id=user.id if user else None,
        username=user.display_name if user else "system",
    )
    db.add(entry)
    db.commit()

def entry_to_dict(e: Entry) -> dict:
    return {
        "id": e.id,
        "timestamp": e.timestamp,
        "reporter": e.reporter,
        "raw_text": e.raw_text,
        "categories": e.categories or {},
    }

def visit_to_dict(v: Visit) -> dict:
    return {
        "id": v.id,
        "doctor_name": v.doctor_name,
        "date": v.date,
        "transcript": v.transcript,
        "key_takeaways": v.key_takeaways,
        "saved_at": v.saved_at.isoformat() if v.saved_at else "",
    }

def user_to_dict(u: User) -> dict:
    jp = getattr(u, "journal_public", True)
    if jp is None:
        jp = True
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "role": u.role,
        "relationship": u.relationship or "",
        "circle_id": u.circle_id,
        "active": u.active,
        "journal_public": jp,
        "created_at": u.created_at.isoformat() if u.created_at else "",
    }


def filter_entries_for_viewer(entries: list, viewer: User, db: Session) -> list:
    """Hide entries authored by patients who set journal to private, unless the viewer is that patient."""
    private_author_ids = {
        u.id
        for u in db.query(User).filter(
            User.circle_id == viewer.circle_id,
            User.role == "patient",
        ).all()
        if getattr(u, "journal_public", True) is False
    }
    if not private_author_ids:
        return entries
    out = []
    for e in entries:
        aid = e.created_by
        if aid and aid in private_author_ids and aid != viewer.id:
            continue
        out.append(e)
    return out

def circle_to_dict(c: CareCircle) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "patient_name": c.patient_name,
    }

def get_reporter_context(db: Session, circle_id: int, patient_name: str) -> str:
    users = db.query(User).filter(User.circle_id == circle_id, User.active == True).all()
    lines = []
    for u in users:
        rel = u.relationship or u.role
        lines.append(f"- {u.display_name}: {rel}")
    if not lines:
        return ""
    return (
        f"REPORTERS AND THEIR RELATIONSHIP TO THE PATIENT ({patient_name}):\n"
        + "\n".join(lines)
        + f"\n\nUse this to understand why different reporters may refer to {patient_name} differently "
        f"(e.g. a daughter might say 'Dad', a wife might use their first name, a nurse uses clinical language).\n"
    )

def get_patient_name(db: Session, user: User) -> str:
    circle = db.query(CareCircle).filter(CareCircle.id == user.circle_id).first()
    return circle.patient_name if circle else "the patient"

# ── Auth Endpoints ───────────────────────────

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.active:
        raise HTTPException(status_code=403, detail="Account deactivated")

    circle = db.query(CareCircle).filter(CareCircle.id == user.circle_id).first()

    token = create_access_token({"sub": user.id})
    log_action(db, "login", {"username": user.username}, user)
    return {
        "token": token,
        "user": user_to_dict(user),
        "circle": circle_to_dict(circle) if circle else None,
    }

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    circle = db.query(CareCircle).filter(CareCircle.id == user.circle_id).first()
    return {
        **user_to_dict(user),
        "circle": circle_to_dict(circle) if circle else None,
    }


@app.patch("/api/me/journal-visibility")
def set_journal_visibility(
    req: JournalVisibilityRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "patient":
        raise HTTPException(status_code=403, detail="Only the patient account can change journal visibility")
    user.journal_public = req.journal_public
    db.commit()
    db.refresh(user)
    log_action(db, "journal_visibility_changed", {"journal_public": req.journal_public}, user)
    return user_to_dict(user)


# ── Admin: User Management ───────────────────

@app.get("/api/admin/users")
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.circle_id == admin.circle_id).order_by(User.created_at).all()
    return [user_to_dict(u) for u in users]


CHECKIN_PREFIX = "Daily Check-In:"


@app.post("/api/admin/reset-patient-daily-checkins")
def reset_patient_daily_checkins(
    req: ResetPatientDailyCheckinsRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Hard-delete journal rows that start with 'Daily Check-In:' for a patient in this circle (demo / QA)."""
    target = db.query(User).filter(
        User.username == req.username.strip(),
        User.circle_id == admin.circle_id,
        User.role == "patient",
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Patient not found in this care circle")
    reporter_match = [Entry.reporter == target.display_name]
    if target.username == "demo_booboo":
        reporter_match.append(Entry.reporter == "Margaret")
    n = (
        db.query(Entry)
        .filter(
            Entry.circle_id == target.circle_id,
            or_(*reporter_match),
            Entry.raw_text.like(f"{CHECKIN_PREFIX}%"),
            Entry.deleted_at.is_(None),
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    log_action(
        db,
        "patient_daily_checkins_reset",
        {"username": target.username, "removed": n},
        admin,
    )
    return {"username": target.username, "removed": n}


@app.post("/api/admin/users")
def create_user(
    req: CreateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    if req.role not in ("admin", "user", "patient"):
        raise HTTPException(status_code=400, detail="Role must be admin, user, or patient")

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        display_name=req.display_name,
        role=req.role,
        relationship=req.relationship,
        circle_id=admin.circle_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(db, "user_created", {
        "new_user": req.username,
        "display_name": req.display_name,
        "role": req.role,
    }, admin)

    return user_to_dict(user)

@app.patch("/api/admin/users/{user_id}")
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.circle_id == admin.circle_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes = {}
    if req.display_name is not None:
        changes["display_name"] = req.display_name
        user.display_name = req.display_name
    if req.role is not None:
        if req.role not in ("admin", "user", "patient"):
            raise HTTPException(status_code=400, detail="Invalid role")
        changes["role"] = req.role
        user.role = req.role
    if req.active is not None:
        changes["active"] = req.active
        user.active = req.active
    if req.password is not None:
        changes["password_changed"] = True
        user.password_hash = hash_password(req.password)
    if req.relationship is not None:
        changes["relationship"] = req.relationship
        user.relationship = req.relationship
    if req.journal_public is not None:
        if user.role != "patient":
            raise HTTPException(status_code=400, detail="journal_public applies only to patient accounts")
        changes["journal_public"] = req.journal_public
        user.journal_public = req.journal_public

    db.commit()
    log_action(db, "user_updated", {"target_user": user.username, **changes}, admin)
    return user_to_dict(user)

@app.delete("/api/admin/users/{user_id}")
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id, User.circle_id == admin.circle_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user.active = False
    db.commit()
    log_action(db, "user_deactivated", {"target_user": user.username}, admin)
    return {"ok": True}

# ── Admin: Changelog ─────────────────────────

@app.get("/api/admin/changelog")
def get_changelog(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    logs = db.query(ChangeLog).filter(ChangeLog.circle_id == admin.circle_id).order_by(ChangeLog.created_at.desc()).limit(500).all()
    return [{
        "id": l.id,
        "action": l.action,
        "details": l.details,
        "username": l.username,
        "created_at": l.created_at.isoformat() if l.created_at else "",
    } for l in logs]

# ── Entries ──────────────────────────────────

@app.get("/api/entries")
def get_entries(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entries = db.query(Entry).filter(
        Entry.circle_id == user.circle_id,
        Entry.deleted_at == None,
    ).order_by(Entry.id.desc()).all()
    entries = filter_entries_for_viewer(entries, user, db)
    return [entry_to_dict(e) for e in entries]

@app.post("/api/entries")
def create_entry(
    req: LogEntryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    patient_name = get_patient_name(db, user)
    reporter_ctx = get_reporter_context(db, user.circle_id, patient_name)
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=f"""You parse caregiver notes into structured JSON.
Today's date is {datetime.now().strftime("%Y-%m-%d")}.
The patient's name is {patient_name}.
The current reporter is: {user.display_name} ({user.relationship or user.role}).

{reporter_ctx}

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
        messages=[{"role": "user", "content": req.raw_text}]
    )

    try:
        parsed = json.loads(response.content[0].text)
        event_date = parsed.get("event_date", datetime.now().strftime("%Y-%m-%d"))
        categories = parsed.get("categories", {})
    except json.JSONDecodeError:
        event_date = datetime.now().strftime("%Y-%m-%d")
        categories = {"other": req.raw_text}

    entry = Entry(
        circle_id=user.circle_id,
        timestamp=event_date,
        reporter=user.display_name,
        raw_text=req.raw_text,
        categories=categories,
        created_by=user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    log_action(db, "entry_created", {
        "entry_id": entry.id,
        "reporter": user.display_name,
        "preview": req.raw_text[:80],
    }, user)

    return entry_to_dict(entry)

@app.delete("/api/entries/{entry_id}")
def delete_entry(
    entry_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    entry = db.query(Entry).filter(Entry.id == entry_id, Entry.circle_id == admin.circle_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    entry.deleted_at = datetime.utcnow()
    entry.deleted_by = admin.id
    db.commit()

    log_action(db, "entry_deleted", {
        "entry_id": entry.id,
        "reporter": entry.reporter,
        "preview": entry.raw_text[:80],
    }, admin)

    return {"ok": True}

# ── Ask / Summary ────────────────────────────

@app.post("/api/ask")
def ask_question(
    req: AskQuestion,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    entries = db.query(Entry).filter(Entry.circle_id == user.circle_id, Entry.deleted_at == None).all()
    entries = filter_entries_for_viewer(entries, user, db)
    if not entries:
        return {"answer": "No entries yet."}

    entries_text = ""
    for e in entries:
        entries_text += f"\n[{e.timestamp}] {e.reporter}:\n"
        entries_text += f"  Raw: {e.raw_text}\n"
        for cat, detail in (e.categories or {}).items():
            entries_text += f"  {cat}: {detail}\n"

    patient_name = get_patient_name(db, user)
    reporter_ctx = get_reporter_context(db, user.circle_id, patient_name)
    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=f"""You are a care log assistant for a patient named {patient_name}. You answer questions based ONLY on the
log entries provided. Always note who reported what and when. If perspectives
conflict, highlight the difference — don't pick a side. This is important for
medical accuracy.

{reporter_ctx}""",
        messages=[
            {"role": "user", "content": f"Here are the care log entries:\n{entries_text}\n\nQuestion: {req.question}"}
        ]
    )

    return {"answer": response.content[0].text}

@app.post("/api/summary")
def generate_summary(
    req: SummaryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Entry).filter(Entry.circle_id == user.circle_id, Entry.deleted_at == None)

    if req.start_date and req.end_date:
        query = query.filter(Entry.timestamp >= req.start_date, Entry.timestamp <= req.end_date)

    entries = query.all()
    entries = filter_entries_for_viewer(entries, user, db)
    if not entries:
        return {"summary": "No entries found in that date range." if req.start_date else "No entries yet."}

    entries_text = ""
    for e in entries:
        entries_text += f"\n[{e.timestamp}] {e.reporter}:\n"
        entries_text += f"  Raw: {e.raw_text}\n"
        for cat, detail in (e.categories or {}).items():
            entries_text += f"  {cat}: {detail}\n"

    patient_name = get_patient_name(db, user)
    reporter_ctx = get_reporter_context(db, user.circle_id, patient_name)
    if req.length == "short":
        system_prompt = f"""{reporter_ctx}You are preparing a brief care summary for a doctor's visit about {patient_name}.
Your job is to RELAY information, not to diagnose or interpret.
Create a SHORT summary (5-8 sentences max) that covers:
- Key trends or patterns across reporters
- Any notable incidents with dates
- Where the patient's self-reports differ from caregiver observations
Be direct and concise. No headers or sections — just a tight paragraph.
Do NOT diagnose or use clinical terminology."""
        max_tok = 512
    else:
        system_prompt = f"""{reporter_ctx}You are preparing a factual care summary for a doctor's visit about {patient_name}.
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

    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=max_tok,
        system=system_prompt,
        messages=[
            {"role": "user", "content": f"Here are all care log entries:\n{entries_text}\n\nPlease generate a doctor visit summary."}
        ]
    )

    return {"summary": response.content[0].text}

# ── Doctor Visits ────────────────────────────

@app.get("/api/visits")
def get_visits(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    visits = db.query(Visit).filter(
        Visit.circle_id == user.circle_id,
        Visit.deleted_at == None,
    ).order_by(Visit.id.desc()).all()
    return [visit_to_dict(v) for v in visits]

@app.post("/api/visits")
def save_visit(
    req: VisitSave,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    patient_name = get_patient_name(db, user)
    visit = Visit(
        circle_id=user.circle_id,
        doctor_name=req.doctor_name,
        date=req.date,
        transcript=req.transcript,
        key_takeaways=req.key_takeaways,
        created_by=user.id,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)

    log_action(db, "visit_saved", {
        "visit_id": visit.id,
        "doctor_name": req.doctor_name,
        "date": req.date,
    }, user)

    return visit_to_dict(visit)

@app.post("/api/visits/process")
def process_visit(
    req: VisitProcess,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    patient_name = get_patient_name(db, user)
    messages = []
    for msg in req.conversation:
        messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": req.transcript})

    response = claude.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=f"""You are processing a doctor visit transcript or notes for a patient named {patient_name}.
Today's date is {datetime.now().strftime("%Y-%m-%d")}.

Your job:
1. Check if the doctor's name is mentioned. Look for "Dr. [Name]", "Doctor [Name]", or any clear reference to who the doctor is. If NO doctor name is found anywhere in the transcript or prior conversation, you MUST ask: respond with ONLY a JSON object: {{"status": "need_info", "question": "Which doctor was this visit with?"}}
2. If you have the doctor's name (either from the transcript or from a follow-up answer), respond with a JSON object:
   {{"status": "complete", "doctor_name": "Dr. Whatever", "date": "YYYY-MM-DD", "key_takeaways": "A clear bulleted summary of what the doctor said, instructions given, medications changed, follow-up plans, etc."}}

For the date: extract it from the text if mentioned, otherwise use today's date.
For key_takeaways: summarize the important medical information — what the doctor said, any instructions, medication changes, follow-up appointments, test results, etc. Use simple bullet points.

Respond with ONLY valid JSON, no other text.""",
        messages=messages,
    )

    try:
        parsed = json.loads(response.content[0].text)
        return parsed
    except json.JSONDecodeError:
        return {"status": "complete", "doctor_name": "Unknown", "date": datetime.now().strftime("%Y-%m-%d"), "key_takeaways": response.content[0].text}

# ── Data Migration (run once) ────────────────

@app.post("/api/admin/migrate-json")
def migrate_json_data(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    imported = {"entries": 0, "visits": 0}

    try:
        with open("care_entries.json", "r") as f:
            old_entries = json.load(f)
        for e in old_entries:
            entry = Entry(
                circle_id=admin.circle_id,
                timestamp=e.get("timestamp", ""),
                reporter=e.get("reporter", "Unknown"),
                raw_text=e.get("raw_text", ""),
                categories=e.get("categories", {}),
            )
            db.add(entry)
            imported["entries"] += 1
    except FileNotFoundError:
        pass

    try:
        with open("doctor_visits.json", "r") as f:
            old_visits = json.load(f)
        for v in old_visits:
            visit = Visit(
                circle_id=admin.circle_id,
                doctor_name=v.get("doctor_name", "Unknown"),
                date=v.get("date", ""),
                transcript=v.get("transcript", ""),
                key_takeaways=v.get("key_takeaways", ""),
            )
            db.add(visit)
            imported["visits"] += 1
    except FileNotFoundError:
        pass

    db.commit()
    log_action(db, "data_migrated", imported, admin)
    return imported
