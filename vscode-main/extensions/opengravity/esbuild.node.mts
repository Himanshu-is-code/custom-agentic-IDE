/*---------------------------------------------------------------------------------------------
 * OpenGravity IDE — esbuild bundler for the node extension
 *--------------------------------------------------------------------------------------------*/
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const extensionRoot = import.meta.dirname;

await run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(extensionRoot, 'src', 'extension.ts'),
	},
	srcDir: path.join(extensionRoot, 'src'),
	outdir: path.join(extensionRoot, 'dist', 'node'),
	additionalOptions: {
		// vscode API is provided by the extension host at runtime — do not bundle it
		external: ['vscode'],
		format: 'cjs',
	},
}, process.argv);
