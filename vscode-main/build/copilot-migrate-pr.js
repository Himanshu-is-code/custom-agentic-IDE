/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Migrates a pull request from microsoft/vscode-copilot-chat to microsoft/vscode.
//
// The diff is fetched, file paths are rewritten to prepend `extensions/copilot/`,
// and a new PR is created in microsoft/vscode via the `gh` CLI.
//
// Usage:
//   node build/copilot-migrate-pr.ts <PR_NUMBER> [--dry-run] [--verbose]
//
// Requirements:
//   - `gh` CLI installed and authenticated with access to both repos
//   - Local checkout of microsoft/vscode with `main` branch up to date
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
const SOURCE_REPO = 'microsoft/vscode-copilot-chat';
const TARGET_REPO = 'microsoft/vscode';
const PATH_PREFIX = 'extensions/copilot';
function parseArgs() {
    const args = process.argv.slice(2);
    let prNumber;
    let dryRun = false;
    let verbose = false;
    for (const arg of args) {
        if (arg === '--dry-run') {
            dryRun = true;
        }
        else if (arg === '--verbose') {
            verbose = true;
        }
        else if (!prNumber && /^\d+$/.test(arg)) {
            prNumber = parseInt(arg, 10);
        }
        else {
            console.error(`Unknown argument: ${arg}`);
            process.exit(1);
        }
    }
    if (!prNumber) {
        console.error('Usage: node build/copilot-migrate-pr.ts <PR_NUMBER> [--dry-run] [--verbose]');
        process.exit(1);
    }
    return { prNumber, dryRun, verbose };
}
function supportsColor() {
    return Boolean(output.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}
function color(text, code, enabled) {
    if (!enabled) {
        return text;
    }
    return `\u001b[${code}m${text}\u001b[0m`;
}
function createLogger(verbose) {
    const useColor = supportsColor();
    const label = {
        info: color('[INFO]', 36, useColor),
        detail: color('[DETAIL]', 90, useColor),
        step: color('[STEP]', 34, useColor),
        warn: color('[WARN]', 33, useColor),
        success: color('[DONE]', 32, useColor),
    };
    return {
        info: message => console.log(`${label.info} ${message}`),
        detail: message => {
            if (verbose) {
                console.log(`${label.detail} ${message}`);
            }
        },
        step: message => console.log(`\n${label.step} ${message}`),
        warn: message => console.log(`${label.warn} ${message}`),
        success: message => console.log(`\n${label.success} ${message}`),
    };
}
async function promptYesNo(question, defaultNo = true) {
    const rl = createInterface({ input, output });
    try {
        const suffix = defaultNo ? ' [y/N]: ' : ' [Y/n]: ';
        const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
        if (!answer) {
            return !defaultNo;
        }
        return answer === 'y' || answer === 'yes';
    }
    finally {
        rl.close();
    }
}
async function waitForEnter(message) {
    const rl = createInterface({ input, output });
    try {
        await rl.question(`${message}\nPress Enter to continue...`);
    }
    finally {
        rl.close();
    }
}
// ---------------------------------------------------------------------------
// gh CLI helpers
// ---------------------------------------------------------------------------
function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
}
function git(args, cwd, env) {
    return execFileSync('git', args, {
        encoding: 'utf-8',
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 50 * 1024 * 1024
    });
}
function getCurrentRef(repoRoot) {
    try {
        return git(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot).trim();
    }
    catch {
        return git(['rev-parse', 'HEAD'], repoRoot).trim();
    }
}
function checkoutRef(ref, repoRoot) {
    git(['checkout', ref], repoRoot);
}
function getMigrationBranchName(prNumber) {
    return `vscode-copilot-chat/migrate-${prNumber}`;
}
function remoteBranchExists(remote, branchName, repoRoot) {
    try {
        git(['ls-remote', '--exit-code', '--heads', remote, branchName], repoRoot);
        return true;
    }
    catch (error) {
        const status = error.status;
        if (status === 2) {
            return false;
        }
        throw error;
    }
}
function fetchPrMetadata(prNumber) {
    const json = gh([
        'pr', 'view', String(prNumber),
        '--repo', SOURCE_REPO,
        '--json', 'title,body,baseRefName,headRefName,state,mergedAt,isDraft,number,author,labels,assignees',
    ]);
    return JSON.parse(json);
}
function fetchPrDiff(prNumber) {
    return gh([
        'pr', 'diff', String(prNumber),
        '--repo', SOURCE_REPO,
    ]);
}
function fetchPrCommits(prNumber) {
    const json = gh([
        'api',
        `repos/${SOURCE_REPO}/pulls/${prNumber}/commits`,
        '--paginate',
    ]);
    const commits = JSON.parse(json);
    return commits.map(commit => ({
        sha: commit.sha,
        author: commit.commit.author,
        committer: commit.commit.committer,
    }));
}
function fetchCommitPatch(sha) {
    return gh([
        'api',
        `repos/${SOURCE_REPO}/commits/${sha}`,
        '-H', 'Accept: application/vnd.github.patch',
    ]);
}
function getDiffStats(diff) {
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ')) {
            filesChanged++;
        }
        else if (line.startsWith('+') && !line.startsWith('+++')) {
            insertions++;
        }
        else if (line.startsWith('-') && !line.startsWith('---')) {
            deletions++;
        }
    }
    return {
        filesChanged,
        insertions,
        deletions,
    };
}
// ---------------------------------------------------------------------------
// Diff path rewriting
// ---------------------------------------------------------------------------
/**
 * Rewrites file paths in a unified diff to prepend `extensions/copilot/`.
 *
 * Handles:
 *   - `diff --git a/path b/path`
 *   - `--- a/path` / `+++ b/path`
 *   - `/dev/null` (new/deleted files) — left unchanged
 *   - `rename from path` / `rename to path`
 *   - `copy from path` / `copy to path`
 */
