# DYNB Data Dictionary (Draft)

Definitions inferred from competition footage and CSV behavior; adjust once official metadata is available.

## Attempt Metadata
| Column       | Units   | Description                                                        |
|--------------|---------|--------------------------------------------------------------------|
| `Name`       | text    | Athlete name                                                       |
| `Video link` | URL     | CMAS TV link (with timestamp)                                      |
| `Fin type`   | text    | Fin brand/model (e.g., Taras, Molchanovs)                          |
| `Style`      | text    | Description of kick cadence, amplitude, glide strategy, turn style |
| `Dist`       | meters  | Final horizontal distance                                          |
| `TT`         | mm:ss   | Total time underwater                                              |
| `Additions`  | text    | Notes on extra kicks, glide adjustments, or anomalies              |
| `AddArmPulls` | count  | Derived number of additional arm pulls inferred from `Additions`   |

## Split Checkpoints
Paired `T*` / `K*` columns capture elapsed time and kick counts for each 50 m segment. `K*` values represent kicks within
that segment only (not cumulative). Missing segments are stored as blank strings or `-`.

| Column | Units | Description                                    |
|--------|-------|------------------------------------------------|
| `T50`  | mm:ss | Time at 50 m                                   |
| `K50`  | count | Kicks performed between 0–50 m                 |
| `T100` | mm:ss | Time at 100 m                                  |
| `K100` | count | Kicks performed between 50–100 m               |
| `T150` | mm:ss | Time at 150 m                                  |
| `K150` | count | Kicks performed between 100–150 m              |
| `T200` | mm:ss | Time at 200 m                                  |
| `K200` | count | Kicks performed between 150–200 m              |
| `T250` | mm:ss | Time at 250 m                                  |
| `K250` | count | Kicks performed between 200–250 m              |
| `T300` | mm:ss | Time at 300 m (often `-` if surfacing earlier) |
| `K300` | count | Kicks performed between 250–300 m              |

## Aggregated Counts
| Column        | Units   | Description                                                |
|---------------|---------|------------------------------------------------------------|
| `TK`          | count   | Total kicks for the attempt (sum of segment `K*` values)   |
| `AddArmPulls` | count   | Same derived value as above, included for quick reference  |

## Notes & Open Questions
- Confirm whether `Additions` should capture wall-specific deviations (extra dolphin, glide pause, etc.).
- Active fin type and style may be useful categorical features; consider mapping them to structured enums during ingestion.
- `AddArmPulls` values are parsed heuristically from `Additions`; update rules if the text format changes.
