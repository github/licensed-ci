const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const github = require('@actions/github');
const io = require('@actions/io');
const stream = require('stream');

const ORIGIN = 'licensed-ci-origin';

async function configureGit() {
  const userName = core.getInput('user_name', { required: true });
  const userEmail = core.getInput('user_email', { required: true });
  const token = core.getInput('github_token', { required: true });

  await exec.exec('git', ['config', 'user.name', userName]);
  await exec.exec('git', ['config', 'user.email', userEmail]);
  await exec.exec('git', ['remote', 'add', '-f', ORIGIN, `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
}

async function getLicensedInput() {
  const command = core.getInput('command', { required: true });
  await io.which(command.split(' ')[0], true); // check that command is runnable

  const configFilePath = core.getInput('config_file', { required: true });
  await fs.access(configFilePath); // check that config file exists

  return { command, configFilePath };
}

function getBranch() {
  // checkout the target branch
  let branch = process.env.GITHUB_REF;
  if (!branch) {
    throw new Error('Current ref not available');
  } else if (!branch.startsWith('refs/heads')) {
    throw new Error(`${branch} does not reference a branch`);
  }

  return branch.replace('refs/heads/', '');
}

async function getCachePaths(command, configFilePath) {
  let output = '';
  const options = {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => { output += data.toString() }
    },
    outStream: new stream.Writable({ write: () => {} })
  };

  const exitCode = await exec.exec(command, ['env', '--format', 'json', '-c', configFilePath], options);
  if (exitCode === 0 && output) {
    return JSON.parse(output).apps.map(app => app.cache_path);
  }

  // if `licensed env` failed or there was no output, add updated files for the whole repo
  return ['.'];
}

async function ensureBranch(branch, parent) {
  // change to the target branch
  let exitCode = await exec.exec('git', ['checkout', '-t', `${ORIGIN}/${branch}`], { ignoreReturnCode: true });
  if (exitCode != 0 && branch !== parent) {
    await exec.exec('git', ['checkout', '-t', `${ORIGIN}/${parent}`]);
    exitCode = await exec.exec('git', ['checkout', '-b', branch, '--track', `${ORIGIN}/${parent}`], { ignoreReturnCode: true });
  }

  if (exitCode != 0) {
    throw new Error(`Unable to find or create the ${branch} branch`);
  }

  // ensure that branch is up to date with parent
  if (branch !== parent) {
    exitCode = await exec.exec('git', ['rebase', parent], { ignoreReturnCode: true });
    if (exitCode !== 0) {
      throw new Error(`Unable to get ${branch} up to date with ${parent}`);
    }
  }
}

async function findPullRequest(octokit, options={}) {
  let query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY}`;
  for (let key in options) {
    query += ` ${key}:"${options[key]}"`
  }

  const { data } = await octokit.search.issuesAndPullRequests({ q: query });
  const results = data.items;
  if (results && results.length > 0) {
    return results[0];
  }

  return null;
}

async function closePullRequest(octokit, pullRequest) {
  if (!pullRequest || pullRequest.state != 'open') {
    return pullRequest;
  }

  const { data: pull } = await octokit.pulls.update({
    ...github.context.repo,
    pull_number: pullRequest.number,
    state: 'closed'
  });

  return pull;
}

async function deleteBranch(branch) {
  const exitCode = await exec.exec('git', ['ls-remote', '--exit-code', ORIGIN, branch], { ignoreReturnCode: true });
  if (exitCode === 0) {
    await exec.exec('git', ['push', ORIGIN, '--delete', branch]);
  }
}

module.exports = {
  configureGit,
  getLicensedInput,
  getBranch,
  getCachePaths,
  ensureBranch,
  findPullRequest,
  closePullRequest,
  deleteBranch,
  getOrigin: () => ORIGIN
};
