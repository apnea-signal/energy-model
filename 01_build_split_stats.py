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
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Mapping, Sequence

import pandas as pd

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
    "DYNB": "DYNB.csv",
}
SPLIT_PATTERN = re.compile(r"^T(\d+)$", re.IGNORECASE)
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_OUTPUT = Path("web/dashboard_data/01_split_stats.json")


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

    model_params: dict[str, dict[str, List[dict]]] = {}
    for dataset in datasets:
        csv_path = data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        LOGGER.info("Processing %s (%s)", dataset, csv_path)
        frame = pd.read_csv(csv_path)
        split_stats = compute_dataset_splits(frame)
        if not split_stats:
            LOGGER.warning("No split stats computed for %s", dataset)
            continue
        model_params[dataset] = {"splits": [stat.to_dict() for stat in split_stats]}

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


if __name__ == "__main__":
    sys.exit(main())
