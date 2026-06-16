/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BasePolicy } from './basePolicy.ts';
import { renderProfileString } from './render.ts';
import { PolicyType } from './types.ts';
export class ObjectPolicy extends BasePolicy {
    static from(category, policy) {
        const { type, name, minimumVersion, localization } = policy;
        if (type !== 'object' && type !== 'array') {
            return undefined;
        }
        return new ObjectPolicy(name, { moduleName: '', name: { nlsKey: category.name.key, value: category.name.value } }, minimumVersion, { nlsKey: localization.description.key, value: localization.description.value }, '');
    }
    constructor(name, category, minimumVersion, description, moduleName) {
        super(PolicyType.Object, name, category, minimumVersion, description, moduleName);
    }
    renderADMXElements() {
        return [`<multiText id="${this.name}" valueName="${this.name}" required="true" />`];
    }
    renderADMLPresentationContents() {
        return `<multiTextBox refId="${this.name}" />`;
    }
    renderJsonValue() {
        return '';
    }
    renderProfileValue() {
        return `<string></string>`;
    }
    renderProfileManifestValue(translations) {
        return `<key>pfm_default</key>
<string></string>
<key>pfm_description</key>
<string>${renderProfileString(this.name, this.moduleName, this.description, translations)}</string>
<key>pfm_name</key>
<string>${this.name}</string>
<key>pfm_title</key>
<string>${this.name}</string>
<key>pfm_type</key>
<string>string</string>
`;
    }
}
