'use strict';

(() => {
  const config = window.CARD_CONFIG;
  const { clamp, damp, smoothstep, orientationMatrix, relativeTilt } = window.CardMotion;
  const scene = document.querySelector('.scene');
  const card = document.querySelector('.card');
  const faces = [...document.querySelectorAll('.card-face')];
  const status = document.querySelector('#status');
  const motionButton = document.querySelector('#motion');
  const flipButton = document.querySelector('#flip');
  const debug = document.querySelector('#debug');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  debug.hidden = new URLSearchParams(location.search).get('debug') !== '1';
  const state = {
    targetX: 0, targetY: 0, x: 0, y: 0,
    pointer: null, dragged: false, downX: 0, downY: 0, downTime: 0, lastTap: null,
    flip: 0, flipFrom: 0, flipTo: 0, flipStart: -config.flipDuration, flipped: false,
    motion: false, neutral: null, sensor: null, lastSensor: 0
  };
  let bounds = scene.getBoundingClientRect();
  let raf = null, lastTime = 0, watchdog = null;
  let debugTime = 0, debugFrames = 0;
  const screenAngle = () => screen.orientation?.angle ?? window.orientation ?? 0;

  document.querySelectorAll('[data-asset]').forEach(image => {
    image.addEventListener('error', () => {
      status.textContent = 'A card layer could not load. Reload the page to try again.';
      if (image.classList.contains('character') && image.dataset.fallback !== 'true') {
        image.dataset.fallback = 'true';
        image.src = config.placeholder;
        document.querySelector('.asset-label').hidden = false;
      }
    });
    image.src = config[image.dataset.asset];
  });
  faces.forEach(face => {
    for (const name of ['foil', 'rainbow', 'specular', 'glare', 'texture']) {
      const layer = document.createElement('div');
      layer.className = name;
      layer.setAttribute('aria-hidden', 'true');
      face.append(layer);
    }
  });
  function wake() {
    if (raf === null && !document.hidden) {
      lastTime = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function setTarget(x, y) {
    const factor = reduced.matches ? 0.3 : 1;
    state.targetX = clamp(x, -config.maxRotateX, config.maxRotateX) * factor;
    state.targetY = clamp(y, -config.maxRotateY, config.maxRotateY) * factor;
    wake();
  }
  function refreshBounds() { bounds = scene.getBoundingClientRect(); }
  new ResizeObserver(refreshBounds).observe(scene);
  addEventListener('scroll', refreshBounds, { passive: true });
  addEventListener('resize', refreshBounds, { passive: true });
  function pointerTarget(event) {
    setTarget(
      (0.5 - (event.clientY - bounds.top) / bounds.height) * config.maxRotateX * 2,
      ((event.clientX - bounds.left) / bounds.width - 0.5) * config.maxRotateY * 2
    );
  }
  scene.addEventListener('pointerenter', refreshBounds);
  scene.addEventListener('pointerdown', event => {
    if (state.pointer !== null || event.isPrimary === false || event.button !== 0) return;
    refreshBounds();
    state.pointer = event.pointerId;
    state.dragged = false;
    state.downX = event.clientX; state.downY = event.clientY;
    state.downTime = performance.now();
    scene.setPointerCapture(event.pointerId);
    pointerTarget(event);
  });
  scene.addEventListener('pointermove', event => {
    const dragging = state.pointer === event.pointerId;
    const hovering = event.pointerType === 'mouse' && state.pointer === null && !state.motion;
    if (!dragging && !hovering) return;
    if (dragging && Math.hypot(event.clientX - state.downX, event.clientY - state.downY) > 8) state.dragged = true;
    pointerTarget(event);
  });
  function releasePointer(event) {
    if (state.pointer !== event.pointerId) return;
    state.pointer = null;
    if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    const now = performance.now();
    let flipped = false;
    if (event.type === 'pointerup' && !state.dragged && now - state.downTime < 280) {
      const previous = state.lastTap;
      if (previous && now - previous.time < 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 28) {
        flipCard(); state.lastTap = null; flipped = true;
      } else state.lastTap = { time: now, x: event.clientX, y: event.clientY };
    } else state.lastTap = null;
    if (state.motion) applySensor();
    else if (!flipped) setTarget(0, 0);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) scene.addEventListener(event, releasePointer);
  scene.addEventListener('pointerleave', () => { if (state.pointer === null && !state.motion) setTarget(0, 0); });

  function render() {
    card.style.transform = `rotateX(${state.x.toFixed(4)}deg) rotateY(${(state.y + state.flip).toFixed(4)}deg)`;
    const depth = config.parallax * (reduced.matches ? 0.25 : 1);
    const variables = {
      '--px': `${(state.y * 0.24 * depth).toFixed(3)}px`,
      '--py': `${(-state.x * 0.24 * depth).toFixed(3)}px`,
      '--rx': `${state.x.toFixed(4)}deg`, '--ry': `${state.y.toFixed(4)}deg`,
      '--mx': `${50 + state.y * 2}%`, '--my': `${50 - state.x * 2}%`,
      '--foil-angle': `${120 + state.y * 4 - state.x * 2}deg`,
      '--glare-strength': config.glareStrength,
      '--reactor-light': 0.65 + Math.max(0, 1 - Math.hypot(state.x, state.y) / 22) * 0.3
    };
    const angle = Math.min(1, Math.hypot(state.x / config.maxRotateX, state.y / config.maxRotateY) / 1.42);
    variables['--foil-opacity'] = 0.05 + Math.sin(angle * Math.PI) ** 2 * config.foilStrength;
    for (const [key, value] of Object.entries(variables)) card.style.setProperty(key, value);
    const lightX = 50 - state.y * 3 - Math.sin(state.flip * Math.PI / 180) * 45;
    faces.forEach((face, index) => {
      face.style.setProperty('--glare-x', `${index ? 100 - lightX : lightX}%`);
      face.style.setProperty('--glare-y', `${35 + state.x * 3}%`);
    });
  }
  function frame(now) {
    raf = null;
    if (document.hidden) return;
    const elapsed = Math.min(lastTime ? now - lastTime : 1000 / 60, 50);
    state.x = damp(state.x, state.targetX, config.damping, elapsed);
    state.y = damp(state.y, state.targetY, config.damping, elapsed);
    const progress = clamp((now - state.flipStart) / config.flipDuration, 0, 1);
    state.flip = state.flipFrom + (state.flipTo - state.flipFrom) * smoothstep(progress);
    const settling = Math.abs(state.x - state.targetX) > 0.005 || Math.abs(state.y - state.targetY) > 0.005;
    if (!settling) { state.x = state.targetX; state.y = state.targetY; }
    render();
    if (!debug.hidden) {
      debugFrames++;
      if (now - debugTime > 300) {
        const sensor = state.sensor || {};
        debug.textContent = `alpha ${sensor.alpha?.toFixed(1) ?? '—'}\nbeta ${sensor.beta?.toFixed(1) ?? '—'}\ngamma ${sensor.gamma?.toFixed(1) ?? '—'}\ntarget RX ${state.targetX.toFixed(2)}\ntarget RY ${state.targetY.toFixed(2)}\ncurrent RX ${state.x.toFixed(2)}\ncurrent RY ${state.y.toFixed(2)}\nFPS ${Math.round(debugFrames * 1000 / (now - debugTime))}`;
        debugTime = now; debugFrames = 0;
      }
    }
    lastTime = now;
    // Normal mode sleeps once settled. Debug mode intentionally samples frame rate.
    if (settling || progress < 1 || !debug.hidden) raf = requestAnimationFrame(frame);
  }
  function applySensor() {
    if (!state.motion || !state.sensor || state.pointer !== null) return;
    const matrix = orientationMatrix(state.sensor);
    if (!state.neutral) { state.neutral = matrix; status.textContent = 'Motion enabled · neutral position saved.'; }
    const tilt = relativeTilt(state.neutral, matrix, screenAngle());
    setTarget(tilt.x * config.sensorSensitivity, tilt.y * config.sensorSensitivity);
  }
  function onOrientation(event) {
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma) || document.hidden) return;
    state.sensor = { alpha: Number.isFinite(event.alpha) ? event.alpha : 0, beta: event.beta, gamma: event.gamma };
    state.lastSensor = performance.now();
    applySensor();
  }
  function startWatchdog() {
    clearInterval(watchdog);
    watchdog = setInterval(() => {
      if (!document.hidden && state.motion && performance.now() - state.lastSensor > config.sensorTimeout) {
        stopMotion('No motion data received. Try Safari on iPhone, or drag the card.');
      }
    }, 250);
  }
  function stopMotion(message) {
    state.motion = false; state.neutral = null; state.sensor = null;
    clearInterval(watchdog);
    removeEventListener('deviceorientation', onOrientation);
    motionButton.textContent = 'ENABLE MOTION';
    motionButton.setAttribute('aria-pressed', 'false');
    status.textContent = message;
    setTarget(0, 0);
  }
  motionButton.addEventListener('click', async () => {
    if (state.motion) { stopMotion('Motion paused. Drag the card to explore.'); return; }
    if (!isSecureContext) { status.textContent = 'Motion requires HTTPS. You can still drag the card.'; return; }
    if (!('DeviceOrientationEvent' in window)) { status.textContent = 'Motion is unavailable here. Drag the card to explore.'; return; }
    motionButton.disabled = true;
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') { status.textContent = 'Motion permission denied. You can still drag the card.'; return; }
      }
      state.neutral = null; state.sensor = null; state.lastSensor = performance.now(); state.motion = true;
      addEventListener('deviceorientation', onOrientation, { passive: true });
      motionButton.textContent = 'PAUSE MOTION';
      motionButton.setAttribute('aria-pressed', 'true');
      status.textContent = 'Hold your phone comfortably to set the neutral position.';
      startWatchdog();
    } catch { status.textContent = 'Motion could not start. Try again or drag the card.'; }
    finally { motionButton.disabled = false; }
  });
  function resetOrientation() {
    state.neutral = null; state.sensor = null; state.lastSensor = performance.now();
    setTarget(0, 0); refreshBounds();
  }
  screen.orientation?.addEventListener('change', resetOrientation);
  addEventListener('orientationchange', resetOrientation);
  document.querySelector('#calibrate').addEventListener('click', () => {
    state.neutral = state.sensor ? orientationMatrix(state.sensor) : null;
    setTarget(0, 0);
    status.textContent = state.motion ? 'Neutral position recalibrated.' : 'Card centered. Enable motion to calibrate your phone.';
  });
  reduced.addEventListener('change', () => { if (state.motion) applySensor(); else setTarget(0, 0); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; clearInterval(watchdog); }
    else { resetOrientation(); if (state.motion) startWatchdog(); wake(); }
  });
  function flipCard() {
    state.flipped = !state.flipped; state.flipFrom = state.flip;
    state.flipTo = state.flipped ? 180 : 0; state.flipStart = performance.now();
    card.dataset.side = state.flipped ? 'back' : 'front';
    faces[0].setAttribute('aria-hidden', String(state.flipped));
    faces[1].setAttribute('aria-hidden', String(!state.flipped));
    flipButton.setAttribute('aria-pressed', String(state.flipped));
    wake();
  }
  flipButton.addEventListener('click', flipCard);
  scene.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key)) { event.preventDefault(); flipCard(); }
    else if (event.key === 'Escape') setTarget(0, 0);
    else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const delta = { ArrowLeft: [0, -4], ArrowRight: [0, 4], ArrowUp: [4, 0], ArrowDown: [-4, 0] }[event.key];
      if (delta) setTarget(delta[0], delta[1]);
    }
  });
  wake();
})();
