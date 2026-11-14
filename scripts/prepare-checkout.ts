// Clones (or resets) the staffy checkout the bugfix agent works in to a clean
// origin/main with dependencies installed. Run before each bugfix run.
import { prepareCheckout, WORKDIR } from '../src/workspace.ts';

await prepareCheckout();
console.log(`staffy checkout ready at ${WORKDIR}`);
