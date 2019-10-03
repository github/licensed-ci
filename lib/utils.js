const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const io = require('@actions/io');
const stream = require('stream');

async function configureGitUser() {
  const userName = core.getInput('user_name', { required: true });
  const userEmail = core.getInput('user_email', { required: true });

  await exec.exec('git', ['config', 'user.name', userName]);
  await exec.exec('git', ['config', 'user.email', userEmail]);
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
  let exitCode = await exec.exec('git', ['checkout', branch], { ignoreReturnCode: true });
  if (exitCode != 0 && branch !== parent) {
    await exec.exec('git', ['checkout', parent]);
    exitCode = await exec.exec('git', ['checkout', '-b', branch], { ignoreReturnCode: true });
  }

  if (exitCode != 0) {
    throw new Error(`Unable to find or create the ${branch} branch`);
  }

  // ensure that branch is up to date with parent
  if (branch !== parent) {
    exitCode = await exec.exec('git', ['rebase', parent, branch], { ignoreReturnCode: true });
    if (exitCode !== 0) {
      throw new Error(`Unable to get ${branch} up to date with ${parent}`);
    }
  }
}

module.exports = {
  configureGitUser,
  getLicensedInput,
  getBranch,
  getCachePaths,
  ensureBranch
};
