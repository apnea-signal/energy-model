export const PARAMETER_ORDER = [
  "wall_push_o2_cost",
  "arm_o2_cost",
  "leg_o2_cost",
  "dolphin_o2_cost",
  "intensity_time_o2_cost",
  "anaerobic_recovery_o2_cost",
  "static_o2_rate",
];

export const PARAMETER_LABELS = {
  wall_push_o2_cost: "Wall push O₂ cost",
  arm_o2_cost: "Arm stroke O₂ cost",
  leg_o2_cost: "Leg kick O₂ cost",
  dolphin_o2_cost: "Dolphin O₂ cost",
  intensity_time_o2_cost: "Intensity × time O₂ cost",
  anaerobic_recovery_o2_cost: "Anaerobic recovery O₂ credit",
  static_o2_rate: "Static metabolic rate",
};

export const PARAMETER_SYMBOLS = {
  wall_push_o2_cost: "P_w",
  arm_o2_cost: "P_a",
  leg_o2_cost: "P_l",
  dolphin_o2_cost: "P_d",
  intensity_time_o2_cost: "P_i",
  anaerobic_recovery_o2_cost: "P_{ar}",
  static_o2_rate: "R_s",
};

export const PARAMETER_DESCRIPTIONS = {
  wall_push_o2_cost: "O₂ per intensity-scaled wall push (one per turn).",
  arm_o2_cost: "O₂ per arm cycle after intensity scaling.",
  leg_o2_cost: "O₂ per single-leg kick (stroke + post-push).",
  dolphin_o2_cost: "O₂ per stabilizing dolphin kick.",
  intensity_time_o2_cost: "Heart-rate coupling term applied to intensity × swim time.",
  anaerobic_recovery_o2_cost: "Anaerobic relief term that subtracts O₂ as time extends (negative).",
  static_o2_rate: "Baseline O₂ draw multiplied by swim duration.",
};

export const FORMULA_ROWS = [
  {
    symbol: "I",
    label: "Movement intensity",
    description: "Athlete-specific scalar applied to each propulsion count.",
  },
  ...PARAMETER_ORDER.map((key) => ({
    symbol: PARAMETER_SYMBOLS[key] || "",
    label: PARAMETER_LABELS[key] || key,
    description: PARAMETER_DESCRIPTIONS[key] || "",
  })),
  {
    symbol: "N_*",
    label: "Movement counts",
    description: "Per-attempt wall, arm, leg, and dolphin counts from the annotations.",
  },
  {
    symbol: "T",
    label: "Swim duration",
    description: "Total attempt time (seconds) used for the static metabolic term.",
  },
];

export const PENALTY_WEIGHTS = {
  sta: { over: 1.0, under: 0.6 },
  distance: { over: 1.6, under: 0.6 },
};

export const COMBINED_SCORE_WEIGHTS = {
  sta: 1,
  distance: 2,
};

export function buildFeatureVector({
  movementIntensity = 1,
  wallPushes = 0,
  armPulls = 0,
  legKicks = 0,
  dolphinKicks = 0,
  swimTime = 0,
} = {}) {
  const intensity = sanitizePositive(movementIntensity);
  const wall = sanitizePositive(wallPushes);
  const arms = sanitizePositive(armPulls);
  const legs = sanitizePositive(legKicks);
  const dolphins = sanitizePositive(dolphinKicks);
  const totalTime = sanitizePositive(swimTime);
  return {
    wall_push_o2_cost: intensity * wall,
    arm_o2_cost: intensity * arms,
    leg_o2_cost: intensity * legs,
    dolphin_o2_cost: intensity * dolphins,
    intensity_time_o2_cost: intensity * totalTime,
    anaerobic_recovery_o2_cost: -totalTime,
    static_o2_rate: totalTime,
  };
}

export function applyParametersToFeatures(parameters = {}, features = {}) {
  let total = 0;
  const contributions = {};
  PARAMETER_ORDER.forEach((key) => {
    const coeff = sanitizeCoefficient(parameters[key]);
    const featureValue = Number.isFinite(features[key]) ? features[key] : 0;
    const contribution = coeff * featureValue;
    contributions[key] = contribution;
    total += contribution;
  });
  return { total, contributions };
}

export function evaluateSplitCost(parameters = {}, counts = {}) {
  const features = buildFeatureVector(counts);
  const { total, contributions } = applyParametersToFeatures(parameters, features);
  return { total, contributions, features };
}

