#!/usr/bin/env python3
"""Compute weighted split times for each competition dataset.

The resulting JSON structure is consumed by the web UI (distance/time chart and split
summaries). Splits are computed by averaging the available athlete split checkpoints
weighted by the total distance completed on the attempt.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence

import pandas as pd

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
    "DYNB": "DYNB.csv",
}
SPLIT_PATTERN = re.compile(r"^T(\d+)$", re.IGNORECASE)
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_OUTPUT = Path("data/dashboard_data/01_split_stats.json")
DEFAULT_STA_FILE = DEFAULT_DATA_ROOT / "STA_PB.csv"
MIN_STA_SAMPLES = 3


@dataclass(frozen=True)
class SplitStat:
    split_label: str
    split_distance_m: int
    weighted_time_s: float
    weighted_time_str: str
    samples: int

    def to_dict(self) -> dict:
        return {
            "split_label": self.split_label,
            "split_distance_m": self.split_distance_m,
            "weighted_time_s": self.weighted_time_s,
            "weighted_time_str": self.weighted_time_str,
            "samples": self.samples,
        }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help="Directory that contains the competition CSV files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Destination for the generated 01_split_stats.json file.",
    )
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASET_FILES.keys()),
        help="Restrict processing to a specific dataset (can be provided multiple times).",
    )
    parser.add_argument(
        "--sta-file",
        type=Path,
        default=DEFAULT_STA_FILE,
        help="CSV file with STA PB references (defaults to STA_PB.csv).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging.",
    )
    return parser.parse_args(argv)


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    datasets = args.datasets or sorted(DATASET_FILES.keys())

    data_root = args.data_root
    output_path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sta_lookup = load_sta_lookup(args.sta_file)

    model_params: Dict[str, dict] = {}
    for dataset in datasets:
        csv_path = data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        LOGGER.info("Processing %s (%s)", dataset, csv_path)
        frame = pd.read_csv(csv_path)
        payload: Dict[str, object] = {}

        split_stats = compute_dataset_splits(frame)
        if split_stats:
            payload["splits"] = [stat.to_dict() for stat in split_stats]
        else:
            LOGGER.warning("No split stats computed for %s", dataset)

        sta_projection = compute_sta_projection_params(dataset, frame, sta_lookup)
        if sta_projection:
            payload["sta_projection"] = sta_projection
        elif sta_lookup:
            LOGGER.warning("No STA projection derived for %s", dataset)

        if payload:
            model_params[dataset] = payload

    if not model_params:
        LOGGER.error("No datasets processed successfully; aborting")
        return 1

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(model_params, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", output_path)
    return 0


def compute_dataset_splits(frame: pd.DataFrame) -> List[SplitStat]:
    if "Dist" not in frame.columns:
        raise ValueError("Dataset missing Dist column required for weighting")
    split_columns = identify_split_columns(frame.columns)
    if not split_columns:
        return []
    distances = pd.to_numeric(frame["Dist"], errors="coerce")
    stats: List[SplitStat] = []
    for distance_m, column in split_columns:
        if column not in frame:
            continue
        times = frame[column].apply(parse_time_to_seconds)
        valid_mask = times.notna() & distances.notna()
        if not valid_mask.any():
            continue
        weighted_total = float((times[valid_mask] * distances[valid_mask]).sum())
        weight_sum = float(distances[valid_mask].sum())
        if weight_sum <= 0:
            continue
        weighted_seconds = weighted_total / weight_sum
        stats.append(
            SplitStat(
                split_label=column,
                split_distance_m=distance_m,
                weighted_time_s=round(weighted_seconds, 3),
                weighted_time_str=format_seconds(weighted_seconds),
                samples=int(valid_mask.sum()),
            )
        )
    return stats


def identify_split_columns(columns: Iterable[str]) -> List[tuple[int, str]]:
    splits: List[tuple[int, str]] = []
    for column in columns:
        if not isinstance(column, str):
            continue
        match = SPLIT_PATTERN.match(column.strip())
        if not match:
            continue
        splits.append((int(match.group(1)), column))
    splits.sort(key=lambda item: item[0])
    return splits


def parse_time_to_seconds(value) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return math.nan
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value < 0:
            return math.nan
        return float(value)
    value_str = str(value).strip()
    if not value_str or value_str == "-":
        return math.nan
    parts = value_str.split(":")
    seconds = 0.0
    multiplier = 1.0
    try:
        for part in reversed(parts):
            seconds += float(part) * multiplier
            multiplier *= 60.0
    except ValueError:
        return math.nan
    return seconds


def format_seconds(total_seconds: float) -> str:
    if not isinstance(total_seconds, (int, float)) or not math.isfinite(total_seconds):
        return "-"
    minutes, seconds = divmod(total_seconds, 60)
    seconds = int(round(seconds))
    minutes = int(minutes)
    if seconds == 60:
        minutes += 1
        seconds = 0
    return f"{minutes}:{seconds:02d}"


def compute_sta_projection_params(dataset: str, frame: pd.DataFrame, sta_lookup: Dict[str, float]) -> dict | None:
    samples = extract_sta_samples(frame, sta_lookup)
    if len(samples) < MIN_STA_SAMPLES:
        return None

    sta_values = [sample[0] for sample in samples]
    distances = [sample[1] for sample in samples]
    sta_min = min(sta_values)
    sta_max = max(sta_values)
    sta_span = max(sta_max - sta_min, 1.0)
    dist_min = min(distances)
    dist_max = max(distances)
    dist_median = statistics.median(distances)
    range_ratio = (dist_max - dist_min) / sta_span
    spread = max(0.0, dist_max - dist_median)
    slope = max(0.05, range_ratio + 0.0003 * spread + 0.02)
    offset = sta_min
    angle = math.degrees(math.atan(slope))

    return {
        "slope": round(slope, 6),
        "offset_seconds": round(offset, 3),
        "angle_degrees": round(angle, 3),
        "sta_seconds_min": sta_min,
        "sta_seconds_max": sta_max,
        "distance_min": dist_min,
        "distance_max": dist_max,
        "distance_median": dist_median,
        "sample_count": len(samples),
    }


def extract_sta_samples(frame: pd.DataFrame, sta_lookup: Dict[str, float]) -> List[tuple[float, float]]:
    samples: List[tuple[float, float]] = []
    for _, row in frame.iterrows():
        name = normalize_name(row.get("Name"))
        if not name:
            continue
        sta_seconds = sta_lookup.get(name)
        if sta_seconds is None:
            continue
        distance = row.get("Dist")
        try:
            distance_val = float(distance)
        except (TypeError, ValueError):
            continue
        if math.isnan(distance_val):
            continue
        samples.append((float(sta_seconds), distance_val))
    return samples


def load_sta_lookup(csv_path: Path) -> Dict[str, float]:
    if not csv_path.exists():
        LOGGER.warning("STA roster missing: %s", csv_path)
        return {}
    frame = pd.read_csv(csv_path)
    lookup: Dict[str, float] = {}
    for _, row in frame.iterrows():
        name = normalize_name(row.get("Name"))
        seconds = parse_time_to_seconds(row.get("STA"))
        if name and seconds is not None and math.isfinite(seconds):
            lookup[name] = float(seconds)
    return lookup


def normalize_name(value) -> str:
    return str(value or "").strip().lower()


if __name__ == "__main__":
    sys.exit(main())
