import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_CONFIG,
  advanceOneStep,
  advanceTo,
  calculateMetrics,
  createInitialState,
  stableTimeStep,
  velocityAt,
} from "../solver.js";

function makeConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    lengthM: 400,
    widthM: 100,
    nx: 41,
    ny: 21,
    depthM: 2,
    releaseXFraction: 0.5,
    releaseSigmaXM: 30,
    releaseSigmaYM: 12,
    ...overrides,
  };
}

test("the tidal velocity reverses the downstream river current", () => {
  const config = makeConfig({
    meanVelocityMps: -0.05,
    tidalAmplitudeMps: 0.1,
    tidalPeriodHours: 1,
    tidalPhaseRad: Math.PI / 2,
  });

  assert.ok(velocityAt(0, config) > 0, "flood tide should carry pollutant upstream");
  assert.ok(velocityAt(1800, config) < 0, "ebb tide should carry pollutant downstream");
});

test("the initial Gaussian release contains the configured pollutant mass", () => {
  const config = makeConfig();
  const state = createInitialState(config);
  const metrics = calculateMetrics(state, config);

  assert.ok(Math.abs(metrics.totalMassMg - config.releaseMassMg) / config.releaseMassMg < 1e-12);
  assert.ok(metrics.peakConcentration > 0);
});

test("diffusion preserves mass with closed boundaries and smooths the release", () => {
  const config = makeConfig({
    meanVelocityMps: 0,
    tidalAmplitudeMps: 0,
    diffusivityM2ps: 0.5,
  });
  const state = createInitialState(config);
  const before = calculateMetrics(state, config);

  advanceTo(state, 20, config);

  const after = calculateMetrics(state, config);
  assert.ok(Math.abs(after.totalMassMg - before.totalMassMg) / before.totalMassMg < 1e-12);
  assert.ok(after.peakConcentration < before.peakConcentration);
});

test("the flood tide moves the pollutant centroid upstream", () => {
  const config = makeConfig({
    meanVelocityMps: -0.02,
    tidalAmplitudeMps: 0.08,
    tidalPeriodHours: 1,
    tidalPhaseRad: Math.PI / 2,
    diffusivityM2ps: 0,
  });
  const state = createInitialState(config);
  const initialCentroid = calculateMetrics(state, config).centroidXM;

  advanceTo(state, 60, config);

  assert.ok(calculateMetrics(state, config).centroidXM > initialCentroid);
});

test("open ends allow pollutant mass to leave the river reach", () => {
  const config = makeConfig({
    meanVelocityMps: -0.1,
    tidalAmplitudeMps: 0,
    diffusivityM2ps: 0,
    releaseXFraction: 0.1,
  });
  const state = createInitialState(config);
  const initialMass = calculateMetrics(state, config).totalMassMg;

  advanceTo(state, 600, config);

  assert.ok(calculateMetrics(state, config).totalMassMg < initialMass);
});

test("unstable time steps are rejected", () => {
  const config = makeConfig({ meanVelocityMps: -0.1, tidalAmplitudeMps: 0.1 });
  const state = createInitialState(config);

  assert.throws(
    () => advanceOneStep(state, stableTimeStep(config) * 2, config),
    /stability limit/,
  );
});
