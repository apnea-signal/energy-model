#!/usr/bin/env python3
"""Estimate first-split arm and leg propulsion intensities for each DNF athlete."""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import pandas as pd

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Dict[str, str] = {
    "DNF": "DNF.csv",
}
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_OUTPUT = Path("data/dashboard_data/03_movement_intensity.json")
DEFAULT_SPLIT_DISTANCE_M = 50.0
DEFAULT_ARM_LEG_RATIO = 1.5  # assume one arm pull carries the load of 1.5 leg kicks


@dataclass(frozen=True)
class IntensityRecord:
    """Per-attempt metrics derived from the first 50 m split."""

    name: str
    normalized_name: str
    split_time_s: float
    split_speed_m_s: float
    arm_pulls: float
    leg_kicks: float
    arm_work_per_pull: float
    leg_work_per_kick: float | None
    arm_work_total: float
    leg_work_total: float
    leg_arm_work_ratio: float | None
    movement_intensity: float | None

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "split_time_s": round(self.split_time_s, 3),
            "split_speed_m_s": round(self.split_speed_m_s, 4),
            "arm_pulls": round(self.arm_pulls, 3),
            "leg_kicks": round(self.leg_kicks, 3),
            "arm_work_per_pull": round(self.arm_work_per_pull, 4),
            "leg_work_per_kick": round(self.leg_work_per_kick, 4) if self.leg_work_per_kick is not None else None,
            "arm_work_total": round(self.arm_work_total, 4),
            "leg_work_total": round(self.leg_work_total, 4),
            "leg_arm_work_ratio": round(self.leg_arm_work_ratio, 4) if self.leg_arm_work_ratio is not None else None,
            "movement_intensity": round(self.movement_intensity, 4) if self.movement_intensity is not None else None,
        }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASET_FILES.keys()),
        help="Restrict processing to specific datasets (can be provided multiple times).",
    )
    parser.add_argument(
        "--split-distance",
        type=float,
        default=DEFAULT_SPLIT_DISTANCE_M,
        help="Distance in meters for the opening split (defaults to 50 m).",
    )
    parser.add_argument(
        "--arm-leg-ratio",
        type=float,
        default=DEFAULT_ARM_LEG_RATIO,
        help="Arm-to-leg mechanical ratio (2.0 => one arm equals two leg kicks).",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    datasets = args.datasets or sorted(DATASET_FILES.keys())
    if args.split_distance <= 0:
        LOGGER.error("split_distance must be positive (got %s)", args.split_distance)
        return 1

    arm_leg_ratio = resolve_ratio(args.arm_leg_ratio)
    LOGGER.info("Using arm/leg ratio %.3f", arm_leg_ratio)

    payload: Dict[str, dict] = {}
    for dataset in datasets:
        csv_path = args.data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        frame = pd.read_csv(csv_path)
        records = compute_split_records(
            frame,
            split_distance_m=args.split_distance,
            arm_leg_ratio=arm_leg_ratio,
        )
        if not records:
            LOGGER.warning("No valid first-split entries for %s", dataset)
            continue
        summary = aggregate_by_athlete(records)
        payload[dataset] = {
            "metadata": build_metadata(records, split_distance=args.split_distance, arm_leg_ratio=arm_leg_ratio),
            "athletes": summary,
        }
        LOGGER.info(
            "%s: computed intensities for %d athletes (source rows=%d)",
            dataset,
            len(summary),
            len(frame),
        )

    if not payload:
        LOGGER.error("No datasets processed successfully; aborting")
        return 1

    output_path = args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", output_path)
    return 0


def resolve_ratio(override: float | None) -> float:
    if override is None or override <= 0:
        raise ValueError("arm_leg_ratio must be positive")
    return override


def compute_split_records(
    frame: pd.DataFrame,
    *,
    split_distance_m: float,
    arm_leg_ratio: float,
) -> List[IntensityRecord]:
    required_columns = {"Name", "T50", "A50", "ST_K", "ST_WK"}
    missing = required_columns.difference(frame.columns)
    if missing:
        raise ValueError(f"Missing columns required for intensity computation: {sorted(missing)}")

    records: List[IntensityRecord] = []
    for _, row in frame.iterrows():
        name = row.get("Name")
        normalized = normalize_name(name)
        if not normalized:
            continue
        split_seconds = parse_time_to_seconds(row.get("T50"))
        arm_pulls = coerce_float(row.get("A50"))
        st_k = max(0.0, coerce_float(row.get("ST_K")))
        wall_kicks = max(0.0, coerce_float(row.get("ST_WK")))
        if not (math.isfinite(split_seconds) and split_seconds > 0 and math.isfinite(arm_pulls) and arm_pulls > 0):
            continue
        leg_kicks = st_k * arm_pulls + wall_kicks
        speed = split_distance_m / split_seconds
        work_total = split_distance_m * speed * speed
        arm_share = compute_arm_share(arm_pulls, leg_kicks, arm_leg_ratio)
        arm_work = work_total * arm_share
        leg_work = work_total - arm_work
        arm_work_per_pull = arm_work / arm_pulls
        leg_work_per_kick = (leg_work / leg_kicks) if leg_kicks > 0 else None
        leg_arm_work_ratio = (leg_work / arm_work) if arm_work > 0 else None
        records.append(
            IntensityRecord(
                name=str(name),
                normalized_name=normalized,
                split_time_s=float(split_seconds),
                split_speed_m_s=float(speed),
                arm_pulls=float(arm_pulls),
                leg_kicks=float(leg_kicks),
                arm_work_per_pull=float(arm_work_per_pull),
                leg_work_per_kick=float(leg_work_per_kick) if leg_work_per_kick is not None else None,
                arm_work_total=float(arm_work),
                leg_work_total=float(leg_work),
                leg_arm_work_ratio=float(leg_arm_work_ratio) if leg_arm_work_ratio is not None else None,
                movement_intensity=None,
            )
        )
    if not records:
        return []

    arm_median = statistics.median(record.arm_work_per_pull for record in records)
    leg_values = [record.leg_work_per_kick for record in records if record.leg_work_per_kick is not None]
    leg_median = statistics.median(leg_values) if leg_values else None

    for idx, record in enumerate(records):
        arm_intensity = record.arm_work_per_pull / arm_median if arm_median else None
        leg_intensity = None
        if leg_median and record.leg_work_per_kick is not None:
            leg_intensity = record.leg_work_per_kick / leg_median
        movement_intensity = combine_intensities(arm_intensity, leg_intensity)
        records[idx] = IntensityRecord(
            name=record.name,
            normalized_name=record.normalized_name,
            split_time_s=record.split_time_s,
            split_speed_m_s=record.split_speed_m_s,
            arm_pulls=record.arm_pulls,
            leg_kicks=record.leg_kicks,
            arm_work_per_pull=record.arm_work_per_pull,
            leg_work_per_kick=record.leg_work_per_kick,
            arm_work_total=record.arm_work_total,
            leg_work_total=record.leg_work_total,
            leg_arm_work_ratio=record.leg_arm_work_ratio,
            movement_intensity=movement_intensity,
        )
    return records


def compute_arm_share(arm_pulls: float, leg_kicks: float, arm_leg_ratio: float) -> float:
    leg_term = max(leg_kicks, 0.0)
    numerator = arm_leg_ratio * arm_pulls
    denominator = numerator + leg_term
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def aggregate_by_athlete(records: Iterable[IntensityRecord]) -> List[dict]:
    grouped: Dict[str, List[IntensityRecord]] = {}
    for record in records:
        grouped.setdefault(record.normalized_name, []).append(record)

    athletes: List[dict] = []
    for normalized, entries in grouped.items():
        canonical_name = entries[0].name
        athletes.append(
            {
                "name": canonical_name,
                "samples": len(entries),
                "split_time_s": round(median([entry.split_time_s for entry in entries]), 3),
                "split_speed_m_s": round(median([entry.split_speed_m_s for entry in entries]), 4),
                "arm_pulls": round(median([entry.arm_pulls for entry in entries]), 3),
                "leg_kicks": round(median([entry.leg_kicks for entry in entries]), 3),
                "arm_work_per_pull": round(median([entry.arm_work_per_pull for entry in entries]), 4),
                "leg_work_per_kick": round(median_optional([entry.leg_work_per_kick for entry in entries]), 4)
                if any(entry.leg_work_per_kick is not None for entry in entries)
                else None,
                "arm_work_total": round(median([entry.arm_work_total for entry in entries]), 4),
                "leg_work_total": round(median([entry.leg_work_total for entry in entries]), 4),
                "leg_arm_work_ratio": round(median_optional([entry.leg_arm_work_ratio for entry in entries]), 4)
                if any(entry.leg_arm_work_ratio is not None for entry in entries)
                else None,
                "movement_intensity": round(median_optional([entry.movement_intensity for entry in entries]), 4)
                if any(entry.movement_intensity is not None for entry in entries)
                else None,
            }
        )
    athletes.sort(key=lambda item: normalize_name(item["name"]))
    return athletes


def build_metadata(
    records: List[IntensityRecord],
    *,
    split_distance: float,
    arm_leg_ratio: float,
) -> dict:
    split_time_median = median([record.split_time_s for record in records])
    arm_pull_median = median([record.arm_pulls for record in records])
    leg_kick_median = median([record.leg_kicks for record in records])
    arm_median = median([record.arm_work_per_pull for record in records])
    leg_median = median_optional([record.leg_work_per_kick for record in records])
    arm_total_median = median([record.arm_work_total for record in records])
    leg_total_median = median([record.leg_work_total for record in records])
    movement_median = median_optional([record.movement_intensity for record in records])
    total_work_median = None
    if arm_total_median is not None and leg_total_median is not None:
        total_work_median = arm_total_median + leg_total_median
    return {
        "split_distance_m": split_distance,
        "arm_leg_ratio": arm_leg_ratio,
        "split_time_s_median": round(split_time_median, 4) if split_time_median is not None else None,
        "arm_pulls_median": round(arm_pull_median, 4) if arm_pull_median is not None else None,
        "leg_kicks_median": round(leg_kick_median, 4) if leg_kick_median is not None else None,
        "arm_work_per_pull_median": round(arm_median, 4) if arm_median is not None else None,
        "leg_work_per_kick_median": round(leg_median, 4) if leg_median is not None else None,
        "arm_work_total_median": round(arm_total_median, 4) if arm_total_median is not None else None,
        "leg_work_total_median": round(leg_total_median, 4) if leg_total_median is not None else None,
        "total_work_per_split_median": round(total_work_median, 4) if total_work_median is not None else None,
        "movement_intensity_median": round(movement_median, 4) if movement_median is not None else None,
    }


def parse_time_to_seconds(value) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float("nan")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    if not text or text == "-":
        return float("nan")
    parts = text.split(":")
    seconds = 0.0
    multiplier = 1.0
    try:
        for part in reversed(parts):
            seconds += float(part) * multiplier
            multiplier *= 60.0
    except ValueError:
        return float("nan")
    return seconds


def coerce_float(value) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float("nan")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    if not text or text == "-":
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def normalize_name(value) -> str:
    return str(value or "").strip().lower()


def median(values: Iterable[float]) -> float | None:
    filtered = [value for value in values if math.isfinite(value)]
    if not filtered:
        return None
    return statistics.median(filtered)


def median_optional(values: Iterable[float | None]) -> float | None:
    filtered = [value for value in values if value is not None and math.isfinite(value)]
    if not filtered:
        return None
    return statistics.median(filtered)


def combine_intensities(*values: float | None) -> float | None:
    samples = [value for value in values if value is not None and math.isfinite(value)]
    if not samples:
        return None
    return float(sum(samples) / len(samples))


if __name__ == "__main__":
    raise SystemExit(main())
