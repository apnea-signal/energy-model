"""Feature engineering helpers shared between notebooks and scripts."""

from __future__ import annotations

import pandas as pd


def add_split_pace(frame: pd.DataFrame, distance_col: str, time_col: str) -> pd.DataFrame:
    """Return a copy with a derived pace column (meters per second)."""

    df = frame.copy()
    df["pace_mps"] = df[distance_col] / pd.to_timedelta(df[time_col]).dt.total_seconds()
    return df


def compute_efficiency(frame: pd.DataFrame, distance_col: str, stroke_col: str) -> pd.DataFrame:
    """Return copy with distance-per-stroke efficiency metric."""

    df = frame.copy()
    df["distance_per_stroke"] = df[distance_col] / df[stroke_col]
    return df
