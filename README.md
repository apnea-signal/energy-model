# Apnea Energy Model

## Overview
This repository now focuses exclusively on exploring the annotated Dynamic No Fins (DNF) and Dynamic with Bifins (DYNB)
datasets. The goal is to make it easy to review raw splits, pacing notes, and STA references without carrying any of the
previous regression experiments.

## Data Inventory
- `data/aida_greece_2025/athletes_and_pbs.csv`: Athlete list with STA personal bests plus DYN, DYNB, and DNF records.
- `data/aida_greece_2025/DNF.csv`: Annotated DNF races with timing checkpoints, apnea estimates, stroke counts, and
  notes about extra kicks or dolphins.
- `data/aida_greece_2025/DYNB.csv`: Annotated DYNB races with fin details, kick style labels, cumulative splits, and
  kick counts per length.
- `data/aida_greece_2025/STA_PB.csv`: Static apnea PB references collected with the athlete submissions.

## Repository Layout
```
.
├── README.md
├── requirements.txt
├── scripts/
│   ├── _explore_base.py
│   ├── explore_dnf.py
│   └── explore_dynb.py
├── src/
│   └── energy_model/
│       └── data_loading.py
├── tests/
│   └── test_data_loading.py
├── web/
│   ├── exploration.html
│   ├── js/exploration.js
│   └── styles.css
└── data/
    └── aida_greece_2025/
        ├── DNF.csv
        ├── DYNB.csv
        └── STA_PB.csv
```

## Environment Setup
```shell
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

## Usage

### Console exploration
Use the helper scripts to quickly inspect either dataset from the command line:
```shell
python3 scripts/explore_dnf.py
python3 scripts/explore_dynb.py
```
Both commands print a quick preview of the selected CSV and basic summary statistics. Adjust
`scripts/_explore_base.py` if you need to point at a different data folder.

### Web exploration page
Serve the repository root (so the page can reach the CSV files) and open `web/exploration.html`:
```shell
python -m http.server 8000
# visit http://localhost:8000/web/exploration.html
```
The page loads the CSVs directly in the browser and provides sortable tables, a distance vs. time chart, and STA
correlation plots for quick comparison between athletes.

### Data processing workflow
The web UI displays "Weighted split stats" derived from the race CSVs. Generate the JSON consumed by the UI via the
numbered processing scripts in the repository root (additional steps can be added later):
```shell
python run_all.py               # executes each numbered step in order
# or run the individual steps with extra options
python 01_build_split_stats.py --data-root data/aida_greece_2025 --output web/dashboard_data/01_split_stats.json
python 02_static_bands.py --data-root data/aida_greece_2025 --output web/dashboard_data/02_static_bands.json
```
`01_build_split_stats.py` averages each split checkpoint time while weighting athletes by their total distance. The
resulting `web/dashboard_data/01_split_stats.json` feeds the split targets in `web/exploration.html`.

`02_static_bands.py` joins each race result with the STA PB roster and uses the slope/offset heuristics derived in
`01_build_split_stats.py` to emit the STA projection bands at `web/dashboard_data/02_static_bands.json`. The web UI merges
both JSON files when loading `web/exploration.html`.

## Testing
Run the lightweight unit tests with:
```shell
pytest
```
