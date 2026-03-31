"""Seed the database with two Care Circles:
  1. The real family circle (Mark)
  2. A demo circle with dummy data for presentations
"""
import sys
from datetime import datetime, timedelta
from database import engine, SessionLocal, Base
from models import CareCircle, User, Entry, Visit
from auth import hash_password

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# ── Circle 1: Mark (real family) ─────────────

mark_circle = db.query(CareCircle).filter(CareCircle.patient_name == "Mark").first()
if not mark_circle:
    mark_circle = CareCircle(name="Mark's Care Circle", patient_name="Mark")
    db.add(mark_circle)
    db.commit()
    db.refresh(mark_circle)
    print(f"Created circle: {mark_circle.name} (id={mark_circle.id})")
else:
    print(f"Circle already exists: {mark_circle.name} (id={mark_circle.id})")

admin = db.query(User).filter(User.username == "admin").first()
if not admin:
    admin = User(
        username="admin",
        password_hash=hash_password("admin123"),
        display_name="Jack",
        role="admin",
        relationship="son",
        circle_id=mark_circle.id,
    )
    db.add(admin)
    db.commit()
    print("Created admin user: username='admin', password='admin123', display_name='Jack'")
else:
    if not admin.circle_id:
        admin.circle_id = mark_circle.id
        db.commit()
    print("Admin user already exists.")

# ── Circle 2: Demo (Margaret) ───────────────

demo_circle = db.query(CareCircle).filter(CareCircle.patient_name == "Margaret").first()
if not demo_circle:
    demo_circle = CareCircle(name="Margaret's Care Circle", patient_name="Margaret")
    db.add(demo_circle)
    db.commit()
    db.refresh(demo_circle)
    print(f"\nCreated demo circle: {demo_circle.name} (id={demo_circle.id})")
else:
    print(f"\nDemo circle already exists: {demo_circle.name} (id={demo_circle.id})")

demo_users_data = [
    ("demo_admin", "demo123", "Sarah", "admin", "daughter"),
    ("demo_tom", "demo123", "Tom", "user", "son"),
    ("demo_linda", "demo123", "Linda", "user", "wife"),
    ("demo_nurse", "demo123", "Nurse Rachel", "user", "home health aide"),
    ("demo_booboo", "baseball", "Margaret", "patient", "patient"),
]

