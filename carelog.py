import anthropic
import json
from rag import add_entry_to_db, search_entries, rebuild_db, get_entry_count
from datetime import datetime

client = anthropic.Anthropic()

LOG_FILE = "care_entries.json"

# Load existing entries or start fresh
def load_entries():
    try:
        with open(LOG_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return []

# Save entries to file
def save_entries(entries):
    with open(LOG_FILE, "w") as f:
        json.dump(entries, f, indent=2)

# Use Claude to parse a plain-language entry into structured data
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
    

    try:
        parsed = json.loads(response.content[0].text)
        return parsed.get("categories", {})
    except json.JSONDecodeError:
        return {"other": raw_text}

# Main program
entries = load_entries()

print("\n=== Care Log ===")
print("Type 'log' to add an entry")
print("Type 'view' to see recent entries")
print("Type 'summary' for a doctor visit briefing")
print("Type 'ask' to ask a question about the log")
print("Type 'quit' to exit\n")

while True:
    command = input("What would you like to do? ").strip().lower()

    if command == "quit":
        print("Goodbye!")
        break

    elif command == "log":
        reporter = input("Who is reporting? (e.g., Mom, Nurse Amy, Dad): ")
        raw_text = input("What happened? Describe in your own words:\n> ")

        print("\nParsing entry...")
        event_date, categories = parse_entry(reporter, raw_text)

        entry = {
            "timestamp": event_date,
            "reporter": reporter,
            "raw_text": raw_text,
            "categories": categories
        }

        entries.append(entry)
        save_entries(entries)
        add_entry_to_db(entry, len(entries) - 1)

        print(f"\nEntry saved! Parsed into these categories:")
        for cat, detail in categories.items():
            print(f"  {cat}: {detail}")
        print()

    elif command == "view":
        if not entries:
            print("No entries yet.\n")
        else:
            for e in entries[-5:]:
                print(f"\n[{e['timestamp']}] {e['reporter']}:")
                for cat, detail in e['categories'].items():
                    print(f"  {cat}: {detail}")
            print()

    elif command == "summary":
        if not entries:
            print("No entries yet.\n")
        else:
            entries_text = ""
            for e in entries:
                entries_text += f"\n[{e['timestamp']}] {e['reporter']}:\n"
                entries_text += f"  Raw: {e['raw_text']}\n"
                for cat, detail in e['categories'].items():
                    entries_text += f"  {cat}: {detail}\n"

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
            print(f"\n{'='*50}")
            print("DOCTOR VISIT SUMMARY")
            print(f"{'='*50}")
            print(f"\n{response.content[0].text}\n")
    elif command == "ask":
        if not entries:
            print("No entries yet.\n")
        else:
            question = input("What do you want to know? ")
            print("\nSearching relevant entries...")
            relevant = search_entries(question)

            if not relevant:
                print("No relevant entries found.\n")
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
                print(f"\n{response.content[0].text}\n")

    elif command == "rebuild":
        rebuild_db(entries)
        print()
    else:
            print("Commands: log, view, summary, ask, rebuild, quit\n")
