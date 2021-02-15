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
  await exec.exec('git', ['remote', 'add', ORIGIN, `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
}

async function getLicensedInput() {
  const command = core.getInput('command', { required: true });
  await io.which(command.split(' ')[0], true); // check that command is runnable

  const configFilePath = core.getInput('config_file', { required: true });
  await fs.access(configFilePath); // check that config file exists

  return { command, configFilePath };
}

async function checkStatus(command, configFilePath) {
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

function getBranch(context) {
  if (context.payload && context.payload.pull_request) {
    return context.payload.pull_request.head.ref;
  } else if (context.payload && context.payload.ref) {
    const ref = context.payload.ref;
    if (!ref.startsWith('refs/heads')) {
      throw new Error(`${ref} does not reference a branch`);
    }
    return ref.replace('refs/heads/', '');
  }

  throw new Error(`Unable to determine a HEAD branch reference for ${context.eventName} event type`);
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
  let exitCode = await exec.exec('git', ['checkout', branch], { ignoreReturnCode: true });
  if (exitCode != 0 && branch !== parent) {
    await exec.exec('git', ['checkout', parent]);
    exitCode = await exec.exec('git', ['checkout', '-b', branch], { ignoreReturnCode: true });
  }

  if (exitCode != 0) {
    throw new Error(`Unable to find or create the ${branch} branch`);
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
  checkStatus,
  getOrigin: () => ORIGIN
};
