"""CLI tool to evaluate a hypothetical technique sequence."""

from __future__ import annotations

import argparse

from energy_model.simulation import TechniquePhase, simulate_sequence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Simulate total time and oxygen usage for technique phases.")
    parser.add_argument(
        "--phases",
        nargs="+",
        metavar="name:duration:oxygen",
        help="Phase spec like pull:5:30 meaning 5 s duration and 30 ml cost.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    phases = []
    for spec in args.phases or []:
        name, duration, oxygen = spec.split(":")
        phases.append(TechniquePhase(name=name, duration_s=float(duration), oxygen_cost_ml=float(oxygen)))

    result = simulate_sequence(phases)
    print(f"total_time={result.total_time:.1f}s, total_oxygen={result.total_oxygen_cost:.1f}ml")


if __name__ == "__main__":
    main()
