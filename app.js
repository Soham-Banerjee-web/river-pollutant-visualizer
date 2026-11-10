import {
  DEFAULT_CONFIG,
  advanceOneStep,
  advanceTo,
  calculateMetrics,
  createInitialState,
  stableTimeStep,
  velocityAt,
} from "./solver.js";

const SIMULATION_DURATION_SECONDS = 24 * 3600;
const CHECKPOINT_INTERVAL_SECONDS = 15 * 60;
const SIMULATION_SECONDS_PER_SECOND = 900;
const COLOR_STOPS = [
  [0.00, [26, 48, 62]],
  [0.12, [35, 91, 105]],
  [0.32, [38, 158, 151]],
  [0.55, [172, 207, 105]],
  [0.76, [246, 169, 69]],
  [1.00, [241, 97, 72]],
];

const elements = {
  riverCanvas: document.querySelector("#river-canvas"),
  profileCanvas: document.querySelector("#profile-canvas"),
  playButton: document.querySelector("#play-button"),
  playIcon: document.querySelector("#play-icon"),
  resetButton: document.querySelector("#reset-button"),
  timeSlider: document.querySelector("#time-slider"),
  riverCurrent: document.querySelector("#river-current"),
  riverCurrentValue: document.querySelector("#river-current-value"),
  tideAmplitude: document.querySelector("#tide-amplitude"),
  tideAmplitudeValue: document.querySelector("#tide-amplitude-value"),
  tidePeriod: document.querySelector("#tide-period"),
  tidePeriodValue: document.querySelector("#tide-period-value"),
  diffusivity: document.querySelector("#diffusivity"),
  diffusivityValue: document.querySelector("#diffusivity-value"),
  elapsedTime: document.querySelector("#elapsed-time"),
  currentVelocity: document.querySelector("#current-velocity"),
  centroidPosition: document.querySelector("#centroid-position"),
  peakConcentration: document.querySelector("#peak-concentration"),
  flowBadge: document.querySelector("#flow-badge"),
  flowState: document.querySelector("#flow-state"),
  timelineCaption: document.querySelector("#timeline-caption"),
  endTimeLabel: document.querySelector("#end-time-label"),
};

const mapContext = elements.riverCanvas.getContext("2d");
const profileContext = elements.profileCanvas.getContext("2d");
const initialConfig = { ...DEFAULT_CONFIG };
let config = { ...initialConfig };
let state = createInitialState(config);
let initialPeak = calculateMetrics(state, config).peakConcentration;
let checkpoints = new Map([[0, cloneState(state)]]);
let playing = false;
let lastFrameTime = 0;
let timeAccumulator = 0;
let lastUiUpdate = 0;

