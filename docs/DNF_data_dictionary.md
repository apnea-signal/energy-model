# DNF Data Dictionary (Draft)

Definitions below are inferred from video review and column behavior; please adjust once official metadata is supplied.

## Attempt Metadata
| Column       | Units   | Description                                                                                   |
|--------------|---------|-----------------------------------------------------------------------------------------------|
| `Name`       | text    | Athlete name (given + family)                                                                 |
| `Video link` | URL     | Deep link to the CMAS TV recording (includes timestamp)                                       |
| `Style`      | text    | Free-form description of the technique (kick cadence, dolphin usage, glide notes, etc.)       |
| `Dist`       | meters  | Final horizontal distance achieved                                                            |
| `TT`         | mm:ss   | Total swim time (wall push to surface)                                                        |
| `TA`         | count   | Total arm-pull cycles for the complete attempt (sum of all segment-level `A*` values)         |
| `Additions`  | text    | Extra remarks such as bonus dolphin kicks after push-off or additional kicks before surfacing |
| `<blank>`    | —       | Empty spacer column present in the CSV for readability; safe to drop during ingestion         |

## Split Checkpoints
Each `T*` column stores elapsed time at a given 50 m checkpoint, while the paired `A*` column records the number of arm
pull cycles executed within that 50 m segment (not cumulative). Missing splits are recorded as `-` when the athlete
surfaced earlier.

| Column | Units | Description                                                                      |
|--------|-------|----------------------------------------------------------------------------------|
| `T50`  | mm:ss | Time to reach 50 m                                                               |
| `A50`  | count | Arm-pull cycles used between the wall push and 50 m (segment total)              |
| `T100` | mm:ss | Time to reach 100 m                                                              |
| `A100` | count | Arm-pull cycles used between 50 m and 100 m                                      |
| `T150` | mm:ss | Time to reach 150 m                                                              |
| `A150` | count | Arm-pull cycles used between 100 m and 150 m                                     |
| `T200` | mm:ss | Time to reach 200 m                                                              |
| `A200` | count | Arm-pull cycles used between 150 m and 200 m                                     |
| `T250` | mm:ss | Time to reach 250 m (often `-` if distance < 250 m)                              |
| `A250` | count | Arm-pull cycles used between 200 m and 250 m (or final segment before surfacing) |

## Stroke Template & Kick Counters
These fields summarize how many movements occurred per length and across the full swim.

| Column  | Units   | Description                                                                                     |
|---------|---------|-------------------------------------------------------------------------------------------------|
| `ST_K`  | count   | Number of leg kicks executed per arm-pull cycle (style-dependent; e.g., 1 kick vs. double kick) |
| `ST_WK` | count   | Additional kicks added immediately after the wall push, before the first arm pull               |
| `ST_DK` | count   | Dolphin kicks baked into the template; non-zero when the style mentions dolphin usage           |
| `TW`    | count   | Wall turns executed (≈ distance / 50 for complete lengths)                                      |
| `TK`    | count   | Total single-leg kicks; equals `ST_K` × total arm-pull cycles + extra wall kicks (`ST_WK`)      |
| `TDK`   | count   | Total dolphin kicks logged for the full swim                                                    |

## Notes & Open Questions
 - Arm-pull cycle composition is athlete specific (e.g., one pull plus one kick vs. pull plus two kicks).
