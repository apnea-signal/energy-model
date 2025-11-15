"""Compute weighted average split times for DNF and DYNB datasets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from energy_model.data_loading import load_competition_data

OUTPUT_PATH = PROJECT_ROOT / "data" / "derived" / "weighted_split_stats.json"
EVENTS = ("DNF", "DYNB")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute weighted average split times for apnea events.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=PROJECT_ROOT / "data" / "aida_greece_2025",
        help="Directory containing DNF.csv and DYNB.csv.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PATH,
        help="Path to the JSON file that will store the weighted stats.",
    )
    return parser.parse_args()


def extract_split_columns(frame: pd.DataFrame) -> List[Tuple[str, float]]:
    """Return list of (column, distance) pairs for split columns like T50, T100, ..."""

    split_cols: List[Tuple[str, float]] = []
    for col in frame.columns:
        if col.startswith("T") and col[1:].isdigit():
            split_cols.append((col, float(col[1:])))
    split_cols.sort(key=lambda item: item[1])
    return split_cols


def to_seconds(series: pd.Series) -> pd.Series:
    """Convert MM:SS or HH:MM:SS strings to seconds, returning NaN for invalid entries."""

    def parse(value: object) -> float:
        if pd.isna(value):
            return np.nan
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip()
        if not text or text == "-":
            return np.nan
        parts = text.split(":")
        try:
            numbers = [float(part) for part in parts]
        except ValueError:
            return np.nan
        if len(numbers) == 3:
            hours, minutes, seconds = numbers
        elif len(numbers) == 2:
            hours = 0.0
            minutes, seconds = numbers
        elif len(numbers) == 1:
            return numbers[0]
        else:
            return np.nan
        return hours * 3600 + minutes * 60 + seconds

    return series.apply(parse)


def weighted_average(values: pd.Series, weights: pd.Series) -> float | None:
    mask = values.notna() & weights.notna()
    if not mask.any():
        return None
    v = values[mask].astype(float)
    w = weights[mask].astype(float)
    total_weight = w.sum()
    if total_weight == 0:
        return None
    return float(np.average(v, weights=w))


def compute_event_stats(frame: pd.DataFrame, event: str) -> Dict[str, object]:
    weights = pd.to_numeric(frame["Dist"], errors="coerce")
    split_pairs = extract_split_columns(frame)
    rows: List[Dict[str, object]] = []

    prev_distance = 0.0
    prev_time = 0.0

    for col, distance in split_pairs:
        values = to_seconds(frame[col])
        wavg = weighted_average(values, weights)
        if wavg is None:
            continue
        delta_time = wavg - prev_time if prev_time is not None else None
        delta_distance = distance - prev_distance
        pace = (delta_distance / delta_time) if delta_time and delta_time > 0 else None
        rows.append(
            {
                "event": event,
                "split_label": col,
                "split_distance_m": distance,
                "weighted_time_s": wavg,
                "weighted_time_str": format_seconds(wavg),
                "delta_time_s": delta_time,
                "delta_distance_m": delta_distance,
                "split_pace_mps": pace,
            }
        )
        prev_distance = distance
        prev_time = wavg

    total_times = to_seconds(frame.get("TT"))
    avg_total_time = weighted_average(total_times, weights)
    avg_distance = weighted_average(pd.to_numeric(frame["Dist"], errors="coerce"), weights)
    summary = {}
    if avg_total_time is not None and avg_distance is not None and avg_total_time > 0:
        summary = {
            "event": event,
            "weighted_total_time_s": avg_total_time,
            "weighted_total_time_str": format_seconds(avg_total_time),
            "weighted_distance_m": avg_distance,
            "overall_pace_mps": avg_distance / avg_total_time,
        }

    return {"rows": rows, "summary": summary}


def format_seconds(total_seconds: float) -> str:
    minutes, seconds = divmod(int(round(total_seconds)), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:d}:{seconds:02d}"


def main() -> None:
    args = parse_args()
    frames = load_competition_data(args.data_root)

    all_rows: List[Dict[str, object]] = []
    summaries: List[Dict[str, object]] = []

    for event in EVENTS:
        frame = frames[event.lower()].copy()
        stats = compute_event_stats(frame, event)
        all_rows.extend(stats["rows"])
        if stats["summary"]:
            summaries.append(stats["summary"])

    payload = {"splits": all_rows, "summaries": summaries}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2))

    for summary in summaries:
        pace = summary.get("overall_pace_mps")
        pace_str = f"{pace:.3f} m/s" if pace else "n/a"
        print(
            f"{summary['event']} | dist={summary['weighted_distance_m']:.1f}m "
            f"time={summary['weighted_total_time_str']} pace={pace_str}"
        )


if __name__ == "__main__":
    main()
