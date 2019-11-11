const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const utils = require('../utils');

async function findPullRequest(octokit, branch) {
  // first try to find a pull request for the branch
  const { data } = await octokit.search.issuesAndPullRequests({
    q: `is:pr repo:${process.env.GITHUB_REPOSITORY} head:${branch}`
  })

  if (data.total_count != 1) {
    core.info(`Pull request for branch ${branch} not found, skipping comment`);
    return;
  }

  const pull = data.items[0];
  core.info(`Found pull request ${pull.html_url}`);

  // if a PR comment was supplied, add it to the pull request
  const comment = core.getInput('pr_comment');
  if (comment) {
    core.info(`Adding comment ${comment}`);
    core.warning('"pr_comment" is deprecated.  Please use the "pr_url" and "pr_number" step outputs to script actions on an available pull request.');

    await octokit.issues.createComment({
      ...github.context.repo,
      issue_number: pull.number,
      body: comment,
    });
  }

  core.setOutput('pr_url', pull.html_url);
  core.setOutput('pr_number', pull.number);
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
  const branch = utils.getBranch();
  const { command, configFilePath } = await utils.getLicensedInput();

  // pre-check, if status succeeds no need to recache
  let statusResult = await status();
  if (statusResult.success) {
    return;
  }

  await utils.ensureBranch(branch, branch);

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
    const token = core.getInput('github_token', { required: true });
    const octokit = new github.GitHub(token);

    await exec.exec('git', ['commit', '-m', commitMessage]);
    await exec.exec('git', ['push', 'licensed-ci-origin', branch]);

    // find an open pull request for the changes, to give output context
    await findPullRequest(octokit, branch);
  }

  // after recaching, check status
  statusResult = await status();
  if (!statusResult.success) {
    throw new Error('Cached metadata checks failed');
  }
}

module.exports = run;
