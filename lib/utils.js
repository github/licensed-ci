const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const io = require('@actions/io');
const fs = require('fs');
const { throttling } = require('@octokit/plugin-throttling');
const stream = require('stream');

const { CLIOptions } = require('./cli-options');

const ORIGIN = 'licensed-ci-origin';

const MAX_RETRY_COUNT = 5;
const octokitThrottleOptions = {
  onRateLimit: (retryAfter, _options, _octokit, retryCount) => {
    if (retryCount >= MAX_RETRY_COUNT) {
      core.error(`Request was not successful after ${MAX_RETRY_COUNT} attempts.  Failing`);
      return false;
    }

    core.info(`Request attempt ${retryCount + 1} was rate limited, retrying after ${retryAfter} seconds`);
    return true;
  },
  onSecondaryRateLimit: (retryAfter, _options, _octokit, retryCount) => {
    if (retryCount >= MAX_RETRY_COUNT) {
      core.error(`Request was not successful after ${MAX_RETRY_COUNT} attempts.  Failing`);
      return false;
    }

    core.info(`Request attempt ${retryCount + 1} hit secondary rate limits, retrying after ${retryAfter} seconds`);
    return true;
  },
};

async function configureGit() {
  const token = core.getInput('github_token', { required: true });
  await core.group('Configuring git', async () => {
    await exec.exec('git', ['remote', 'add', ORIGIN, `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}`]);
  });
}

async function extraHeaderConfigWithoutAuthorization() {
  const serverUrl = new URL(process.env['GITHUB_SERVER_URL'] || 'https://github.com');
  const configValues = [];

  // check for both broad and specific extraheader values
  for (const key of ['http.extraheader', `http.${serverUrl.origin}/.extraheader`]) {
    // always set an empty string to clear any stored config values for the key
    configValues.push(`${key}=`);

    const options = {
      ignoreReturnCode: true,
      listeners: {
        stdout: data => {
          // if this isn't an authorization header, keep using it
          const headers = data.toString().match(/[^\r\n]+/g);
          headers.map(header => header.trim())
                 .filter(header => !header.toLowerCase().startsWith('authorization:'))
                 .forEach(header => configValues.push(`${key}=${header}`));

        }
      }
    };
    await exec.exec('git', ['config', '--get-all', key], options);
  }

  return configValues.flatMap(value => ['-c', value]);
}

function newOctokit() {
  const token = core.getInput('github_token', { required: true });
  // add rate limit handling using the throttling plugin
  return github.getOctokit(
    token,
    { throttle: octokitThrottleOptions },
    throttling
  );
}

function userConfig() {
  const userName = core.getInput('user_name', { required: true });
  const userEmail = core.getInput('user_email', { required: true });

  return [
    '-c', `user.name=${userName}`,
    '-c', `user.email=${userEmail}`
  ]
}

function isDependabotContext(context) {
  return (context.payload.pull_request && context.payload.pull_request.user.login === 'dependabot[bot]') ||
         context.actor === 'dependabot[bot]';
}

function getCommitMessage(context) {
  let commitMessage = core.getInput('commit_message', { required: true });
  if (core.getBooleanInput('dependabot_skip', { required: false }) && isDependabotContext(context)) {
    commitMessage = `[dependabot skip] ${commitMessage}`;
  }

  return commitMessage;
}

async function getLicensedInput() {
  const command = core.getInput('command', { required: true });
  await io.which(command.split(' ')[0], true); // check that command is runnable

  const configFilePath = core.getInput('config_file', { required: true });
  await fs.promises.access(configFilePath); // check that config file exists

  const sources = [];
  const sourcesInput = core.getInput('sources', { required: false });
  if (sourcesInput) {
    sources.push(...sourcesInput.split(',').map(s => s.trim()).filter(s => s));
  }

  const format = core.getInput('format', { required: false });

  return {
    command,
    options: new CLIOptions(configFilePath, sources, format)
  };
}

async function checkStatus(command, cliOptions) {
  let log = '';
  const options = {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => log += data.toString()
    }
  };
  const exitCode = await exec.exec(command, ['status', ...cliOptions.statusOptions], options);
  return { success: exitCode === 0, log };
}

