/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import crypto from 'crypto';
import { retry } from './retry.ts';
import { CosmosClient } from '@azure/cosmos';
import cp from 'child_process';
import os from 'os';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { BlobClient, BlobServiceClient, BlockBlobClient, ContainerClient, ContainerSASPermissions, generateBlobSASQueryParameters } from '@azure/storage-blob';
import jws from 'jws';
import { clearInterval, setInterval } from 'node:timers';
export function e(name) {
    const result = process.env[name];
    if (typeof result !== 'string') {
        throw new Error(`Missing env: ${name}`);
    }
    return result;
}
function hashStream(hashName, stream) {
    return new Promise((c, e) => {
        const shasum = crypto.createHash(hashName);
        stream
            .on('data', shasum.update.bind(shasum))
            .on('error', e)
            .on('close', () => c(shasum.digest()));
    });
}
const StatusCode = Object.freeze({
    Pass: 'pass',
    Aborted: 'aborted',
    Inprogress: 'inprogress',
    FailCanRetry: 'failCanRetry',
    FailDoNotRetry: 'failDoNotRetry',
    PendingAnalysis: 'pendingAnalysis',
    Cancelled: 'cancelled'
});
function getCertificateBuffer(input) {
    return Buffer.from(input.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, ''), 'base64');
}
function getThumbprint(input, algorithm) {
    const buffer = getCertificateBuffer(input);
    return crypto.createHash(algorithm).update(buffer).digest();
}
function getKeyFromPFX(pfx) {
    const pfxCertificatePath = path.join(os.tmpdir(), 'cert.pfx');
    const pemKeyPath = path.join(os.tmpdir(), 'key.pem');
    try {
        const pfxCertificate = Buffer.from(pfx, 'base64');
        fs.writeFileSync(pfxCertificatePath, pfxCertificate);
        cp.execSync(`openssl pkcs12 -in "${pfxCertificatePath}" -nocerts -nodes -out "${pemKeyPath}" -passin pass:`);
        const raw = fs.readFileSync(pemKeyPath, 'utf-8');
        const result = raw.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/g)[0];
        return result;
    }
    finally {
        fs.rmSync(pfxCertificatePath, { force: true });
        fs.rmSync(pemKeyPath, { force: true });
    }
}
function getCertificatesFromPFX(pfx) {
    const pfxCertificatePath = path.join(os.tmpdir(), 'cert.pfx');
    const pemCertificatePath = path.join(os.tmpdir(), 'cert.pem');
    try {
        const pfxCertificate = Buffer.from(pfx, 'base64');
        fs.writeFileSync(pfxCertificatePath, pfxCertificate);
        cp.execSync(`openssl pkcs12 -in "${pfxCertificatePath}" -nokeys -out "${pemCertificatePath}" -passin pass:`);
        const raw = fs.readFileSync(pemCertificatePath, 'utf-8');
        const matches = raw.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
        return matches ? matches.reverse() : [];
    }
    finally {
        fs.rmSync(pfxCertificatePath, { force: true });
        fs.rmSync(pemCertificatePath, { force: true });
    }
}
class ESRPReleaseService {
    static async create(log, tenantId, clientId, authCertificatePfx, requestSigningCertificatePfx, containerClient, stagingSasToken) {
        const authKey = getKeyFromPFX(authCertificatePfx);
        const authCertificate = getCertificatesFromPFX(authCertificatePfx)[0];
        const requestSigningKey = getKeyFromPFX(requestSigningCertificatePfx);
        const requestSigningCertificates = getCertificatesFromPFX(requestSigningCertificatePfx);
        const app = new ConfidentialClientApplication({
            auth: {
                clientId,
                authority: `https://login.microsoftonline.com/${tenantId}`,
                clientCertificate: {
                    thumbprintSha256: getThumbprint(authCertificate, 'sha256').toString('hex'),
                    privateKey: authKey,
                    x5c: authCertificate
                }
            }
        });
        const response = await app.acquireTokenByClientCredential({
            scopes: ['https://api.esrp.microsoft.com/.default']
        });
        return new ESRPReleaseService(log, clientId, response.accessToken, requestSigningCertificates, requestSigningKey, containerClient, stagingSasToken);
    }
    static API_URL = 'https://api.esrp.microsoft.com/api/v3/releaseservices/clients/';
    log;
    clientId;
    accessToken;
    requestSigningCertificates;
    requestSigningKey;
    containerClient;
    stagingSasToken;
    constructor(log, clientId, accessToken, requestSigningCertificates, requestSigningKey, containerClient, stagingSasToken) {
        this.log = log;
        this.clientId = clientId;
        this.accessToken = accessToken;
        this.requestSigningCertificates = requestSigningCertificates;
        this.requestSigningKey = requestSigningKey;
        this.containerClient = containerClient;
        this.stagingSasToken = stagingSasToken;
    }
    async createRelease(version, filePath, friendlyFileName) {
        const correlationId = crypto.randomUUID();
        const blobClient = this.containerClient.getBlockBlobClient(correlationId);
        this.log(`Uploading ${filePath} to ${blobClient.url}`);
        await blobClient.uploadFile(filePath);
        this.log('Uploaded blob successfully');
        try {
            this.log(`Submitting release for ${version}: ${filePath}`);
            const submitReleaseResult = await this.submitRelease(version, filePath, friendlyFileName, correlationId, blobClient);
            this.log(`Successfully submitted release ${submitReleaseResult.operationId}. Polling for completion...`);
            // Poll every 5 seconds, wait 60 minutes max -> poll 60/5*60=720 times
            for (let i = 0; i < 720; i++) {
                await new Promise(c => setTimeout(c, 5000));
                const releaseStatus = await this.getReleaseStatus(submitReleaseResult.operationId);
                if (releaseStatus.status === 'pass') {
                    break;
                }
                else if (releaseStatus.status === 'aborted') {
                    this.log(JSON.stringify(releaseStatus));
                    throw new Error(`Release was aborted`);
                }
                else if (releaseStatus.status !== 'inprogress') {
                    this.log(JSON.stringify(releaseStatus));
                    throw new Error(`Unknown error when polling for release`);
                }
            }
            const releaseDetails = await this.getReleaseDetails(submitReleaseResult.operationId);
            if (releaseDetails.status !== 'pass') {
                throw new Error(`Timed out waiting for release: ${JSON.stringify(releaseDetails)}`);
            }
            this.log('Successfully created release:', releaseDetails.files[0].fileDownloadDetails[0].downloadUrl);
            return releaseDetails.files[0].fileDownloadDetails[0].downloadUrl;
        }
        finally {
            this.log(`Deleting blob ${blobClient.url}`);
            await blobClient.delete();
            this.log('Deleted blob successfully');
        }
    }
    async submitRelease(version, filePath, friendlyFileName, correlationId, blobClient) {
        const size = fs.statSync(filePath).size;
        const hash = await hashStream('sha256', fs.createReadStream(filePath));
        const blobUrl = `${blobClient.url}?${this.stagingSasToken}`;
        const message = {
            customerCorrelationId: correlationId,
            esrpCorrelationId: correlationId,
            driEmail: ['joao.moreno@microsoft.com'],
            createdBy: { userPrincipalName: 'jomo@microsoft.com' },
            owners: [{ owner: { userPrincipalName: 'jomo@microsoft.com' } }],
            approvers: [{ approver: { userPrincipalName: 'jomo@microsoft.com' }, isAutoApproved: true, isMandatory: false }],
            releaseInfo: {
                title: 'VS Code',
                properties: {
                    'ReleaseContentType': 'InstallPackage'
                },
                minimumNumberOfApprovers: 1
            },
            productInfo: {
                name: 'VS Code',
                version,
                description: 'VS Code'
            },
            accessPermissionsInfo: {
                mainPublisher: 'VSCode',
                channelDownloadEntityDetails: {
                    AllDownloadEntities: ['VSCode']
                }
            },
            routingInfo: {
                intent: 'filedownloadlinkgeneration'
            },
            files: [{
                    name: path.basename(filePath),
                    friendlyFileName,
                    tenantFileLocation: blobUrl,
                    tenantFileLocationType: 'AzureBlob',
                    sourceLocation: {
                        type: 'azureBlob',
                        blobUrl
                    },
                    hashType: 'sha256',
                    hash: Array.from(hash),
                    sizeInBytes: size
                }]
        };
        message.jwsToken = await this.generateJwsToken(message);
        const res = await fetch(`${ESRPReleaseService.API_URL}${this.clientId}/workflows/release/operations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessToken}`
            },
            body: JSON.stringify(message)
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to submit release: ${res.statusText}\n${text}`);
        }
        return await res.json();
    }
    async getReleaseStatus(releaseId) {
        const url = `${ESRPReleaseService.API_URL}${this.clientId}/workflows/release/operations/grs/${releaseId}`;
        const res = await retry(() => fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        }));
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to get release status: ${res.statusText}\n${text}`);
        }
        return await res.json();
    }
    async getReleaseDetails(releaseId) {
        const url = `${ESRPReleaseService.API_URL}${this.clientId}/workflows/release/operations/grd/${releaseId}`;
        const res = await retry(() => fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        }));
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Failed to get release status: ${res.statusText}\n${text}`);
        }
        return await res.json();
    }
    async generateJwsToken(message) {
        // Create header with properly typed properties, then override x5c with the non-standard string format
        const header = {
            alg: 'RS256',
            crit: ['exp', 'x5t'],
            // Release service uses ticks, not seconds :roll_eyes: (https://stackoverflow.com/a/7968483)
            exp: ((Date.now() + (6 * 60 * 1000)) * 10000) + 621355968000000000,
            // Release service uses hex format, not base64url :roll_eyes:
            x5t: getThumbprint(this.requestSigningCertificates[0], 'sha1').toString('hex'),
        };
        // The Release service expects x5c as a '.' separated string, not the standard array format
        header['x5c'] = this.requestSigningCertificates.map(c => getCertificateBuffer(c).toString('base64url')).join('.');
        return jws.sign({
            header,
            payload: message,
            privateKey: this.requestSigningKey,
        });
    }
}
class State {
    statePath;
    set = new Set();
    constructor() {
        const pipelineWorkspacePath = e('PIPELINE_WORKSPACE');
        const previousState = fs.readdirSync(pipelineWorkspacePath)
            .map(name => /^artifacts_processed_(\d+)$/.exec(name))
            .filter((match) => !!match)
            .map(match => ({ name: match[0], attempt: Number(match[1]) }))
            .sort((a, b) => b.attempt - a.attempt)[0];
        if (previousState) {
            const previousStatePath = path.join(pipelineWorkspacePath, previousState.name, previousState.name + '.txt');
            fs.readFileSync(previousStatePath, 'utf8').split(/\n/).filter(name => !!name).forEach(name => this.set.add(name));
        }
        const stageAttempt = e('SYSTEM_STAGEATTEMPT');
        this.statePath = path.join(pipelineWorkspacePath, `artifacts_processed_${stageAttempt}`, `artifacts_processed_${stageAttempt}.txt`);
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        fs.writeFileSync(this.statePath, [...this.set.values()].map(name => `${name}\n`).join(''));
    }
    get size() {
        return this.set.size;
    }
    has(name) {
        return this.set.has(name);
    }
    add(name) {
        this.set.add(name);
        fs.appendFileSync(this.statePath, `${name}\n`);
    }
    [Symbol.iterator]() {
        return this.set[Symbol.iterator]();
    }
}
const azdoFetchOptions = {
    headers: {
        // Pretend we're a web browser to avoid download rate limits
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://dev.azure.com',
        Authorization: `Bearer ${e('SYSTEM_ACCESSTOKEN')}`
    }
};
export async function requestAZDOAPI(path) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 2 * 60 * 1000);
    try {
        const res = await retry(() => fetch(`${e('BUILDS_API_URL')}${path}?api-version=6.0`, { ...azdoFetchOptions, signal: abortController.signal }));
        if (!res.ok) {
            throw new Error(`Unexpected status code: ${res.status}`);
        }
        return await res.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
async function getPipelineArtifacts() {
    const result = await requestAZDOAPI('artifacts');
    return result.value.filter(a => /^vscode_/.test(a.name) && !/sbom$/.test(a.name));
}
async function getPipelineTimeline() {
    return await requestAZDOAPI('timeline');
}
async function downloadArtifact(artifact, downloadPath) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 4 * 60 * 1000);
    try {
        const res = await fetch(artifact.resource.downloadUrl, { ...azdoFetchOptions, signal: abortController.signal });
        if (!res.ok) {
            throw new Error(`Unexpected status code: ${res.status}`);
        }
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(downloadPath));
    }
    finally {
        clearTimeout(timeout);
    }
}
async function unzip(packagePath, outputPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(packagePath, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
            if (err) {
                return reject(err);
            }
            const result = [];
            zipfile.on('entry', entry => {
                if (/\/$/.test(entry.fileName)) {
                    zipfile.readEntry();
                }
                else {
                    zipfile.openReadStream(entry, (err, istream) => {
                        if (err) {
                            return reject(err);
                        }
                        const filePath = path.join(outputPath, entry.fileName);
                        fs.mkdirSync(path.dirname(filePath), { recursive: true });
                        const ostream = fs.createWriteStream(filePath);
                        ostream.on('finish', () => {
                            result.push(filePath);
                            zipfile.readEntry();
                        });
                        istream?.on('error', err => reject(err));
                        istream.pipe(ostream);
                    });
                }
            });
            zipfile.on('close', () => resolve(result));
            zipfile.readEntry();
        });
    });
}
// Contains all of the logic for mapping details to our actual product names in CosmosDB
function getPlatform(product, os, arch, type) {
    switch (os) {
        case 'win32':
            switch (product) {
                case 'client': {
                    switch (type) {
                        case 'archive':
                            return `win32-${arch}-archive`;
                        case 'setup':
                            return `win32-${arch}`;
                        case 'user-setup':
                            return `win32-${arch}-user`;
                        default:
                            throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
                    }
                }
                case 'server':
                    return `server-win32-${arch}`;
                case 'web':
                    return `server-win32-${arch}-web`;
                case 'cli':
                    return `cli-win32-${arch}`;
                default:
                    throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
            }
        case 'alpine':
            switch (product) {
                case 'server':
                    return `server-alpine-${arch}`;
                case 'web':
                    return `server-alpine-${arch}-web`;
                case 'cli':
                    return `cli-alpine-${arch}`;
                default:
                    throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
            }
        case 'linux':
            switch (type) {
                case 'snap':
                    return `linux-snap-${arch}`;
                case 'archive-unsigned':
                    switch (product) {
                        case 'client':
                            return `linux-${arch}`;
                        case 'server':
                            return `server-linux-${arch}`;
                        case 'web':
                            if (arch === 'standalone') {
                                return 'web-standalone';
                            }
                            return `server-linux-${arch}-web`;
                        default:
                            throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
                    }
                case 'deb-package':
                    return `linux-deb-${arch}`;
                case 'rpm-package':
                    return `linux-rpm-${arch}`;
                case 'cli':
                    return `cli-linux-${arch}`;
                default:
                    throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
            }
        case 'darwin':
            switch (product) {
                case 'client':
                    switch (type) {
                        case 'dmg':
                            return `darwin-${arch}-dmg`;
                        case 'archive':
                        default:
                            if (arch === 'x64') {
                                return 'darwin';
                            }
                            return `darwin-${arch}`;
                    }
                case 'server':
                    if (arch === 'x64') {
                        return 'server-darwin';
                    }
                    return `server-darwin-${arch}`;
                case 'web':
                    if (arch === 'x64') {
                        return 'server-darwin-web';
                    }
                    return `server-darwin-${arch}-web`;
                case 'cli':
                    return `cli-darwin-${arch}`;
                default:
                    throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
            }
        default:
            throw new Error(`Unrecognized: ${product} ${os} ${arch} ${type}`);
    }
}
// Contains all of the logic for mapping types to our actual types in CosmosDB
function getRealType(type) {
    switch (type) {
        case 'user-setup':
            return 'setup';
        case 'deb-package':
        case 'rpm-package':
            return 'package';
        default:
            return type;
    }
}
async function withLease(client, fn) {
    const lease = client.getBlobLeaseClient();
    for (let i = 0; i < 360; i++) { // Try to get lease for 30 minutes
        try {
            await client.uploadData(new ArrayBuffer()); // blob needs to exist for lease to be acquired
            await lease.acquireLease(60);
            try {
                const abortController = new AbortController();
                const refresher = new Promise((c, e) => {
                    abortController.signal.onabort = () => {
                        clearInterval(interval);
                        c();
                    };
                    const interval = setInterval(() => {
                        lease.renewLease().catch(err => {
                            clearInterval(interval);
                            e(new Error('Failed to renew lease ' + err));
                        });
                    }, 30_000);
                });
                const result = await Promise.race([fn(), refresher]);
                abortController.abort();
                return result;
            }
            finally {
                await lease.releaseLease();
            }
        }
        catch (err) {
            if (err.statusCode !== 409 && err.statusCode !== 412) {
                throw err;
            }
            await new Promise(c => setTimeout(c, 5000));
        }
    }
    throw new Error('Failed to acquire lease on blob after 30 minutes');
}
async function processArtifact(artifact, filePath) {
    const log = (...args) => console.log(`[${artifact.name}]`, ...args);
    const match = /^vscode_(?<product>[^_]+)_(?<os>[^_]+)(?:_legacy)?_(?<arch>[^_]+)_(?<unprocessedType>[^_]+)$/.exec(artifact.name);
    if (!match) {
        throw new Error(`Invalid artifact name: ${artifact.name}`);
    }
    const { cosmosDBAccessToken, blobServiceAccessToken } = JSON.parse(e('PUBLISH_AUTH_TOKENS'));
    const quality = e('VSCODE_QUALITY');
    const version = e('BUILD_SOURCEVERSION');
    const friendlyFileName = `${quality}/${version}/${path.basename(filePath)}`;
    const blobServiceClient = new BlobServiceClient(`https://${e('VSCODE_STAGING_BLOB_STORAGE_ACCOUNT_NAME')}.blob.core.windows.net/`, { getToken: async () => blobServiceAccessToken });
    const leasesContainerClient = blobServiceClient.getContainerClient('leases');
    await leasesContainerClient.createIfNotExists();
    const leaseBlobClient = leasesContainerClient.getBlockBlobClient(friendlyFileName);
    log(`Acquiring lease for: ${friendlyFileName}`);
    await withLease(leaseBlobClient, async () => {
        log(`Successfully acquired lease for: ${friendlyFileName}`);
        const url = `${e('PRSS_CDN_URL')}/${friendlyFileName}`;
        const res = await retry(() => fetch(url));
        if (res.status === 200) {
            log(`Already released and provisioned: ${url}`);
        }
        else {
            const stagingContainerClient = blobServiceClient.getContainerClient('staging');
            await stagingContainerClient.createIfNotExists();
            const now = new Date().valueOf();
            const oneHour = 120 * 60 * 1000;
            const oneHourAgo = new Date(now - oneHour);
            const oneHourFromNow = new Date(now + oneHour);
            const userDelegationKey = await blobServiceClient.getUserDelegationKey(oneHourAgo, oneHourFromNow);
            const sasOptions = { containerName: 'staging', permissions: ContainerSASPermissions.from({ read: true }), startsOn: oneHourAgo, expiresOn: oneHourFromNow };
            const stagingSasToken = generateBlobSASQueryParameters(sasOptions, userDelegationKey, e('VSCODE_STAGING_BLOB_STORAGE_ACCOUNT_NAME')).toString();
            const releaseService = await ESRPReleaseService.create(log, e('RELEASE_TENANT_ID'), e('RELEASE_CLIENT_ID'), e('RELEASE_AUTH_CERT'), e('RELEASE_REQUEST_SIGNING_CERT'), stagingContainerClient, stagingSasToken);
            await releaseService.createRelease(version, filePath, friendlyFileName);
        }
        const { product, os, arch, unprocessedType } = match.groups;
        const platform = getPlatform(product, os, arch, unprocessedType);
        const type = getRealType(unprocessedType);
        const size = fs.statSync(filePath).size;
        const stream = fs.createReadStream(filePath);
        const [hash, sha256hash] = await Promise.all([hashStream('sha1', stream), hashStream('sha256', stream)]); // CodeQL [SM04514] Using SHA1 only for legacy reasons, we are actually only respecting SHA256
        const asset = { platform, type, url, hash: hash.toString('hex'), sha256hash: sha256hash.toString('hex'), size, supportsFastUpdate: true };
        log('Creating asset...');
        const result = await retry(async (attempt) => {
            log(`Creating asset in Cosmos DB (attempt ${attempt})...`);
            const client = new CosmosClient({ endpoint: e('AZURE_DOCUMENTDB_ENDPOINT'), tokenProvider: () => Promise.resolve(`type=aad&ver=1.0&sig=${cosmosDBAccessToken.token}`) });
            const scripts = client.database('builds').container(quality).scripts;
            const { resource: result } = await scripts.storedProcedure('createAsset').execute('', [version, asset, true]);
            return result;
        });
        if (result === 'already exists') {
            log('Asset already exists!');
        }
        else {
            log('Asset successfully created: ', JSON.stringify(asset, undefined, 2));
        }
    });
    log(`Successfully released lease for: ${friendlyFileName}`);
}
// It is VERY important that we don't download artifacts too much too fast from AZDO.
// AZDO throttles us SEVERELY if we do. Not just that, but they also close open
// sockets, so the whole things turns to a grinding halt. So, downloading and extracting
// happens serially in the main thread, making the downloads are spaced out
// properly. For each extracted artifact, we spawn a worker thread to upload it to
// the CDN and finally update the build in Cosmos DB.
async function main() {
    if (!isMainThread) {
        const { artifact, artifactFilePath } = workerData;
        await processArtifact(artifact, artifactFilePath);
        return;
    }
    const done = new State();
    const processing = new Set();
    for (const name of done) {
        console.log(`\u2705 ${name}`);
    }
    const stages = new Set(['Quality']);
    if (e('VSCODE_BUILD_STAGE_WINDOWS') === 'True') {
        stages.add('Windows');
    }
    if (e('VSCODE_BUILD_STAGE_LINUX') === 'True') {
        stages.add('Linux');
    }
    if (e('VSCODE_BUILD_STAGE_ALPINE') === 'True') {
        stages.add('Alpine');
    }
    if (e('VSCODE_BUILD_STAGE_MACOS') === 'True') {
        stages.add('macOS');
    }
    if (e('VSCODE_BUILD_STAGE_WEB') === 'True') {
        stages.add('Web');
    }
    let timeline;
    let artifacts;
    let resultPromise = Promise.resolve([]);
    const operations = [];
    while (true) {
        [timeline, artifacts] = await Promise.all([retry(() => getPipelineTimeline()), retry(() => getPipelineArtifacts())]);
        const stagesCompleted = new Set(timeline.records.filter(r => r.type === 'Stage' && r.state === 'completed' && stages.has(r.name)).map(r => r.name));
        const stagesInProgress = [...stages].filter(s => !stagesCompleted.has(s));
        const artifactsInProgress = artifacts.filter(a => processing.has(a.name));
        if (stagesInProgress.length === 0 && artifacts.length === done.size + processing.size) {
            break;
        }
        else if (stagesInProgress.length > 0) {
            console.log('Stages in progress:', stagesInProgress.join(', '));
        }
        else if (artifactsInProgress.length > 0) {
            console.log('Artifacts in progress:', artifactsInProgress.map(a => a.name).join(', '));
        }
        else {
            console.log(`Waiting for a total of ${artifacts.length}, ${done.size} done, ${processing.size} in progress...`);
        }
        for (const artifact of artifacts) {
            if (done.has(artifact.name) || processing.has(artifact.name)) {
                continue;
            }
            console.log(`[${artifact.name}] Found new artifact`);
            const artifactZipPath = path.join(e('AGENT_TEMPDIRECTORY'), `${artifact.name}.zip`);
            await retry(async (attempt) => {
                const start = Date.now();
                console.log(`[${artifact.name}] Downloading (attempt ${attempt})...`);
                await downloadArtifact(artifact, artifactZipPath);
                const archiveSize = fs.statSync(artifactZipPath).size;
                const downloadDurationS = (Date.now() - start) / 1000;
                const downloadSpeedKBS = Math.round((archiveSize / 1024) / downloadDurationS);
                console.log(`[${artifact.name}] Successfully downloaded after ${Math.floor(downloadDurationS)} seconds(${downloadSpeedKBS} KB/s).`);
            });
            const artifactFilePaths = await unzip(artifactZipPath, e('AGENT_TEMPDIRECTORY'));
            const artifactFilePath = artifactFilePaths.filter(p => !/_manifest/.test(p))[0];
            processing.add(artifact.name);
            const promise = new Promise((resolve, reject) => {
                const worker = new Worker(import.meta.filename, { workerData: { artifact, artifactFilePath } });
                worker.on('error', reject);
                worker.on('exit', code => {
                    if (code === 0) {
                        resolve();
                    }
                    else {
                        reject(new Error(`[${artifact.name}] Worker stopped with exit code ${code}`));
                    }
                });
            });
            const operation = promise.then(() => {
                processing.delete(artifact.name);
                done.add(artifact.name);
                console.log(`\u2705 ${artifact.name} `);
            });
            operations.push({ name: artifact.name, operation });
            resultPromise = Promise.allSettled(operations.map(o => o.operation));
        }
        await new Promise(c => setTimeout(c, 10_000));
    }
    console.log(`Found all ${done.size + processing.size} artifacts, waiting for ${processing.size} artifacts to finish publishing...`);
    const artifactsInProgress = operations.filter(o => processing.has(o.name));
    if (artifactsInProgress.length > 0) {
        console.log('Artifacts in progress:', artifactsInProgress.map(a => a.name).join(', '));
    }
    const results = await resultPromise;
    for (let i = 0; i < operations.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
            console.error(`[${operations[i].name}]`, result.reason);
        }
    }
    // Fail the job if any of the artifacts failed to publish
    if (results.some(r => r.status === 'rejected')) {
        throw new Error('Some artifacts failed to publish');
    }
    // Also fail the job if any of the stages did not succeed
    let shouldFail = false;
    for (const stage of stages) {
        const record = timeline.records.find(r => r.name === stage && r.type === 'Stage');
        if (record.result !== 'succeeded' && record.result !== 'succeededWithIssues') {
            shouldFail = true;
            console.error(`Stage ${stage} did not succeed: ${record.result}`);
        }
    }
    if (shouldFail) {
        throw new Error('Some stages did not succeed');
    }
    console.log(`All ${done.size} artifacts published!`);
}
if (import.meta.main) {
    main().then(() => {
        process.exit(0);
    }, err => {
        console.error(err);
        process.exit(1);
    });
}
