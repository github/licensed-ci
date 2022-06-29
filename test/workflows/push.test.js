const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');
const sinon = require('sinon');
const utils = require('../../lib/utils');
const { CLIOptions } = require('../../lib/cli-options');
const { run: workflow } = require('../../lib/workflows/push');

const processEnv = process.env;

describe('push workflow', () => {
  const token = 'token';
  const commitMessage = 'commit message';
  const command = 'licensed';
  const configFilePath = path.normalize(path.join(__dirname, '..', '..', '.licensed.yml'));
  const cliOptions = new CLIOptions(configFilePath, ['npm'], 'json');
  const cachePaths = ['cache1', 'cache2'];

  const branch = 'branch';
  const localBranch = `${utils.getOrigin()}/${branch}`;

  // to match the response from the testSearchResult.json fixture
  const owner = 'jonabc';
  const repo = 'setup-licensed';
  const userConfig = ['-c', 'config=value'];

  let octokit;
  let createCommentEndpoint;

  beforeEach(() => {
    process.env.INPUT_CONFIG_FILE = configFilePath;
    process.env.INPUT_GITHUB_TOKEN = token;
    process.env.GITHUB_REPOSITORY = `${owner}/${repo}`;

    createCommentEndpoint = sinon.stub();
    octokit = {
      rest: {
        issues: {
          createComment: createCommentEndpoint
        }
      }
    };

    // stub core methods
    sinon.stub(core, 'info');
    sinon.stub(core, 'warning');
    sinon.stub(core, 'setOutput');
    sinon.stub(core, 'group').callsFake((_name, fn) => fn());

    sinon.stub(utils, 'userConfig').returns(userConfig);
    sinon.stub(utils, 'getBranch').returns('branch');
    sinon.stub(utils, 'getLicensedInput').resolves({ command, options: cliOptions });
    sinon.stub(utils, 'ensureBranch').resolves([localBranch, localBranch]);
    sinon.stub(utils, 'findPullRequest').resolves(null);
    sinon.stub(utils, 'getCachePaths').resolves(cachePaths);
    sinon.stub(utils, 'filterCachePaths').resolves(cachePaths);
    sinon.stub(utils, 'extraHeaderConfigWithoutAuthorization').resolves([]);
    sinon.stub(utils, 'getCommitMessage').returns(commitMessage);
    sinon.stub(github, 'getOctokit').returns(octokit);
    sinon.stub(exec, 'exec')
      .rejects()
      .withArgs(command, ['cache', ...cliOptions.cacheOptions]).resolves()
      .withArgs('git', ['add', '--', ...cachePaths]).resolves()
      .withArgs('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths]).resolves(0);
    sinon.stub(utils, 'checkStatus')
      .onCall(0).resolves({ success: false })
      .onCall(1).resolves({ success: true });
  });

  afterEach(() => {
    sinon.restore();
    process.env = processEnv;
  });

  it('does not cache data if no changes are needed', async () => {
    utils.checkStatus.reset();
    utils.checkStatus.resolves({ success: true });

    await workflow();
    expect(utils.checkStatus.callCount).toEqual(1);
    expect(utils.checkStatus.getCall(0).args).toEqual([command, cliOptions]);
    expect(exec.exec.callCount).toEqual(0);
  });

  it('raises an error if github_token is not set', async () => {
    delete process.env.INPUT_GITHUB_TOKEN;
    await expect(workflow()).rejects.toThrow(
      'Input required and not supplied: github_token'
    );
  })

  it('runs a licensed ci workflow', async () => {
    await workflow();
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getBranch.getCall(0).args).toEqual([github.context]);

    expect(utils.getLicensedInput.callCount).toEqual(1);

    expect(utils.checkStatus.callCount).toEqual(2);
    expect(utils.checkStatus.getCall(0).args).toEqual([command, cliOptions]);
    expect(utils.checkStatus.getCall(1).args).toEqual([command, cliOptions]);

    expect(utils.ensureBranch.callCount).toEqual(1);
    expect(utils.ensureBranch.getCall(0).args).toEqual([branch, branch]);

    expect(utils.findPullRequest.callCount).toEqual(1);
    expect(utils.findPullRequest.getCall(0).args).toEqual([octokit, { head: branch }]);

    expect(exec.exec.callCount).toEqual(3);
    expect(exec.exec.getCall(0).args).toEqual([command, ['cache', ...cliOptions.cacheOptions]]);

    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(utils.getCachePaths.getCall(0).args).toEqual([command, cliOptions]);

    expect(utils.filterCachePaths.callCount).toEqual(1);
    expect(utils.filterCachePaths.getCall(0).args).toEqual([cachePaths]);

    expect(exec.exec.getCall(1).args).toEqual(['git', ['add', '--', ...cachePaths]]);
    expect(exec.exec.getCall(2).args).toEqual(
      expect.arrayContaining(
        ['git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths]]
      )
    );

    expect(createCommentEndpoint.callCount).toEqual(0);

    // expect information set in output
    expect(core.setOutput.callCount).toEqual(3);
    expect(core.setOutput.calledWith('licenses_branch', branch)).toEqual(true);
    expect(core.setOutput.calledWith('user_branch', branch)).toEqual(true);
    expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
  });

  it('fails if status checks fail after caching data', async () => {
    utils.checkStatus.reset();
    utils.checkStatus.resolves({ success: false });

    await expect(workflow()).rejects.toThrow('Cached metadata checks failed');

    // expect information set in output
    expect(core.setOutput.callCount).toEqual(3);
    expect(core.setOutput.calledWith('licenses_branch', branch)).toEqual(true);
    expect(core.setOutput.calledWith('user_branch', branch)).toEqual(true);
    expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await workflow();
      expect(exec.exec.neverCalledWith('git', ['push', utils.getOrigin(), `${localBranch}:${branch}`])).toEqual(true);
      expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
    });
  });

  describe('with cached file changes', () => {
    const pullRequest = require(path.join(__dirname, '..', 'fixtures', 'pullRequest.json'));
    const comment = 'Auto updated files';

    beforeEach(() => {
      process.env.INPUT_PR_COMMENT = comment;

      exec.exec
        .withArgs('licensed').resolves(0)
        .withArgs('git').resolves(0)
        .withArgs('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths]).resolves(1);
    });

    it('raises an error when github_token is not given', async () => {
      delete process.env.INPUT_GITHUB_TOKEN;

      await expect(workflow()).rejects.toThrow(
        'Input required and not supplied: github_token'
      );
    });

    it('pushes changes to origin', async () => {
      await workflow();
      expect(exec.exec.calledWith('git', [...userConfig, 'commit', '-m', commitMessage])).toEqual(true);
      expect(exec.exec.calledWith('git', ['push', utils.getOrigin(), `${localBranch}:${branch}`])).toEqual(true);
      expect(core.setOutput.calledWith('licenses_updated', 'true')).toEqual(true);
    });

    it('does not comment if PR is not found', async () => {
      await workflow();
      expect(createCommentEndpoint.callCount).toEqual(0);
    });

    it('does not comment if comment input is not given', async () => {
      delete process.env.INPUT_PR_COMMENT;
      utils.findPullRequest.resolves(pullRequest);

      await workflow();
      expect(createCommentEndpoint.callCount).toEqual(0);
    });

    it('comments if input is given and PR is open', async () => {
      utils.findPullRequest.resolves(pullRequest);

      await workflow();
      expect(createCommentEndpoint.callCount).toEqual(1);
      expect(createCommentEndpoint.getCall(0).args).toEqual([{
        owner,
        repo,
        issue_number: pullRequest.number,
        body: comment
      }]);
    });

    it('sets pr details in step output', async () => {
      utils.findPullRequest.resolves(pullRequest);
      await workflow();
      expect(core.setOutput.calledWith('pr_url', pullRequest.html_url)).toEqual(true);
      expect(core.setOutput.calledWith('pr_number', pullRequest.number)).toEqual(true);
    });
  });
});
