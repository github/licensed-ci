const core = require('@actions/core');
const utils = require('./utils');
const workflows = require('./workflows');

async function run() {
  try {
    const workflowInput = core.getInput('workflow', { required: true });
    const workflow = workflows[workflowInput];
    if (!workflow) {
      throw new Error(`Workflow input value "${workflowInput}" must be one of: ${Object.keys(workflows).join(', ')}`);
    }

    await utils.configureGit();
    await workflow();
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
