#!/usr/bin/env python3
"""Compute oxygen economy fit bands for distance and per-split costs."""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

LOGGER = logging.getLogger(__name__)
DEFAULT_PROPULSION_FILE = Path("data/dashboard_data/05_propulsion_fit.json")
DEFAULT_OUTPUT = Path("data/dashboard_data/06_distance_fit_bands.json")
DEFAULT_SPLIT_DISTANCE = 50.0
MIN_POINTS = 5
SAMPLE_COUNT = 25


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--propulsion-file", type=Path, default=DEFAULT_PROPULSION_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        help="Restrict processing to specific datasets (can be provided multiple times).",
    )
    parser.add_argument("--split-distance", type=float, default=DEFAULT_SPLIT_DISTANCE)
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)

    if not args.propulsion_file.exists():
        LOGGER.error("Propulsion fit file missing: %s", args.propulsion_file)
        return 1
    with args.propulsion_file.open("r", encoding="utf-8") as handle:
        try:
            payload = json.load(handle)
        except json.JSONDecodeError as exc:
            LOGGER.error("Failed to parse %s: %s", args.propulsion_file, exc)
            return 1

    datasets = args.datasets or sorted(payload.keys())
    output: Dict[str, dict] = {}
    for dataset in datasets:
        entry = payload.get(dataset)
        if not entry:
            LOGGER.warning("Dataset %s missing in %s", dataset, args.propulsion_file)
            continue
        attempts = entry.get("attempts")
        if not isinstance(attempts, list):
            LOGGER.warning("Dataset %s lacks attempts array", dataset)
            continue
        distance_points = build_distance_points(attempts, split_distance=args.split_distance)
        cost_points = build_cost_points(attempts)
        dataset_payload: Dict[str, dict] = {}
        if len(distance_points) < MIN_POINTS:
            LOGGER.warning("%s: insufficient points for distance band (need %d, have %d)", dataset, MIN_POINTS, len(distance_points))
        else:
            distance_band = fit_distance_band(dataset, distance_points)
            if distance_band:
                dataset_payload["distance_fit_band"] = distance_band
        if len(cost_points) < MIN_POINTS:
            LOGGER.warning("%s: insufficient points for cost band (need %d, have %d)", dataset, MIN_POINTS, len(cost_points))
        else:
            cost_band = fit_cost_band(dataset, cost_points)
            if cost_band:
                dataset_payload["distance_cost_band"] = cost_band
        if dataset_payload:
            output[dataset] = dataset_payload

    if not output:
        LOGGER.error("No oxygen economy bands generated; aborting")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", args.output)
    return 0


def build_distance_points(attempts: List[dict], *, split_distance: float) -> List[tuple[float, float]]:
    points: List[tuple[float, float]] = []
    for attempt in attempts:
        try:
            actual = float(attempt.get("distance_m"))
            budget = float(attempt.get("sta_budget_s"))
            split_cost = float(attempt.get("split_o2_cost"))
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(value) and value > 0 for value in (actual, budget, split_cost)):
            continue
        predicted = (budget / split_cost) * split_distance
        if not math.isfinite(predicted):
            continue
        points.append((actual, predicted))
    return points


def build_cost_points(attempts: List[dict]) -> List[tuple[float, float]]:
    points: List[tuple[float, float]] = []
    for attempt in attempts:
        try:
            actual = float(attempt.get("distance_m"))
            split_cost = float(attempt.get("split_o2_cost"))
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(value) and value > 0 for value in (actual, split_cost)):
            continue
        points.append((actual, split_cost))
    return points


def fit_distance_band(dataset: str, points: List[tuple[float, float]]) -> dict | None:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    if len(xs) < MIN_POINTS:
        return None
    residuals = [y - x for x, y in points]
    residual_median = statistics.median(residuals)
    abs_dev = [abs(res - residual_median) for res in residuals]
    mad = statistics.median(abs_dev) if abs_dev else 0.0
    half_width = max(1.0, mad * 1.4826)
    coverage = compute_coverage(residuals, residual_median, half_width)
    target = 0.6
    iterations = 0
    while coverage < target and iterations < 12:
        half_width *= 1.2
        coverage = compute_coverage(residuals, residual_median, half_width)
        iterations += 1

    domain, start, end = build_domain(xs)
    samples = [format_sample(x, x + residual_median, half_width) for x in domain]
    LOGGER.info(
        "%s distance band: shift=%.3f width=%.3f coverage=%.2f points=%d",
        dataset,
        residual_median,
        half_width * 2,
        coverage,
        len(points),
    )
    return {
        "band_width": round(half_width * 2, 4),
        "samples": samples,
        "metadata": {
            "slope": 1.0,
            "intercept": round(residual_median, 4),
            "coverage_ratio": round(coverage, 3),
            "source_points": len(points),
            "x_min": round(start, 3),
            "x_max": round(end, 3),
            "label": "distance_fit",
        },
    }


def fit_cost_band(dataset: str, points: List[tuple[float, float]]) -> dict | None:
    xs = [x for x, _ in points]
    ys = [y for _, y in points]
    if len(xs) < MIN_POINTS:
        return None
    center_value = statistics.median(ys)
    residuals = [y - center_value for y in ys]
    abs_dev = [abs(res) for res in residuals]
    mad = statistics.median(abs_dev) if abs_dev else 0.0
    half_width = max(0.1, mad * 1.4826)
    coverage = compute_coverage(residuals, 0.0, half_width)
    target = 0.6
    iterations = 0
    while coverage < target and iterations < 12:
        half_width *= 1.2
        coverage = compute_coverage(residuals, 0.0, half_width)
        iterations += 1

    domain, start, end = build_domain(xs)
    samples = [format_sample(x, center_value, half_width) for x in domain]
    LOGGER.info(
        "%s cost band: slope=0 intercept=%.3f width=%.3f coverage=%.2f points=%d",
        dataset,
        center_value,
        half_width * 2,
        coverage,
        len(points),
    )
    return {
        "band_width": round(half_width * 2, 4),
        "samples": samples,
        "metadata": {
            "slope": 0.0,
            "intercept": round(center_value, 4),
            "coverage_ratio": round(coverage, 3),
            "source_points": len(points),
            "x_min": round(start, 3),
            "x_max": round(end, 3),
            "label": "distance_cost",
        },
    }


def compute_coverage(residuals: Iterable[float], median: float, half_width: float) -> float:
    residual_list = list(residuals)
    if not residual_list or half_width <= 0:
        return 0.0
    inside = sum(1 for res in residual_list if abs(res - median) <= half_width)
    return inside / len(residual_list)


def build_domain(xs: List[float]) -> tuple[List[float], float, float]:
    if not xs:
        return [], 0.0, 0.0
    min_x = min(xs)
    max_x = max(xs)
    span = max(max_x - min_x, 1.0)
    start = min_x
    end = max_x + max(10.0, span * 0.1)
    if math.isclose(start, end):
        end = start + 1.0
    step = (end - start) / max(1, SAMPLE_COUNT - 1)
    domain = [start + step * idx for idx in range(SAMPLE_COUNT)]
    return domain, start, end


def format_sample(x_value: float, center: float, half_width: float) -> dict:
    lower = center - half_width
    upper = center + half_width
    if lower > upper:
        lower, upper = upper, lower
    return {
        "x": round(x_value, 3),
        "center": round(center, 4),
        "lower": round(max(0.0, lower), 4),
        "upper": round(max(0.0, upper), 4),
    }


if __name__ == "__main__":
    raise SystemExit(main())
