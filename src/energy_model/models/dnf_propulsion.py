"""Propulsion and oxygen accounting model for DNF attempts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping


@dataclass
class PropulsionParameters:
    """Global coefficients that map movements to thrust and oxygen costs."""

    wall_push_force: float = 1.0
    wall_push_o2_cost: float = 0.05
    post_push_kick_force: float = 0.35
    post_push_kick_o2_cost: float = 0.03
    arm_stroke_force: float = 0.8
    arm_o2_cost: float = 0.05
    stroke_kick_force: float = 0.25
    stroke_kick_o2_cost: float = 0.03
    dolphin_kick_force: float = 0.12
    dolphin_o2_cost: float = 0.02
    reference_pace_mps: float = 1.0
    pace_force_exponent: float = 1.2
    static_rate_base: float = 1.0
    static_reference_sta: float = 480.0
    heart_rate_reference: float = 45.0
    heart_rate_slope: float = 0.01
    rest_hr: float = 40.0
    peak_hr: float = 120.0
    anaerobic_leg_threshold: float = 80.0
    anaerobic_leg_multiplier: float = 0.5


@dataclass
class AthleteModifiers:
    """Per-athlete adjustments applied on top of the global parameters."""

    wall_push_scale: float = 1.0
    stroke_scale: float = 1.0
    kick_scale: float = 1.0
    dolphin_scale: float = 1.0
    static_rate_scale: float = 1.0


class DNFPropulsionModel:
    """Estimate propulsion supply and oxygen demand for a DNF attempt."""

    def __init__(
        self,
        parameters: PropulsionParameters | None = None,
        athlete_modifiers: Mapping[str, AthleteModifiers] | None = None,
    ) -> None:
        self.parameters = parameters or PropulsionParameters()
        self.athlete_modifiers: MutableMapping[str, AthleteModifiers] = {}
        if athlete_modifiers:
            for key, modifier in athlete_modifiers.items():
                self.athlete_modifiers[normalize_name(key)] = modifier

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------
    def parameter_dict(self) -> Dict[str, float]:
        """Return parameters as a flat dict for regression/serialization."""

        return asdict(self.parameters)

    def get_modifier(self, athlete_name: str | None) -> AthleteModifiers:
        """Return the stored modifier for an athlete (defaults to identity)."""

        return self.athlete_modifiers.get(normalize_name(athlete_name), AthleteModifiers())

    def set_modifier(self, athlete_name: str, modifier: AthleteModifiers) -> None:
        self.athlete_modifiers[normalize_name(athlete_name)] = modifier

    # ------------------------------------------------------------------
    # Core evaluation
    # ------------------------------------------------------------------
    def evaluate_attempt(
        self,
        attempt: Mapping[str, Any],
        sta_seconds: float | None = None,
    ) -> Dict[str, Any]:
        """Compute propulsion vs. demand and oxygen draw for an attempt."""

        splits: Iterable[Mapping[str, Any]] = attempt.get("split_details", [])
        name = attempt.get("name")
        modifier = self.get_modifier(name)
        split_payloads: List[Dict[str, Any]] = []

        total_segments = sum(1 for segment in splits if _segment_distance(segment) > 0)
        total_propulsion = 0.0
        total_demand = 0.0
        total_static_o2 = 0.0
        total_movement_o2 = 0.0
        cumulative_leg_kicks = 0.0

        for index, split in enumerate(splits):
            segment_distance = _segment_distance(split)
            if segment_distance <= 0:
                continue

            segment_time = _to_float(split.get("segment_time_s"))
            segment_pace = _to_float(split.get("segment_pace_mps"))
            demand = self._propulsion_demand(segment_distance, segment_pace)
            heart_rate = self._heart_rate(index, total_segments)
            static_rate = self._static_rate(sta_seconds, heart_rate, modifier)
            static_o2 = (segment_time * static_rate) if (segment_time and static_rate) else 0.0

            wall_push_prop, wall_push_o2 = self._wall_push(modifier)
            post_kicks = _to_float(split.get("wall_kicks")) or 0.0
            stroke_kicks = _to_float(split.get("stroke_leg_kicks")) or 0.0
            dolphin_kicks = _to_float(split.get("dolphin_kicks")) or 0.0
            arm_cycles = _to_float(split.get("arm_cycles")) or 0.0

            leg_multiplier = self._leg_o2_multiplier(cumulative_leg_kicks)
            post_prop, post_o2 = self._post_push_kicks(post_kicks, modifier, leg_multiplier)
            stroke_prop, stroke_o2 = self._stroke_kicks(stroke_kicks, modifier, leg_multiplier)
            arm_prop, arm_o2 = self._arm_strokes(arm_cycles, modifier)
            dolphin_prop, dolphin_o2 = self._dolphin_kicks(dolphin_kicks, modifier)

            segment_propulsion = wall_push_prop + post_prop + stroke_prop + arm_prop + dolphin_prop
            movement_o2 = wall_push_o2 + post_o2 + stroke_o2 + arm_o2 + dolphin_o2

            cumulative_leg_kicks += post_kicks + stroke_kicks
            total_propulsion += segment_propulsion
            total_demand += demand
            total_static_o2 += static_o2
            total_movement_o2 += movement_o2

            split_payloads.append(
                {
                    "split_label": split.get("split_label"),
                    "segment_index": split.get("segment_index"),
                    "segment_distance_m": segment_distance,
                    "segment_time_s": segment_time,
                    "segment_pace_mps": segment_pace,
                    "heart_rate_bpm": heart_rate,
                    "propulsion_demand": demand,
                    "propulsion_supply": segment_propulsion,
                    "propulsion_surplus": segment_propulsion - demand,
                    "oxygen_static": static_o2,
                    "oxygen_movement": movement_o2,
                    "components": {
                        "wall_push": {"propulsion": wall_push_prop, "oxygen": wall_push_o2},
                        "post_push_kicks": {"propulsion": post_prop, "oxygen": post_o2},
                        "stroke_kicks": {"propulsion": stroke_prop, "oxygen": stroke_o2},
                        "arm_strokes": {"propulsion": arm_prop, "oxygen": arm_o2},
                        "dolphin_kicks": {"propulsion": dolphin_prop, "oxygen": dolphin_o2},
                    },
                }
            )

        return {
            "name": name,
            "total_propulsion": total_propulsion,
            "total_propulsion_demand": total_demand,
            "propulsion_surplus": total_propulsion - total_demand,
            "oxygen_static": total_static_o2,
            "oxygen_movement": total_movement_o2,
            "oxygen_total": total_static_o2 + total_movement_o2,
            "splits": split_payloads,
            "parameters": self.parameter_dict(),
            "modifier": asdict(modifier),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _propulsion_demand(self, distance: float, pace: float | None) -> float:
        if not pace or pace <= 0:
            return distance
        reference = self.parameters.reference_pace_mps or 1.0
        ratio = pace / reference
        return distance * ratio**self.parameters.pace_force_exponent

    def _heart_rate(self, split_index: int, total_segments: int) -> float:
        if total_segments <= 1:
            return self.parameters.peak_hr
        fraction = split_index / (total_segments - 1)
        return self.parameters.rest_hr + (self.parameters.peak_hr - self.parameters.rest_hr) * fraction

    def _static_rate(
        self,
        sta_seconds: float | None,
        heart_rate: float,
        modifier: AthleteModifiers,
    ) -> float:
        base = self.parameters.static_rate_base
        if sta_seconds and sta_seconds > 0:
            base *= self.parameters.static_reference_sta / sta_seconds
        hr_adjustment = 1 + self.parameters.heart_rate_slope * (heart_rate - self.parameters.heart_rate_reference)
        return base * hr_adjustment * modifier.static_rate_scale

    def _leg_o2_multiplier(self, cumulative_leg_kicks: float) -> float:
        if cumulative_leg_kicks >= self.parameters.anaerobic_leg_threshold:
            return self.parameters.anaerobic_leg_multiplier
        return 1.0

    def _wall_push(self, modifier: AthleteModifiers) -> tuple[float, float]:
        prop = self.parameters.wall_push_force * modifier.wall_push_scale
        o2 = self.parameters.wall_push_o2_cost * modifier.wall_push_scale
        return prop, o2

    def _post_push_kicks(
        self, count: float, modifier: AthleteModifiers, o2_multiplier: float
    ) -> tuple[float, float]:
        prop = count * self.parameters.post_push_kick_force * modifier.kick_scale
        o2 = count * self.parameters.post_push_kick_o2_cost * modifier.kick_scale * o2_multiplier
        return prop, o2

    def _stroke_kicks(
        self, count: float, modifier: AthleteModifiers, o2_multiplier: float
    ) -> tuple[float, float]:
        prop = count * self.parameters.stroke_kick_force * modifier.kick_scale
        o2 = count * self.parameters.stroke_kick_o2_cost * modifier.kick_scale * o2_multiplier
        return prop, o2

    def _arm_strokes(self, count: float, modifier: AthleteModifiers) -> tuple[float, float]:
        prop = count * self.parameters.arm_stroke_force * modifier.stroke_scale
        o2 = count * self.parameters.arm_o2_cost * modifier.stroke_scale
        return prop, o2

    def _dolphin_kicks(self, count: float, modifier: AthleteModifiers) -> tuple[float, float]:
        prop = count * self.parameters.dolphin_kick_force * modifier.dolphin_scale
        o2 = count * self.parameters.dolphin_o2_cost * modifier.dolphin_scale
        return prop, o2


def normalize_name(value: str | None) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def _segment_distance(split: Mapping[str, Any]) -> float:
    value = split.get("segment_distance_m")
    return _to_float(value) or 0.0


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
