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
| `TA`         | count   | Total arm pulls logged for the attempt; matches `A250` maximum in sample rows                 |
| `Additions`  | text    | Extra remarks such as bonus dolphin kicks after push-off or additional kicks before surfacing |
| `<blank>`    | —       | Empty spacer column present in the CSV; ignore                                                |

## Split Checkpoints
Each `T*` column stores elapsed time at a given 50 m checkpoint, while the paired `A*` column stores the cumulative
arm-pull (or kick) count at that same distance. Missing splits are recorded as `-` when the athlete surfaced earlier.

| Column | Units | Description                                                                   |
|--------|-------|-------------------------------------------------------------------------------|
| `T50`  | mm:ss | Time to reach 50 m                                                            |
| `A50`  | count | Cumulative arm pulls by 50 m                                                  |
| `T100` | mm:ss | Time to reach 100 m                                                           |
| `A100` | count | Cumulative arm pulls by 100 m                                                 |
| `T150` | mm:ss | Time to reach 150 m                                                           |
| `A150` | count | Cumulative arm pulls by 150 m                                                 |
| `T200` | mm:ss | Time to reach 200 m                                                           |
| `A200` | count | Cumulative arm pulls by 200 m                                                 |
| `T250` | mm:ss | Time to reach 250 m (often `-` if distance < 250 m)                           |
| `A250` | count | Cumulative arm pulls by 250 m (or final pull count if the swim ended earlier) |

## Stroke Template & Kick Counters
These fields summarize how many movements occurred per length and across the full swim.

| Column  | Units   | Description                                                                                      |
|---------|---------|--------------------------------------------------------------------------------------------------|
| `ST_K`  | count   | Number of single-leg kicks paired with each arm pull in the nominal stroke template (commonly 1) |
| `ST_WK` | count   | Additional wall kicks in the template (e.g., second push-off kick); typically 0 or 1             |
| `ST_DK` | count   | Dolphin kicks baked into the template; non-zero when the style mentions dolphin usage            |
| `TW`    | count   | Wall turns executed (≈ distance / 50 for complete lengths)                                       |
| `TK`    | count   | Total single-leg kicks logged for the full swim                                                  |
| `TDK`   | count   | Total dolphin kicks logged for the full swim                                                     |

## Notes & Open Questions
- `TA` appears to equal the final arm-pull count (`A250` or last available `A*`). Confirm if it also includes push-off phases.
- `ST_*` columns likely encode a qualitative template rather than raw counts; keep monitoring new data to refine meanings.
- If official documentation clarifies what the blank column represents, remove the placeholder row above.
