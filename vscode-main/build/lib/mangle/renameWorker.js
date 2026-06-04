/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import ts from 'typescript';
import workerpool from 'workerpool';
import { StaticLanguageServiceHost } from './staticLanguageServiceHost.ts';
let service;
function findRenameLocations(projectPath, fileName, position) {
    if (!service) {
        service = ts.createLanguageService(new StaticLanguageServiceHost(projectPath));
    }
    return service.findRenameLocations(fileName, position, false, false, {
        providePrefixAndSuffixTextForRename: true,
    }) ?? [];
}
workerpool.worker({
    findRenameLocations
});
