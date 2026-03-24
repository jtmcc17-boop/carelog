import streamlit as st
import anthropic
import json
from datetime import datetime

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
Extract relevant categories from the text. Only include categories that are mentioned.
Possible categories: mood, cognition, medication, meals, physical_activity, sleep, incidents, social, other.
For each category, write a brief factual summary of what was reported.
Also extract the date the entry refers to. If a specific date is mentioned (like "last Tuesday" or "March 19th"),
convert it to YYYY-MM-DD format. If no date is mentioned, use today's date.
Respond with ONLY valid JSON, no other text. Example format:
{{"event_date": "2026-03-19", "categories": {{"mood": "Seemed frustrated", "meals": "Ate half of lunch"}}}}""",
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

# Sidebar for logging
st.sidebar.header("Log New Entry")
reporter = st.sidebar.text_input("Who is reporting?", placeholder="e.g., Mom, Nurse Amy, Dad")
raw_text = st.sidebar.text_area("What happened?", placeholder="Describe in plain language...")

if st.sidebar.button("Save Entry", type="primary"):
    if reporter and raw_text:
        with st.sidebar:
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
                st.rerun()
    else:
        st.sidebar.warning("Please fill in both fields.")

# Main area with tabs
tab1, tab2, tab3 = st.tabs(["📋 Care Log", "📊 Doctor Summary", "❓ Ask a Question"])

with tab1:
    if not entries:
        st.info("No entries yet. Use the sidebar to log the first one.")
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
    if st.button("Generate Doctor Visit Summary", type="primary"):
        if not entries:
            st.warning("No entries to summarize.")
        else:
            with st.spinner("Generating summary..."):
                entries_text = get_entries_text(entries)
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=2048,
                    system="""You are preparing a concise care summary for a doctor's visit.
Based on the log entries provided, create a structured briefing that includes:
1. PATIENT OVERVIEW: A 2-3 sentence snapshot of the patient's recent status.
2. KEY PATTERNS: Any trends in mood, cognition, medication, sleep, or physical activity.
3. NOTABLE DISCREPANCIES: Where the patient's self-reports differ from caregiver observations. This is clinically important.
4. INCIDENTS & CONCERNS: Any falls, missed medications, confusion episodes, or other concerns.
5. QUESTIONS FOR THE DOCTOR: Based on the patterns, suggest 2-3 questions the family should ask.
Be factual. Cite who reported what and when. Do not speculate beyond what the entries support.""",
                    messages=[
                        {"role": "user", "content": f"Here are all care log entries:\n{entries_text}\n\nPlease generate a doctor visit summary."}
                    ]
                )
                st.markdown(response.content[0].text)

with tab3:
    question = st.text_input("What do you want to know?", placeholder="e.g., Where do Dad's self-reports differ from what others observed?")
    if st.button("Ask"):
        if not entries:
            st.warning("No entries to search.")
        elif question:
            with st.spinner("Searching care log..."):
                entries_text = get_entries_text(entries)
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=1024,
                    system="""You are a care log assistant. You answer questions based ONLY on the
log entries provided. Always note who reported what and when. If perspectives
conflict, highlight the difference — don't pick a side. This is important for
medical accuracy.""",
                    messages=[
                        {"role": "user", "content": f"Here are the care log entries:\n{entries_text}\n\nQuestion: {question}"}
                    ]
                )
                st.markdown(response.content[0].text)

