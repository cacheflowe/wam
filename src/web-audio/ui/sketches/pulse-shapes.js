/**
 * Pulse Shapes sketch — expanding stroked shapes on instrument triggers.
 *
 * Kick  → large square (red/orange)
 * Snare → medium circle (cyan)
 * Hi-Hat → small circle (yellow)
 * Other instruments → small diamond (purple)
 *
 * Each particle scales up and fades out from center.
 */
export default function pulseShapes(p, bus, ctx, container) {
  const particles = [];

  p.setup = () => {
    const { width, height } = container.getBoundingClientRect();
    p.createCanvas(width || 600, height || 400);
    p.colorMode(p.HSB, 360, 100, 100, 100);
    p.rectMode(p.CENTER);
  };

  p.windowResized = () => {
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) p.resizeCanvas(width, height);
  };

  p.draw = () => {
    p.background(0, 0, 5);
    const snap = bus.snapshot(ctx.currentTime);

    // Spawn particles from fresh triggers
    for (const t of snap.triggers) {
      if (t.age === 1) spawnParticle(t.instrument, t.velocity);
    }

    // Update and draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.life -= pt.decay;
      if (pt.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      const alpha = pt.life * 100;
      const scale = p.map(pt.life, 1, 0, 1, pt.maxScale);
      const size = pt.baseSize * scale;

      p.push();
      p.translate(p.width / 2, p.height / 2);
      p.noFill();
      p.stroke(pt.hue, pt.sat, pt.bri, alpha);
      p.strokeWeight(pt.weight * pt.life);

      if (pt.shape === "square") {
        p.rect(0, 0, size, size);
      } else if (pt.shape === "circle") {
        p.ellipse(0, 0, size, size);
      } else if (pt.shape === "diamond") {
        p.rotate(p.PI / 4);
        p.rect(0, 0, size * 0.7, size * 0.7);
      }
      p.pop();
    }
  };

  function spawnParticle(instrument, velocity) {
    const name = instrument.toLowerCase();
    let shape, baseSize, hue, sat, bri, weight, maxScale, decay;

    if (name.includes("kick")) {
      shape = "square";
      baseSize = 80;
      hue = 15;
      sat = 90;
      bri = 100;
      weight = 20;
      maxScale = 1.4;
      decay = 0.02;
    } else if (name.includes("snare")) {
      shape = "square";
      baseSize = 130;
      hue = 190;
      sat = 80;
      bri = 100;
      weight = 3;
      maxScale = 0.9;
      decay = 0.025;
    } else if (name.includes("hat")) {
      shape = "square";
      baseSize = 30;
      hue = 55;
      sat = 90;
      bri = 100;
      weight = 2;
      maxScale = 2.5;
      decay = 0.01;
    } else if (name.includes("mono synth")) {
      shape = "square";
      baseSize = 140;
      hue = 0;
      sat = 90;
      bri = 100;
      weight = 8;
      maxScale = 1.25;
      decay = 0.02;
    } else if (name.includes("acid")) {
      shape = "square";
      baseSize = 170;
      hue = 130;
      sat = 90;
      bri = 100;
      weight = 2;
      maxScale = 1.5;
      decay = 0.04;
      // } else {
      //   shape = "diamond";
      //   baseSize = 40;
      //   hue = 280;
      //   sat = 70;
      //   bri = 90;
      //   weight = 2.5;
      //   maxScale = 3;
      //   decay = 0.03;
    }

    if (!shape) return;

    particles.push({
      shape,
      baseSize: baseSize * (0.8 + velocity * 0.4),
      hue,
      sat,
      bri,
      weight,
      maxScale,
      decay,
      life: 1,
    });
  }
}
