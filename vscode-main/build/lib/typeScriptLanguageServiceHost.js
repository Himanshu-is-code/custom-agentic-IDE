/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import ts from 'typescript';
import fs from 'node:fs';
import { normalize } from 'node:path';
function normalizePath(filePath) {
    return normalize(filePath);
}
/**
 * A TypeScript language service host
 */
export class TypeScriptLanguageServiceHost {
    ts;
    topLevelFiles;
    compilerOptions;
    constructor(ts, topLevelFiles, compilerOptions) {
        this.ts = ts;
        this.topLevelFiles = topLevelFiles;
        this.compilerOptions = compilerOptions;
    }
    // --- language service host ---------------
    getCompilationSettings() {
        return this.compilerOptions;
    }
    getScriptFileNames() {
        return [
            ...this.topLevelFiles.keys(),
            this.ts.getDefaultLibFilePath(this.compilerOptions)
        ];
    }
    getScriptVersion(_fileName) {
        return '1';
    }
    getProjectVersion() {
        return '1';
    }
    getScriptSnapshot(fileName) {
        fileName = normalizePath(fileName);
        if (this.topLevelFiles.has(fileName)) {
            return this.ts.ScriptSnapshot.fromString(this.topLevelFiles.get(fileName));
        }
        else {
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        }
    }
    getScriptKind(_fileName) {
        return this.ts.ScriptKind.TS;
    }
    getCurrentDirectory() {
        return '';
    }
    getDefaultLibFileName(options) {
        return this.ts.getDefaultLibFilePath(options);
    }
    readFile(path, encoding) {
        path = normalizePath(path);
        if (this.topLevelFiles.get(path)) {
            return this.topLevelFiles.get(path);
        }
        return ts.sys.readFile(path, encoding);
    }
    fileExists(path) {
        path = normalizePath(path);
        if (this.topLevelFiles.has(path)) {
            return true;
        }
        return ts.sys.fileExists(path);
    }
}
