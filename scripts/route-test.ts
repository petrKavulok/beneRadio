import { TaxiGraph } from '../src/airport/route';
import { HOLDING_POINTS, STANDS } from '../src/airport/lkbe';
const g = new TaxiGraph();
for (const hp of HOLDING_POINTS) {
  const r = g.route(STANDS[1].pos, hp.pos);
  console.log(`${hp.id.padEnd(5)} ${hp.label.padEnd(28)} via ${r.names.join(', ').padEnd(16)} ${Math.round(r.length)} m`);
}
