"""CLI entry point for training the baseline regressor."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from energy_model.data_loading import load_competition_data
from energy_model.models import BaselineRegressor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train baseline regressor on stroke counts vs distance.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("data/aida_greece_2025"),
        help="Directory containing competition CSV files.",
    )
    parser.add_argument(
        "--event",
        choices=("DNF", "DYNB"),
        default="DNF",
        help="Select which dataset to train on.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frames = load_competition_data(args.data_root)
    frame = frames[args.event.lower()]

    x = frame["ST_K"].fillna(0).to_numpy() if args.event == "DNF" else frame["TK"].fillna(0).to_numpy()
    y = frame["Dist"].to_numpy()

    model = BaselineRegressor().fit(x.astype(float), y.astype(float))
    print(f"slope={model.slope:.4f}, intercept={model.intercept:.2f}")


if __name__ == "__main__":
    main()
