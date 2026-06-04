/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { $, ProcessPromise } from 'zx';
export function printBanner(title) {
    title = `${title} (${new Date().toISOString()})`;
    console.log('\n');
    console.log('#'.repeat(75));
    console.log(`# ${title.padEnd(71)} #`);
    console.log('#'.repeat(75));
    console.log('\n');
}
export async function streamProcessOutputAndCheckResult(name, promise) {
    const result = await promise.pipe(process.stdout);
    if (result.ok) {
        console.log(`\n${name} completed successfully. Duration: ${result.duration} ms`);
        return;
    }
    throw new Error(`${name} failed: ${result.stderr}`);
}
export function spawnCodesignProcess(esrpCliDLLPath, type, folder, glob) {
    return $ `node build/azure-pipelines/common/sign.ts ${esrpCliDLLPath} ${type} ${folder} ${glob}`;
}
