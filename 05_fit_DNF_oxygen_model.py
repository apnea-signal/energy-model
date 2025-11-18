#!/usr/bin/env python3
"""Fit global DNF oxygen costs so max attempts exhaust their STA-derived budgets."""

from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence

import numpy as np
import pandas as pd
LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
}
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_STA_FILE = Path("data/aida_greece_2025/STA_PB.csv")
DEFAULT_MOVEMENT_FILE = Path("data/dashboard_data/03_movement_intensity.json")
DEFAULT_OUTPUT = Path("data/dashboard_data/05_propulsion_fit.json")
GD_DEFAULT_PARAMS = {
    "wall_push_o2_cost": 2.5,
    "arm_o2_cost": 3.5,
    "leg_o2_cost": 2.5,
    "dolphin_o2_cost": 0.0,
    "intensity_time_o2_cost": 0.39,
    "anaerobic_recovery_o2_cost": 0.1,
    "static_o2_rate": 1.0,
}
GD_LR = 1e-5
GD_MAX_ITER = 40_000
GD_TOL = 1e-6
WALL_LEG_EPS = 1e-6
ARM_LEG_RATIO_MAX = 1.5
STATIC_MIN = 1.0
PARAMETER_ORDER = [
    "wall_push_o2_cost",
    "arm_o2_cost",
    "leg_o2_cost",
    "dolphin_o2_cost",
    "intensity_time_o2_cost",
    "anaerobic_recovery_o2_cost",
    "static_o2_rate",
]
MOVEMENT_PARAMETER_ORDER = PARAMETER_ORDER[:-1]
PENALTY_WEIGHTS = {
    "sta": {"over": 1.0, "under": 0.6},
    "distance": {"over": 1.6, "under": 0.6},
}
COMBINED_SCORE_WEIGHTS = {"sta": 1.0, "distance": 2.0}


@dataclass
class AttemptSample:
    name: str
    normalized_name: str
    dataset: str
    distance_m: float
    total_time_s: float
    sta_budget_s: float
    movement_intensity: float
    wall_pushes: float
    arm_pulls: float
    leg_kicks: float
    dolphin_kicks: float
    movement_allowance_s: float
    feature_array: np.ndarray | None = None

    def feature_vector(self) -> List[float]:
        multiplier = self.movement_intensity or 1.0
        return [
            self.wall_pushes * multiplier,
            self.arm_pulls * multiplier,
            self.leg_kicks * multiplier,
            self.dolphin_kicks * multiplier,
            multiplier * self.total_time_s,
            -self.total_time_s,
        ]


@dataclass
class FitResult:
    parameters: Dict[str, float]
    residuals: List[float]
    predictions: List[float]
    unconstrained_parameters: Dict[str, float]


@dataclass
class OutputAttempt:
    name: str
    distance_m: float
    total_time_s: float
    sta_budget_s: float
    movement_intensity: float
    prediction_s: float
    residual_s: float
    features: Dict[str, float]
    component_costs: Dict[str, float]
    arm_pulls: float
    leg_kicks: float
    split_o2_cost: float | None = None


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DEFAULT_DATA_ROOT)
    parser.add_argument("--sta-file", type=Path, default=DEFAULT_STA_FILE)
    parser.add_argument("--movement-file", type=Path, default=DEFAULT_MOVEMENT_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dataset",
        dest="datasets",
        action="append",
        choices=sorted(DATASET_FILES.keys()),
        help="Restrict processing to specific datasets (can be provided multiple times).",
    )
    parser.add_argument("--min-distance", type=float, default=0.0, help="Skip attempts shorter than this distance (m).")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def configure_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging(args.verbose)
    datasets = args.datasets or sorted(DATASET_FILES.keys())

    movement_payload = load_movement_payload(args.movement_file)
    sta_lookup = load_sta_budgets(args.sta_file)
    if not sta_lookup:
        LOGGER.error("STA reference file is empty or missing valid entries: %s", args.sta_file)
        return 1

    output_payload: Dict[str, dict] = {}
    for dataset in datasets:
        csv_path = args.data_root / DATASET_FILES[dataset]
        if not csv_path.exists():
            LOGGER.warning("Skipping %s – missing %s", dataset, csv_path)
            continue
        frame = pd.read_csv(csv_path)
        movement_lookup, movement_metadata = build_movement_lookup(movement_payload, dataset)
        samples = build_attempt_samples(
            frame,
            dataset=dataset,
            sta_lookup=sta_lookup,
            movement_lookup=movement_lookup,
            min_distance=args.min_distance,
        )
        if not samples:
            LOGGER.warning("Skipping %s – no attempts with STA + intensity overlap", dataset)
            continue
        fit = fit_parameters(samples)
        payload = format_output(
            dataset,
            samples,
            fit,
            movement_lookup=movement_lookup,
            metadata=movement_metadata or {},
        )
        output_payload[dataset] = payload

    if not output_payload:
        LOGGER.error("No datasets produced a propulsion fit; aborting")
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        json.dump(output_payload, handle, indent=2)
        handle.write("\n")
    LOGGER.info("Wrote %s", args.output)
    return 0


