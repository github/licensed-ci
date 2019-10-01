const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs').promises;
const path = require('path');
const utils = require('./utils');

let workflows;

async function loadWorkflows() {
  if (!workflows) {
    workflows = {};

    const workflowFiles = await fs.readdir(path.join(__dirname, 'workflows'));
    for (let workflowFile of workflowFiles) {
      const workflowPath = path.join(__dirname, 'workflows', workflowFile);
      const key = path.basename(workflowFile, path.extname(workflowFile));
      workflows[key] = require(workflowPath);
    }
  }

  return workflows;
}

async function run() {
  try {
    const workflowInput = core.getInput('workflow', { required: true });
    const availableWorkflows = await loadWorkflows();
    const workflow = availableWorkflows[workflowInput];
    if (!workflow) {
      throw new Error(`Workflow input value "${workflowInput}" must be one of: ${Object.keys(availableWorkflows).join(', ')}`);
    }

    await workflow();

    // check the status of current cached data
    const { command, configFilePath } = await utils.getLicensedInput();
    await exec.exec(command, ['status', '-c', configFilePath]);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

run()
