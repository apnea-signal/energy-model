"""Simple console-based exploratory analysis helpers."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

import pandas as pd

from energy_model.data_loading import load_competition_data


EVENT_MAP = {
    "athletes": "athletes",
    "dnf": "dnf",
    "dynb": "dynb",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quick summaries of competition datasets.")
    parser.add_argument(
        "--dataset",
        choices=EVENT_MAP.keys(),
        default="dnf",
        help="Select which dataset to inspect.",
    )
    parser.add_argument(
        "--head",
        type=int,
        default=5,
        help="Number of rows to print from the top of the dataset.",
    )
    parser.add_argument(
        "--describe",
        action="store_true",
        help="Include pandas describe() output for numeric columns.",
    )
    parser.add_argument(
        "--columns",
        nargs="*",
        help="Optional subset of columns to display.",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=PROJECT_ROOT / "data" / "aida_greece_2025",
        help="Path to directory with competition CSV files.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frames = load_competition_data(args.data_root)
    frame = frames[EVENT_MAP[args.dataset]]

    selection = args.columns or frame.columns.tolist()
    print(f"Dataset: {args.dataset} | rows={len(frame)} | columns={len(frame.columns)}")
    print(frame[selection].head(args.head).to_string(index=False))

    if args.describe:
        desc = frame[selection].describe(include="all")
        print("\nSummary statistics:\n", desc)


if __name__ == "__main__":
    main()
