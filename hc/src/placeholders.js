/**
 * PLACEHOLDER sheets - generated at runtime. They are NOT hamsters: labelled boxes
 * showing action name, pose and frame number, so you can verify the engine
 * (frame timing, transitions, travel) before the real art exists.
 */
const COLORS = { sit: '#4f7cff', quad: '#2fa66a', curl: '#8a5cf6', hidden: '#8a8a8a' };
export function createPlaceholderManifest(animations, cell = { w: 256, h: 256 }, columns = 4) {
  const sheets = {};
  for (const [id, a] of Object.entries(animations)) {
    const rows = Math.ceil(a.frames / columns), c = document.createElement('canvas');
    c.width = columns * cell.w; c.height = rows * cell.h;
    const g = c.getContext('2d');
    for (let i = 0; i < a.frames; i++) {
      const x = (i % columns) * cell.w, y = Math.floor(i / columns) * cell.h, t = a.frames > 1 ? i / (a.frames - 1) : 0.5;
      g.save(); g.translate(x, y);
      g.fillStyle = COLORS[i === 0 ? a.from : i === a.frames - 1 ? a.to : a.from] + 'cc';
      const bw = a.from === 'curl' ? 150 : 130, bh = a.from === 'sit' ? 150 : 90;
      g.beginPath(); g.roundRect(cell.w / 2 - bw / 2, cell.h - 20 - bh, bw, bh, 22); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 15px system-ui';
      g.fillText('PLACEHOLDER', cell.w / 2, cell.h - 20 - bh + 24);
      g.font = 'bold 18px system-ui'; g.fillText(id, cell.w / 2, cell.h - 20 - bh + 48);
      g.font = '15px system-ui'; g.fillText(`${a.from}→${a.to}`, cell.w / 2, cell.h - 20 - bh + 68);
      g.font = 'bold 22px system-ui'; g.fillText(`${i + 1}/${a.frames}`, cell.w / 2, cell.h - 20 - bh + 96);
      g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(cell.w * (0.2 + 0.6 * t), cell.h - 10, 6, 0, 7); g.fill(); // frame-progress dot
      g.restore();
    }
    sheets[id] = { image: c, columns, frameW: cell.w, frameH: cell.h };
  }
  const h = document.createElement('canvas'); h.width = cell.w; h.height = cell.h;
  const g = h.getContext('2d');
  g.fillStyle = '#b08968'; g.beginPath(); g.roundRect(30, 70, cell.w - 60, cell.h - 80, [90, 90, 10, 10]); g.fill();
  g.clearRect(cell.w / 2 - 34, cell.h - 100, 68, 90);                 // transparent doorway
  g.fillStyle = '#fff'; g.font = 'bold 14px system-ui'; g.textAlign = 'center'; g.fillText('PLACEHOLDER hideout', cell.w / 2, 105);
  return { cell, groundY: cell.h - 10, sheets, props: { hideout: { image: h } } };
}
