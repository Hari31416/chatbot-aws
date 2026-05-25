from __future__ import annotations

import argparse
import logging
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.vector_store import VectorStoreClient

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create the S3 Vectors bucket and index used for RAG."
    )
    parser.add_argument("--region", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--index", required=True)
    parser.add_argument("--embedding-model", default="gemini/gemini-embedding-2")
    parser.add_argument("--dimension", type=int, default=768)
    args = parser.parse_args()

    client = VectorStoreClient(
        region_name=args.region,
        vector_bucket=args.bucket,
        index_name=args.index,
        embedding_model=args.embedding_model,
        dimension=args.dimension,
    )
    client.initialize_storage()


if __name__ == "__main__":
    main()
