"""Evaluate a hypothetical technique sequence."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
if str(SRC_PATH) not in sys.path:
    sys.path.insert(0, str(SRC_PATH))

from energy_model.simulation import TechniquePhase, simulate_sequence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate total time and oxygen use for a series of phases.")
    parser.add_argument(
        "--phases",
        nargs="+",
        metavar="name:duration:oxygen",
        help="Phase spec such as pull:5:30 for 5 s duration and 30 ml oxygen cost.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    phases = []
    for spec in args.phases or []:
        try:
            name, duration, oxygen = spec.split(":")
        except ValueError as exc:
            raise SystemExit(f"Invalid phase '{spec}'. Expected format name:duration:oxygen") from exc
        phases.append(TechniquePhase(name=name, duration_s=float(duration), oxygen_cost_ml=float(oxygen)))

    result = simulate_sequence(phases)
    print(f"total_time={result.total_time:.1f}s total_oxygen={result.total_oxygen_cost:.1f}ml")


if __name__ == "__main__":
    main()