demo_users = {}
for uname, pwd, display, role, rel in demo_users_data:
    u = db.query(User).filter(User.username == uname).first()
    if not u:
        u = User(
            username=uname,
            password_hash=hash_password(pwd),
            display_name=display,
            role=role,
            relationship=rel,
            circle_id=demo_circle.id,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        print(f"  Created demo user: {uname} ({display}, {role})")
    else:
        print(f"  Demo user already exists: {uname}")
    demo_users[display] = u

today = datetime.now().date()

existing_entries = db.query(Entry).filter(Entry.circle_id == demo_circle.id).count()
if existing_entries > 0:
    print(f"\n  Demo entries already exist ({existing_entries}). Skipping.")
else:
    demo_entries = [
        (-14, "Linda", "Mom had a really good morning today. She was humming in the kitchen and even remembered to water her plants without me reminding her. She asked about the grandkids and what they were up to in school.", {"mood": "Good mood, humming and engaged", "cognition": "Remembered to water plants independently", "social": "Asked about grandchildren"}),
        (-13, "Tom", "Visited Mom today. She seemed a bit confused about what day it was but once we got talking she was pretty sharp. We looked through old photos and she remembered most of the people. She did call me David a couple times (that's Dad's name).", {"cognition": "Confused about the day, called Tom by his father's name", "mood": "Engaged during photo activity", "social": "Enjoyed looking through old photos"}),
        (-12, "Nurse Rachel", "Vitals normal. BP 128/82. Weight stable at 142 lbs. Margaret reports sleeping well. Noticed slight unsteadiness when she stood up from the chair — reminded her to use the grab bar. Medication compliance is good, pill organizer was correctly used.", {"medication": "Good compliance, pill organizer used correctly", "physical_activity": "Slight unsteadiness when standing, reminded about grab bar", "sleep": "Reports sleeping well"}),
        (-11, "Margaret", "Daily Check-In:\nMental: 5/7\nFeeling: Normal, Calm\nPhysical: 4/7\nBody: Stiff, Achy\nKnees were bothering me again today. I sat in the garden for a while and that helped. Linda brought over soup for dinner which was nice.", {"mood": "Calm, normal", "physical_activity": "Knee pain, sat in garden", "meals": "Linda brought soup for dinner", "social": "Linda visited with soup"}),
        (-10, "Sarah", "Called Mom this morning. She sounded good but told me she had already eaten breakfast, and then Linda told me she hadn't — she just forgot she hadn't eaten yet. I reminded Linda to keep an eye on that. Otherwise Mom said she slept great and was planning to watch her shows.", {"cognition": "Told Sarah she had eaten breakfast but hadn't", "meals": "May have skipped breakfast, needs monitoring", "sleep": "Reported sleeping well"}),
        (-9, "Linda", "Rough morning. Margaret woke up disoriented and didn't recognize the bedroom for a few minutes. She was anxious until I turned on the lights and talked her through it. After about 20 minutes she was fine and ate a full breakfast. The rest of the day was normal.", {"cognition": "Woke up disoriented, didn't recognize bedroom", "mood": "Anxious upon waking, settled after 20 minutes", "meals": "Ate full breakfast after settling", "incidents": "Disorientation episode upon waking"}),
        (-8, "Margaret", "Daily Check-In:\nMental: 4/7\nFeeling: Foggy, Confused\nPhysical: 5/7\nBody: Normal\nI don't remember what happened this morning too well. Linda says I was confused but I feel fine now. Watched my cooking show and made a grocery list.", {"mood": "Foggy and confused earlier, fine later", "cognition": "Doesn't remember morning disorientation episode"}),
        (-7, "Nurse Rachel", "Weekly check-in. BP slightly elevated at 138/88 — will monitor. Margaret seemed in good spirits. She was telling me about a recipe she wanted to try. Gait is stable with her walker. Reviewed medications — all on track. Noted small bruise on left forearm, Linda says she bumped the kitchen counter.", {"medication": "All on track", "physical_activity": "Gait stable with walker", "incidents": "Small bruise on left forearm from bumping kitchen counter"}),
        (-6, "Tom", "Took Mom to the park today. She loved it — was pointing out the birds and even remembered the name of that big oak tree we used to climb as kids. She got tired after about 30 minutes and we headed back. She napped for almost 2 hours after.", {"mood": "Loved the park, engaged and happy", "cognition": "Remembered childhood oak tree", "physical_activity": "Tired after 30 min walk, napped 2 hours", "social": "Enjoyed outing with Tom"}),
        (-5, "Linda", "Margaret was a bit snappy today. She got frustrated when she couldn't find her reading glasses (they were on her head). She also refused to take her afternoon meds at first but eventually took them after I brought her some tea. I think she's just having an off day.", {"mood": "Irritable, frustrated about glasses", "cognition": "Couldn't find glasses that were on her head", "medication": "Initially refused afternoon meds, took them later with tea"}),
        (-4, "Sarah", "Mom called me today which is unusual — she normally doesn't initiate calls. She wanted to tell me about a dream she had about Dad. She sounded a little sad but said talking about it made her feel better. She also asked me to bring her that lavender lotion she likes next time I visit.", {"mood": "Slightly sad, talking about deceased husband", "social": "Initiated phone call to Sarah, which is unusual", "cognition": "Remembered specific lotion preference"}),
        (-3, "Margaret", "Daily Check-In:\nMental: 6/7\nFeeling: Happy, Hopeful\nPhysical: 5/7\nBody: Normal, Well-Rested\nI talked to Sarah yesterday and it made me feel good. Tom is coming over this weekend. I tried that new recipe for banana bread and it turned out pretty well. Linda helped a little.", {"mood": "Happy and hopeful", "social": "Looking forward to Tom's visit", "meals": "Made banana bread with Linda's help"}),
        (-2, "Nurse Rachel", "Margaret in excellent spirits today. BP back to normal at 126/80. She proudly showed me the banana bread she made. Cognitively she seems sharp today — she recalled all her medications by name and knew what each one was for. Left forearm bruise is healing well.", {"medication": "Recalled all medications by name and purpose", "mood": "Excellent spirits, proud of baking", "physical_activity": "Bruise healing well"}),
        (-1, "Linda", "Good day overall. Margaret and I did a jigsaw puzzle together and she was very focused. She did get a little mixed up about whether it was morning or afternoon around 3pm but corrected herself. Ate well — had oatmeal for breakfast, sandwich for lunch, and I made chicken and vegetables for dinner.", {"cognition": "Slight time confusion around 3pm, self-corrected", "social": "Did jigsaw puzzle together, very focused", "meals": "Ate three full meals"}),
        (0, "Tom", "Spent the day with Mom. She was in a great mood and we watched old home movies. She remembered so many details — even the name of our dog from when I was a kid. She did ask where Dad was once, and when I reminded her she got quiet for a minute but then moved on. Overall a really nice day.", {"mood": "Great mood, got quiet when reminded about husband", "cognition": "Strong long-term memories, asked about deceased husband", "social": "Watched home movies together"}),
    ]

    for days_ago, reporter, raw_text, categories in demo_entries:
        entry_date = (today + timedelta(days=days_ago)).strftime("%Y-%m-%d")
        user = demo_users[reporter]
        entry = Entry(
            circle_id=demo_circle.id,
            timestamp=entry_date,
            reporter=reporter,
            raw_text=raw_text,
            categories=categories,
            created_by=user.id,
        )
        db.add(entry)

    db.commit()
    print(f"  Created {len(demo_entries)} demo entries.")

existing_visits = db.query(Visit).filter(Visit.circle_id == demo_circle.id).count()
if existing_visits > 0:
    print(f"  Demo visits already exist ({existing_visits}). Skipping.")
else:
    demo_visits = [
        {
            "doctor_name": "Dr. Patel",
            "date": (today - timedelta(days=10)).strftime("%Y-%m-%d"),
            "transcript": "Routine check-up with Dr. Patel. Discussed Margaret's recent disorientation episodes. Doctor said occasional morning confusion is common at this stage and not alarming on its own, but to keep tracking frequency. Reviewed medications — no changes needed. Recommended continuing daily walks and social engagement. Follow up in 6 weeks.",
            "key_takeaways": "• Morning disorientation episodes are within expected range but should be tracked\n• No medication changes\n• Continue daily walks and social activities\n• Follow-up appointment in 6 weeks\n• Call if disorientation episodes increase in frequency or duration",
            "created_by": demo_users["Sarah"].id,
        },
        {
            "doctor_name": "Dr. Nguyen",
            "date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
            "transcript": "Saw Dr. Nguyen (orthopedic) about Margaret's knee pain. X-rays show mild arthritis, nothing severe. Recommended glucosamine supplement and gentle stretching exercises. Said the walking is good but to limit it to 20-30 minutes at a time. Prescribed a topical anti-inflammatory cream for bad days. No need for follow-up unless pain worsens significantly.",
            "key_takeaways": "• Mild knee arthritis confirmed on X-ray\n• Start glucosamine supplement daily\n• Gentle stretching exercises recommended\n• Limit walks to 20-30 minutes\n• Topical anti-inflammatory cream prescribed for flare-ups\n• No follow-up needed unless pain significantly worsens",
            "created_by": demo_users["Linda"].id,
        },
    ]

    for v in demo_visits:
        visit = Visit(
            circle_id=demo_circle.id,
            doctor_name=v["doctor_name"],
            date=v["date"],
            transcript=v["transcript"],
            key_takeaways=v["key_takeaways"],
            created_by=v["created_by"],
        )
        db.add(visit)

    db.commit()
    print(f"  Created {len(demo_visits)} demo visits.")

print("\nDone! Login credentials:")
print("  Family circle (Mark):     admin / admin123")
print("  Demo circle (Margaret):   demo_admin / demo123")
print("  Demo family:              demo_tom / demo_linda / demo_nurse (all demo123), demo_boobo / baseball")

db.close()
