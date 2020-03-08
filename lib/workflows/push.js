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

    await octokit.issues.createComment({
      ...github.context.repo,
      issue_number: pullRequest.number,
      body: comment,
    });
  }
}

async function status() {
  const { command, configFilePath } = await utils.getLicensedInput();

  let log = '';
  const options = {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => log += data.toString()
    }
  };
  const exitCode = await exec.exec(command, ['status', '-c', configFilePath], options);
  return { success: exitCode === 0, log };
}

async function run() {
  let licensesUpdated = false;
  const branch = utils.getBranch();
  core.setOutput('licenses_branch', branch);
  core.setOutput('user_branch', branch);

  const { command, configFilePath } = await utils.getLicensedInput();

  // pre-check, if status succeeds no need to recache
  let statusResult = await status();
  if (statusResult.success) {
    return;
  }

  await utils.ensureBranch(branch, branch);

  // find an open pull request for the changes if one exists
  const token = core.getInput('github_token', { required: true });
  const octokit = new github.GitHub(token);
  const pullRequest = await utils.findPullRequest(octokit, { head: branch });

  // cache any metadata updates
  await exec.exec(command, ['cache', '-c', configFilePath]);

  // stage any changes, checking only configured cache paths if possible
  const cachePaths = await utils.getCachePaths(command, configFilePath);
  await exec.exec('git', ['add', '--', ...cachePaths]);

  // check for any changes, checking only configured cache paths if possible
  const exitCode = await exec.exec('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths], { ignoreReturnCode: true });
  if (exitCode > 0) {
    // if files were changed, push them back up to origin using the passed in github token
    const commitMessage = core.getInput('commit_message', { required: true });
    await exec.exec('git', ['commit', '-m', commitMessage]);
    await exec.exec('git', ['push', utils.getOrigin(), branch]);
    licensesUpdated = true;

    // if a PR comment was supplied and PR exists, add comment
    if (pullRequest) {
      await commentOnPullRequest(octokit, pullRequest);
    }
  }

  core.setOutput('licenses_updated', licensesUpdated.toString());

  if (pullRequest) {
    core.setOutput('pr_url', pullRequest.html_url);
    core.setOutput('pr_number', pullRequest.number);
  }

  // after recaching, check status
  statusResult = await status();
  if (!statusResult.success) {
    throw new Error('Cached metadata checks failed');
  }
}

module.exports = run;
