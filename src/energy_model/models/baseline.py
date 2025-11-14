"""Simple baseline estimator for oxygen cost per movement."""

from __future__ import annotations

from dataclasses import dataclass
import numpy as np


@dataclass
class BaselineRegressor:
    """Predict oxygen cost using a linear relationship to stroke or kick counts."""

    slope: float = 1.0
    intercept: float = 0.0

    def fit(self, x: np.ndarray, y: np.ndarray) -> "BaselineRegressor":
        """Fit slope and intercept via least squares."""

        ones = np.ones((x.shape[0], 1))
        design = np.column_stack((x.reshape(-1, 1), ones))
        coeffs, *_ = np.linalg.lstsq(design, y, rcond=None)
        self.slope, self.intercept = coeffs
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        """Return predicted oxygen cost."""

        return self.slope * x + self.intercept
