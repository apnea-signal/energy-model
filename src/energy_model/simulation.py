"""Scenario planning helpers for evaluating apnea techniques."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass
class TechniquePhase:
    name: str
    duration_s: float
    oxygen_cost_ml: float


@dataclass
class SimulationResult:
    phases: List[TechniquePhase]

    @property
    def total_time(self) -> float:
        return sum(phase.duration_s for phase in self.phases)

    @property
    def total_oxygen_cost(self) -> float:
        return sum(phase.oxygen_cost_ml for phase in self.phases)


def simulate_sequence(phases: List[TechniquePhase]) -> SimulationResult:
    """Aggregate a sequence of phases into summary totals."""

    return SimulationResult(phases=phases)
