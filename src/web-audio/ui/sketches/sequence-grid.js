/**
 * Sequence Grid sketch — visual overview of all instrument patterns.
 *
 * Each instrument is a row, each step is a column.
 * Active steps are lit, the current playhead column is highlighted.
 */
export default function sequenceGrid(p, bus, ctx, container) {
  const COLS = 16;
  const PAD = 2;
  const MARGIN = { top: 10, bottom: 10, left: 10, right: 10 };

  p.setup = () => {
    const { width, height } = container.getBoundingClientRect();
    p.createCanvas(width || 600, height || 400);
    p.noStroke();
    p.textAlign(p.LEFT, p.CENTER);
    p.textFont("monospace");
  };

  p.windowResized = () => {
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) p.resizeCanvas(width, height);
  };

  p.draw = () => {
    p.background(15);
    const snap = bus.snapshot(ctx.currentTime);

    // Gather instruments that have sequence data
    const entries = [];
    for (const [name, inst] of Object.entries(snap.instruments)) {
      if (inst.steps) entries.push({ name, inst });
    }

    if (entries.length === 0) {
      p.fill(80);
      p.textSize(14);
      p.textAlign(p.CENTER, p.CENTER);
      p.text("No sequenced instruments", p.width / 2, p.height / 2);
      return;
    }

    const rows = entries.length;
    const labelWidth = 90;
    const gridLeft = MARGIN.left + labelWidth;
    const gridWidth = p.width - gridLeft - MARGIN.right;
    const gridHeight = p.height - MARGIN.top - MARGIN.bottom;
    const cellW = (gridWidth - PAD * (COLS - 1)) / COLS;
    const cellH = (gridHeight - PAD * (rows - 1)) / rows;
    const currentStep = snap.beat.step;

    // Draw playhead column highlight
    const phX = gridLeft + currentStep * (cellW + PAD);
    p.fill(255, 255, 255, 20);
    p.rect(phX - 1, MARGIN.top - 2, cellW + 2, gridHeight + 4, 3);

    for (let row = 0; row < rows; row++) {
      const { name, inst } = entries[row];
      const y = MARGIN.top + row * (cellH + PAD);
      const color = inst.color ? p.color(inst.color) : p.color(180);
      const muted = inst.muted;

      // Label
      p.fill(muted ? 80 : 200);
      p.textSize(Math.min(11, cellH * 0.7));
      p.textAlign(p.RIGHT, p.CENTER);
      p.noStroke();
      const shortName = name.replace(/ \d+$/, ""); // strip instance id
      p.text(shortName, gridLeft - 8, y + cellH / 2);

      // Steps
      for (let col = 0; col < COLS; col++) {
        const x = gridLeft + col * (cellW + PAD);
        const step = inst.steps[col];
        const isActive = step?.active;
        const isCurrent = col === currentStep;

        if (isActive) {
          const alpha = muted ? (isCurrent ? 60 : 40) : isCurrent ? 255 : 180;
          p.fill(p.red(color), p.green(color), p.blue(color), alpha);
        } else {
          p.fill(isCurrent ? (muted ? 30 : 40) : muted ? 18 : 25);
        }

        p.rect(x, y, cellW, cellH, 2);

        // Trigger flash — bright overlay when this step just fired
        if (!muted && isCurrent && isActive && inst.trigger && inst.trigger.age > 0 && inst.trigger.age < 4) {
          const flash = p.map(inst.trigger.age, 1, 4, 200, 0);
          p.fill(255, flash);
          p.rect(x, y, cellW, cellH, 2);
        }
      }

      // RMS bar on right edge
      if (inst.rms > 0.01) {
        const barH = cellH * inst.rms;
        p.fill(p.red(color), p.green(color), p.blue(color), 120);
        p.rect(p.width - MARGIN.right + 2, y + cellH - barH, 4, barH, 1);
      }
    }
  };
}
