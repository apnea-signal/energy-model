"""Generate derived style metrics for the DNF dataset."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_PATH = PROJECT_ROOT / "src"
DEFAULT_DATA_ROOT = PROJECT_ROOT / "data" / "aida_greece_2025"
DEFAULT_OUTPUT = PROJECT_ROOT / "data" / "derived" / "dnf_style.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build derived DNF style metrics.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help="Directory that contains DNF.csv.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="JSON file that will store the derived metrics.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    frame = load_dnf_frame(args.data_root)
    attempts = [build_attempt_payload(record) for record in frame.to_dict(orient="records")]
    payload = {"event": "DNF", "attempts": attempts}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2))


def load_dnf_frame(data_root: Path) -> pd.DataFrame:
    from energy_model.data_loading import load_competition_data

    frames = load_competition_data(data_root)
    if "dnf" not in frames:
        raise FileNotFoundError(f"DNF.csv not found under {data_root}")
    frame = frames["dnf"].copy()
    # Drop the empty spacer column when present.
    if "Unnamed: 17" in frame.columns:
        frame = frame.drop(columns=["Unnamed: 17"])
    return frame


SEGMENT_DISTANCES = (50, 100, 150, 200, 250)


def build_attempt_payload(record: Dict[str, Any]) -> Dict[str, Any]:
    dist = to_float(record.get("Dist"))
    total_arms = to_float(record.get("TA"))
    st_k = to_float(record.get("ST_K")) or 0.0
    st_wk = to_float(record.get("ST_WK")) or 0.0
    st_dk = to_float(record.get("ST_DK")) or 0.0

    time_map, total_time = build_time_metadata(record)
    split_details = list(compute_split_details(record, dist, st_k, st_wk, st_dk, time_map, total_time))
    wall_pushes = len(split_details)

    total_leg_kicks = None
    total_dolphin_kicks = None
    if total_arms is not None:
        total_leg_kicks = st_k * total_arms + st_wk * wall_pushes
        total_dolphin_kicks = st_dk * total_arms

    return {
        "name": record.get("Name"),
        "video_link": record.get("Video link"),
        "style_notes": record.get("Style"),
        "distance_m": dist,
        "total_arm_cycles": total_arms,
        "style_template": {"st_k": st_k, "st_wk": st_wk, "st_dk": st_dk},
        "derived_totals": {
            "wall_pushes": wall_pushes,
            "leg_kicks": total_leg_kicks,
            "dolphin_kicks": total_dolphin_kicks,
        },
        "split_details": split_details,
    }


def compute_split_details(
    record: Dict[str, Any],
    dist: float | None,
    st_k: float,
    st_wk: float,
    st_dk: float,
    time_map: Dict[int, float],
    total_time: float | None,
) -> Iterable[Dict[str, Any]]:
    if dist is None or dist <= 0:
        return []

    split_payloads: List[Dict[str, Any]] = []
    previous_distance = 0.0
    cumulative_arm_cycles = 0.0
    previous_time = 0.0

    for index, split_distance in enumerate(SEGMENT_DISTANCES):
        if dist <= previous_distance:
            break
        segment_start = previous_distance
        segment_end = min(dist, float(split_distance))
        segment_length = segment_end - segment_start
        if segment_length <= 0:
            previous_distance = segment_end
            continue

        column = f"A{split_distance}"
        arm_cycles = to_float(record.get(column))
        used_cycles = arm_cycles if arm_cycles is not None else 0.0
        cumulative_arm_cycles += used_cycles

        cumulative_time = time_map.get(split_distance)
        if cumulative_time is None and segment_end < split_distance:
            cumulative_time = total_time
        segment_time = None
        pace = None
        if cumulative_time is not None and cumulative_time >= previous_time:
            segment_time = cumulative_time - previous_time
            if segment_time > 0:
                pace = segment_length / segment_time
            previous_time = cumulative_time

        stroke_leg_kicks = st_k * arm_cycles if arm_cycles is not None else None
        dolphin_kicks = st_dk * arm_cycles if arm_cycles is not None else None
        cumulative_stroke_leg_kicks = st_k * cumulative_arm_cycles if st_k else 0.0
        cumulative_dolphin_kicks = st_dk * cumulative_arm_cycles if st_dk else 0.0
        wall_kicks = st_wk
        cumulative_wall_kicks = st_wk * (index + 1)

        split_payloads.append(
            {
                "split_label": column,
                "segment_index": index,
                "segment_start_m": segment_start,
                "segment_end_m": segment_end,
                "segment_distance_m": segment_length,
                "segment_target_m": split_distance,
                "arm_cycles": arm_cycles,
                "stroke_leg_kicks": stroke_leg_kicks,
                "wall_kicks": wall_kicks,
                "total_leg_kicks": add_optional(stroke_leg_kicks, wall_kicks),
                "dolphin_kicks": dolphin_kicks,
                "cumulative_time_s": cumulative_time,
                "segment_time_s": segment_time,
                "segment_pace_mps": pace,
                "cumulative_arm_cycles": cumulative_arm_cycles,
                "cumulative_stroke_leg_kicks": cumulative_stroke_leg_kicks,
                "cumulative_wall_kicks": cumulative_wall_kicks,
                "cumulative_total_leg_kicks": cumulative_stroke_leg_kicks + cumulative_wall_kicks,
                "cumulative_dolphin_kicks": cumulative_dolphin_kicks,
            }
        )

        previous_distance = segment_end

    return split_payloads


def build_time_metadata(record: Dict[str, Any]) -> Tuple[Dict[int, float], float | None]:
    time_map: Dict[int, float] = {}
    for distance in SEGMENT_DISTANCES:
        time_value = parse_time_to_seconds(record.get(f"T{distance}"))
        if time_value is not None:
            time_map[distance] = time_value
    total_time = parse_time_to_seconds(record.get("TT"))
    return time_map, total_time


def add_optional(primary: float | None, secondary: float | None) -> float | None:
    primary_val = primary if primary is not None else 0.0
    secondary_val = secondary if secondary is not None else 0.0
    total = primary_val + secondary_val
    if primary is None and secondary is None:
        return None
    return total


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result):
        return None
    return result


def parse_time_to_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or text in {"-", "--"}:
        return None
    parts = text.split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 3:
        hours, minutes, seconds = numbers
    elif len(numbers) == 2:
        hours = 0.0
        minutes, seconds = numbers
    elif len(numbers) == 1:
        return numbers[0]
    else:
        return None
    return hours * 3600 + minutes * 60 + seconds


if __name__ == "__main__":
    # Ensure the src directory is importable when running as a script.
    import sys

    if str(SRC_PATH) not in sys.path:
        sys.path.insert(0, str(SRC_PATH))

    main()
