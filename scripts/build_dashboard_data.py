"""Export model parameters and inference-ready payloads for the D3 dashboards."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict

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


def build_payloads(frames: Dict[str, pd.DataFrame], features: Dict[str, str]) -> tuple[dict, dict]:
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

        model_payload[event] = {
            "feature": feature,
            "target": TARGET_COLUMN,
            "slope": float(model.slope),
            "intercept": float(model.intercept),
            "count": int(len(frame)),
            "feature_range": [float(np.min(x)), float(np.max(x))],
            "target_range": [float(np.min(y)), float(np.max(y))],
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
    frames = load_competition_data(args.data_root)
    features = {"DNF": args.dnf_feature, "DYNB": args.dynb_feature}

    args.output_dir.mkdir(parents=True, exist_ok=True)

    model_payload, inference_payload = build_payloads(frames, features)

    model_path = args.output_dir / "model_params.json"
    inference_path = args.output_dir / "inference_predictions.json"

    model_path.write_text(json.dumps(model_payload, indent=2))
    inference_path.write_text(json.dumps(inference_payload, indent=2))

    print(f"Wrote model params to {model_path}")
    print(f"Wrote inference payload to {inference_path}")


if __name__ == "__main__":
    main()