function cloneState(source) {
  return {
    concentration: source.concentration.slice(),
    timeSeconds: source.timeSeconds,
  };
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function exponentLabel(value) {
  return String(Math.round(value)).replace("-", "−");
}

function readControls() {
  config = {
    ...DEFAULT_CONFIG,
    meanVelocityMps: Number(elements.riverCurrent.value),
    tidalAmplitudeMps: Number(elements.tideAmplitude.value),
    tidalPeriodHours: Number(elements.tidePeriod.value),
    diffusivityM2ps: 10 ** Number(elements.diffusivity.value),
  };

  elements.riverCurrentValue.textContent = `${config.meanVelocityMps.toFixed(2).replace("-", "−")} m/s`;
  elements.tideAmplitudeValue.textContent = `${config.tidalAmplitudeMps.toFixed(2)} m/s`;
  elements.tidePeriodValue.textContent = `${config.tidalPeriodHours.toFixed(2)} h`;
  elements.diffusivityValue.textContent = `1.0 × 10${exponentLabel(Math.log10(config.diffusivityM2ps))} m²/s`;
}

function resetModel() {
  pause();
  readControls();
  state = createInitialState(config);
  initialPeak = calculateMetrics(state, config).peakConcentration;
  checkpoints = new Map([[0, cloneState(state)]]);
  elements.timeSlider.value = "0";
  render();
}

function saveCheckpoint() {
  const bucket = Math.floor(state.timeSeconds / CHECKPOINT_INTERVAL_SECONDS);
  if (Math.abs(state.timeSeconds - bucket * CHECKPOINT_INTERVAL_SECONDS) < 1e-6) {
    checkpoints.set(bucket, cloneState(state));
  }
}

function seekTo(targetTimeSeconds) {
  const target = Math.max(0, Math.min(SIMULATION_DURATION_SECONDS, targetTimeSeconds));
  if (target < state.timeSeconds) {
    const bucket = Math.floor(target / CHECKPOINT_INTERVAL_SECONDS);
    const saved = checkpoints.get(bucket);
    state = saved ? cloneState(saved) : createInitialState(config);
  }

  while (state.timeSeconds < target) {
    const nextCheckpoint = (Math.floor(state.timeSeconds / CHECKPOINT_INTERVAL_SECONDS) + 1)
      * CHECKPOINT_INTERVAL_SECONDS;
    const stepTarget = Math.min(target, nextCheckpoint);
    advanceTo(state, stepTarget, config);
    saveCheckpoint();
  }
  elements.timeSlider.value = String(Math.round(state.timeSeconds));
}

function interpolateColor(value) {
  const scaled = Math.max(0, Math.min(1, value));
  let index = 0;
  while (index < COLOR_STOPS.length - 2 && scaled > COLOR_STOPS[index + 1][0]) {
    index += 1;
  }
  const [startPosition, startColor] = COLOR_STOPS[index];
  const [endPosition, endColor] = COLOR_STOPS[index + 1];
  const mix = (scaled - startPosition) / (endPosition - startPosition);
  return startColor.map((channel, channelIndex) => Math.round(
    channel + (endColor[channelIndex] - channel) * Math.max(0, Math.min(1, mix)),
  ));
}

function fitCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawRiver() {
  const { width, height } = fitCanvas(elements.riverCanvas, mapContext);
  const { nx, ny } = config;
  const concentration = state.concentration;
  const cellWidth = width / nx;
  const cellHeight = height / ny;
  const maxScale = initialPeak || 1;

  mapContext.clearRect(0, 0, width, height);
  mapContext.fillStyle = "#132b35";
  mapContext.fillRect(0, 0, width, height);

  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const value = concentration[j * nx + i] / maxScale;
      if (value < 0.001) continue;
      const [red, green, blue] = interpolateColor(value);
      mapContext.fillStyle = `rgb(${red} ${green} ${blue})`;
      mapContext.fillRect(i * cellWidth, j * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    }
  }

  const velocity = velocityAt(state.timeSeconds, config);
  const direction = velocity >= 0 ? 1 : -1;
  const centerY = height / 2;
  mapContext.strokeStyle = "rgb(231 246 230 / 62%)";
  mapContext.fillStyle = "rgb(231 246 230 / 72%)";
  mapContext.lineWidth = 1;
  for (let i = 12; i < nx - 8; i += 25) {
    const x = (i / nx) * width;
    const halfLength = 6;
    mapContext.beginPath();
    mapContext.moveTo(x - direction * halfLength, centerY);
    mapContext.lineTo(x + direction * halfLength, centerY);
    mapContext.stroke();
    mapContext.beginPath();
    mapContext.moveTo(x + direction * halfLength, centerY);
    mapContext.lineTo(x + direction * (halfLength - 4), centerY - 3);
    mapContext.lineTo(x + direction * (halfLength - 4), centerY + 3);
    mapContext.closePath();
    mapContext.fill();
  }

  mapContext.strokeStyle = "rgb(153 204 187 / 45%)";
  mapContext.setLineDash([5, 5]);
  mapContext.beginPath();
  mapContext.moveTo(0, 1);
  mapContext.lineTo(width, 1);
  mapContext.moveTo(0, height - 1);
  mapContext.lineTo(width, height - 1);
  mapContext.stroke();
  mapContext.setLineDash([]);
}

function drawProfile() {
  const { width, height } = fitCanvas(elements.profileCanvas, profileContext);
  const { nx, ny } = config;
  const centerline = Math.floor(ny / 2);
  const values = new Float64Array(nx);
  let maximum = 0;
  for (let i = 0; i < nx; i += 1) {
    values[i] = state.concentration[centerline * nx + i];
    maximum = Math.max(maximum, values[i]);
  }

  profileContext.clearRect(0, 0, width, height);
  profileContext.strokeStyle = "#2b393e";
  profileContext.lineWidth = 1;
  profileContext.beginPath();
  profileContext.moveTo(0, height - 1);
  profileContext.lineTo(width, height - 1);
  profileContext.stroke();

  if (maximum <= 0) return;
  profileContext.beginPath();
  for (let i = 0; i < nx; i += 1) {
    const x = (i / (nx - 1)) * width;
    const y = height - 3 - (values[i] / maximum) * (height - 9);
    if (i === 0) profileContext.moveTo(x, y);
    else profileContext.lineTo(x, y);
  }
  profileContext.lineTo(width, height);
  profileContext.lineTo(0, height);
  profileContext.closePath();
  profileContext.fillStyle = "rgb(90 187 155 / 12%)";
  profileContext.fill();
  profileContext.beginPath();
  for (let i = 0; i < nx; i += 1) {
    const x = (i / (nx - 1)) * width;
    const y = height - 3 - (values[i] / maximum) * (height - 9);
    if (i === 0) profileContext.moveTo(x, y);
    else profileContext.lineTo(x, y);
  }
  profileContext.strokeStyle = "#83dbb5";
  profileContext.lineWidth = 1.5;
  profileContext.stroke();
}

