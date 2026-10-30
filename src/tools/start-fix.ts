import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { connectAsana } from '../connections/asana-client.ts';
import { botTitle } from '../review.ts';

const IN_PROGRESS_SECTION = 'In Progress';

// Claims a ticket before any code is written: posts the planned approach for
// humans, prefixes the title with 🤖, and moves it to "In Progress". The model
// writes the approach; this code does the Asana writes.
export const startFix = defineTool({
	name: 'start_fix',
	description:
		'Claim an Asana bug ticket before delegating to the coder: posts your planned approach as a comment, ' +
		'prefixes the title with 🤖, and moves the ticket to "In Progress". Call exactly once per ticket, before delegating.',
	input: v.object({
		ticketGid: v.pipe(v.string(), v.regex(/^\d+$/), v.description('GID of the Asana bug ticket.')),
		approach: v.pipe(
			v.string(),
			v.minLength(40),
			v.description(
				'Plain-language summary for the team: what is going wrong, the likely cause, the planned fix, and how it will be tested. No code.',
			),
		),
	}),

	async run({ data }) {
		const projectGid = process.env.ASANA_BUG_PROJECT_GID;
		if (!projectGid) throw new Error('ASANA_BUG_PROJECT_GID is not set');

		const asana = await connectAsana();
		try {
			if (!(await asana.isTaskInProject(data.ticketGid, projectGid))) {
				return `Ticket ${data.ticketGid} is not on the bug board; nothing was changed.`;
			}
			await asana.comment(data.ticketGid, `🤖 Staffy Bot is picking this up.\n\nPlanned approach:\n${data.approach}`);
			await asana.rename(data.ticketGid, botTitle(await asana.taskName(data.ticketGid)));
			await asana.moveToSection(data.ticketGid, projectGid, await asana.sectionGid(projectGid, IN_PROGRESS_SECTION));
			return `Ticket claimed and moved to "${IN_PROGRESS_SECTION}". Now delegate to the coder.`;
		} finally {
			await asana.close();
		}
	},
});
