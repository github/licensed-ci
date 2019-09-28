const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const github = require('@actions/github');
const io = require('@actions/io');

async function createCommentOnPullRequest(token, branch, comment) {
  const octokit = new github.GitHub(token);

  // first try to find a pull request for the branch
  await octokit.search.issuesAndPullRequests({
    q: `is:pr repo:${process.env.GITHUB_REPOSITORY} head:${branch}`
  }).then(({ data }) => {
    if (data.total_count != 1) {
      console.log(`Pull request for branch ${branch} not found`);
      return null;
    }

    // then add a comment if a pull request exists
    const issue = data.items[0];
    console.log(`Found pull request ${issue.pull_request.html_url}`);
    console.log(`Add comment ${comment}`);

    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
    return octokit.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: comment,
    });
  });
}

async function getCachePaths(command, configFilePath) {
  let output = '';
  const options = {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => { output += data.toString() }
    }
  };

  const exitCode = await exec.exec(command, ['env', '--format', 'json', '-c', configFilePath], options);
  if (exitCode === 0 && output) {
    return JSON.parse(output).apps.map(app => app.cache_path);
  }

  // if `licensed env` failed or there was no output, add updated files for the whole repo
  return ['.'];
}

async function run() {
  try {
    const commitMessage = core.getInput('commit_message', { required: true });
    const userName = core.getInput('user_name', { required: true });
    const userEmail = core.getInput('user_email', { required: true });

    const command = core.getInput('command', { required: true });
    await io.which(command.split(' ')[0], true); // check that command is runnable

    const configFilePath = core.getInput('config_file', { required: true });
    await fs.access(configFilePath); // check that config file exists

    // checkout the target branch
    let branch = process.env.GITHUB_REF;
    if (!branch) {
      throw new Error('Current ref not available');
    } else if (!branch.startsWith('refs/heads')) {
      throw new Error(`${branch} does not reference a branch`);
    }
    branch = branch.replace('refs/heads/', '');
    await exec.exec('git', ['checkout', branch]);

    // cache any metadata updates
    await exec.exec(command, ['cache', '-c', configFilePath]);

    // stage any changes, checking only configured cache paths if possible
    const cachePaths = await getCachePaths(command, configFilePath);
    await exec.exec('git', ['add', '--', ...cachePaths]);

    // check for any changes, checking only configured cache paths if possible
    const exitCode = await exec.exec('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths], { ignoreReturnCode: true });
    if (exitCode > 0) {
      // if files were changed, push them back up to origin using the passed in github token
      const token = core.getInput('github_token', { required: true });
      await exec.exec('git', ['remote', 'add', 'licensed-ci-origin', `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
      await exec.exec('git', ['-c', `user.name=${userName}`, '-c', `user.email=${userEmail}`, 'commit', '-m', commitMessage]);
      await exec.exec('git', ['push', 'licensed-ci-origin', branch]);

      // if a PR comment was supplied, try to comment on an open pull request
      const prComment = core.getInput('pr_comment');
      if (prComment) {
        createCommentOnPullRequest(token, branch, prComment);
      }
    }

    // check the status of current cached data
    await exec.exec(command, ['status', '-c', configFilePath]);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