export function projectDistanceFromSplitCost(budget, splitCost, splitDistance) {
  const oxygenBudget = Number(budget);
  const costPerSplit = Number(splitCost);
  const distancePerSplit = Number(splitDistance);
  if (!Number.isFinite(oxygenBudget) || oxygenBudget <= 0) {
    return { distance_m: Number.NaN, split_count: Number.NaN };
  }
  if (!Number.isFinite(costPerSplit) || costPerSplit <= 0) {
    return { distance_m: Number.NaN, split_count: Number.NaN };
  }
  if (!Number.isFinite(distancePerSplit) || distancePerSplit <= 0) {
    return { distance_m: Number.NaN, split_count: Number.NaN };
  }
  const splitCount = oxygenBudget / costPerSplit;
  return { distance_m: splitCount * distancePerSplit, split_count: splitCount };
}

export function computeManualPredictedDistance(attempt, prediction, splitDistance) {
  const budget = Number(attempt?.sta_budget_s);
  const actualDistance = Number(attempt?.distance_m);
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(actualDistance) || actualDistance <= 0) {
    return Number.NaN;
  }
  if (!Number.isFinite(prediction) || prediction <= 0) {
    return Number.NaN;
  }
  return (budget * actualDistance) / prediction;
}

export function computeManualMetrics(attempts = []) {
  if (!attempts.length) {
    return null;
  }
  const absResiduals = attempts.map((attempt) => Math.abs(attempt.residual_s ?? 0));
  const meanAbs = average(absResiduals);
  const medianAbs = median(absResiduals);
  const maxAbs = Math.max(...absResiduals);
  const pctErrors = attempts
    .map((attempt) => (attempt.sta_budget_s > 0 ? Math.abs(attempt.residual_s ?? 0) / attempt.sta_budget_s : Number.NaN))
    .filter((value) => Number.isFinite(value));
  const meanPct = pctErrors.length ? average(pctErrors) : Number.NaN;

  const staPenalties = attempts
    .map((attempt) => computeStaPenalty(attempt))
    .filter((value) => Number.isFinite(value));
  const distancePenalties = attempts
    .map((attempt) => computeDistancePenalty(attempt))
    .filter((value) => Number.isFinite(value));

  const staPenalty = staPenalties.length ? average(staPenalties) : Number.NaN;
  const distancePenalty = distancePenalties.length ? average(distancePenalties) : Number.NaN;
  const combinedPenalty = computeCombinedPenalty(staPenalty, distancePenalty);

  return {
    mean_abs_error_s: meanAbs,
    median_abs_error_s: medianAbs,
    max_abs_error_s: maxAbs,
    mean_abs_pct_error: meanPct,
    sta_penalty: staPenalty,
    distance_penalty: distancePenalty,
    combined_penalty: combinedPenalty,
  };
}

export function computeStaPenalty(attempt) {
  const budget = Number(attempt?.sta_budget_s);
  if (!Number.isFinite(budget) || budget <= 0) {
    return Number.NaN;
  }
  const residual = Number(attempt?.residual_s);
  if (!Number.isFinite(residual)) {
    return Number.NaN;
  }
  const normalized = Math.abs(residual) / budget;
  const weight = residual >= 0 ? PENALTY_WEIGHTS.sta.over : PENALTY_WEIGHTS.sta.under;
  return normalized * weight;
}

export function computeDistancePenalty(attempt) {
  const actual = Number(attempt?.distance_m);
  const predicted = Number(attempt?.predicted_distance_m);
  if (!Number.isFinite(actual) || actual <= 0 || !Number.isFinite(predicted) || predicted <= 0) {
    return Number.NaN;
  }
  const delta = predicted - actual;
  const normalized = Math.abs(delta) / actual;
  const weight = delta >= 0 ? PENALTY_WEIGHTS.distance.over : PENALTY_WEIGHTS.distance.under;
  return normalized * weight;
}

export function computeCombinedPenalty(staPenalty, distancePenalty) {
  let total = 0;
  let weightSum = 0;
  if (Number.isFinite(staPenalty)) {
    total += staPenalty * COMBINED_SCORE_WEIGHTS.sta;
    weightSum += COMBINED_SCORE_WEIGHTS.sta;
  }
  if (Number.isFinite(distancePenalty)) {
    total += distancePenalty * COMBINED_SCORE_WEIGHTS.distance;
    weightSum += COMBINED_SCORE_WEIGHTS.distance;
  }
  if (weightSum <= 0) {
    return Number.NaN;
  }
  return total / weightSum;
}

function average(values = []) {
  if (!values.length) {
    return Number.NaN;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function median(values = []) {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sanitizePositive(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value > 0 ? value : 0;
}

function sanitizeCoefficient(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value;
}