function updateReadouts() {
  const velocity = velocityAt(state.timeSeconds, config);
  const metrics = calculateMetrics(state, config);
  const nearSlack = Math.abs(velocity) < 0.005;
  const upstream = velocity > 0.005;

  elements.elapsedTime.textContent = formatClock(state.timeSeconds);
  elements.currentVelocity.innerHTML = `${velocity >= 0 ? "+" : "−"}${Math.abs(velocity).toFixed(3)} <small>m/s</small>`;
  elements.centroidPosition.innerHTML = `${Math.round(metrics.centroidXM)} <small>m from mouth</small>`;
  const peakLabel = metrics.peakConcentration < 0.01
    ? "<0.01"
    : metrics.peakConcentration.toFixed(2);
  elements.peakConcentration.innerHTML = `${peakLabel} <small>mg/m³</small>`;
  elements.flowBadge.classList.toggle("ebb", !upstream && !nearSlack);
  elements.flowState.textContent = nearSlack ? "SLACK WATER" : upstream ? "FLOOD TIDE" : "EBB / RIVER FLOW";
  elements.flowBadge.querySelector(".flow-indicator").textContent = nearSlack ? "↔" : upstream ? "↑" : "↓";
  elements.timelineCaption.textContent = nearSlack
    ? "The tide is turning; the plume is close to slack water."
    : upstream
      ? "The flood tide is carrying the plume upstream."
      : "River flow and the ebb tide are carrying the plume downstream.";

  if (metrics.totalMassMg < config.releaseMassMg * 0.01) {
    elements.timelineCaption.textContent = "More than 99% of the released pollutant has left the modeled reach.";
  }
}

function render() {
  drawRiver();
  drawProfile();
  updateReadouts();
}

function pause() {
  playing = false;
  lastFrameTime = 0;
  timeAccumulator = 0;
  elements.playIcon.textContent = "▶";
  elements.playButton.setAttribute("aria-label", "Play simulation");
}

function togglePlayback() {
  if (state.timeSeconds >= SIMULATION_DURATION_SECONDS) seekTo(0);
  playing = !playing;
  lastFrameTime = 0;
  elements.playIcon.textContent = playing ? "Ⅱ" : "▶";
  elements.playButton.setAttribute("aria-label", playing ? "Pause simulation" : "Play simulation");
}

function frame(timestamp) {
  if (playing) {
    if (lastFrameTime > 0) {
      timeAccumulator += Math.min(timestamp - lastFrameTime, 100) / 1000
        * SIMULATION_SECONDS_PER_SECOND;
      while (
        timeAccumulator >= stableTimeStep(config)
        && state.timeSeconds < SIMULATION_DURATION_SECONDS
      ) {
        const nextCheckpoint = (Math.floor(state.timeSeconds / CHECKPOINT_INTERVAL_SECONDS) + 1)
          * CHECKPOINT_INTERVAL_SECONDS;
        const nextTarget = Math.min(nextCheckpoint, SIMULATION_DURATION_SECONDS);
        const dt = Math.min(stableTimeStep(config), nextTarget - state.timeSeconds);
        advanceOneStep(state, dt, config);
        timeAccumulator -= dt;
        saveCheckpoint();
      }
    }
    lastFrameTime = timestamp;
    if (state.timeSeconds >= SIMULATION_DURATION_SECONDS) {
      state.timeSeconds = SIMULATION_DURATION_SECONDS;
      pause();
    }
    if (timestamp - lastUiUpdate > 100) {
      elements.timeSlider.value = String(Math.round(state.timeSeconds));
      render();
      lastUiUpdate = timestamp;
    }
  }
  requestAnimationFrame(frame);
}

elements.playButton.addEventListener("click", togglePlayback);
elements.resetButton.addEventListener("click", resetModel);
elements.timeSlider.addEventListener("input", () => {
  pause();
  seekTo(Number(elements.timeSlider.value));
  render();
});
for (const control of [elements.riverCurrent, elements.tideAmplitude, elements.tidePeriod, elements.diffusivity]) {
  control.addEventListener("input", () => {
    const wasPlaying = playing;
    pause();
    readControls();
    state = createInitialState(config);
    initialPeak = calculateMetrics(state, config).peakConcentration;
    checkpoints = new Map([[0, cloneState(state)]]);
    render();
    if (wasPlaying) togglePlayback();
  });
}
window.addEventListener("resize", render);

elements.endTimeLabel.textContent = formatClock(SIMULATION_DURATION_SECONDS);
readControls();
render();
requestAnimationFrame(frame);
