import chromadb
import json

# Create the vector database (stored locally in a folder)
chroma_client = chromadb.PersistentClient(path="./carelog_db")

# Create or get the collection for care entries
collection = chroma_client.get_or_create_collection(name="care_entries")

def add_entry_to_db(entry, entry_id):
    """Store a care entry as a searchable embedding."""
    # Combine all the entry info into one searchable text
    text = f"{entry['reporter']} reported on {entry['timestamp']}: {entry['raw_text']}"
    for cat, detail in entry['categories'].items():
        text += f" [{cat}: {detail}]"

    collection.upsert(
        documents=[text],
        metadatas=[{
            "reporter": entry['reporter'],
            "timestamp": entry['timestamp'],
            "raw_text": entry['raw_text'],
            "categories": json.dumps(entry['categories'])
        }],
        ids=[str(entry_id)]
    )

def search_entries(query, n_results=5):
    """Find the most relevant entries for a question."""
    results = collection.query(
        query_texts=[query],
        n_results=n_results
    )

    entries = []
    if results and results['metadatas']:
        for meta in results['metadatas'][0]:
            entries.append({
                "reporter": meta['reporter'],
                "timestamp": meta['timestamp'],
                "raw_text": meta['raw_text'],
                "categories": json.loads(meta['categories'])
            })
    return entries

def rebuild_db(entries):
    """Rebuild the entire database from the JSON file."""
    # Clear existing data
    existing = collection.get()
    if existing['ids']:
        collection.delete(ids=existing['ids'])

    # Add all entries
    for i, entry in enumerate(entries):
        add_entry_to_db(entry, i)
    print(f"Database rebuilt with {len(entries)} entries.")

def get_entry_count():
    """How many entries are in the vector database."""
    return collection.count()