const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const utils = require('../utils');

async function commentOnPullRequest(octokit, pullRequest) {
  // if a PR comment was supplied, add it to the pull request
  const comment = core.getInput('pr_comment');
  if (comment) {
    core.info(`Adding comment ${comment}`);
    core.warning('"pr_comment" is deprecated.  Please use the "pr_url" and "pr_number" step outputs to script actions on an available pull request.');

    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: pullRequest.number,
      body: comment,
    });
  }
}

async function run() {
  let licensesUpdated = false;
  const branch = utils.getBranch(github.context);
  core.setOutput('licenses_branch', branch);
  core.setOutput('user_branch', branch);

  const { command, configFilePath } = await utils.getLicensedInput();

  // pre-check, if status succeeds no need to re-cache
  let statusResult = await core.group('Pre-Checking license status', async () => {
    return utils.checkStatus(command, configFilePath);
  });
  if (statusResult.success) {
    return;
  }

  const [localBranch] = await utils.ensureBranch(branch, branch);

  // find an open pull request for the changes if one exists
  const token = core.getInput('github_token', { required: true });
  const octokit = github.getOctokit(token);
  const pullRequest = await utils.findPullRequest(octokit, { head: branch });

  // cache any metadata updates
  await core.group('Refreshing cache', async () => {
    await exec.exec(command, ['cache', '-c', configFilePath]);

    // stage any changes, checking only configured cache paths if possible
    const cachePaths = await utils.getCachePaths(command, configFilePath);
    await exec.exec('git', ['add', '--', ...(await utils.filterCachePaths(cachePaths))]);

    // check for any changes, checking only configured cache paths if possible
    const exitCode = await exec.exec('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths], { ignoreReturnCode: true });
    if (exitCode > 0) {
      // if files were changed, push them back up to origin using the passed in github token
      await exec.exec('git', [...utils.userConfig(), 'commit', '-m', utils.getCommitMessage(github.context)]);

      const extraHeadersConfig = await utils.extraHeaderConfigWithoutAuthorization();
      await exec.exec('git', [...extraHeadersConfig, 'push', utils.getOrigin(), `${localBranch}:${branch}`]);
      licensesUpdated = true;

      // if a PR comment was supplied and PR exists, add comment
      if (pullRequest) {
        await commentOnPullRequest(octokit, pullRequest);
      }
    }

    core.setOutput('licenses_updated', licensesUpdated.toString());
  });

  if (pullRequest) {
    core.setOutput('pr_url', pullRequest.html_url);
    core.setOutput('pr_number', pullRequest.number);
  }

  // after re-caching, check status
  await core.group('Check license status', async () => {
    statusResult = await utils.checkStatus(command, configFilePath);
    if (!statusResult.success) {
      throw new Error('Cached metadata checks failed');
    }
  });
}

module.exports = { run };
