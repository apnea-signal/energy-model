from pathlib import Path

import pandas as pd

from energy_model import data_loading


def test_ensure_expected_columns_passes(tmp_path: Path) -> None:
    frame = pd.DataFrame({"A": [1], "B": [2]})
    data_loading.ensure_expected_columns(frame, {"A"})


def test_ensure_expected_columns_fails() -> None:
    frame = pd.DataFrame({"A": [1]})
    try:
        data_loading.ensure_expected_columns(frame, {"B"})
    except ValueError as exc:
        assert "Missing columns" in str(exc)
    else:
        raise AssertionError("Expected ValueError")
