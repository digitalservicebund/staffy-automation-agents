// Starts (or continues) the bugfix agent on one Asana ticket:
//   npm run bugfix -- <ticket GID> ["optional extra instruction"]
// Uses the ticket's stable conversation id, so the review sweep's later
// revisions continue this same conversation.
import { canRunAgent, runBugfixAgent } from '../src/run-agent.ts';
import { conversationId } from '../src/review.ts';
import { prepareCheckout, WORKDIR } from '../src/workspace.ts';

const [ticketGid, extra] = process.argv.slice(2);
if (!ticketGid) throw new Error('Usage: npm run bugfix -- <ticket GID> ["extra instruction"]');
const id = conversationId(ticketGid); // validates the GID
if (!canRunAgent()) throw new Error('Refusing to run model shell commands on this host: set ALLOW_LOCAL_SANDBOX=true (or run in CI).');

console.log(`Preparing a clean checkout of main in ${WORKDIR} (git fetch + npm ci)…`);
await prepareCheckout();
console.log(`Starting the agent on ticket ${ticketGid} (conversation ${id}); its activity follows.`);
await runBugfixAgent(ticketGid, [`Fix Asana ticket ${ticketGid}.`, extra].filter(Boolean).join('\n\n'));
