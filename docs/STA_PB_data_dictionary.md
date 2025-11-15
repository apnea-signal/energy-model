# STA PB Data Dictionary (Draft)

`data/aida_greece_2025/STA_PB.csv` lists the static apnea PB each athlete declared once the AIDA Greece 2025 entries were
finalized. We pair it with the discipline results to study how static capacity aligns with depth/dynamic performance.

## Columns
| Column     | Description                                                                 |
|------------|-----------------------------------------------------------------------------|
| `Name`     | Athlete display name (given + family); use as the join key with other data. |
| `STA`      | Static apnea PB time in `mm:ss`; treat `-` or blank as missing.             |
| `STA_YEAR` | Year the PB was achieved.                                                   |

## Data Quality Notes
- `STA` missing in 2 records; treat `-` and empty strings as `NaN`.
- `STA_YEAR` present in 19 rows and limited to {2017, 2021, 2024, 2025}; empty otherwise.
- Avoid relying on PBs older than 2024 for performance modeling—they likely lag the athletes' current capability.
