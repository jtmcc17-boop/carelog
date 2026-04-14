import streamlit as st
import anthropic
import json
from datetime import datetime
from rag import add_entry, search_entries, rebuild_from_rows, get_entry_count

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

def parse_entry(reporter, raw_text):
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
6. The entry may describe MULTIPLE dates. If so, create separate entries for each date mentioned.
7. Look for phrases like "yesterday", "last week", "on the 23rd", "I forgot to mention" — these indicate backdated information.

For date extraction: Convert any mentioned dates to YYYY-MM-DD format. If multiple dates are mentioned, use the EARLIEST date as the event_date and note other dates in the categories.
If no date is mentioned, use today's date.

Respond with ONLY valid JSON, no other text. Example format:
{{"event_date": "2026-03-23", "categories": {{"mood": "Seemed to be in a good mood on the phone", "cognition": "Was a bit forgetful, had difficulty getting words out"}}}}""",
        messages=[
            {"role": "user", "content": raw_text}
        ]
    )
    try:
        parsed = json.loads(response.content[0].text)
        event_date = parsed.get("event_date", datetime.now().strftime("%Y-%m-%d"))
        categories = parsed.get("categories", {})
        return event_date, categories
    except json.JSONDecodeError:
        return datetime.now().strftime("%Y-%m-%d"), {"other": raw_text}

def get_entries_text(entries):
    entries_text = ""
    for e in entries:
        entries_text += f"\n[{e['timestamp']}] {e['reporter']}:\n"
        entries_text += f"  Raw: {e['raw_text']}\n"
        for cat, detail in e['categories'].items():
            entries_text += f"  {cat}: {detail}\n"
    return entries_text

# Page setup
st.set_page_config(page_title="CareLog", page_icon="🏥", layout="wide")
st.title("🏥 CareLog")
st.markdown("*Multi-perspective care tracking for dementia patients*")

# Load entries
entries = load_entries()
# Main area with tabs
tab1, tab2, tab3, tab4 = st.tabs(["📋 Care Log", "📝 My Journal", "📊 Doctor Summary", "❓ Ask a Question"])

with tab1:
    st.markdown("### Log New Entry")
    col_form, col_spacer = st.columns([2, 1])
    with col_form:
        if "log_counter" not in st.session_state:
            st.session_state.log_counter = 0
        reporter = st.text_input("Who is reporting?", placeholder="e.g., Mom, Nurse Amy, Dad", key=f"reporter_input_{st.session_state.log_counter}")
        raw_text = st.text_area("What happened?", placeholder="Describe in plain language...", key=f"raw_text_input_{st.session_state.log_counter}")
        if st.button("Save Entry", type="primary"):
            if reporter and raw_text:
                with st.spinner("Parsing entry..."):
                    event_date, categories = parse_entry(reporter, raw_text)
                    entry = {
                        "timestamp": event_date,
                        "reporter": reporter,
                        "raw_text": raw_text,
                        "categories": categories
                    }
                    entries.append(entry)
                    save_entries(entries)
                    
                    st.success("Entry saved!")
                    for cat, detail in categories.items():
                        st.write(f"**{cat}**: {detail}")
                    st.session_state.log_counter += 1
                    st.rerun()
            else:
                st.warning("Please fill in both fields.")

    st.divider()
    st.markdown("### Recent Entries")
    if not entries:
        st.info("No entries yet. Log the first one above.")
    else:
        for e in reversed(entries):
            with st.container():
                col1, col2 = st.columns([1, 4])
                with col1:
                    st.caption(e['timestamp'])
                    st.markdown(f"**{e['reporter']}**")
                with col2:
                    for cat, detail in e['categories'].items():
                        st.markdown(f"**{cat}**: {detail}")
                st.divider()


with tab2:
    st.markdown("### Your Personal Space")
    st.markdown("*This is a private space for you to record how you're feeling in your own words. No one else's notes appear here.*")

    if "journal_counter" not in st.session_state:
        st.session_state.journal_counter = 0
    journal_entry = st.text_area("How are you feeling today?", placeholder="Write whatever is on your mind...", key=f"journal_input_{st.session_state.journal_counter}")
    if st.button("Save to Journal", key="journal_save"):
        if journal_entry:
            with st.spinner("Saving..."):
                event_date, categories = parse_entry("Patient", journal_entry)
                entry = {
                    "timestamp": event_date,
                    "reporter": "Patient",
                    "raw_text": journal_entry,
                    "categories": categories
                }
                entries.append(entry)
                save_entries(entries)
                add_entry(
                    entry_id=len(entries) - 1,
                    circle_id=0,
                    reporter=entry["reporter"],
                    timestamp=entry["timestamp"],
                    raw_text=entry["raw_text"],
                    categories=entry["categories"],
                )
                st.success("Journal entry saved!")
                st.session_state.journal_counter += 1
                st.rerun()

    st.divider()
    st.markdown("### Your Previous Entries")
    patient_entries = [e for e in reversed(entries) if e['reporter'].lower() in ['patient', 'dad', 'mark']]
    if not patient_entries:
        st.info("No journal entries yet. Write your first one above.")
    else:
        for e in patient_entries:
            st.caption(e['timestamp'])
            st.write(e['raw_text'])
            st.divider()

with tab3:
    if st.button("Generate Doctor Visit Summary", type="primary"):
        if not entries:
            st.warning("No entries to summarize.")
        else:
            with st.spinner("Generating summary..."):
                entries_text = get_entries_text(entries)
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=2048,
                    system="""You are preparing a factual care summary for a doctor's visit.
Your job is to RELAY information from the log entries, not to diagnose or interpret.
Based on the log entries provided, create a structured briefing that includes:
1. OVERVIEW: A 2-3 sentence factual snapshot of what has been reported recently and by whom.
2. WHAT THE PATIENT REPORTS: Summarize what the patient has said about their own experience, in their own words.
3. WHAT FAMILY AND CAREGIVERS REPORT: Summarize what others have observed, attributed to each reporter.
4. WHERE ACCOUNTS DIFFER: Note any differences between the patient's self-reports and what others observed. Present both sides without interpreting which is correct.
5. NOTABLE EVENTS: Any specific incidents mentioned (falls, missed medications, confusion episodes, etc.) with dates and who reported them.
Do NOT diagnose, suggest conditions, or use clinical terminology. Do NOT speculate about causes.
Simply relay what each person reported, when they reported it, and where accounts differ.
The doctor will draw their own conclusions.""",
                    messages=[
                        {"role": "user", "content": f"Here are all care log entries:\n{entries_text}\n\nPlease generate a doctor visit summary."}
                    ]
                )
                st.markdown(response.content[0].text)

with tab4:
    question = st.text_input("What do you want to know?", placeholder="e.g., Where do Dad's self-reports differ from what others observed?")
    if st.button("Ask"):
        if not entries:
            st.warning("No entries to search.")
        elif question:
            with st.spinner("Searching relevant entries..."):
                relevant = search_entries(question, circle_id=0, n_results=10)

                if not relevant:
                    st.warning("No relevant entries found.")
                else:
                    entries_text = ""
                    for e in relevant:
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
                            {"role": "user", "content": f"Here are the relevant care log entries:\n{entries_text}\n\nQuestion: {question}"}
                        ]
                    )
                    st.markdown(response.content[0].text)

                    with st.expander("See which entries were used"):
                        for e in relevant:
                            st.caption(f"[{e['timestamp']}] {e['reporter']}")
                            st.write(e['raw_text'])
                            st.divider()