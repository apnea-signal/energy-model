"""Export model parameters and inference-ready payloads for the D3 dashboards."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Sequence

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from energy_model.data_loading import load_competition_data
from energy_model.models import BaselineRegressor

DEFAULT_FEATURES = {
    "DNF": "ST_K",
    "DYNB": "TK",
}
TARGET_COLUMN = "Dist"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build JSON payloads used by the dashboard web pages.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=PROJECT_ROOT / "data" / "aida_greece_2025",
        help="Directory that contains DNF.csv, DYNB.csv, and athlete CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "web" / "dashboard_data",
        help="Directory where JSON payloads will be written.",
    )
    parser.add_argument(
        "--dnf-feature",
        default=DEFAULT_FEATURES["DNF"],
        help="Column name to treat as the explanatory variable for the DNF regression.",
    )
    parser.add_argument(
        "--dynb-feature",
        default=DEFAULT_FEATURES["DYNB"],
        help="Column name to treat as the explanatory variable for the DYNB regression.",
    )
    parser.add_argument(
        "--split-stats",
        type=Path,
        default=PROJECT_ROOT / "data" / "derived" / "weighted_split_stats.json",
        help="Optional JSON file with weighted split summaries (output of build_split_stats.py).",
    )
    parser.add_argument(
        "--skip-dependencies",
        action="store_true",
        help="Skip running other builder scripts before creating dashboard payloads.",
    )
    return parser.parse_args()


def sanitize_series(series: pd.Series) -> np.ndarray:
    """Convert a pandas series to a float numpy array with NaNs replaced by zeros."""

    numeric = pd.to_numeric(series, errors="coerce").fillna(0.0)
    return numeric.to_numpy(dtype=float)


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Return MAE, RMSE, and R^2 for the fitted predictions."""

    residuals = y_true - y_pred
    mae = float(np.mean(np.abs(residuals)))
    rmse = float(np.sqrt(np.mean(residuals**2)))
    total_var = np.sum((y_true - np.mean(y_true)) ** 2)
    ss_res = np.sum(residuals**2)
    r_squared = float(1 - ss_res / total_var) if total_var else 0.0
    return {"mae": mae, "rmse": rmse, "r_squared": r_squared}


def build_payloads(
    frames: Dict[str, pd.DataFrame],
    features: Dict[str, str],
    split_stats: dict | None,
    sta_frame: pd.DataFrame | None,
) -> tuple[dict, dict]:
    """Return model metadata and per-athlete inference dictionaries."""

    model_payload: dict = {}
    inference_payload: dict = {}

    for event, feature in features.items():
        frame = frames[event.lower()].copy()
        x = sanitize_series(frame[feature])
        y = sanitize_series(frame[TARGET_COLUMN])

        model = BaselineRegressor().fit(x, y)
        predictions = model.predict(x)
        metrics = regression_metrics(y, predictions)

        splits_for_event = extract_split_stats(split_stats, event)
        sta_band = compute_sta_band(frame, sta_frame)

        model_payload[event] = {
            "feature": feature,
            "target": TARGET_COLUMN,
            "slope": float(model.slope),
            "intercept": float(model.intercept),
            "count": int(len(frame)),
            "feature_range": [float(np.min(x)), float(np.max(x))],
            "target_range": [float(np.min(y)), float(np.max(y))],
            "splits": splits_for_event,
            "sta_band": sta_band,
            **metrics,
        }

        names = frame["Name"] if "Name" in frame else pd.Series(["Unknown"] * len(frame))
        videos = frame["Video link"] if "Video link" in frame else pd.Series([None] * len(frame))
        event_records = []
        for name, feature_value, actual, predicted, video in zip(names, x, y, predictions, videos):
            event_records.append(
                {
                    "name": name or "Unknown",
                    "event": event,
                    "feature": float(feature_value),
                    "actual_distance": float(actual),
                    "predicted_distance": float(predicted),
                    "residual": float(actual - predicted),
                    "video": video,
                }
            )
        inference_payload[event] = event_records

    return model_payload, inference_payload


def main() -> None:
    args = parse_args()
    run_dependency_scripts(
        data_root=args.data_root,
        split_stats_output=args.split_stats,
        skip=args.skip_dependencies,
    )
    frames = load_competition_data(args.data_root)
    features = {"DNF": args.dnf_feature, "DYNB": args.dynb_feature}

    sta_frame = load_sta_pb(args.data_root)

    split_stats = load_split_stats(args.split_stats)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    model_payload, inference_payload = build_payloads(frames, features, split_stats, sta_frame)

    model_path = args.output_dir / "model_params.json"
    inference_path = args.output_dir / "inference_predictions.json"

    model_path.write_text(json.dumps(model_payload, indent=2))
    inference_path.write_text(json.dumps(inference_payload, indent=2))

    print(f"Wrote model params to {model_path}")
    print(f"Wrote inference payload to {inference_path}")