def load_movement_payload(path: Path) -> dict:
    if not path.exists():
        LOGGER.warning("Movement intensity file missing: %s", path)
        return {}
    with path.open("r", encoding="utf-8") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError as exc:
            LOGGER.error("Failed to parse %s: %s", path, exc)
            return {}


def load_sta_budgets(path: Path) -> Dict[str, float]:
    if not path.exists():
        LOGGER.error("STA reference file missing: %s", path)
        return {}
    frame = pd.read_csv(path)
    lookup: Dict[str, float] = {}
    for _, row in frame.iterrows():
        name = row.get("Name")
        normalized = normalize_name(name)
        sta_seconds = parse_time_to_seconds(row.get("STA"))
        if normalized and math.isfinite(sta_seconds) and sta_seconds > 0:
            lookup[normalized] = sta_seconds
    return lookup


def build_movement_lookup(movement_payload: dict, dataset: str) -> tuple[Dict[str, dict], dict | None]:
    dataset_payload = movement_payload.get(dataset, {}) if movement_payload else {}
    if not isinstance(dataset_payload, dict):
        return {}, None
    athletes = dataset_payload.get("athletes")
    metadata = dataset_payload.get("metadata") if isinstance(dataset_payload.get("metadata"), dict) else None
    if not isinstance(athletes, list):
        return {}, metadata
    lookup: Dict[str, dict] = {}
    for entry in athletes:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name") or entry.get("Name")
        normalized = normalize_name(name)
        if normalized:
            lookup[normalized] = entry
    return lookup, metadata


