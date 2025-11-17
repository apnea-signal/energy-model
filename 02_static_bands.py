#!/usr/bin/env python3
"""Build STA-vs-distance projection bands for each dataset."""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Mapping, Sequence

import pandas as pd

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
    "DYNB": "DYNB.csv",
}
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_STA_FILE = DEFAULT_DATA_ROOT / "STA_PB.csv"
DEFAULT_SETTINGS = Path("web/sta_band_settings.json")
DEFAULT_OUTPUT = Path("web/dashboard_data/02_static_bands.json")
SAMPLE_COUNT = 25
MIN_POINTS = 3


@dataclass
class StaSample:
    name: str
    sta_seconds: float
    distance_m: float


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--sta-file", type=Path, default=DEFAULT_STA_FILE)
    parser.add_argument("--settings", type=Path, default=DEFAULT_SETTINGS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASET_FILES.keys()),
        help="Restrict processing to a specific dataset (can be provided multiple times).",
    )
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    data_root = args.data_root
    datasets = args.datasets or sorted(DATASET_FILES.keys())

    sta_lookup = load_sta_lookup(args.sta_file)
    if not sta_lookup:
        LOGGER.error("STA roster %s has no parsable entries", args.sta_file)
        return 1
    settings = load_settings(args.settings)
    if not settings:
        LOGGER.error("STA band settings missing %s", args.settings)
        return 1

    output_payload: Dict[str, Dict[str, object]] = {}
    for dataset in datasets:
        csv_path = data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        frame = pd.read_csv(csv_path)
        samples = extract_sta_samples(frame, sta_lookup)
        if len(samples) < MIN_POINTS:
            LOGGER.warning("Skipping %s – insufficient STA-linked rows", dataset)
            continue
        config = settings.get(dataset)
        if not config:
            LOGGER.warning("Skipping %s – no settings entry", dataset)
            continue
        sta_band = build_sta_band(dataset, samples, config)
        if not sta_band:
            continue
        output_payload.setdefault(dataset, {})["sta_band"] = sta_band

    if not output_payload:
        LOGGER.error("No STA band data produced; aborting")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(output_payload, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", args.output)
    return 0


def load_sta_lookup(csv_path: Path) -> Dict[str, dict]:
    if not csv_path.exists():
        LOGGER.error("STA roster missing: %s", csv_path)
        return {}
    frame = pd.read_csv(csv_path)
    lookup: Dict[str, dict] = {}
    for _, row in frame.iterrows():
        name = normalize_name(row.get("Name"))
        seconds = parse_time_to_seconds(row.get("STA"))
        if not name or not math.isfinite(seconds):
            continue
        lookup[name] = {
            "seconds": seconds,
            "raw": row.get("STA"),
            "year": row.get("STA_YEAR"),
        }
    return lookup


def load_settings(settings_path: Path) -> dict:
    if not settings_path.exists():
        LOGGER.error("Settings file missing: %s", settings_path)
        return {}
    with settings_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def extract_sta_samples(frame: pd.DataFrame, sta_lookup: Dict[str, dict]) -> List[StaSample]:
    samples: List[StaSample] = []
    for _, row in frame.iterrows():
        name = normalize_name(row.get("Name"))
        if not name:
            continue
        sta_entry = sta_lookup.get(name)
        if not sta_entry:
            continue
        distance = coerce_float(row.get("Dist"))
        if not math.isfinite(distance):
            continue
        samples.append(
            StaSample(
                name=name,
                sta_seconds=float(sta_entry["seconds"]),
                distance_m=float(distance),
            )
        )
    return samples


def build_sta_band(dataset: str, samples: List[StaSample], config: dict) -> dict | None:
    slope = slope_from_config(config, samples)
    offset = float(config.get("offset_seconds", 0) or 0)
    predictions = [slope * (sample.sta_seconds - offset) for sample in samples]
    baseline = statistics.median(sample.distance_m - pred for sample, pred in zip(samples, predictions))

    def predict(seconds: float) -> float:
        return slope * (seconds - offset) + baseline

    residuals = [sample.distance_m - predict(sample.sta_seconds) for sample in samples]
    residual_median = statistics.median(residuals)
    abs_deviation = [abs(res - residual_median) for res in residuals]
    mad = statistics.median(abs_deviation) if abs_deviation else 0.0
    half_width = max(5.0, mad * 1.4826)

    domain = build_domain(samples)
    sampled_curve = [
        format_sample(x_seconds, predict(x_seconds), half_width) for x_seconds in domain
    ]

    LOGGER.info(
        "%s: slope=%.3f offset=%.1f baseline=%.1f width=%.1f points=%d",
        dataset,
        slope,
        offset,
        baseline,
        half_width * 2,
        len(samples),
    )

    return {
        "band_width": round(half_width * 2, 3),
        "samples": sampled_curve,
        "metadata": {
            "angle_degrees": float(config.get("angle_degrees", 0) or 0),
            "offset_seconds": offset,
            "baseline": round(baseline, 3),
            "slope": round(slope, 5),
            "source_points": len(samples),
        },
    }


def slope_from_config(config: dict, samples: List[StaSample]) -> float:
    angle = float(config.get("angle_degrees", 0) or 0)
    slope = math.tan(math.radians(angle)) if angle else 0.0
    if slope > 0:
        return slope
    return fallback_slope(samples)


def fallback_slope(samples: List[StaSample]) -> float:
    xs = [sample.sta_seconds for sample in samples]
    ys = [sample.distance_m for sample in samples]
    if not xs or not ys:
        return 0.1
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)
    if x_span <= 0:
        return 0.1
    return max(0.05, y_span / x_span)


def build_domain(samples: List[StaSample]) -> List[float]:
    xs = sorted(sample.sta_seconds for sample in samples)
    if not xs:
        return []
    start = xs[0]
    end = xs[-1]
    if math.isclose(start, end):
        return [start, end]
    step = (end - start) / max(1, SAMPLE_COUNT - 1)
    return [start + step * idx for idx in range(SAMPLE_COUNT)]


def format_sample(x_seconds: float, center: float, half_width: float) -> dict:
    lower = max(0.0, center - half_width)
    upper = max(lower, center + half_width)
    return {
        "x": round(x_seconds, 3),
        "center": round(center, 3),
        "lower": round(lower, 3),
        "upper": round(upper, 3),
    }


def coerce_float(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def parse_time_to_seconds(value) -> float:
    if value is None:
        return float("nan")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value)
        return seconds if seconds >= 0 else float("nan")
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


def normalize_name(name) -> str:
    return str(name or "").strip().lower()


if __name__ == "__main__":
    sys.exit(main())
