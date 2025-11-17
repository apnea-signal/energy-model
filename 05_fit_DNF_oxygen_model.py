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
from sklearn.linear_model import LinearRegression

LOGGER = logging.getLogger(__name__)
DATASET_FILES: Mapping[str, str] = {
    "DNF": "DNF.csv",
}
DEFAULT_DATA_ROOT = Path("data/aida_greece_2025")
DEFAULT_STA_FILE = Path("data/aida_greece_2025/STA_PB.csv")
DEFAULT_MOVEMENT_FILE = Path("data/dashboard_data/03_movement_intensity.json")
DEFAULT_OUTPUT = Path("data/dashboard_data/05_propulsion_fit.json")
GD_DEFAULT_PARAMS = {
    "wall_push_o2_cost": 1.0,
    "arm_o2_cost": 1.5,
    "leg_o2_cost": 1.0,
    "dolphin_o2_cost": 0.0,
    "intensity_time_o2_cost": 0.0,
    "anaerobic_recovery_o2_cost": 0.1,
    "static_o2_rate": 1.8,
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
        intensity_lookup = build_intensity_lookup(movement_payload, dataset)
        samples = build_attempt_samples(
            frame,
            dataset=dataset,
            sta_lookup=sta_lookup,
            intensity_lookup=intensity_lookup,
            min_distance=args.min_distance,
        )
        if not samples:
            LOGGER.warning("Skipping %s – no attempts with STA + intensity overlap", dataset)
            continue
        fit = fit_parameters(samples)
        payload = format_output(dataset, samples, fit)
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


def build_intensity_lookup(movement_payload: dict, dataset: str) -> Dict[str, float]:
    dataset_payload = movement_payload.get(dataset, {}) if movement_payload else {}
    athletes = dataset_payload.get("athletes") if isinstance(dataset_payload, dict) else None
    if not isinstance(athletes, list):
        return {}
    lookup: Dict[str, float] = {}
    for entry in athletes:
        name = entry.get("name") or entry.get("Name")
        normalized = normalize_name(name)
        if not normalized:
            continue
        movement_intensity = entry.get("movement_intensity")
        try:
            value = float(movement_intensity)
        except (TypeError, ValueError):
            continue
        if math.isfinite(value) and value > 0:
            lookup[normalized] = value
    return lookup


def build_attempt_samples(
    frame: pd.DataFrame,
    *,
    dataset: str,
    sta_lookup: Dict[str, float],
    intensity_lookup: Dict[str, float],
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
        raw_intensity = intensity_lookup.get(normalized)
        intensity = (
            float(raw_intensity)
            if isinstance(raw_intensity, (int, float)) and math.isfinite(raw_intensity) and raw_intensity > 0
            else 1.0
        )
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
    design = np.array([sample.feature_vector() for sample in samples], dtype=float)
    movement_targets = np.array([sample.movement_allowance_s for sample in samples], dtype=float)
    raw_model = LinearRegression(fit_intercept=False)
    raw_model.fit(design, movement_targets)
    raw_solution = raw_model.coef_
    weights = np.array([compute_sample_weight(sample, samples) for sample in samples], dtype=float)
    constrained_solution = run_gradient_descent(
        design,
        movement_targets,
        weights=weights,
        initial=build_initial_params(),
    )
    movement_predictions = design @ constrained_solution
    total_times = np.array([sample.total_time_s for sample in samples], dtype=float)
    sta_targets = np.array([sample.sta_budget_s for sample in samples], dtype=float)
    static_rate = solve_static_rate(residual=sta_targets - movement_predictions, times=total_times)
    predictions = movement_predictions + static_rate * total_times
    errors = predictions - sta_targets
    movement_parameters = {name: float(value) for name, value in zip(MOVEMENT_PARAMETER_ORDER, constrained_solution)}
    parameters = {**movement_parameters, PARAMETER_ORDER[-1]: static_rate}
    raw_parameters = {name: float(value) for name, value in zip(MOVEMENT_PARAMETER_ORDER, raw_solution)}
    raw_parameters[PARAMETER_ORDER[-1]] = STATIC_MIN
    LOGGER.info(
        "Non-negative fit: %s",
        ", ".join(f"%s=%.4f" % (name, value) for name, value in parameters.items()),
    )
    negative_raw = [name for name, value in raw_parameters.items() if value < 0]
    if negative_raw:
        LOGGER.info(
            "Unconstrained (reference) fit: %s",
            ", ".join(f"%s=%.4f" % (name, value) for name, value in raw_parameters.items()),
        )
    LOGGER.info(
        "Residuals: mean=%.2f s, median=%.2f s, max=%.2f s",
        float(np.mean(np.abs(errors))),
        float(np.median(np.abs(errors))),
        float(np.max(np.abs(errors))),
    )
    return FitResult(
        parameters=parameters,
        residuals=list(errors),
        predictions=list(predictions),
        unconstrained_parameters=raw_parameters,
    )


def format_output(dataset: str, samples: List[AttemptSample], fit: FitResult) -> dict:
    attempts: List[OutputAttempt] = []
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


def compute_mean_abs_pct_error(attempts: Iterable[OutputAttempt]) -> float:
    errors: List[float] = []
    for attempt in attempts:
        if attempt.sta_budget_s > 0:
            errors.append(abs(attempt.residual_s) / attempt.sta_budget_s)
    if not errors:
        return float("nan")
    return float(sum(errors) / len(errors))


def build_initial_params() -> np.ndarray:
    values = [GD_DEFAULT_PARAMS.get(name, 1.0) for name in MOVEMENT_PARAMETER_ORDER]
    return np.array(values, dtype=float)


def compute_sample_weight(sample: AttemptSample, samples: List[AttemptSample]) -> float:
    return 1.0


def run_gradient_descent(
    design: np.ndarray,
    targets: np.ndarray,
    *,
    weights: np.ndarray,
    initial: np.ndarray,
) -> np.ndarray:
    params = np.maximum(initial.copy(), 0.0)
    if weights.shape[0] != targets.shape[0]:
        weights = np.ones_like(targets)
    weight_sum = float(np.sum(weights)) or float(len(targets))
    for iteration in range(GD_MAX_ITER):
        preds = design @ params
        residuals = preds - targets
        grad = (design.T @ (weights * residuals)) / weight_sum
        update = GD_LR * grad
        params -= update
        params = np.maximum(params, 0.0)
        enforce_hierarchy_constraints(params)
        if np.linalg.norm(update) < GD_TOL:
            LOGGER.debug("Gradient descent converged after %d iterations", iteration + 1)
            break
    else:
            LOGGER.debug("Gradient descent reached max iterations (%d)", GD_MAX_ITER)
    return params


def solve_static_rate(residual: np.ndarray, times: np.ndarray) -> float:
    if residual.size == 0 or times.size == 0:
        return STATIC_MIN
    numerator = np.dot(residual, times)
    denominator = np.dot(times, times)
    if denominator <= 0:
        return STATIC_MIN
    rate = numerator / denominator
    return max(rate, STATIC_MIN)


def enforce_hierarchy_constraints(params: np.ndarray) -> None:
    try:
        wall_idx = MOVEMENT_PARAMETER_ORDER.index("wall_push_o2_cost")
        leg_idx = MOVEMENT_PARAMETER_ORDER.index("leg_o2_cost")
        arm_idx = MOVEMENT_PARAMETER_ORDER.index("arm_o2_cost")
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