def build_attempt_samples(
    frame: pd.DataFrame,
    *,
    dataset: str,
    sta_lookup: Dict[str, float],
    movement_lookup: Dict[str, dict],
    min_distance: float,
) -> List[AttemptSample]:
    samples: List[AttemptSample] = []
    skipped = 0
    for _, row in frame.iterrows():
        normalized = normalize_name(row.get("Name"))
        if not normalized:
            continue
        distance = coerce_float(row.get("Dist"))
        if not math.isfinite(distance) or distance <= 0 or distance < min_distance:
            continue
        sta_budget = sta_lookup.get(normalized)
        if not (sta_budget and math.isfinite(sta_budget)):
            skipped += 1
            continue
        total_time = parse_time_to_seconds(row.get("TT"))
        arm_pulls = coerce_float(row.get("TA"))
        leg_kicks = coerce_float(row.get("TK"))
        dolphin_kicks = coerce_float(row.get("TDK"))
        wall_pushes = resolve_wall_pushes(row)
        movement_entry = movement_lookup.get(normalized) if movement_lookup else None
        raw_intensity = movement_entry.get("movement_intensity") if isinstance(movement_entry, dict) else None
        try:
            intensity_value = float(raw_intensity)
        except (TypeError, ValueError):
            intensity_value = float("nan")
        intensity = intensity_value if math.isfinite(intensity_value) and intensity_value > 0 else 1.0
        movement_allowance = sta_budget - total_time
        if not math.isfinite(movement_allowance) or movement_allowance <= 0:
            LOGGER.debug(
                "Skipping %s – STA margin %.2f s is non-positive",
                row.get("Name"),
                movement_allowance,
            )
            continue
        if not all(
            math.isfinite(value)
            for value in [total_time, arm_pulls, leg_kicks, dolphin_kicks, wall_pushes]
        ):
            continue
        if total_time <= 0 or arm_pulls < 0 or leg_kicks < 0 or dolphin_kicks < 0 or wall_pushes <= 0:
            continue
        samples.append(
            AttemptSample(
                name=str(row.get("Name")),
                normalized_name=normalized,
                dataset=dataset,
                distance_m=float(distance),
                total_time_s=float(total_time),
                sta_budget_s=float(sta_budget),
                movement_intensity=intensity,
                wall_pushes=float(wall_pushes),
                arm_pulls=float(arm_pulls),
                leg_kicks=float(leg_kicks),
                dolphin_kicks=float(dolphin_kicks),
                movement_allowance_s=float(movement_allowance),
            )
        )
    if skipped:
        LOGGER.info("%s: skipped %d rows without STA reference", dataset, skipped)
    LOGGER.info("%s: built %d regression samples", dataset, len(samples))
    for sample in samples:
        features = sample.feature_vector() + [sample.total_time_s]
        sample.feature_array = np.array(features, dtype=float)
    return samples


def resolve_wall_pushes(row: Mapping[str, object]) -> float:
    tw_value = coerce_float(row.get("TW"))
    if math.isfinite(tw_value) and tw_value > 0:
        return float(tw_value)
    distance = coerce_float(row.get("Dist"))
    if math.isfinite(distance) and distance > 0:
        return float(max(1.0, math.ceil(distance / 50.0)))
    return float("nan")


def fit_parameters(samples: List[AttemptSample]) -> FitResult:
    optimized_params = run_penalty_descent(samples, build_initial_params())
    predictions = []
    errors = []
    for sample in samples:
        feature_array = sample.feature_array
        if feature_array is None:
            predictions.append(float("nan"))
            errors.append(float("nan"))
            continue
        prediction = float(np.dot(feature_array, optimized_params))
        predictions.append(prediction)
        errors.append(prediction - sample.sta_budget_s)
    parameters = {name: float(value) for name, value in zip(PARAMETER_ORDER, optimized_params)}
    LOGGER.info(
        "Optimized parameters: %s",
        ", ".join(f"%s=%.4f" % (name, value) for name, value in parameters.items()),
    )
    LOGGER.info(
        "STA residuals: mean=%.2f s, median=%.2f s, max=%.2f s",
        float(np.nanmean(np.abs(errors))),
        float(np.nanmedian(np.abs(errors))),
        float(np.nanmax(np.abs(errors))),
    )
    return FitResult(
        parameters=parameters,
        residuals=list(errors),
        predictions=list(predictions),
        unconstrained_parameters=dict(parameters),
    )


