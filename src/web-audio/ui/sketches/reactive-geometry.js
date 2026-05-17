/**
 * Reactive Geometry sketch — rings and particles driven by audio.
 *
 * Exports a function(p, bus, ctx, container) compatible with wam-visualizer.
 */
export default function reactiveGeometry(p, bus, ctx, container) {
  let particles = [];
  const maxParticles = 120;

  p.setup = () => {
    const { width, height } = container.getBoundingClientRect();
    p.createCanvas(width || 600, height || 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.noStroke();
  };

  p.windowResized = () => {
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) p.resizeCanvas(width, height);
  };

  p.draw = () => {
    const now = ctx?.currentTime || 0;
    const data = bus.snapshot(now);
    if (!data.master) {
      p.background(0, 0, 5);
      return;
    }

    const { master, instruments, beat, triggers } = data;

    // Background fade (trail effect)
    p.background(0, 0, 5, 12);

    const cx = p.width / 2;
    const cy = p.height / 2;

    // ---- Central ring: master waveform as radial shape ----
    const ringRadius = p.min(p.width, p.height) * 0.25 * (0.8 + master.rms * 0.6);
    const waveLen = master.waveform.length;
    const hueBase = (beat.step * 22.5 + beat.phase * 22.5) % 360;

    p.push();
    p.translate(cx, cy);
    p.noFill();
    p.strokeWeight(2);
    p.stroke(hueBase, 70, 90, 70);
    p.beginShape();
    for (let i = 0; i < waveLen; i += 4) {
      const angle = (i / waveLen) * p.TWO_PI;
      const amp = (master.waveform[i] - 128) / 128;
      const r = ringRadius + amp * ringRadius * 0.5;
      p.vertex(p.cos(angle) * r, p.sin(angle) * r);
    }
    p.endShape(p.CLOSE);
    p.pop();

    // ---- FFT bars as radial spikes ----
    const binCount = 64; // use first 64 bins
    p.push();
    p.translate(cx, cy);
    for (let i = 0; i < binCount; i++) {
      const angle = (i / binCount) * p.TWO_PI - p.HALF_PI;
      const amp = master.fft[i] / 255;
      const spikeLen = amp * ringRadius * 0.8;
      const hue = (hueBase + i * 3) % 360;
      p.stroke(hue, 60, 80 + amp * 20, 60);
      p.strokeWeight(2);
      const x1 = p.cos(angle) * ringRadius;
      const y1 = p.sin(angle) * ringRadius;
      const x2 = p.cos(angle) * (ringRadius + spikeLen);
      const y2 = p.sin(angle) * (ringRadius + spikeLen);
      p.line(x1, y1, x2, y2);
    }
    p.pop();

    // ---- Particles burst on triggers ----
    for (const t of triggers) {
      if (t.age === 1 && particles.length < maxParticles) {
        const count = Math.ceil(t.velocity * 6);
        for (let i = 0; i < count; i++) {
          particles.push({
            x: cx,
            y: cy,
            vx: p.random(-3, 3) * t.velocity,
            vy: p.random(-3, 3) * t.velocity,
            life: 1,
            decay: p.random(0.01, 0.03),
            hue: (hueBase + p.random(-30, 30)) % 360,
            size: p.random(3, 8) * t.velocity,
          });
        }
      }
    }

    // Update and draw particles
    p.noStroke();
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vx *= 0.98;
      pt.vy *= 0.98;
      pt.life -= pt.decay;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.fill(pt.hue, 70, 90, pt.life * 80);
      p.ellipse(pt.x, pt.y, pt.size * pt.life, pt.size * pt.life);
    }

    // ---- Beat pulse ring ----
    const pulseAlpha = (1 - beat.phase) * 40;
    const pulseR = ringRadius * 1.3 + beat.phase * ringRadius * 0.4;
    p.noFill();
    p.stroke(hueBase, 40, 100, pulseAlpha);
    p.strokeWeight(1.5);
    p.ellipse(cx, cy, pulseR * 2, pulseR * 2);

    // ---- Per-instrument orbit dots ----
    const names = Object.keys(instruments);
    names.forEach((name, idx) => {
      const inst = instruments[name];
      const orbitAngle = (idx / names.length) * p.TWO_PI + p.frameCount * 0.005;
      const orbitR = ringRadius * 1.6 + inst.rms * 40;
      const x = cx + p.cos(orbitAngle) * orbitR;
      const y = cy + p.sin(orbitAngle) * orbitR;
      const dotHue = (idx * 60 + 120) % 360;
      const dotSize = 6 + inst.rms * 20;
      p.noStroke();
      p.fill(dotHue, 70, 90, 60 + inst.rms * 30);
      p.ellipse(x, y, dotSize, dotSize);
    });
  };
}
