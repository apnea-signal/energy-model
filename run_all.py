#!/usr/bin/env python3
"""Execute each numbered workflow step (e.g. 01_build_split_stats.py) in order."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

STEP_PATTERN = re.compile(r"^(\d+)_.*\.py$")


@dataclass(frozen=True)
class StepScript:
    order: int
    path: Path


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "steps",
        nargs="*",
        help="Optional step numbers or prefixes to run (e.g. 01 02). If omitted, run all steps.",
    )
    return parser.parse_args(argv)


def discover_steps(directory: Path) -> list[StepScript]:
    scripts: list[StepScript] = []
    for child in directory.iterdir():
        if not child.is_file():
            continue
        match = STEP_PATTERN.match(child.name)
        if not match:
            continue
        order = int(match.group(1))
        scripts.append(StepScript(order=order, path=child))
    scripts.sort(key=lambda step: (step.order, step.path.name))
    return scripts


def select_steps(available: Iterable[StepScript], filters: Sequence[str]) -> list[StepScript]:
    if not filters:
        return list(available)
    normalized = [f.strip() for f in filters if f.strip()]
    selected: list[StepScript] = []
    for step in available:
        if any(step.path.stem.startswith(prefix) for prefix in normalized):
            selected.append(step)
    return selected


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path.cwd()
    available = discover_steps(repo_root)
    if not available:
        print("No numbered step scripts found.", file=sys.stderr)
        return 1
    steps = select_steps(available, args.steps)
    if not steps:
        print("No steps match the provided filters.", file=sys.stderr)
        return 1

    for step in steps:
        print(f"\n==> Running {step.path.name}", flush=True)
        try:
            subprocess.run([sys.executable, str(step.path)], check=True)
        except subprocess.CalledProcessError as exc:
            print(f"Step {step.path.name} failed with exit code {exc.returncode}.", file=sys.stderr)
            return exc.returncode or 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
