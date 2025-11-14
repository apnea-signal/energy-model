import numpy as np

from energy_model.models import BaselineRegressor


def test_baseline_regressor_fit_and_predict() -> None:
    x = np.array([0, 1, 2, 3], dtype=float)
    y = 2 * x + 5
    model = BaselineRegressor().fit(x, y)
    preds = model.predict(x)
    assert np.allclose(preds, y)
