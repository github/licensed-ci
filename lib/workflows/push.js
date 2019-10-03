const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const utils = require('../utils');

async function createCommentOnPullRequest(octokit, branch, comment) {
  // first try to find a pull request for the branch
  const { data } = await octokit.search.issuesAndPullRequests({
    q: `is:pr repo:${process.env.GITHUB_REPOSITORY} head:${branch}`
  })

  if (data.total_count != 1) {
    console.log(`Pull request for branch ${branch} not found`);
    return null;
  }

  // then add a comment if a pull request exists
  const issue = data.items[0];
  console.log(`Found pull request ${issue.pull_request.html_url}`);
  console.log(`Adding comment ${comment}`);

  return octokit.issues.createComment({
    ...github.context.repo,
    issue_number: issue.number,
    body: comment,
  });
}

async function cache() {
  const branch = utils.getBranch();
  const { command, configFilePath } = await utils.getLicensedInput();

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

    await exec.exec('git', ['remote', 'add', 'licensed-ci-origin', `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
    await exec.exec('git', ['commit', '-m', commitMessage]);
    await exec.exec('git', ['push', 'licensed-ci-origin', branch]);

    // if a PR comment was supplied, try to comment on an open pull request
    const prComment = core.getInput('pr_comment');
    if (prComment) {
      await createCommentOnPullRequest(octokit, branch, prComment);
    }
  }
}

async function status() {
  const { command, configFilePath } = await utils.getLicensedInput();
  await exec.exec(command, ['status', '-c', configFilePath]);
}

module.exports = {
  cache,
  status
};