function getBranch(context) {
  // allow the user to specify a branch to run the action on
  const branch = core.getInput('branch', { required: false });
  if (branch) {
    return branch;
  }

  if (context.payload && context.payload.pull_request) {
    return context.payload.pull_request.head.ref;
  } else if (context.payload && context.payload.merge_group) {
    return context.payload.merge_group.head_ref;
  } else if (context.payload && context.payload.ref) {
    const ref = context.payload.ref;
    if (!ref.startsWith('refs/heads')) {
      throw new Error(`${ref} does not reference a branch`);
    }
    return ref.replace('refs/heads/', '');
  } else if (context.ref && context.ref.startsWith('refs/heads')) {
    return context.ref.replace('refs/heads/', '');
  }

  throw new Error(`Unable to determine a HEAD branch reference for ${context.eventName} event type`);
}

async function getCachePaths(command, cliOptions) {
  let output = '';
  const options = {
    ignoreReturnCode: true,
    listeners: {
      stdout: data => { output += data.toString() }
    },
    outStream: new stream.Writable({ write: () => {} })
  };

  const optionsWithJSONFormat = new CLIOptions(cliOptions.configFilePath, cliOptions.sources, 'json');
  const exitCode = await exec.exec(command, ['env', ...optionsWithJSONFormat.envOptions], options);
  if (exitCode === 0 && output) {
    return JSON.parse(output).apps.map(app => app.cache_path);
  }

  // if `licensed env` failed or there was no output, add updated files for the whole repo
  return ['.'];
}

async function filterCachePaths(paths) {
  const filteredPaths = await Promise.all(paths.map(path =>
    // exclude paths that don't exist
    fs.promises.access(path, fs.constants.R_OK)
               .then(() => path)
               .catch(() => null)
  ));
  return filteredPaths.filter(p=>p);
}

async function ensureBranch(branch, parent, unshallow = true) {
  const localBranch = `${ORIGIN}/${branch}`;
  const localParent = `${ORIGIN}/${parent}`;

  // always fetch the work and licenses branches
  const fetchOpts = [];
  if (unshallow && fs.existsSync('.git/shallow')) {
    fetchOpts.push('--unshallow');
  }

  let exitCode = await exec.exec('git', ['fetch', ...fetchOpts, ORIGIN, branch], { ignoreReturnCode: true });
  if (parent && branch != parent) {
    await exec.exec('git', ['fetch', ORIGIN, parent], { ignoreReturnCode: true});
  }

  // change to the target branch
  exitCode = await exec.exec('git', ['checkout', '--force', '-B', localBranch, `refs/remotes/${ORIGIN}/${branch}`], { ignoreReturnCode: true });
  if (exitCode != 0 && branch !== parent) {
    exitCode = await exec.exec('git', ['checkout', '--force', '-B', localBranch, `refs/remotes/${ORIGIN}/${parent}`], { ignoreReturnCode: true });
  }

  if (exitCode != 0) {
    throw new Error(`Unable to find or create the ${branch} branch`);
  }

  return [localBranch, localParent];
}

async function findPullRequest(octokit, options={}) {
  let query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY}`;
  for (let key in options) {
    query += ` ${key}:"${options[key]}"`
  }

  const { data } = await octokit.rest.search.issuesAndPullRequests({ q: query });
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

  const { data: pull } = await octokit.rest.pulls.update({
    ...github.context.repo,
    pull_number: pullRequest.number,
    state: 'closed'
  });

  return pull;
}

async function deleteBranch(branch) {
  // Address potential second-order command injection
  // See https://github.com/github/licensed-ci/security/code-scanning/4
  if (branch.startsWith("--")) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  const exitCode = await exec.exec('git', ['ls-remote', '--exit-code', ORIGIN, branch], { ignoreReturnCode: true });
  if (exitCode === 0) {
    await exec.exec('git', ['push', ORIGIN, '--delete', branch]);
  }
}

module.exports = {
  configureGit,
  extraHeaderConfigWithoutAuthorization,
  newOctokit,
  userConfig,
  isDependabotContext,
  getCommitMessage,
  getLicensedInput,
  getBranch,
  getCachePaths,
  filterCachePaths,
  ensureBranch,
  findPullRequest,
  closePullRequest,
  deleteBranch,
  checkStatus,
  getOrigin: () => ORIGIN
};
