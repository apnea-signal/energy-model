"""Utilities for reading and validating apnea competition datasets."""

from __future__ import annotations

from pathlib import Path
from typing import Dict, TypedDict

import pandas as pd


class DatasetPaths(TypedDict, total=False):
    """Named references to the CSV sources used across project scripts and modules."""

    athletes: Path
    dnf: Path
    dynb: Path


def load_competition_data(base_path: Path) -> Dict[str, pd.DataFrame]:
    """Load all known CSV datasets under ``base_path`` and return dataframes keyed by name."""

    paths: DatasetPaths = {
        "athletes": base_path / "athletes_and_pbs.csv",
        "dnf": base_path / "DNF.csv",
        "dynb": base_path / "DYNB.csv",
    }

    frames: Dict[str, pd.DataFrame] = {}
    for name, csv_path in paths.items():
        if not csv_path.exists():
            continue
        frames[name] = pd.read_csv(csv_path)
    return frames


def ensure_expected_columns(frame: pd.DataFrame, required: set[str]) -> None:
    """Raise ``ValueError`` if required columns are missing from the given frame."""

    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")