function rewriteDiff(diff) {
    const lines = diff.split('\n');
    const result = [];
    for (const line of lines) {
        result.push(rewriteDiffLine(line));
    }
    return result.join('\n');
}
function rewriteDiffLine(line) {
    // diff --git a/path b/path
    const diffGitMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffGitMatch) {
        return `diff --git a/${PATH_PREFIX}/${diffGitMatch[1]} b/${PATH_PREFIX}/${diffGitMatch[2]}`;
    }
    // --- a/path or --- /dev/null
    const minusMatch = line.match(/^--- a\/(.+)$/);
    if (minusMatch) {
        return `--- a/${PATH_PREFIX}/${minusMatch[1]}`;
    }
    // +++ b/path or +++ /dev/null
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch) {
        return `+++ b/${PATH_PREFIX}/${plusMatch[1]}`;
    }
    // rename from path / rename to path
    const renameFromMatch = line.match(/^rename from (.+)$/);
    if (renameFromMatch) {
        return `rename from ${PATH_PREFIX}/${renameFromMatch[1]}`;
    }
    const renameToMatch = line.match(/^rename to (.+)$/);
    if (renameToMatch) {
        return `rename to ${PATH_PREFIX}/${renameToMatch[1]}`;
    }
    // copy from path / copy to path
    const copyFromMatch = line.match(/^copy from (.+)$/);
    if (copyFromMatch) {
        return `copy from ${PATH_PREFIX}/${copyFromMatch[1]}`;
    }
    const copyToMatch = line.match(/^copy to (.+)$/);
    if (copyToMatch) {
        return `copy to ${PATH_PREFIX}/${copyToMatch[1]}`;
    }
    // Everything else (context lines, hunk headers, /dev/null, etc.) passes through
    return line;
}
// ---------------------------------------------------------------------------
// Branch and PR creation
// ---------------------------------------------------------------------------
function hasActiveRebaseApply(repoRoot) {
    return fs.existsSync(path.join(repoRoot, '.git', 'rebase-apply'));
}
async function resolveAmConflicts(repoRoot) {
    console.log('\nA commit patch could not be applied cleanly.');
    console.log('Resolve merge conflicts in your working tree, stage the changes, and continue.');
    for (;;) {
        await waitForEnter('After resolving conflicts and staging the changes, continue.');
        const unresolved = git(['diff', '--name-only', '--diff-filter=U'], repoRoot).trim();
        if (unresolved) {
            console.log('\nThese files still have unresolved conflicts:');
            for (const file of unresolved.split('\n')) {
                console.log(`  - ${file}`);
            }
            continue;
        }
        try {
            git(['am', '--continue'], repoRoot);
            break;
        }
        catch (error) {
            console.log(`\nCould not continue apply: ${error instanceof Error ? error.message : String(error)}`);
            console.log('Fix any remaining issues, ensure all changes are staged, then try again.');
        }
    }
}
function amendHeadCommitMetadata(commit, repoRoot) {
    if (!commit.author && !commit.committer) {
        return;
    }
    const author = commit.author ?? commit.committer;
    const committer = commit.committer ?? commit.author;
    if (!author || !committer) {
        return;
    }
    git([
        'commit',
        '--amend',
        '--no-edit',
        '--author', `${author.name} <${author.email}>`,
        '--date', author.date,
    ], repoRoot, {
        GIT_COMMITTER_NAME: committer.name,
        GIT_COMMITTER_EMAIL: committer.email,
        GIT_COMMITTER_DATE: committer.date,
    });
}
async function createBranchAndApplyCommits(prNumber, commits, repoRoot) {
    const branchName = getMigrationBranchName(prNumber);
    // Ensure we're on a clean state based on main
    git(['checkout', 'main'], repoRoot);
    git(['pull', '--ff-only', 'origin', 'main'], repoRoot);
    // Create and switch to the new branch
    try {
        git(['checkout', '-b', branchName], repoRoot);
    }
    catch {
        // Branch may already exist from a previous attempt
        git(['checkout', branchName], repoRoot);
        git(['reset', '--hard', 'main'], repoRoot);
    }
    for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const patch = fetchCommitPatch(commit.sha);
        const rewrittenPatch = rewriteDiff(patch);
        const tmpPatch = path.join(os.tmpdir(), `copilot-migrate-pr-${prNumber}-${i + 1}.patch`);
        try {
            fs.writeFileSync(tmpPatch, rewrittenPatch);
            try {
                git(['am', '--3way', tmpPatch], repoRoot);
            }
            catch {
                if (!hasActiveRebaseApply(repoRoot)) {
                    throw new Error(`Failed to apply commit ${commit.sha}.`);
                }
                await resolveAmConflicts(repoRoot);
            }
        }
        finally {
            fs.unlinkSync(tmpPatch);
        }
        amendHeadCommitMetadata(commit, repoRoot);
    }
    if (!commits.length) {
        git([
            'commit',
            '--allow-empty',
            '-m', `Migrate ${SOURCE_REPO}#${prNumber}`,
        ], repoRoot);
    }
    return branchName;
}
function closeSourcePr(prNumber, targetPrUrl) {
    const comment = `Superseded by ${targetPrUrl}`;
    gh([
        'pr', 'close', String(prNumber),
        '--repo', SOURCE_REPO,
        '--comment', comment,
    ]);
}
function pushBranch(branchName, repoRoot) {
    git(['push', '-u', 'origin', branchName, '--force-with-lease'], repoRoot);
}
function createPr(meta, branchName) {
    const migrationNote = [
        `> Migrated from ${SOURCE_REPO}#${meta.number}`,
        `> Original author: @${meta.author.login}`,
        '',
    ].join('\n');
    const body = meta.body
        ? `${migrationNote}\n---\n\n${meta.body}`
        : migrationNote;
    const args = [
        'pr', 'create',
        '--repo', TARGET_REPO,
        '--head', branchName,
        '--base', 'main',
        '--title', meta.title,
        '--body', body,
    ];
    if (meta.isDraft) {
        args.push('--draft');
    }
    for (const assignee of meta.assignees) {
        args.push('--assignee', assignee.login);
    }
    for (const label of meta.labels) {
        args.push('--label', label.name);
    }
    return gh(args).trim();
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const { prNumber, dryRun, verbose } = parseArgs();
    const logger = createLogger(verbose);
    const repoRoot = path.dirname(import.meta.dirname);
    const originalRef = getCurrentRef(repoRoot);
    const targetBranchName = getMigrationBranchName(prNumber);
    let shouldRestoreRef = false;
    try {
        logger.info(`Migrating PR #${prNumber} from ${SOURCE_REPO} to ${TARGET_REPO}`);
        logger.detail(`Starting ref: ${originalRef}`);
        if (!dryRun) {
            logger.step('Checking whether target branch already exists on origin');
            if (remoteBranchExists('origin', targetBranchName, repoRoot)) {
                throw new Error(`Remote branch already exists: origin/${targetBranchName}. Delete it before rerunning.`);
            }
            logger.detail(`Target branch is available: origin/${targetBranchName}`);
        }
        logger.step('Fetching source PR metadata');
        const meta = fetchPrMetadata(prNumber);
        if (meta.state !== 'OPEN') {
            const status = meta.mergedAt ? 'merged' : 'closed';
            throw new Error(`Source PR #${prNumber} is ${status}. Only open PRs can be migrated.`);
        }
        logger.info(`Title: ${meta.title}`);
        logger.detail(`Author: @${meta.author.login}`);
        logger.detail(`Base: ${meta.baseRefName} -> Head: ${meta.headRefName}`);
        logger.detail(`State: ${meta.state}`);
        logger.detail(`Draft: ${meta.isDraft}`);
        logger.detail(`Labels: ${meta.labels.map(l => l.name).join(', ') || '(none)'}`);
        logger.detail(`Assignees: ${meta.assignees.map(a => a.login).join(', ') || '(none)'}`);
        logger.step('Fetching source PR commits');
        const commits = fetchPrCommits(prNumber);
        logger.info(`Commit count: ${commits.length}`);
        logger.step('Fetching and rewriting diff');
        const diff = fetchPrDiff(prNumber);
        const diffStats = getDiffStats(diff);
        logger.detail(`Diff size: ${diff.length} bytes`);
        logger.info(`Diff stats: ${diffStats.filesChanged} files changed, ${diffStats.insertions} insertions(+), ${diffStats.deletions} deletions(-)`);
        if (dryRun) {
            logger.info('Dry run: no changes were made.');
            return;
        }
        logger.step('Creating branch and applying commit series');
        const branchName = await createBranchAndApplyCommits(prNumber, commits, repoRoot);
        shouldRestoreRef = true;
        logger.info(`Branch: ${branchName}`);
        logger.step('Pushing branch');
        pushBranch(branchName, repoRoot);
        logger.step(`Creating PR in ${TARGET_REPO}`);
        const prUrl = createPr(meta, branchName);
        logger.success(`PR created: ${prUrl}`);
        const closeOldPr = await promptYesNo(`Close source PR #${prNumber} in ${SOURCE_REPO}?`);
        if (closeOldPr) {
            try {
                closeSourcePr(prNumber, prUrl);
                logger.info(`Closed source PR #${prNumber}`);
            }
            catch (error) {
                logger.warn(`Failed to close source PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else {
            logger.info(`Left source PR #${prNumber} open`);
        }
    }
    finally {
        if (shouldRestoreRef) {
            logger.step(`Restoring original ref (${originalRef})`);
            try {
                checkoutRef(originalRef, repoRoot);
                logger.info(`Checked out ${originalRef}`);
            }
            catch (error) {
                logger.warn(`Failed to restore original ref ${originalRef}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
}
main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
