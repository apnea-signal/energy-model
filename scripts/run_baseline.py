"""Train the baseline regressor on competition data."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from energy_model.data_loading import load_competition_data
from energy_model.models import BaselineRegressor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train baseline regressor on stroke/kick counts vs distance.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=PROJECT_ROOT / "data" / "aida_greece_2025",
        help="Path to directory with competition CSV files.",
    )
    parser.add_argument(
        "--event",
        choices=("DNF", "DYNB"),
        default="DNF",
        help="Select dataset used for fitting.",
    )
    parser.add_argument(
        "--feature",
        help="Optional column override for stroke/kick counts (defaults to ST_K for DNF, TK for DYNB).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frames = load_competition_data(args.data_root)
    frame = frames[args.event.lower()]

    default_feature = "ST_K" if args.event == "DNF" else "TK"
    feature_col = args.feature or default_feature
    x = frame[feature_col].fillna(0).to_numpy(dtype=float)
    y = frame["Dist"].to_numpy(dtype=float)

    model = BaselineRegressor().fit(x, y)
    print(f"event={args.event} feature={feature_col} slope={model.slope:.4f} intercept={model.intercept:.2f}")


if __name__ == "__main__":
    main()
