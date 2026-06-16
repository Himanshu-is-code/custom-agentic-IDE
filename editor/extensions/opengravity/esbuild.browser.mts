/*---------------------------------------------------------------------------------------------
 * OpenGravity IDE — esbuild bundler for the browser extension
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const extensionRoot = import.meta.dirname;

await run({
	platform: 'browser',
	entryPoints: {
		'extension': path.join(extensionRoot, 'src', 'extension.ts'),
	},
	srcDir: path.join(extensionRoot, 'src'),
	outdir: path.join(extensionRoot, 'dist', 'browser'),
	additionalOptions: {
		// vscode API is provided by the extension host at runtime — do not bundle it
		external: ['vscode'],
		format: 'cjs',
	},
}, process.argv);
