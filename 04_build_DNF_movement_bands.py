#!/usr/bin/env python3
"""Fit banded regressions for movement intensity vs distance and leg-vs-arm work bias."""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence

import pandas as pd

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
}
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_MOVEMENT_FILE = Path("data/dashboard_data/03_movement_intensity.json")
DEFAULT_OUTPUT = Path("data/dashboard_data/04_movement_bands.json")
MIN_POINTS = 5
SAMPLE_COUNT = 25


@dataclass
class MovementSample:
    name: str
    distance_m: float
    movement_intensity: float | None
    arm_work_total: float | None
    leg_work_total: float | None
    leg_arm_work_ratio: float | None

    @property
    def work_bias(self) -> float | None:
        if self.leg_arm_work_ratio is not None and math.isfinite(self.leg_arm_work_ratio):
            return self.leg_arm_work_ratio
        if self.arm_work_total is None or self.leg_work_total is None:
            return None
        if self.arm_work_total == 0:
            return None
        return self.leg_work_total / self.arm_work_total


@dataclass
class BandResult:
    name: str
    payload: dict


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--movement-file", type=Path, default=DEFAULT_MOVEMENT_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASET_FILES.keys()),
        help="Restrict processing to specific datasets (can be provided multiple times).",
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

    movement_payload = load_movement_payload(args.movement_file)
    if not movement_payload:
        LOGGER.error("Movement intensity file missing or empty: %s", args.movement_file)
        return 1

    output: Dict[str, dict] = {}
    for dataset in datasets:
        csv_path = args.data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        movement_dataset = movement_payload.get(dataset, {})
        athlete_rows = movement_dataset.get("athletes")
        if not isinstance(athlete_rows, list):
            LOGGER.warning("Skipping %s – missing athletes list in %s", dataset, args.movement_file)
            continue
        frame = pd.read_csv(csv_path)
        samples = build_samples(frame, athlete_rows)
        if not samples:
            LOGGER.warning("Skipping %s – no overlapping movement samples", dataset)
            continue
        bands = build_bands(samples, dataset=dataset)
        if bands:
            output[dataset] = bands

    if not output:
        LOGGER.error("No movement bands were generated; aborting")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", args.output)
    return 0


def load_movement_payload(path: Path) -> dict:
    if not path.exists():
        LOGGER.error("Movement file missing: %s", path)
        return {}
    with path.open("r", encoding="utf-8") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError as exc:
            LOGGER.error("Failed to parse %s: %s", path, exc)
            return {}


def build_samples(frame: pd.DataFrame, movement_rows: List[dict]) -> List[MovementSample]:
    distance_lookup = {}
    for _, row in frame.iterrows():
        key = normalize_name(row.get("Name"))
        distance = row.get("Dist")
        try:
            distance_val = float(distance)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(distance_val):
            continue
        if key:
            distance_lookup[key] = distance_val

    samples: List[MovementSample] = []
    for entry in movement_rows:
        name = entry.get("name") or entry.get("Name")
        key = normalize_name(name)
        if not key:
            continue
        distance = distance_lookup.get(key)
        if not math.isfinite(distance):
            continue
        movement_intensity = coerce_float(entry.get("movement_intensity"))
        arm_work_total = coerce_float(entry.get("arm_work_total"))
        leg_work_total = coerce_float(entry.get("leg_work_total"))
        leg_arm_work_ratio = coerce_float(entry.get("leg_arm_work_ratio"))
        samples.append(
            MovementSample(
                name=str(name),
                distance_m=float(distance),
                movement_intensity=movement_intensity if math.isfinite(movement_intensity) else None,
                arm_work_total=arm_work_total if math.isfinite(arm_work_total) else None,
                leg_work_total=leg_work_total if math.isfinite(leg_work_total) else None,
                leg_arm_work_ratio=leg_arm_work_ratio if math.isfinite(leg_arm_work_ratio) else None,
            )
        )
    return samples


def build_bands(samples: List[MovementSample], *, dataset: str) -> dict:
    movement_points = [
        (sample.distance_m, sample.movement_intensity)
        for sample in samples
        if sample.movement_intensity is not None
    ]
    work_bias_points = [
        (sample.distance_m, sample.work_bias)
        for sample in samples
        if sample.work_bias is not None
    ]

    payload: dict = {}
    movement_band = fit_band(dataset, "movement_intensity", movement_points)
    if movement_band:
        payload["movement_intensity_band"] = movement_band
    work_bias_band = fit_band(dataset, "work_bias", work_bias_points)
    if work_bias_band:
        payload["work_bias_band"] = work_bias_band
    return payload


def fit_band(dataset: str, label: str, points: List[tuple[float, float | None]]) -> dict | None:
    filtered = [(x, y) for x, y in points if x is not None and y is not None]
    if len(filtered) < MIN_POINTS:
        LOGGER.warning("%s: insufficient points for %s (need %d, have %d)", dataset, label, MIN_POINTS, len(filtered))
        return None
    xs = [float(x) for x, _ in filtered]
    ys = [float(y) for _, y in filtered]
    intercept = statistics.median(ys)
    slope = 0.0
    predictions = [intercept for _ in xs]
    residuals = [y - pred for y, pred in zip(ys, predictions)]
    residual_median = statistics.median(residuals)
    abs_dev = [abs(res - residual_median) for res in residuals]
    mad = statistics.median(abs_dev) if abs_dev else 0.0
    half_width = max(0.01, mad * 1.4826)
    coverage = compute_coverage(residuals, residual_median, half_width)
    target = 0.60
    iterations = 0
    while coverage < target and iterations < 10:
        half_width *= 1.2
        coverage = compute_coverage(residuals, residual_median, half_width)
        iterations += 1

    domain = build_domain(xs)
    samples = [format_sample(x, slope * x + intercept, half_width) for x in domain]

    LOGGER.info(
        "%s %s: intercept=%.3f width=%.3f coverage=%.2f points=%d",
        dataset,
        label,
        intercept,
        half_width * 2,
        coverage,
        len(filtered),
    )

    return {
        "band_width": round(half_width * 2, 4),
        "samples": samples,
        "metadata": {
            "slope": round(slope, 6),
            "intercept": round(intercept, 6),
            "coverage_ratio": round(coverage, 3),
            "source_points": len(filtered),
            "x_min": round(min(xs), 3),
            "x_max": round(max(xs), 3),
            "label": label,
        },
    }


def compute_coverage(residuals: Iterable[float], median: float, half_width: float) -> float:
    residual_list = list(residuals)
    if not residual_list or half_width <= 0:
        return 0.0
    inside = sum(1 for res in residual_list if abs(res - median) <= half_width)
    return inside / len(residual_list)


def build_domain(xs: List[float]) -> List[float]:
    if not xs:
        return []
    start = min(xs)
    end = max(xs)
    if math.isclose(start, end):
        return [start, end]
    step = (end - start) / max(1, SAMPLE_COUNT - 1)
    return [start + step * idx for idx in range(SAMPLE_COUNT)]


def format_sample(x_value: float, center: float, half_width: float) -> dict:
    lower = center - half_width
    upper = center + half_width
    if lower > upper:
        lower, upper = upper, lower
    return {
        "x": round(x_value, 3),
        "center": round(center, 4),
        "lower": round(lower, 4),
        "upper": round(upper, 4),
    }


def coerce_float(value) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float("nan")
    return number


def normalize_name(value) -> str:
    return str(value or "").strip().lower()


if __name__ == "__main__":
    raise SystemExit(main())
