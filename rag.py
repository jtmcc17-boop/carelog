import chromadb
import json

chroma_client = chromadb.PersistentClient(path="./carelog_db")
collection = chroma_client.get_or_create_collection(name="care_entries")


def add_entry(entry_id: int, circle_id: int, reporter: str, timestamp: str,
              raw_text: str, categories: dict):
    """Store a care entry as a searchable embedding, scoped to a care circle."""
    text = f"{reporter} reported on {timestamp}: {raw_text}"
    for cat, detail in categories.items():
        text += f" [{cat}: {detail}]"

    collection.upsert(
        documents=[text],
        metadatas=[{
            "circle_id": circle_id,
            "entry_id": entry_id,
            "reporter": reporter,
            "timestamp": timestamp,
            "raw_text": raw_text,
            "categories": json.dumps(categories),
        }],
        ids=[str(entry_id)],
    )


def search_entries(query: str, circle_id: int, n_results: int = 10) -> list[dict]:
    """Semantic search scoped to a single care circle."""
    results = collection.query(
        query_texts=[query],
        n_results=n_results,
        where={"circle_id": circle_id},
    )

    entries = []
    if results and results["metadatas"]:
        for meta in results["metadatas"][0]:
            entries.append({
                "entry_id": meta["entry_id"],
                "reporter": meta["reporter"],
                "timestamp": meta["timestamp"],
                "raw_text": meta["raw_text"],
                "categories": json.loads(meta["categories"]),
            })
    return entries


def rebuild_from_rows(rows: list[dict]):
    """Rebuild the vector store from a list of SQL-sourced entry dicts.

    Each dict must have: id, circle_id, reporter, timestamp, raw_text, categories.
    """
    existing = collection.get()
    if existing["ids"]:
        collection.delete(ids=existing["ids"])

    for row in rows:
        add_entry(
            entry_id=row["id"],
            circle_id=row["circle_id"],
            reporter=row["reporter"],
            timestamp=row["timestamp"],
            raw_text=row["raw_text"],
            categories=row["categories"] or {},
        )
    return len(rows)


def get_entry_count() -> int:
    """How many entries are in the vector database."""
    return collection.count()
