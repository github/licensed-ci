const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const io = require('@actions/io');

async function run() {
  try {
    const token = core.getInput('github_token', { required: true });
    const commitMessage = core.getInput('commit_message', { required: true });
    const userName = core.getInput('user_name', { required: true });
    const userEmail = core.getInput('user_email', { required: true });

    const command = core.getInput('command', { required: true });
    await io.which(command.split(' ')[0], true); // check that command is runnable

    const configFilePath = core.getInput('config_file', { required: true });
    await fs.access(configFilePath); // check that config file exists

    let branch = process.env.GITHUB_REF;
    if (!branch.startsWith('refs/heads')) {
      throw new Error(`${branch} does not reference a branch`);
    }
    branch = branch.replace('refs/heads/', '');

    await exec.exec('git', ['checkout', branch]);
    await exec.exec(command, ['cache', '-c', configFilePath]);
    await exec.exec('git', ['add', '.']);

    const exitCode = await exec.exec('git', ['diff-index', '--quiet', 'HEAD'], { ignoreReturnCode: true });
    if (exitCode > 0) {
      await exec.exec('git', ['remote', 'add', 'licensed-ci-origin', `https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`]);
      await exec.exec('git', ['-c', `user.name=${userName}`, '-c', `user.email=${userEmail}`, 'commit', '-m', commitMessage]);
      await exec.exec('git', ['push', 'licensed-ci-origin', branch]);
    }

    await exec.exec(command, ['status', '-c', configFilePath]);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
