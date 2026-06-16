/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import debug from 'debug';
import path from 'path';
import { downloadArtifact } from '@electron/get';
import productJson from '../../product.json' with { type: 'json' };
const product = productJson;
const d = debug('explorer-dll-fetcher');
export async function downloadExplorerDll(outDir, quality = 'stable', targetArch = 'x64') {
    const fileNamePrefix = quality === 'insider' ? 'code_insider' : 'code';
    const fileName = `${fileNamePrefix}_explorer_command_${targetArch}.dll`;
    if (!await fs.existsSync(outDir)) {
        await fs.mkdirSync(outDir, { recursive: true });
    }
    // Read and parse checksums file
    const checksumsFilePath = path.join(path.dirname(import.meta.dirname), 'checksums', 'explorer-dll.txt');
    const checksumsContent = fs.readFileSync(checksumsFilePath, 'utf8');
    const checksums = {};
    checksumsContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            const [checksum, filename] = trimmedLine.split(/\s+/);
            if (checksum && filename) {
                checksums[filename] = checksum;
            }
        }
    });
    d(`downloading ${fileName}`);
    const artifact = await downloadArtifact({
        isGeneric: true,
        version: 'v8.0.0-398351',
        artifactName: fileName,
        checksums,
        mirrorOptions: {
            mirror: 'https://github.com/microsoft/vscode-explorer-command/releases/download/',
            customDir: 'v8.0.0-398351',
            customFilename: fileName
        }
    });
    d(`moving ${artifact} to ${outDir}`);
    await fs.copyFileSync(artifact, path.join(outDir, fileName));
}
async function main(outputDir) {
    const arch = process.env['VSCODE_ARCH'];
    if (!outputDir) {
        throw new Error('Required build env not set');
    }
    await downloadExplorerDll(outputDir, product.quality, arch);
}
if (import.meta.main) {
    main(process.argv[2]).catch(err => {
        console.error(err);
        process.exit(1);
    });
}
