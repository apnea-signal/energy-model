"""Console summaries for the DNF dataset."""

from __future__ import annotations

from _explore_base import load_dataset, display_preview


def main() -> None:
    frame = load_dataset("dnf")
    print(f"DNF dataset | rows={len(frame)} | columns={len(frame.columns)}")
    display_preview(frame)


if __name__ == "__main__":
    main()
