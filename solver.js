export const DEFAULT_CONFIG = Object.freeze({
  lengthM: 2000,
  widthM: 200,
  nx: 161,
  ny: 41,
  depthM: 3,
  releaseMassMg: 10_000_000,
  releaseXFraction: 0.1,
  releaseYFraction: 0.5,
  releaseSigmaXM: 45,
  releaseSigmaYM: 14,
  meanVelocityMps: -0.06,
  tidalAmplitudeMps: 0.18,
  tidalPeriodHours: 12.42,
  tidalPhaseRad: Math.PI / 2,
  diffusivityM2ps: 1e-9,
});

export function velocityAt(timeSeconds, config) {
  const periodSeconds = config.tidalPeriodHours * 3600;
  return config.meanVelocityMps
    + config.tidalAmplitudeMps
      * Math.sin((2 * Math.PI * timeSeconds / periodSeconds) + config.tidalPhaseRad);
}

export function gridSpacing(config) {
  return {
    dx: config.lengthM / (config.nx - 1),
    dy: config.widthM / (config.ny - 1),
  };
}

export function stableTimeStep(config) {
  const { dx, dy } = gridSpacing(config);
  const maxVelocity = Math.abs(config.meanVelocityMps) + config.tidalAmplitudeMps;
  const rate = maxVelocity / dx
    + 2 * config.diffusivityM2ps * (1 / dx ** 2 + 1 / dy ** 2);
  return rate > 0 ? 0.4 / rate : 60;
}

export function createInitialState(config) {
  const concentration = new Float64Array(config.nx * config.ny);
  const { dx, dy } = gridSpacing(config);
  const releaseX = config.releaseXFraction * config.lengthM;
  const releaseY = config.releaseYFraction * config.widthM;
  let gaussianSum = 0;

  for (let j = 0; j < config.ny; j += 1) {
    const y = j * dy;
    for (let i = 0; i < config.nx; i += 1) {
      const x = i * dx;
      const exponent = -0.5 * (
        ((x - releaseX) / config.releaseSigmaXM) ** 2
        + ((y - releaseY) / config.releaseSigmaYM) ** 2
      );
      const value = Math.exp(exponent);
      concentration[j * config.nx + i] = value;
      gaussianSum += value;
    }
  }

  const cellVolume = dx * dy * config.depthM;
  const scale = config.releaseMassMg / (gaussianSum * cellVolume);
  for (let index = 0; index < concentration.length; index += 1) {
    concentration[index] *= scale;
  }
  return { concentration, timeSeconds: 0 };
}

export function advanceOneStep(state, dt, config) {
  if (!Number.isFinite(dt) || dt <= 0 || dt > stableTimeStep(config) * (1 + 1e-12)) {
    throw new RangeError("The time step must be positive and satisfy the stability limit.");
  }

  const { dx, dy } = gridSpacing(config);
  const { nx, ny, diffusivityM2ps } = config;
  const velocity = velocityAt(state.timeSeconds + dt / 2, config);
  const current = state.concentration;
  const next = new Float64Array(current.length);

  for (let j = 0; j < ny; j += 1) {
    const rowStart = j * nx;
    for (let i = 0; i < nx; i += 1) {
      const index = rowStart + i;
      const center = current[index];
      const left = i === 0 ? center : current[index - 1];
      const right = i === nx - 1 ? center : current[index + 1];
      const below = j === 0 ? center : current[index - nx];
      const above = j === ny - 1 ? center : current[index + nx];

      const fluxLeft = i === 0
        ? velocity * center
        : velocity * (velocity >= 0 ? left : center);
      const fluxRight = i === nx - 1
        ? velocity * center
        : velocity * (velocity >= 0 ? center : right);
      const advection = -(fluxRight - fluxLeft) / dx;
      const diffusion = diffusivityM2ps
        * ((left - 2 * center + right) / dx ** 2
          + (below - 2 * center + above) / dy ** 2);
      next[index] = center + dt * (advection + diffusion);
    }
  }

  state.concentration = next;
  state.timeSeconds += dt;
  return state;
}

export function advanceTo(state, targetTimeSeconds, config) {
  if (!Number.isFinite(targetTimeSeconds) || targetTimeSeconds < state.timeSeconds) {
    throw new RangeError("The target time must be finite and no earlier than the current time.");
  }

  const maxStep = stableTimeStep(config);
  while (state.timeSeconds < targetTimeSeconds) {
    const remaining = targetTimeSeconds - state.timeSeconds;
    advanceOneStep(state, Math.min(maxStep, remaining), config);
  }
  return state;
}

export function calculateMetrics(state, config) {
  const { dx, dy } = gridSpacing(config);
  const concentration = state.concentration;
  let totalMassMg = 0;
  let weightedX = 0;
  let peakConcentration = 0;

  for (let j = 0; j < config.ny; j += 1) {
    for (let i = 0; i < config.nx; i += 1) {
      const value = concentration[j * config.nx + i];
      totalMassMg += value * dx * dy * config.depthM;
      weightedX += value * i * dx * dx * dy * config.depthM;
      peakConcentration = Math.max(peakConcentration, value);
    }
  }

  return {
    totalMassMg,
    centroidXM: totalMassMg > 0 ? weightedX / totalMassMg : 0,
    peakConcentration,
  };
}