def run_dependency_scripts(data_root: Path, split_stats_output: Path, skip: bool) -> None:
    if skip:
        return

    entries: List[tuple[Path, Sequence[str]]] = [
        (
            PROJECT_ROOT / "scripts" / "build_split_stats.py",
            ("--data-root", str(data_root), "--output", str(split_stats_output)),
        ),
        (
            PROJECT_ROOT / "scripts" / "build_dnf_style.py",
            ("--data-root", str(data_root),),
        ),
    ]

    for script_path, extra_args in entries:
        if not script_path.exists():
            continue
        cmd = [sys.executable, str(script_path), *extra_args]
        print(f"Running {script_path.name} ...", flush=True)
        subprocess.run(cmd, check=True)


def load_split_stats(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def extract_split_stats(split_stats: dict | None, event: str) -> list[dict]:
    if not split_stats:
        return []
    rows = split_stats.get("splits") or []
    return [row for row in rows if row.get("event") == event]


def load_sta_pb(base_path: Path) -> pd.DataFrame | None:
    csv_path = base_path / "STA_PB.csv"
    if not csv_path.exists():
        return None
    return pd.read_csv(csv_path)


def compute_sta_band(event_frame: pd.DataFrame, sta_frame: pd.DataFrame | None) -> dict | None:
    if sta_frame is None or event_frame is None or event_frame.empty:
        return None

    lookup = build_sta_lookup(sta_frame)
    if not lookup:
        return None

    points: list[tuple[float, float]] = []
    for _, row in event_frame.iterrows():
        name = str(row.get("Name", "")).strip()
        if not name:
            continue
        key = normalize_name(name)
        sta_entry = lookup.get(key)
        if not sta_entry:
            continue
        sta_seconds = sta_entry["seconds"]
        dist_value = safe_float(row.get("Dist"))
        if sta_seconds is None or dist_value is None:
            continue
        points.append((sta_seconds, dist_value))

    if len(points) < 2:
        return None

    return regression_band(points)


def build_sta_lookup(sta_frame: pd.DataFrame) -> dict[str, dict]:
    lookup: dict[str, dict] = {}
    for _, row in sta_frame.iterrows():
        name = str(row.get("Name", "")).strip()
        if not name:
            continue
        seconds = parse_time_to_seconds(row.get("STA"))
        if seconds is None or not math.isfinite(seconds):
            continue
        lookup[normalize_name(name)] = {"seconds": float(seconds)}
    return lookup


def parse_time_to_seconds(value) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or text in {"-", "--"}:
        return None
    parts = text.split(":")
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 3:
        hours, minutes, seconds = numbers
        return float(hours * 3600 + minutes * 60 + seconds)
    if len(numbers) == 2:
        minutes, seconds = numbers
        return float(minutes * 60 + seconds)
    if len(numbers) == 1:
        return float(numbers[0])
    return None


def normalize_name(value: str) -> str:
    return " ".join(value.split()).lower()


def safe_float(value) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def regression_band(points: Iterable[tuple[float, float]]) -> dict | None:
    xs = np.array([p[0] for p in points], dtype=float)
    ys = np.array([p[1] for p in points], dtype=float)
    if len(xs) < 2:
        return None
    if np.ptp(xs) == 0:
        return None

    mean_x = float(np.mean(xs))
    mean_y = float(np.mean(ys))

    numerator = float(np.sum((xs - mean_x) * (ys - mean_y)))
    denominator = float(np.sum((xs - mean_x) ** 2))
    if denominator == 0:
        return None

    slope = numerator / denominator
    top_idx = int(np.argmax(ys))
    top_x = xs[top_idx]
    top_y = ys[top_idx]
    if top_x != mean_x:
        candidate_slope = (top_y - mean_y) / (top_x - mean_x)
        if math.isfinite(candidate_slope) and candidate_slope > slope:
            slope = candidate_slope

    intercept = mean_y - slope * mean_x

    residuals = ys - (slope * xs + intercept)
    denom = max(len(xs) - 2, 1)
    residual_std = float(np.sqrt(np.sum(residuals**2) / denom))
    band_width = float(max(5.0, residual_std * 0.75))

    domain = [float(np.min(xs)), float(np.max(xs))]
    if domain[0] == domain[1]:
        return None

    sample_count = int(max(20, min(60, len(xs) * 2)))
    sample_xs = np.linspace(domain[0], domain[1], sample_count)
    samples = []
    for x in sample_xs:
        center = slope * x + intercept
        samples.append(
            {
                "x": float(x),
                "center": float(center),
                "lower": float(center - band_width),
                "upper": float(center + band_width),
            }
        )

    return {
        "domain": domain,
        "slope": float(slope),
        "intercept": float(intercept),
        "band_width": band_width,
        "point_count": int(len(xs)),
        "samples": samples,
    }


if __name__ == "__main__":
    main()
