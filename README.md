# Apnea Energy Model

## Overview
This project explores how different pool apnea techniques spend oxygen, with attention on Dynamic No Fins (DNF) and
Dynamic with Bifins (DYNB). It pulls together competition observations and training notes to connect each pull, kick,
and glide to a practical oxygen budget that can inform race plans.

## Core Questions
- DNF: One leg kick per arm pull or multiple leg kicks?
- DYNB: How do continuous kicks stack up against kick-and-glide cycles?

## Data Inventory
- `data/aida_greece_2025/athletes_and_pbs.csv`: Athlete roster with STA personal bests plus DYN, DYNB, and DNF records.
- `data/aida_greece_2025/DNF.csv`: Annotated DNF races with timing checkpoints, apnea estimates, stroke counts, and
  notes about extra kicks or dolphins.
- `docs/DNF_data_dictionary.md`: Working definitions for every DNF column (update once official metadata is available).
- `data/aida_greece_2025/DYNB.csv`: Annotated DYNB races with fin details, kick style labels, cumulative splits, and
  kick counts per length.
- `docs/DYNB_data_dictionary.md`: Working definitions for DYNB columns; breaks down per-split `T*`/`K*` behavior and
  total kick counts.

Video links inside each table allow quick review if a data point needs clarification.

## Target Outputs
1. A structured model that breaks each pool length into push, glide, pull, and kick phases
   with oxygen rates per athlete.
2. A lightweight ML layer that fits recorded splits and distances to estimate the marginal cost of every pull, kick, or
   dolphin accent.
3. A scenario tool that evaluates proposed sequences of pulls, kicks, and glides against estimated oxygen reserves.

## Modeling Roadmap
1. **Data validation and enrichment**
   - Clean timing formats, distances, and descriptive text so the annotations parse consistently.
   - Convert qualitative notes into cadence, glide-ratio, dolphin-usage, and fin-stiffness features.
2. **Descriptive baselines**
   - Summarize velocity, stroke efficiency, and pull or kick densities for every length.
   - Tie STA and DYN personal bests to observed pacing choices to set athlete-specific oxygen ceilings.
3. **Parameter estimation**
   - Fit mixed-effects or Bayesian regressions that learn the oxygen draw of each movement while allowing athlete
     variability.
   - Compare physics-informed drag models with empirical fits to flag mismatches.
4. **Simulation and recommendations**
   - Build command-line utilities that digest a proposed technique profile and return distance, time, and oxygen curves.
   - Validate on held-out races or future competitions to track drift and update parameters.

## Repository Layout
```
.
├── README.md
├── requirements.txt
├── scripts/
│   ├── explore_data.py
│   ├── run_baseline.py
│   └── simulate_profile.py
├── src/
│   └── energy_model/
├── tests/
└── data/
    └── aida_greece_2025/
        ├── athletes_and_pbs.csv
        ├── DNF.csv
        └── DYNB.csv
```

## Next Steps
- Publish a compact data schema with column descriptions, units, and validation tests.
- Prototype feature engineering scripts that translate annotations into model-ready sequences.
- Train a baseline regression that links stroke or kick totals to distance before layering complex models.
- Expand the dataset with more competitions or training sets once the processing pipeline feels solid.

## Environment Setup

```shell
python3 -m venv .venv
source .venv/bin/activate  
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt
```

## Usage Examples

Explore DNF data from the console:
```shell
python3 scripts/explore_dnf.py
```

Explore DYNB data:
```shell
python3 scripts/explore_dynb.py
```

Fit the baseline model:
```shell
python3 scripts/run_baseline.py --event DNF
```

Simulate a technique sequence:
```shell
python3 scripts/simulate_profile.py --phases push:3:10 pull:5:35 glide:4:5
```

Run unit tests:
```shell
pytest
```

## Interactive Dashboards

Generate the JSON payloads that power the D3 dashboards:

```shell
python scripts/build_dashboard_data.py
```

Serve the repository root (so the pages can load both the CSV sources and generated JSON) and open `web/index.html` in a
browser:

```shell
python -m http.server 8000
# visit http://localhost:8000/web/index.html
```

Available views:

- **Exploratory Analysis** loads `DNF.csv`/`DYNB.csv` directly with D3 for quick histograms and scatter plots.
- **Model Playground** renders the baseline regression parameters plus an interactive slider to probe predictions.
- **Inference Viewer** plots residuals from the model application and includes a form for experimenting with your own
  stroke/kick counts.