def format_output(
    dataset: str,
    samples: List[AttemptSample],
    fit: FitResult,
    *,
    movement_lookup: Dict[str, dict],
    metadata: dict | None,
) -> dict:
    attempts: List[OutputAttempt] = []
    split_distance = coerce_float((metadata or {}).get("split_distance_m"))
    if not math.isfinite(split_distance) or split_distance <= 0:
        split_distance = 50.0
    for sample, prediction, residual in zip(samples, fit.predictions, fit.residuals):
        features = sample.feature_vector()
        component_costs = {}
        feature_dict = {}
        for name, feature in zip(PARAMETER_ORDER[:-1], features):
            component_costs[name] = round(fit.parameters[name] * feature, 4)
            feature_dict[name] = round(feature, 4)
        static_feature = sample.total_time_s
        component_costs[PARAMETER_ORDER[-1]] = round(static_feature * fit.parameters[PARAMETER_ORDER[-1]], 4)
        feature_dict[PARAMETER_ORDER[-1]] = round(static_feature, 4)
        movement_entry = movement_lookup.get(sample.normalized_name) if movement_lookup else None
        split_o2_cost = compute_split_o2_cost(
            sample,
            parameters=fit.parameters,
            movement_entry=movement_entry,
            split_distance=split_distance,
        )
        attempts.append(
            OutputAttempt(
                name=sample.name,
                distance_m=sample.distance_m,
                total_time_s=sample.total_time_s,
                sta_budget_s=sample.sta_budget_s,
                movement_intensity=sample.movement_intensity,
                prediction_s=float(prediction),
                residual_s=float(residual),
                features=feature_dict,
                component_costs={k: round(v, 4) for k, v in component_costs.items()},
                arm_pulls=sample.arm_pulls,
                leg_kicks=sample.leg_kicks,
                split_o2_cost=round(split_o2_cost, 4) if split_o2_cost is not None else None,
            )
        )
    residual_seconds = [abs(attempt.residual_s) for attempt in attempts]
    median_abs = statistics.median(residual_seconds) if residual_seconds else 0.0
    mean_abs = statistics.mean(residual_seconds) if residual_seconds else 0.0
    max_abs = max(residual_seconds) if residual_seconds else 0.0
    mae_pct = compute_mean_abs_pct_error(attempts)
    payload = {
        "dataset": dataset,
        "parameters": {key: round(val, 6) for key, val in fit.parameters.items()},
        "unconstrained_parameters": {key: round(val, 6) for key, val in fit.unconstrained_parameters.items()},
        "metrics": {
            "attempts": len(attempts),
            "mean_abs_error_s": round(mean_abs, 4),
            "median_abs_error_s": round(median_abs, 4),
            "max_abs_error_s": round(max_abs, 4),
            "mean_abs_pct_error": round(mae_pct, 4) if math.isfinite(mae_pct) else None,
        },
        "attempts": [attempt_to_dict(entry) for entry in attempts],
        "parameter_order": list(PARAMETER_ORDER),
        "design_note": "Fit solves for (STA - swim_time) using intensity-scaled movement counts plus heart-rate and anaerobic time terms; swim_time is added back afterward",
    }
    return payload


def compute_split_o2_cost(
    sample: AttemptSample,
    *,
    parameters: Dict[str, float],
    movement_entry: dict | None,
    split_distance: float,
) -> float | None:
    if not parameters:
        return None
    splits = estimate_split_count(sample.distance_m, split_distance)
    if splits <= 0:
        return None
    split_time = extract_split_time(movement_entry)
    if not (math.isfinite(split_time) and split_time > 0):
        split_time = sample.total_time_s / splits if splits > 0 else float("nan")
    if not (math.isfinite(split_time) and split_time > 0):
        return None
    split_counts = extract_split_counts(sample, movement_entry, splits)
    multiplier = sample.movement_intensity or 1.0
    features = {
        "wall_push_o2_cost": split_counts["wall_pushes"] * multiplier,
        "arm_o2_cost": split_counts["arm_pulls"] * multiplier,
        "leg_o2_cost": split_counts["leg_kicks"] * multiplier,
        "dolphin_o2_cost": split_counts["dolphin_kicks"] * multiplier,
        "intensity_time_o2_cost": split_time * multiplier,
        "anaerobic_recovery_o2_cost": -split_time,
    }
    movement_cost = 0.0
    for name, feature_value in features.items():
        param_value = parameters.get(name)
        if param_value is None:
            continue
        movement_cost += param_value * feature_value
    static_rate = parameters.get("static_o2_rate", 0.0)
    total_cost = movement_cost + static_rate * split_time
    return total_cost if math.isfinite(total_cost) else None


def extract_split_time(entry: dict | None) -> float:
    if isinstance(entry, dict):
        value = entry.get("split_time_s")
        value = coerce_float(value)
        if math.isfinite(value) and value > 0:
            return value
    return float("nan")


