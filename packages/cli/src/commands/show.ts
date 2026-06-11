import { findFootprintById } from '@substrata/core';
import type { Command } from 'commander';
import pc from 'picocolors';

import { CliError, out, requireConfig, resolveCwd } from '../util';

/**
 * `substrata show <id>` — pretty-print one footprint, or its JSON / path.
 * (plan §8.7)
 */

type ShowOptions = {
  json?: boolean;
  path?: boolean;
};

export function registerShowCommand(program: Command): void {
  program
    .command('show <id>')
    .description('Show one footprint')
    .option('--json', 'Output the parsed footprint as JSON')
    .option('--path', 'Print only the footprint file path')
    .action(async (id: string, opts: ShowOptions, command: Command) => {
      const cwd = resolveCwd(command.parent?.opts());
      await requireConfig(cwd);

      const fp = await findFootprintById(cwd, id);
      if (!fp) throw new CliError(`Footprint not found: ${id}`);

      if (opts.path) {
        out.plain(fp.filePath);
        return;
      }

      if (opts.json) {
        out.plain(
          JSON.stringify(
            {
              id: fp.frontmatter.id,
              title: fp.title,
              filePath: fp.filePath,
              frontmatter: fp.frontmatter,
              sections: fp.sections,
            },
            null,
            2,
          ),
        );
        return;
      }

      const fm = fp.frontmatter;
      const lines: string[] = [
        pc.bold(fp.title || fm.id),
        `${pc.dim('id:')}        ${fm.id}`,
        `${pc.dim('status:')}    ${fm.status}`,
        `${pc.dim('work_type:')} ${fm.work_type}`,
        `${pc.dim('actor:')}     ${fm.actor}`,
      ];
      if (fm.requester) lines.push(`${pc.dim('requester:')} ${fm.requester}`);
      if (fm.agent_model) lines.push(`${pc.dim('model:')}     ${fm.agent_model}`);
      lines.push(`${pc.dim('created:')}   ${fm.created_at}`);
      if (fm.tags && fm.tags.length > 0)
        lines.push(`${pc.dim('tags:')}      ${fm.tags.join(', ')}`);
      if (fm.files_touched && fm.files_touched.length > 0) {
        lines.push(`${pc.dim('files:')}     ${fm.files_touched.join(', ')}`);
      }
      lines.push(`${pc.dim('path:')}      ${fp.filePath}`);
      lines.push('');
      lines.push(fp.body.trim());
      out.plain(lines.join('\n'));
    });
}
