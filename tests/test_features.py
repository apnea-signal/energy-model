import pandas as pd

from energy_model import features


def test_add_split_pace_creates_column() -> None:
    frame = pd.DataFrame({"dist": [50], "time": ["00:01:00"]})
    result = features.add_split_pace(frame, "dist", "time")
    assert "pace_mps" in result


def test_compute_efficiency_creates_column() -> None:
    frame = pd.DataFrame({"dist": [50], "strokes": [10]})
    result = features.compute_efficiency(frame, "dist", "strokes")
    assert result.loc[0, "distance_per_stroke"] == 5