def extract_split_counts(sample: AttemptSample, entry: dict | None, splits: float) -> Dict[str, float]:
    counts = {
        "arm_pulls": float("nan"),
        "leg_kicks": float("nan"),
        "dolphin_kicks": float("nan"),
    }
    if isinstance(entry, dict):
        for field in counts:
            value = coerce_float(entry.get(field))
            if math.isfinite(value) and value >= 0:
                counts[field] = value
    resolved = {}
    arm_default = sample.arm_pulls / splits if splits > 0 else float("nan")
    leg_default = sample.leg_kicks / splits if splits > 0 else float("nan")
    dolphin_default = sample.dolphin_kicks / splits if splits > 0 else 0.0
    resolved["arm_pulls"] = counts["arm_pulls"] if math.isfinite(counts["arm_pulls"]) else arm_default
    resolved["leg_kicks"] = counts["leg_kicks"] if math.isfinite(counts["leg_kicks"]) else leg_default
    resolved["dolphin_kicks"] = (
        counts["dolphin_kicks"] if math.isfinite(counts["dolphin_kicks"]) else dolphin_default
    )
    for key in ("arm_pulls", "leg_kicks", "dolphin_kicks"):
        value = resolved.get(key)
        if not (math.isfinite(value) and value >= 0):
            resolved[key] = 0.0
    wall_per_split = sample.wall_pushes / splits if splits > 0 else 1.0
    if not (math.isfinite(wall_per_split) and wall_per_split > 0):
        wall_per_split = 1.0
    resolved["wall_pushes"] = wall_per_split
    return resolved


def estimate_split_count(distance_m: float, split_distance: float) -> float:
    if not math.isfinite(distance_m) or distance_m <= 0:
        return float("nan")
    if not math.isfinite(split_distance) or split_distance <= 0:
        split_distance = 50.0
    splits = distance_m / split_distance
    return max(1.0, splits)


def compute_mean_abs_pct_error(attempts: Iterable[OutputAttempt]) -> float:
    errors: List[float] = []
    for attempt in attempts:
        if attempt.sta_budget_s > 0:
            errors.append(abs(attempt.residual_s) / attempt.sta_budget_s)
    if not errors:
        return float("nan")
    return float(sum(errors) / len(errors))


def build_initial_params() -> np.ndarray:
    values = [GD_DEFAULT_PARAMS.get(name, 1.0) for name in PARAMETER_ORDER]
    return np.array(values, dtype=float)


def run_penalty_descent(samples: List[AttemptSample], initial: np.ndarray) -> np.ndarray:
    params = initial.astype(float)
    for iteration in range(GD_MAX_ITER):
        grad = np.zeros_like(params)
        penalty_sum = 0.0
        valid = 0
        for sample in samples:
            feature_array = sample.feature_array
            if feature_array is None:
                continue
            prediction = float(np.dot(feature_array, params))
            penalty, derivative = combined_penalty_and_gradient(sample, prediction)
            if not math.isfinite(penalty):
                continue
            penalty_sum += penalty
            valid += 1
            if math.isfinite(derivative):
                grad += derivative * feature_array
        if not valid:
            LOGGER.warning("No valid samples contributed to the optimization gradient")
            break
        grad /= valid
        update = GD_LR * grad
        params -= update
        enforce_parameter_bounds(params)
        if np.linalg.norm(update) < GD_TOL:
            LOGGER.debug("Penalty descent converged after %d iterations (avg combined penalty %.4f)", iteration + 1, penalty_sum / valid)
            break
    else:
        LOGGER.debug("Penalty descent reached max iterations (%d)", GD_MAX_ITER)
    return params


