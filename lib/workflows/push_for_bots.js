const core = require('@actions/core');
const exec = require('@actions/exec');
const { Context } = require('@actions/github/lib/context');
const utils = require('../utils');
const branch = require('./branch');
const push = require('./push');

async function hasLicensesBranch(context) {
  const branch = utils.getBranch(context);
  if (branch.endsWith('-licenses')) {
    return true;
  }

  // check that the license branch exists
  const exitCode = await exec.exec('git', 
    ['ls-remote', '--exit-code', '.', `${utils.getOrigin()}/${branch}-licenses`], 
    { ignoreReturnCode: true});
  return exitCode === 0;
}

function isBotSender(context) {
  return context.payload.sender && context.payload.sender.type === 'Bot';
}

async function run() {
  const context = new Context();

  // run the branch workflow when
  // 1. the branch workflow has already run and there is a separate licenese branch
  // 2. the action was triggered from a "User" typed user
  if ((await hasLicensesBranch(context))) {
    core.info('Detected licenses branch, choosing branch workflow');
    await branch.run();
  } else if (!isBotSender(context)) {
    core.info('Detected user context, choosing branch workflow');
    await branch.run();
  } else {
    core.info('Detected no licenses branch and Bot context, choosing push workflow');
    await push.run();
  }
}

module.exports = { run };
