const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const utils = require('../utils');

PULL_REQUEST_TEMPLATE = `
This PR was auto generated by the 'licensed-ci' GitHub Action.
It contains updates to cached 'github/licensed' dependency metadata to be merged into <base>.

Please review the changed files and adjust as needed before merging.

<prComment>

/cc @<actor>
`.trim();

async function ensureLicensesPullRequest(octokit, head, base) {
  const { data } = await octokit.search.issuesAndPullRequests({
    q: `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:${head} base:${base}`
  });

  if (data.total_count > 0) {
    // an open PR from the licenses branch to the parent branch exists
    return;
  }

  const prComment = core.getInput('pr_comment');
  const actor = process.env.GITHUB_ACTOR;
  const body = PULL_REQUEST_TEMPLATE.replace('<actor>', actor)
                                    .replace('<prComment>', prComment);

  await octokit.pulls.create({
    ...github.context.repo,
    title: `License updates for ${base}`,
    head,
    base,
    body
  });
}


async function branch() {
  const branch = utils.getBranch();

  const runCacheWorkflow = !branch.endsWith('/licenses');
  if (runCacheWorkflow) {
    const licensesBranch = `${branch}-licenses`;
    const { command, configFilePath } = await utils.getLicensedInput();

    // change to a `<branch>/licenses` branch to continue updates
    await utils.ensureBranch(licensesBranch, branch);

    // cache any metadata updates
    await exec.exec(command, ['cache', '-c', configFilePath]);

    // stage any changes, checking only configured cache paths if possible
    const cachePaths = await utils.getCachePaths(command, configFilePath);
    await exec.exec('git', ['add', '--', ...cachePaths]);

    // check for any changes, checking only configured cache paths if possible
    const exitCode = await exec.exec('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths], { ignoreReturnCode: true });
    if (exitCode > 0) {
      // if files were changed, push them back up to origin using the passed in github token
      const token = core.getInput('github_token', { required: true });
      const octokit = new github.GitHub(token);

      const { userName, userEmail, commitMessage } = utils.getCommitInput();

      await exec.exec('git', ['remote', 'add', 'licensed-ci-origin', `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
      await exec.exec('git', ['-c', `user.name=${userName}`, '-c', `user.email=${userEmail}`, 'commit', '-m', commitMessage]);
      await exec.exec('git', ['push', 'licensed-ci-origin', licensesBranch]);

      await ensureLicensesPullRequest(octokit, licensesBranch, branch);
    }

    await exec.exec('git', ['checkout', branch])
  }
}

module.exports = branch;