def combined_penalty_and_gradient(sample: AttemptSample, prediction: float) -> tuple[float, float]:
    sta_penalty, sta_grad = sta_penalty_and_gradient(sample, prediction)
    distance_penalty, distance_grad = distance_penalty_and_gradient(sample, prediction)
    total_weight = 0.0
    weighted_penalty = 0.0
    weighted_grad = 0.0
    if math.isfinite(sta_penalty):
        weight = COMBINED_SCORE_WEIGHTS["sta"]
        weighted_penalty += sta_penalty * weight
        weighted_grad += sta_grad * weight
        total_weight += weight
    if math.isfinite(distance_penalty):
        weight = COMBINED_SCORE_WEIGHTS["distance"]
        weighted_penalty += distance_penalty * weight
        weighted_grad += distance_grad * weight
        total_weight += weight
    if total_weight <= 0:
        return float("nan"), 0.0
    return weighted_penalty / total_weight, weighted_grad / total_weight


def sta_penalty_and_gradient(sample: AttemptSample, prediction: float) -> tuple[float, float]:
    budget = sample.sta_budget_s
    residual = prediction - budget
    weight = PENALTY_WEIGHTS["sta"]["over" if residual >= 0 else "under"]
    penalty = weight * abs(residual) / budget
    grad = weight * (1.0 if residual >= 0 else -1.0) / budget
    return penalty, grad


def distance_penalty_and_gradient(sample: AttemptSample, prediction: float) -> tuple[float, float]:
    budget = sample.sta_budget_s
    actual_distance = sample.distance_m
    if prediction <= 0 or actual_distance <= 0:
        return float("nan"), 0.0
    numerator = budget * actual_distance
    predicted_distance = numerator / prediction
    delta = predicted_distance - actual_distance
    weight = PENALTY_WEIGHTS["distance"]["over" if delta >= 0 else "under"]
    penalty = weight * abs(delta) / actual_distance
    grad_predicted_distance = -numerator / (prediction ** 2)
    grad = weight * (1.0 if delta >= 0 else -1.0) * grad_predicted_distance / actual_distance
    return penalty, grad


def enforce_parameter_bounds(params: np.ndarray) -> None:
    for idx, name in enumerate(PARAMETER_ORDER):
        if name == "static_o2_rate":
            params[idx] = max(params[idx], STATIC_MIN)
        else:
            params[idx] = max(params[idx], 0.0)
    enforce_hierarchy_constraints(params)


def enforce_hierarchy_constraints(params: np.ndarray) -> None:
    try:
        wall_idx = PARAMETER_ORDER.index("wall_push_o2_cost")
        leg_idx = PARAMETER_ORDER.index("leg_o2_cost")
        arm_idx = PARAMETER_ORDER.index("arm_o2_cost")
    except ValueError:
        return
    if params[wall_idx] < params[leg_idx]:
        params[wall_idx] = params[leg_idx] + WALL_LEG_EPS
    leg_value = params[leg_idx]
    if leg_value > 0:
        max_arm = leg_value * ARM_LEG_RATIO_MAX
        if params[arm_idx] > max_arm:
            params[arm_idx] = max_arm


def attempt_to_dict(entry: OutputAttempt) -> dict:
    return {
        "name": entry.name,
        "distance_m": round(entry.distance_m, 2),
        "total_time_s": round(entry.total_time_s, 3),
        "sta_budget_s": round(entry.sta_budget_s, 3),
        "movement_intensity": round(entry.movement_intensity, 4),
        "prediction_s": round(entry.prediction_s, 3),
        "residual_s": round(entry.residual_s, 3),
        "features": entry.features,
        "component_costs": entry.component_costs,
        "arm_pulls": round(entry.arm_pulls, 3),
        "leg_kicks": round(entry.leg_kicks, 3),
        "split_o2_cost": round(entry.split_o2_cost, 4) if entry.split_o2_cost is not None else None,
    }


def parse_time_to_seconds(value) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float("nan")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
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


def coerce_float(value) -> float:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return float("nan")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    text = str(value).strip()
    if not text or text == "-":
        return float("nan")
    try:
        return float(text)
    except ValueError:
        return float("nan")


def normalize_name(value) -> str:
    return str(value or "").strip().lower()


if __name__ == "__main__":
    raise SystemExit(main())
