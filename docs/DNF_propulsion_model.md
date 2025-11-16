# DNF Propulsion & Oxygen Model (Draft)

This note outlines a conceptual model for Dynamic No Fins (DNF) performances. It
breaks each attempt into repeated split checkpoints and ties propulsion events
to their oxygen costs. The goal is to expose knobs that can be tuned for each
athlete style before wiring the math into simulations.

## Split-Level Propulsion Targets

Every 50 m segment (or the final partial segment) must deliver enough net thrust
to cover its distance before the split timer expires. Faster split times require
higher instantaneous power, so the propulsion recipe for an elite sprint differs
from a pacing-focused swim even if the movements look similar on video.

For each split we accumulate propulsion from the following components:

- **Wall push**: impulse at the start of the segment. Its magnitude can be
  tuned per athlete and falls off if the previous glide consumed too much O2.
- **Post-push leg kicks**: zero or more heavy kicks immediately after the wall
  to convert the push into cruising speed.
- **Arm stroke**: primary drag reduction and thrust, modeled as discrete pulls
  (the `A*` columns). Stroke power varies by swimmer and fatigue state.
- **Intra-stroke leg kicks**: one or more kicks embedded in the stroke template
  (`ST_K`), each with its own power curve.
- **Stabilizing dolphin kicks**: optional micro-kicks (`ST_DK`) used to keep the
  torso aligned while the arm recovers. They usually cost less power individually
  but add up over long distances.

The dataset captures how each athlete uses these pieces, and the current "style
template" columns are reverse-engineered by manually reviewing each race video
to estimate when kicks or strokes happened. The builder script converts these
annotated `ST_*` patterns plus the per-split arm counts into a "propulsion
ledger" so we can ask questions like "how many kicks were available after the
150 m wall?" before evaluating total distance.

## Oxygen Consumption Model

To connect propulsion to physiology we assume two main sinks for O2:

1. **Static metabolic needs**: heart, brain, and core maintenance continue even
   when propulsion pauses. This baseline draw scales with heart rate, so a spike
   from stress or aggressive pacing increases oxygen burn even before strokes
   resume.
2. **Propulsion costs**: every arm pull and kick draws from the same O2 tank, but
   the rate differs by muscle group. Arm strokes and leg kicks are modeled on a
   per-movement basis so we can simulate alternative templates (e.g., double kick
   vs. single kick styles).

Additional modifiers:

- **Heart-rate coupling**: the static term ramps up or down based on the athlete's
  instantaneous heart rate. Long glides might let the HR settle, whereas sprint
  starts could push the baseline higher.
- **Anaerobic leg transition**: once the leg muscles cross their aerobic limit,
  their O2 draw decreases. The propulsion term for legs then shifts to reflect a
  higher reliance on anaerobic metabolism, which preserves O2 for the upper body
  but introduces fatigue debt to be repaid post-surfacing.

### Calibrating Static Needs from STA Performances

The STA personal best dataset (`docs/STA_PB_data_dictionary.md`) gives us the
baseline oxygen consumption each athlete can sustain while motionless. We can
treat those static holds as the reference metabolic rate, then inflate the value
based on the modeled heart-rate curve for a specific DNF attempt. This produces
a swimmer-specific "static metabolic needs" term that already reflects their gas
usage capacity and how it drifts when HR increases mid-swim.

### Movement-Level Propulsion & Oxygen Costs

Because we now track every propulsion component (wall push, post-push kicks,
arm pull, intra-stroke kicks, stabilizing dolphin kicks), we can estimate both
the thrust and the oxygen debit for each movement:

- **Propulsion**: assign per-movement thrust coefficients and accumulate them
  within a split until the distance target is satisfied.
- **Oxygen consumption**: attach per-movement O2 costs that depend on muscle
  group, fatigue state, and anaerobic flags. This makes it possible to show how
  a change in template (e.g., adding an extra kick after the wall) affects both
  split speed and total oxygen burn.

This framework separates the "how much thrust per split" question from "how much
oxygen remains," making it easier to iterate on either side without rewriting
everything else.

## Speed-Adjusted Mechanical Model

To ground the propulsion math we translate split speeds into mechanical work and
metabolic oxygen costs. The fluid constants \(\rho\), \(C_d\), and frontal area
form a shared multiplier \(K_f = \tfrac{1}{2} \rho C_d A\); we keep separate
arm and leg efficiencies (\(\eta_a\), \(\eta_l\)) so the regression can
capture different conversion rates for upper vs. lower body work. This keeps the
fit focused on movement ratios rather than debating absolute drag numbers.

### Derived Quantities per Split

For each 50 m segment with elapsed time \(T_{50}\) and distance \(d = 50\) m:

1. **Speed**: \(v = d / T_{50}\).
2. **Mechanical work**: \(W_{tot} = K_f v^2 d\), where \(K_f = \tfrac{1}{2} \rho C_d A\).
3. **Arm vs leg weighting**: introduce an arm/leg thrust ratio \(r\) (to be
   fitted). Let \(f_A = \frac{r A}{r A + L}\) and \(f_L = 1 - f_A\), where
   \(A\) and \(L\) are the stroke and kick counts for the split.
4. **Mechanical energy split**: \(W_A = f_A W_{tot}\), \(W_L = f_L W_{tot}\).
5. **Per-action intensity**: \(w_A = W_A / A\), \(w_L = W_L / L\).

### Conversion to Oxygen

Metabolic energy consumed during the split:

\[
O_2 = \frac{1}{\varepsilon_{O_2}} \left( \frac{W_A}{\eta_a} + \frac{W_L}{\eta_l} \right)
\]

Because \(W_{tot} \propto v^2\), small changes in split time alter oxygen
spend quadratically. A 10% faster split increases work and O₂ about 21–25%, while
going 5% slower drops work roughly 10%. This effect dominates even when movement
counts stay similar, which is why the model needs speed corrections alongside
stroke templates.

### Regression Targets

With this setup we can fit \(r\) (and any athlete-specific modifiers) so that
the modeled mechanical demand matches the recorded split outcomes. Since the DNF
dataset contains max attempts, the calibrated model should converge to zero
surplus after consuming the available O₂ budget.

## Model Parameters (Web Frontend Defaults)

The propulsion explorer surfaces the following parameters so users can inspect
or eventually tune them. Values shown below match the defaults bundled in the
frontend (mirroring the Python `DNFPropulsionModel`).

| Group           | Parameter                         | Default   | Meaning                                                   |
|-----------------|-----------------------------------|-----------|-----------------------------------------------------------|
| Wall            | `wall_push_force`                 | 1.0       | Propulsion impulse assigned to each wall push             |
| Wall            | `wall_push_o2_cost`               | 0.05      | Oxygen debit for the wall push impulse                    |
| Arm strokes     | `arm_stroke_force`                | 0.8       | Propulsion per arm cycle                                  |
| Arm strokes     | `arm_o2_cost`                     | 0.05      | Oxygen per arm cycle                                      |
| Leg kicks       | `leg_kick_force`                  | 0.25      | Propulsion per single-leg kick embedded in a stroke cycle |
| Leg kicks       | `leg_kick_o2_cost`                | 0.03      | Oxygen per single-leg kick inside the stroke cycle        |
| Dolphin kicks   | `dolphin_kick_force`              | 0.05      | Minimal propulsion for stabilizing the stroke             |
| Dolphin kicks   | `dolphin_o2_cost`                 | 0.02      | Small, unavoidable oxygen cost                            |
| Static needs    | `static_rate_base`                | 1.0       | Baseline oxygen draw (scaled by STA only)                 |
| Static needs    | `static_reference_sta`            | 480.0     | STA (s) used to normalize athletes                        |
| Anaerobic legs  | `anaerobic_leg_threshold`         | 80.0      | Kick count before anaerobic shift                         |
| Anaerobic legs  | `anaerobic_propulsion_multiplier` | 0.9       | Slight propulsion dip after threshold                     |
| Anaerobic legs  | `anaerobic_oxygen_multiplier`     | 0.6       | Oxygen cost drops as legs go anaerobic                    |

Per-athlete modifiers (wall, stroke, kick, dolphin intensity scalars) default to
1.0 and can be regressed later to capture swimmer-specific strengths. In the
annotations we describe intensity qualitatively (low / moderate / high) and map
those labels to numeric multipliers (e.g., 0.8 / 1.0 / 1.2) during fitting.

### Per-Athlete Modifiers

Each athlete can carry individualized scales that tweak the global parameters to
reflect their stroke strength or efficiency. These modifiers multiply the base
coefficients listed above and are the primary levers we expect to regress when
calibrating to observed performances:

| Modifier                 | Applies to                                        | Meaning                                         |
|--------------------------|---------------------------------------------------|-------------------------------------------------|
| `wall_push_intensity`    | Wall push force/O₂                                | Qualitative push-off rating (low/moderate/high) |
| `arm_stroke_intensity`   | Arm stroke force/O₂                               | Pulling intensity (low/moderate/high)           |
| `leg_kick_intensity`     | Stroke + post-push leg kicks (single-leg actions) | Leg-drive intensity (low/moderate/high)         |
| `dolphin_intensity`      | Dolphin kicks                                     | Stabilization effort (low/moderate/high)        |

All modifiers start at 1.0. Fitting them (alongside shared constants) lets the
model adapt to athletes who generate more propulsion per stroke, rely heavily on
wall kicks, or have unusually low static oxygen needs.
