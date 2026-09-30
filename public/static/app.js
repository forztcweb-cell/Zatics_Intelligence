(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // Progressive enhancement: content remains visible if JavaScript is unavailable.
  if (!reducedMotion.matches) {
    document.documentElement.classList.add('js-motion');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    $$('.reveal').forEach(element => observer.observe(element));
  }

  const header = $('#site-header');
  const menuToggle = $('#menu-toggle');
  const mobileNav = $('#mobile-nav');
  const closeMenu = () => { mobileNav.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open navigation'); };
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    mobileNav.hidden = !open;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  });
  $$('#mobile-nav a').forEach(link => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', () => { header.classList.toggle('is-scrolled', window.scrollY > 90); }, { passive: true });
  const navObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      $$('.desktop-nav a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id));
    }
  }), { rootMargin: '-20% 0px -55% 0px' });
  $$('main section[id]').forEach(section => navObserver.observe(section));
  $('#back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' }));

  // Original 3D toroidal intelligence field, rendered with the Canvas API.
  // No third-party assets, video files, or WebGL dependencies.
  const canvas = $('#intelligence-canvas');
  const context = canvas.getContext('2d');
  const visual = $('#intelligence-visual');
  const motionButton = $('#motion-toggle');
  let paused = reducedMotion.matches, inView = true, time = 0, lastFrame = 0;
  let width = 0, height = 0, ratio = 1, pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  let frameId = 0;
  const ringSegments = 104, tubeSegments = 36;
  const TAU = Math.PI * 2;
  const stars = Array.from({ length: 43 }, (_, i) => ({ x: Math.sin(i * 127.1) * .46, y: Math.cos(i * 83.7) * .44, r: i % 9 === 0 ? 1.3 : .55 }));
  const rotation = (x, y, z, a, b, c) => {
    let y1 = y * Math.cos(a) - z * Math.sin(a), z1 = y * Math.sin(a) + z * Math.cos(a);
    let x1 = x * Math.cos(b) + z1 * Math.sin(b), z2 = -x * Math.sin(b) + z1 * Math.cos(b);
    return [x1 * Math.cos(c) - y1 * Math.sin(c), x1 * Math.sin(c) + y1 * Math.cos(c), z2];
  };
  function drawCore() {
    if (!context || !width || !height) return;
    const ctx = context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cx = width * .51, cy = height * .47, scale = Math.min(width / 530, height / 500);
    const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 245 * scale);
    glow.addColorStop(0, '#a9d45d03'); glow.addColorStop(.48, '#9ec9480c'); glow.addColorStop(.75, '#71933106'); glow.addColorStop(1, '#70903500');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
    // Sparse spatial reference points and orbital trajectories.
    stars.forEach((star, i) => {
      ctx.fillStyle = `rgba(173,196,139,${.14 + .12 * Math.sin(time + i)})`;
      ctx.beginPath(); ctx.arc(cx + star.x * width, cy + star.y * height, star.r, 0, TAU); ctx.fill();
    });
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.46);
    ctx.strokeStyle = '#bfd18f13'; ctx.lineWidth = .7;
    ctx.setLineDash([2, 9]); ctx.beginPath(); ctx.ellipse(0, 0, 244 * scale, 159 * scale, 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.strokeStyle = '#bfd18f0c'; ctx.beginPath(); ctx.ellipse(0, 0, 255 * scale, 185 * scale, 0, 0, TAU); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const angle = time * .09 + i * TAU / 3;
      ctx.fillStyle = '#c6df9a88'; ctx.beginPath(); ctx.arc(Math.cos(angle) * 244 * scale, Math.sin(angle) * 159 * scale, 1.8, 0, TAU); ctx.fill();
    }
    ctx.restore();
    const points = [];
    const ax = .90 + pointerY * .12, ay = .28 + pointerX * .14, az = -.53;
    for (let u = 0; u < ringSegments; u++) {
      const theta = u / ringSegments * TAU;
      for (let v = 0; v < tubeSegments; v++) {
        const phi = v / tubeSegments * TAU;
        const twist = phi + Math.sin(theta * 3 + time * .16) * .16;
        const major = 136 + Math.sin(theta * 3 + time * .15) * 5;
        const minor = 63 + Math.sin(theta * 5 - time * .2) * 4 + Math.cos(phi * 3 + theta * 3) * 2;
        const radius = major + minor * Math.cos(twist);
        const p = rotation(radius * Math.cos(theta + time * .055), radius * Math.sin(theta + time * .055), minor * Math.sin(twist), ax, ay, az);
        const perspective = 700 / (700 - p[2]);
        points.push({ x: cx + p[0] * scale * perspective, y: cy + p[1] * scale * perspective, z: p[2], light: Math.max(0, Math.cos(theta * 2 + phi - time * .055)) });
      }
    }
    const lines = [];
    for (let u = 0; u < ringSegments; u++) {
      for (let v = 0; v < tubeSegments; v++) {
        const a = points[u * tubeSegments + v];
        const b = points[u * tubeSegments + (v + 1) % tubeSegments];
        lines.push({ a, b, z: (a.z + b.z) / 2, cross: false });
        if (v % 3 === 0) {
          const c = points[((u + 1) % ringSegments) * tubeSegments + v];
          lines.push({ a, b: c, z: (a.z + c.z) / 2, cross: true });
        }
      }
    }
    lines.sort((a, b) => a.z - b.z);
    lines.forEach(line => {
      const depth = (line.z + 195) / 390;
      const alpha = (.07 + depth * depth * .60 + line.a.light * .17) * (line.cross ? .58 : 1);
      ctx.strokeStyle = `rgba(${164 + Math.floor(depth * 59)},${187 + Math.floor(depth * 50)},${105 + Math.floor(depth * 39)},${alpha})`;
      ctx.lineWidth = line.cross ? .45 : .66;
      ctx.beginPath(); ctx.moveTo(line.a.x, line.a.y); ctx.lineTo(line.b.x, line.b.y); ctx.stroke();
    });
    // Distributed bright processing nodes, with a slow data pulse.
    for (let i = 0; i < 22; i++) {
      const index = (i * 173 + Math.floor(time * 3)) % points.length;
      const p = points[index];
      if (p.z < 0) continue;
      const pulse = .3 + (Math.sin(time * .8 + i * 1.3) + 1) * .28;
      ctx.fillStyle = `rgba(226,255,172,${pulse})`;
      ctx.shadowColor = '#c9ef8c'; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.05 * scale, 0, TAU); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
  function frame(now) {
    frameId = 0;
    if (paused || !inView || document.hidden) return;
    if (now - lastFrame >= 32) {
      time += Math.min((now - lastFrame) / 1000, .04);
      pointerX += (targetX - pointerX) * .06;
      pointerY += (targetY - pointerY) * .06;
      lastFrame = now;
      drawCore();
    }
    frameId = requestAnimationFrame(frame);
  }
  const startAnimation = () => { if (!frameId && !paused && inView && !document.hidden) { lastFrame = performance.now(); frameId = requestAnimationFrame(frame); } };
  const updateMotionButton = () => { motionButton.textContent = paused ? '▷' : 'Ⅱ'; motionButton.setAttribute('aria-label', paused ? 'Play visual animation' : 'Pause visual animation'); motionButton.setAttribute('aria-pressed', String(paused)); };
  new ResizeObserver(() => {
    const bounds = visual.getBoundingClientRect();
    width = bounds.width; height = bounds.height; ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio;
    drawCore(); startAnimation();
  }).observe(visual);
  new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; startAnimation(); }, { threshold: 0 }).observe(visual);
  visual.addEventListener('pointermove', event => { const rect = visual.getBoundingClientRect(); targetX = (event.clientX - rect.left) / rect.width - .5; targetY = (event.clientY - rect.top) / rect.height - .5; });
  visual.addEventListener('pointerleave', () => { targetX = 0; targetY = 0; });
  motionButton.addEventListener('click', () => { paused = !paused; updateMotionButton(); startAnimation(); });
  reducedMotion.addEventListener('change', event => { paused = event.matches; updateMotionButton(); startAnimation(); });
  document.addEventListener('visibilitychange', startAnimation);
  updateMotionButton();

  // Explainable, deterministic workflow simulations. No fictitious live metrics.
  const stages = [
    ['UNDERSTAND', 'Context before computation.', 'Connect documents, business systems, and live data. Transform fragmented information into grounded, usable context.'],
    ['REASON', 'Turn context into a plan.', 'Analyse the objective, retrieve relevant knowledge, and break the problem into a sequence of achievable steps.'],
    ['DECIDE', 'The right action. Within the right boundaries.', 'Evaluate options against business rules and confidence thresholds. Route sensitive or uncertain decisions to a human.'],
    ['COORDINATE', 'Specialists working as one system.', 'Delegate tasks to the right agents and tools, share context, and manage dependencies across the workflow.'],
    ['EXECUTE', 'Close the loop. Verify the outcome.', 'Carry out authorised actions through your connected systems, check the results, and create a traceable record.']
  ];
  const workflows = {
    invoice: {
      logs: [ ['document.parse — invoice #INV-2048', 'Extracted supplier, total, and purchase order.'], ['context.retrieve — matching purchase order', '3 line items matched against approved PO.'], ['policy.check — payment requires approval', 'Human approval checkpoint → approved (simulated).'], ['agents.delegate — finance + operations', 'Preparing accounting entry and supplier update.'], ['workflow.complete — invoice processed', 'Draft entry created. Approval recorded. Audit trail saved.'] ]
    },
    customer: {
      logs: [ ['request.ingest — delivery status enquiry', 'Customer intent identified. Order context retrieved.'], ['context.reason — fulfilment status', 'Shipment delay identified from carrier events.'], ['policy.check — response permissions', 'Within service policy. No refund action authorised.'], ['agents.delegate — support + logistics', 'Retrieving ETA and preparing an informed response.'], ['workflow.complete — customer informed', 'Response drafted. CRM updated. Follow-up scheduled.'] ]
    },
    knowledge: {
      logs: [ ['query.ingest — supplier risk overview', 'Query scoped to the user’s permitted data sources.'], ['knowledge.retrieve — evidence synthesis', 'Policies, contracts, and review notes connected.'], ['evidence.check — source validation', 'Claims checked against retrieved source documents.'], ['agents.delegate — research + synthesis', 'Risk findings organised with supporting citations.'], ['workflow.complete — brief generated', 'Evidence-grounded summary prepared for human review.'] ]
    }
  };
  const stepButtons = $$('.pipeline-step');
  let running = false;
  function selectStage(index, fromSimulation = false) {
    stepButtons.forEach((button, i) => { button.classList.toggle('selected', index === i); button.setAttribute('aria-pressed', String(index === i)); });
    $('#stage-label').textContent = `0${index + 1} / ${stages[index][0]}`;
    $('#stage-title').textContent = stages[index][1];
    $('#stage-description').textContent = stages[index][2];
    if (!fromSimulation && !running) {
      $('#terminal-line').textContent = `stage.inspect — ${stages[index][0].toLowerCase()}`;
      $('#terminal-secondary').textContent = 'Ready to explore. Run a workflow simulation.';
    }
  }
  stepButtons.forEach((button, index) => button.addEventListener('click', () => { if (!running) selectStage(index); }));
  $('#workflow-select').addEventListener('change', () => {
    selectStage(0);
    stepButtons.forEach(button => { button.classList.remove('complete', 'running'); button.querySelector('.step-status').textContent = 'READY'; });
    $('#terminal-line').textContent = 'system.ready — workflow selected';
    $('#terminal-secondary').textContent = 'Run the simulation to follow each decision.';
    $('#run-workflow').innerHTML = '<span class="play-icon">▷</span> Run simulation';
  });
  $('#run-workflow').addEventListener('click', async () => {
    if (running) return;
    running = true;
    const runButton = $('#run-workflow'), selector = $('#workflow-select');
    const selected = workflows[selector.value];
    runButton.disabled = true; selector.disabled = true;
    runButton.textContent = 'Simulating…';
    stepButtons.forEach(button => { button.disabled = true; button.classList.remove('complete', 'running'); button.querySelector('.step-status').textContent = 'QUEUED'; });
    for (let index = 0; index < stages.length; index++) {
      selectStage(index, true);
      const current = stepButtons[index];
      current.classList.add('running');
      current.querySelector('.step-status').textContent = 'ACTIVE';
      const pipeline = $('.pipeline');
      pipeline.scrollTo({ left: current.offsetLeft - pipeline.offsetLeft - 15, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
      $('#terminal-line').textContent = selected.logs[index][0];
      $('#terminal-secondary').textContent = selected.logs[index][1];
      await new Promise(resolve => setTimeout(resolve, 1150));
      current.classList.remove('running'); current.classList.add('complete');
      current.querySelector('.step-status').textContent = 'DONE ✓';
    }
    running = false;
    stepButtons.forEach(button => { button.disabled = false; });
    runButton.disabled = false; selector.disabled = false;
    runButton.innerHTML = '<span class="play-icon">↻</span> Run again';
  });

  const technologies = [
    ['The right model. Not just one model.', 'We select and route between models based on task complexity, latency, cost, and your data requirements. No unnecessary lock-in.'],
    ['Your data. Your boundaries.', 'Access controls, scoped tool permissions, data isolation, and human approval gates are designed into the architecture from the start.'],
    ['See the reasoning. Trace the action.', 'Evaluation, execution traces, and operational monitoring make system behaviour inspectable — so your teams stay in control.']
  ];
  const techButtons = $$('[data-tech]');
  function setTechnology(index) {
    techButtons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; });
    $('#tech-title').textContent = technologies[index][0];
    $('#tech-description').textContent = technologies[index][1];
    $('#tech-panel').setAttribute('aria-labelledby', `tech-tab-${index}`);
    $('#tech-panel').dataset.active = String(index);
  }
  techButtons.forEach((button, index) => {
    button.addEventListener('click', () => setTechnology(index));
    button.addEventListener('keydown', event => {
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % techButtons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + techButtons.length) % techButtons.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = techButtons.length - 1;
      else return;
      event.preventDefault(); setTechnology(next); techButtons[next].focus();
    });
  });
  $$('[data-capability]').forEach(link => link.addEventListener('click', () => {
    const details = $(`#capability-${link.dataset.capability}`);
    details.open = true;
  }));

  // Real enquiries are persisted through the Hono API to Cloudflare D1.
  const dialog = $('#contact-dialog');
  const form = $('#contact-form');
  const dateInput = $('#contact-date');
  const timeInput = $('#contact-time');
  const slotPills = $$('.slot-pill');
  const scheduleSummary = $('#enquiry-schedule-summary');
  let lastFocused = null;

  function updateMinDate() {
    if (dateInput) {
      const today = new Date().toISOString().split('T')[0];
      dateInput.min = today;
    }
  }
  updateMinDate();

  slotPills.forEach(pill => {
    pill.addEventListener('click', () => {
      if (timeInput) {
        timeInput.value = pill.dataset.time || '';
        slotPills.forEach(p => p.classList.toggle('is-active', p === pill));
      }
    });
  });

  if (timeInput) {
    timeInput.addEventListener('input', () => {
      slotPills.forEach(p => p.classList.toggle('is-active', p.dataset.time === timeInput.value));
    });
  }

  function resetSchedulePills() {
    slotPills.forEach(p => p.classList.remove('is-active'));
  }

  function closeDialog() { dialog.close(); lastFocused?.focus(); }
  $$('[data-contact]').forEach(button => button.addEventListener('click', () => {
    lastFocused = button; closeMenu();
    updateMinDate();
    $('#contact-form-view').hidden = false;
    $('#contact-success').hidden = true;
    $('#form-error').hidden = true;
    $('#contact-interest').value = button.dataset.interest || 'Let’s explore together';
    dialog.showModal();
  }));
  $('#dialog-close').addEventListener('click', closeDialog);
  $('#success-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => { const bounds = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) closeDialog(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    const error = $('#form-error');
    submit.disabled = true; submit.textContent = 'Sending your enquiry…'; error.hidden = true;
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const response = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
      // Safely parse JSON — avoids "Unexpected end of JSON input" when server returns HTML or an empty body
      let result;
      try {
        const text = await response.text();
        result = text ? JSON.parse(text) : {};
      } catch {
        throw new Error('The server returned an unexpected response. Please try again.');
      }
      if (!response.ok) throw new Error(result.error || 'Unable to send your enquiry. Please try again.');
      if (!result.success) throw new Error('Your enquiry could not be confirmed. Please try again.');
      $('#contact-form-view').hidden = true; $('#contact-success').hidden = false;
      $('#enquiry-reference').textContent = result.reference ? `YOUR REFERENCE / ZI-${result.reference}` : '';
      if (scheduleSummary) {
        if (payload.preferred_date || payload.preferred_time) {
          const parts = [];
          if (payload.preferred_date) {
            try {
              const d = new Date(payload.preferred_date + 'T00:00:00');
              parts.push(d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
            } catch {
              parts.push(payload.preferred_date);
            }
          }
          if (payload.preferred_time) {
            parts.push(`at ${payload.preferred_time}`);
          }
          scheduleSummary.innerHTML = `<span>CONSULTATION SCHEDULE REQUESTED</span><br/><strong>${parts.join(' ')}</strong>`;
          scheduleSummary.hidden = false;
        } else {
          scheduleSummary.hidden = true;
        }
      }
      form.reset(); resetSchedulePills(); $('#success-close').focus();
    } catch (err) {
      error.textContent = err.name === 'TimeoutError' || err.name === 'TypeError' ? 'Connection interrupted. Please check your connection and try again.' : err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.innerHTML = 'Send your enquiry <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>';
    }
  });
})();
