/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BasePolicy } from './basePolicy.ts';
import { renderProfileString } from './render.ts';
import { PolicyType } from './types.ts';
export class StringPolicy extends BasePolicy {
    static from(category, policy) {
        const { type, name, minimumVersion, localization } = policy;
        if (type !== 'string') {
            return undefined;
        }
        return new StringPolicy(name, { moduleName: '', name: { nlsKey: category.name.key, value: category.name.value } }, minimumVersion, { nlsKey: localization.description.key, value: localization.description.value }, '');
    }
    constructor(name, category, minimumVersion, description, moduleName) {
        super(PolicyType.String, name, category, minimumVersion, description, moduleName);
    }
    renderADMXElements() {
        return [`<text id="${this.name}" valueName="${this.name}" required="true" />`];
    }
    renderJsonValue() {
        return '';
    }
    renderADMLPresentationContents() {
        return `<textBox refId="${this.name}"><label>${this.name}:</label></textBox>`;
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
<string>string</string>`;
    }
}
