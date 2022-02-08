const core = require('@actions/core');
const run = require('../lib/licensed-ci');
const sinon = require('sinon');
const utils = require('../lib/utils');
const workflows = require('../lib/workflows');

const processEnv = process.env;

describe('licensed-ci', () => {
  beforeEach(() => {
    process.env.INPUT_WORKFLOW = 'push';
    sinon.stub(core, 'setFailed');
    sinon.stub(core, 'group').callsFake((_name, fn) => fn());
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
  });

  it('raises an error a workflow is not provided', async () => {
    delete process.env.INPUT_WORKFLOW;
    await run();
    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual(['Input required and not supplied: workflow']);
  });

  it('raises an error if workflow input is not valid', async () => {
    process.env.INPUT_WORKFLOW = 'invalid';

    await run();
    expect(core.setFailed.callCount).toEqual(1);
    expect(core.setFailed.getCall(0).args).toEqual([
      'Workflow input value "invalid" must be one of: branch, push',
    ]);
  });

  it('runs a licensed ci push workflow', async () => {
    sinon.stub(utils, 'configureGit');
    sinon.stub(workflows, 'push');

    await run();
    expect(core.setFailed.callCount).toEqual(0);
    expect(utils.configureGit.callCount).toEqual(1);
    expect(workflows.push.callCount).toEqual(1);
  });

  it('runs a licensed ci branch workflow', async () => {
    process.env.INPUT_WORKFLOW = 'branch';
    sinon.stub(utils, 'configureGit');
    sinon.stub(workflows, 'branch');

    await run();
    expect(core.setFailed.callCount).toEqual(0);
    expect(utils.configureGit.callCount).toEqual(1);
    expect(workflows.branch.callCount).toEqual(1);
  });
});
