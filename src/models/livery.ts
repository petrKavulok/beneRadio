// Procedural "LKBE Benešov" school livery for the FlightGear P2002 texture atlas.
// Works in texture pixels (2048²). Coordinates were measured on the atlas
// (side A = left fuselage side, nose at left; side B = right side, nose at right).
import * as THREE from 'three';

const CZ_BLUE: [number, number, number] = [17, 69, 126];
const CZ_RED = '#d7141a';

export function makeSchoolLivery(base: HTMLImageElement | ImageBitmap, reg: string) {
  const N = 2048, k = N / 1932; // measurements were taken on a 1932-px preview
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0, N, N);

  // 1) original blue panels -> Czech-flag blue, keeping the baked shading
  const img = g.getImageData(0, 0, N, N), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    if (b > r + 60 && b > gg + 40) {
      const s = Math.min(1.25, b / 205);
      d[i] = CZ_BLUE[0] * s; d[i + 1] = CZ_BLUE[1] * s; d[i + 2] = CZ_BLUE[2] * s;
    }
  }
  g.putImageData(img, 0, 0);

  const P = (x: number, y: number): [number, number] => [x * k, y * k];
  const multiply = (col: string, draw: () => void) => {
    g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.strokeStyle = col; draw(); g.restore();
  };
  const line = (pts: [number, number][], w: number) => {
    g.lineWidth = w * k; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y)))); g.stroke();
  };

  // 2) red cheat line just below the black swoosh, both sides, running on to the tail
  multiply(CZ_RED, () => {
    line([[300, 480], [700, 420], [1300, 334], [1840, 326]], 13);   // side A (nose left)
    line([[90, 648], [628, 666], [1100, 728], [1515, 801]], 13);    // side B (nose right)
  });

  // 3) red wingtips (upper + lower surfaces) and wheel pants, red spinner
  multiply(CZ_RED, () => {
    g.fillRect(...P(30, 870), 80 * k, 700 * k);
    g.fillRect(...P(1290, 870), 85 * k, 700 * k);
    g.fillRect(...P(1385, 1232), 535 * k, 200 * k);
    g.fillRect(...P(20, 1648), 530 * k, 90 * k);
    g.fillRect(...P(990, 1690), 236 * k, 242 * k);
  });

  // 4) registration on the rear fuselage, both sides
  g.save();
  g.fillStyle = '#10243d';
  g.font = `700 ${58 * k}px "Arial Narrow", Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(reg, ...P(1525, 370));
  g.fillText(reg, ...P(440, 706));
  g.restore();

  // 5) "LKBE" + small Czech flag on both fins
  const flag = (x: number, y: number, w: number) => {
    const [px, py] = P(x, y), W = w * k, H = W * 2 / 3;
    g.fillStyle = '#fff'; g.fillRect(px, py, W, H / 2);
    g.fillStyle = CZ_RED; g.fillRect(px, py + H / 2, W, H / 2);
    g.fillStyle = `rgb(${CZ_BLUE})`; g.beginPath(); g.moveTo(px, py); g.lineTo(px + W / 2, py + H / 2); g.lineTo(px, py + H); g.fill();
  };
  g.save();
  g.fillStyle = '#ffffff';
  g.font = `800 ${46 * k}px Arial, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('LKBE', ...P(1782, 140));
  g.fillText('LKBE', ...P(128, 455));
  g.restore();
  flag(1735, 185, 60);
  flag(98, 490, 60);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.flipY = true;
  return t;
}
