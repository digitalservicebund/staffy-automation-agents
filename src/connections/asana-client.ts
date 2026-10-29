// Direct Asana MCP client for deterministic code (the review sweep). Flue's
// mounted MCP tools only run inside an agent turn, so code that must not be
// steered by the model calls the server itself.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Story } from '../approval.ts';
import { accessToken, asana } from './asana.ts';

type Ref = { gid: string; name: string };

export type AsanaClient = Awaited<ReturnType<typeof connectAsana>>;

export async function connectAsana() {
	const client = new Client({ name: 'staffy-automation-agents', version: '0' });
	const transport = new StreamableHTTPClientTransport(new URL(asana.url), {
		// Re-resolved per request so the hourly token can refresh mid-run.
		fetch: async (url, init) => {
			const headers = new Headers(init?.headers);
			headers.set('Authorization', `Bearer ${await accessToken()}`);
			return fetch(url, { ...init, headers });
		},
	});
	await client.connect(transport);

	async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
		const result = await client.callTool({ name, arguments: args });
		const [first] = result.content as { type: string; text?: string }[];
		if (result.isError || first?.type !== 'text' || first.text === undefined) {
			throw new Error(`Asana ${name} failed`);
		}
		return JSON.parse(first.text) as T;
	}

	return {
		close: () => client.close(),

		async sectionGid(projectGid: string, name: string): Promise<string> {
			const res = await call<{ data: { sections?: Ref[] } }>('get_project', {
				project_id: projectGid,
				include_sections: true,
			});
			const section = res.data.sections?.find((s) => s.name === name);
			if (!section) throw new Error(`Asana section "${name}" not found`);
			return section.gid;
		},

		async tasksInSection(sectionGid: string): Promise<Ref[]> {
			return (await call<{ data: Ref[] }>('get_tasks', { section: sectionGid, limit: 100 })).data;
		},

		async subtasks(taskGid: string): Promise<Ref[]> {
			const res = await call<{ data: { subtasks?: Ref[] } }>('get_task', {
				task_id: taskGid,
				include_comments: false,
			});
			return res.data.subtasks ?? [];
		},

		// Every story after `since`, following pagination so no decisive event is missed.
		async stories(taskGid: string, since: string): Promise<Story[]> {
			const all: Story[] = [];
			let offset: string | undefined;
			do {
				const page = await call<{ data: Story[]; next_page: { offset: string } | null }>('get_task_stories', {
					task_id: taskGid,
					created_after: since,
					sort_ascending: true,
					limit: 100,
					...(offset && { offset }),
				});
				all.push(...page.data);
				offset = page.next_page?.offset;
			} while (offset);
			return all;
		},

		async moveToSection(taskGid: string, projectGid: string, sectionGid: string): Promise<void> {
			await call('update_tasks', {
				tasks: [{ task: taskGid, add_projects: [{ project_id: projectGid, section_id: sectionGid }] }],
			});
		},

		async comment(taskGid: string, text: string): Promise<void> {
			await call('add_comment', { task_id: taskGid, text });
		},
	};
}
