"""Shared helper utilities for dataset exploration scripts."""

from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from energy_model.data_loading import load_competition_data

DEFAULT_DATA_ROOT = PROJECT_ROOT / "data" / "aida_greece_2025"
DEFAULT_HEAD = 10
DEFAULT_DESCRIBE = True
DEFAULT_COLUMNS: list[str] | None = None


def load_dataset(name: str) -> pd.DataFrame:
    frames = load_competition_data(DEFAULT_DATA_ROOT)
    return frames[name]


def display_preview(frame: pd.DataFrame) -> None:
    selection = DEFAULT_COLUMNS or frame.columns.tolist()
    print(frame[selection].head(DEFAULT_HEAD).to_string(index=False))
    if DEFAULT_DESCRIBE:
        print("\nSummary statistics:\n", frame[selection].describe(include="all"))
