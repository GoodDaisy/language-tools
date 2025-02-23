import { AstroCheck } from '@astrojs/language-server';
import { watch } from 'chokidar';
import { bold, dim, red, yellow } from 'kleur/colors';
import { createRequire } from 'node:module';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { options } from './options.js';

/**
 * Given a list of arguments from the command line (such as `process.argv`), return parsed and processed options
 */
export function parseArgsAsCheckConfig(args: string[]) {
	return yargs(hideBin(args)).options(options).parseSync();
}

export type Flags = Pick<ReturnType<typeof parseArgsAsCheckConfig>, keyof typeof options>;

export async function check(flags: Partial<Flags> & { watch: true }): Promise<void>;
export async function check(flags: Partial<Flags> & { watch: false }): Promise<boolean>;
export async function check(flags: Partial<Flags>): Promise<boolean | void>;
/**
 * Print diagnostics according to the given flags, and return whether or not the program should exit with an error code.
 */
export async function check(flags: Partial<Flags>): Promise<boolean | void> {
	const workspaceRoot = path.resolve(flags.root ?? process.cwd());
	const require = createRequire(import.meta.url);
	const checker = new AstroCheck(
		workspaceRoot,
		require.resolve('typescript/lib/tsserverlibrary.js'),
		flags.tsconfig
	);

	let req = 0;

	if (flags.watch) {
		function createWatcher(rootPath: string, extensions: string[]) {
			return watch(`${rootPath}/**/*{${extensions.join(',')}}`, {
				ignored: (ignoredPath) => ignoredPath.includes('node_modules'),
				ignoreInitial: true,
			});
		}

		// Dynamically get the list of extensions to watch from the files already included in the project
		const checkedExtensions = Array.from(
			new Set(
				checker.project.languageHost.getScriptFileNames().map((fileName) => path.extname(fileName))
			)
		);
		createWatcher(workspaceRoot, checkedExtensions)
			.on('add', (fileName) => {
				checker.project.fileCreated(fileName);
				update();
			})
			.on('unlink', (fileName) => {
				checker.project.fileDeleted(fileName);
				update();
			})
			.on('change', (fileName) => {
				checker.project.fileUpdated(fileName);
				update();
			});
	}

	async function update() {
		if (!flags.preserveWatchOutput) process.stdout.write('\x1Bc');
		await lint();
	}

	async function lint() {
		const currentReq = ++req;
		await new Promise((resolve) => setTimeout(resolve, 100));
		const isCanceled = () => currentReq !== req;
		if (isCanceled()) return;

		const minimumSeverity = flags.minimumSeverity || 'hint';
		const result = await checker.lint({
			logErrors: {
				level: minimumSeverity,
			},
			cancel: isCanceled,
		});
		console.info(
			[
				bold(`Result (${result.fileChecked} file${result.fileChecked === 1 ? '' : 's'}): `),
				['error', 'warning', 'hint'].includes(minimumSeverity)
					? bold(red(`${result.errors} ${result.errors === 1 ? 'error' : 'errors'}`))
					: undefined,
				['warning', 'hint'].includes(minimumSeverity)
					? bold(yellow(`${result.warnings} ${result.warnings === 1 ? 'warning' : 'warnings'}`))
					: undefined,
				['hint'].includes(minimumSeverity)
					? dim(`${result.hints} ${result.hints === 1 ? 'hint' : 'hints'}\n`)
					: undefined,
			]
				.filter(Boolean)
				.join(`\n${dim('-')} `)
		);

		if (flags.watch) {
			console.info('Watching for changes...');
		} else {
			switch (flags.minimumFailingSeverity) {
				case 'error':
					return result.errors > 0;
				case 'warning':
					return result.errors + result.warnings > 0;
				case 'hint':
					return result.errors + result.warnings + result.hints > 0;
				default:
					return result.errors > 0;
			}
		}
	}

	// Always lint on first run, even in watch mode.
	const lintResult = await lint();
	if (!flags.watch) return lintResult;
}
