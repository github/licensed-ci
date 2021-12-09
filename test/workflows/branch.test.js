const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');
const sinon = require('sinon');
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/branch');

const processEnv = process.env;

describe('branch workflow', () => {
  const token = 'token';
  const commitMessage = 'commit message';
  const command = 'licensed';
  const configFilePath = path.normalize(path.join(__dirname, '..', '..', '.licensed.yml'));
  const cachePaths = ['cache1', 'cache2'];

  const branch = 'branch';
  const licensesBranch = 'branch-licenses';
  const localBranch = `${utils.getOrigin()}/${branch}`;
  const localLicensesBranch = `${utils.getOrigin()}/${licensesBranch}`;

  const pullRequest = require(path.normalize(path.join(__dirname, '..', 'fixtures', 'pullRequest.json')));

  const owner = 'jonabc';
  const repo = 'licensed-ci';

  let octokit;
  let createCommentEndpoint;
  let requestReviewersEndpoint;
  let createPullRequestEndpoint;

  beforeEach(() => {
    process.env.INPUT_GITHUB_TOKEN = token,
    process.env.INPUT_COMMIT_MESSAGE = commitMessage,
    process.env.INPUT_CLEANUP_ON_SUCCESS = 'false',
    process.env.GITHUB_REPOSITORY = `${owner}/${repo}`,
    process.env.GITHUB_ACTOR = 'actor'

    createCommentEndpoint = sinon.stub();
    requestReviewersEndpoint = sinon.stub();
    createPullRequestEndpoint = sinon.stub();
    octokit = {
      rest: {
        issues: {
          createComment: createCommentEndpoint
        },
        pulls: {
          create: createPullRequestEndpoint,
          requestReviewers: requestReviewersEndpoint
        }
      }
    };

    // stub core methods
    sinon.stub(core, 'info');
    sinon.stub(core, 'warning');
    sinon.stub(core, 'setOutput');

    sinon.stub(utils, 'getBranch').returns(branch);
    sinon.stub(utils, 'getLicensedInput').resolves({ command, configFilePath });
    sinon.stub(utils, 'ensureBranch').resolves([localLicensesBranch, localBranch]);
    sinon.stub(utils, 'findPullRequest').resolves(null);
    sinon.stub(utils, 'getCachePaths').resolves(cachePaths);
    sinon.stub(utils, 'filterCachePaths').resolves(cachePaths);
    sinon.stub(utils, 'extraHeaderConfigWithoutAuthorization').resolves([])
    sinon.stub(github, 'getOctokit').returns(octokit);
    sinon.stub(exec, 'exec')
      .resolves(1)
      .withArgs('git', ['merge', '-s', 'recursive', '-Xtheirs', localBranch]).resolves(0)
      .withArgs(command, ['cache', '-c', configFilePath]).resolves()
      .withArgs('git', ['add', '--', ...cachePaths]).resolves()
      .withArgs('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths]).resolves(0);
    sinon.stub(utils, 'checkStatus')
      .onCall(0).resolves({ success: false })
      .onCall(1).resolves({ success: true, log: 'licenses-success' });
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
  });

  it('does not cache data if no changes are needed', async () => {
    utils.checkStatus.reset();
    utils.checkStatus.resolves({ success: true });

    await workflow();
    expect(utils.checkStatus.callCount).toEqual(1);
    expect(utils.checkStatus.getCall(0).args).toEqual([command, configFilePath]);
    expect(exec.exec.callCount).toEqual(0);
  });

  it('runs a licensed ci workflow', async () => {
    await expect(workflow()).rejects.toThrow('Cached metadata checks failed');
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getBranch.getCall(0).args).toEqual([github.context]);

    expect(utils.getLicensedInput.callCount).toEqual(1);

    expect(utils.checkStatus.callCount).toEqual(1);
    expect(utils.checkStatus.getCall(0).args).toEqual([command, configFilePath]);

    expect(utils.ensureBranch.callCount).toEqual(1);
    expect(utils.ensureBranch.getCall(0).args).toEqual([licensesBranch, branch]);

    expect(utils.findPullRequest.callCount).toEqual(1);
    expect(utils.findPullRequest.getCall(0).args).toEqual([octokit, { head: licensesBranch, base: branch }]);

    expect(exec.exec.callCount).toEqual(5);
    expect(exec.exec.getCall(0).args).toEqual([
      'git',
      ['merge', '-s', 'recursive', '-Xtheirs', localBranch],
      { ignoreReturnCode: true }
    ]);
    expect(exec.exec.getCall(1).args).toEqual([command, ['cache', '-c', configFilePath]]);

    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(utils.getCachePaths.getCall(0).args).toEqual([command, configFilePath]);

    expect(utils.filterCachePaths.callCount).toEqual(1);
    expect(utils.filterCachePaths.getCall(0).args).toEqual([cachePaths]);

    expect(exec.exec.getCall(2).args).toEqual(['git', ['add', '--', ...cachePaths]]);
    expect(exec.exec.getCall(3).args).toEqual([
      'git',
      ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths],
      { ignoreReturnCode: true }
    ]);

    expect(exec.exec.getCall(4).args).toEqual(['git', ['checkout', branch]]);

    expect(createCommentEndpoint.callCount).toEqual(0);
    expect(createPullRequestEndpoint.callCount).toEqual(0);
    expect(requestReviewersEndpoint.callCount).toEqual(0);

    // expect information set in output
    expect(core.setOutput.callCount).toEqual(3);
    expect(core.setOutput.calledWith('licenses_branch', licensesBranch)).toEqual(true);
    expect(core.setOutput.calledWith('user_branch', branch)).toEqual(true);
    expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
  });

  it('does not cache metadata on licenses branch', async () => {
    utils.getBranch.reset();
    utils.getBranch.returns(licensesBranch);

    await expect(workflow()).rejects.toThrow();

    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.findPullRequest.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toEqual(1);
    expect(utils.checkStatus.callCount).toEqual(1);

    expect(utils.ensureBranch.callCount).toEqual(0);
    expect(exec.exec.callCount).toEqual(0);

    expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
  });

  it('cleans pull request and branch if status checks succeed on parent', async () => {
    process.env.INPUT_CLEANUP_ON_SUCCESS = 'true';
    utils.checkStatus.onCall(0).resolves({ success: true });
    sinon.stub(utils, 'closePullRequest').resolves();
    sinon.stub(utils, 'deleteBranch').resolves();
    utils.findPullRequest.resolves(pullRequest);

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(1);
    expect(utils.closePullRequest.getCall(0).args).toEqual([octokit, pullRequest]);

    expect(utils.deleteBranch.callCount).toEqual(1);
    expect(utils.deleteBranch.getCall(0).args).toEqual([licensesBranch]);
  });

  it('does not cleanup if flag input is not true', async () => {
    utils.checkStatus.onCall(0).resolves({ success: true });
    sinon.stub(utils, 'closePullRequest').resolves();
    sinon.stub(utils, 'deleteBranch').resolves();

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(0);
    expect(utils.deleteBranch.callCount).toEqual(0);
  });

  it('does not clean pull request and branch if status check succeeds on licenses branch', async () => {
    utils.getBranch.reset();
    utils.getBranch.returns(licensesBranch);
    process.env.INPUT_CLEANUP_ON_SUCCESS = 'true';
    utils.checkStatus.onCall(0).resolves({ success: true });
    sinon.stub(utils, 'closePullRequest').resolves();
    sinon.stub(utils, 'deleteBranch').resolves();

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(0);
    expect(utils.deleteBranch.callCount).toEqual(0);
  });

  it('raises an error when github_token is not given', async () => {
    delete process.env.INPUT_GITHUB_TOKEN;

    await expect(workflow()).rejects.toThrow(
      'Input required and not supplied: github_token'
    );
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(exec.exec.neverCalledWith('git', ['push', utils.getOrigin(), `${localLicensesBranch}:${licensesBranch}`])).toEqual(true);
      expect(core.setOutput.calledWith('licenses_updated', 'false')).toEqual(true);
    });
  });

  describe('with cached file changes', () => {
    const licensesPullRequest = {
      ...pullRequest,
      id: pullRequest.id + 1,
      number: pullRequest.number + 1,
      html_url: pullRequest.html_url.replace(pullRequest.number, pullRequest.number + 1)
    };

    beforeEach(() => {
      exec.exec
        .withArgs('git', ['diff-index', '--quiet', 'HEAD', '--', ...cachePaths]).resolves(1)
        .withArgs('git', ['commit', '-m', commitMessage]).resolves()
        .withArgs('git', ['push', utils.getOrigin(), `${localLicensesBranch}:${licensesBranch}`]).resolves();

      utils.findPullRequest
        .withArgs(octokit, { head: licensesBranch, base: branch }).resolves(licensesPullRequest)
        .withArgs(octokit, { head: branch, "-base": branch }).resolves(pullRequest);
    });

    it('pushes changes to origin', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(exec.exec.calledWith('git', ['commit', '-m', commitMessage])).toEqual(true);
      expect(exec.exec.calledWith('git', ['push', utils.getOrigin(), `${localLicensesBranch}:${licensesBranch}`])).toEqual(true);
      expect(core.setOutput.calledWith('licenses_updated', 'true')).toEqual(true);
    });

    it("opens a PR for changes if one doesn't exist", async () => {
      utils.findPullRequest.withArgs(octokit, { head: licensesBranch, base: branch }).resolves(null);
      createPullRequestEndpoint.resolves({ data: licensesPullRequest });

      await expect(workflow()).rejects.toThrow();
      expect(utils.findPullRequest.calledWith(octokit, { head: licensesBranch, base: branch })).toEqual(true);
      expect(createPullRequestEndpoint.callCount).toEqual(1);
      expect(createPullRequestEndpoint.getCall(0).args).toEqual([{
        owner,
        repo,
        title: `License updates for ${branch}`,
        head: licensesBranch,
        base: branch,
        body: expect.stringMatching(branch)
      }]);

      expect(requestReviewersEndpoint.callCount).toEqual(1);
      expect(requestReviewersEndpoint.getCall(0).args).toEqual([{
        owner,
        repo,
        pull_number: licensesPullRequest.number,
        reviewers: [process.env.GITHUB_ACTOR]
      }]);

      // expect pr information set in output
      expect(core.setOutput.calledWith('pr_url', licensesPullRequest.html_url)).toEqual(true);
      expect(core.setOutput.calledWith('pr_number', licensesPullRequest.number)).toEqual(true);
      expect(core.setOutput.calledWith('pr_created', 'true')).toEqual(true);
    });

    it('handles failures when requesting the actor as a PR reviewer', async () => {
      utils.findPullRequest.withArgs(octokit, { head: licensesBranch, base: branch }).resolves(null);
      createPullRequestEndpoint.resolves({ data: licensesPullRequest });
      requestReviewersEndpoint.rejects(new Error('request reviewer failed'))

      await expect(workflow()).rejects.toThrow();

      // expect pr information set in output
      expect(core.warning.callCount).toEqual(1)
      expect(core.warning.calledWith('request reviewer failed')).toEqual(true);

      // validate that action completed by checking PR information in output
      expect(core.setOutput.calledWith('pr_url', licensesPullRequest.html_url)).toEqual(true);
      expect(core.setOutput.calledWith('pr_number', licensesPullRequest.number)).toEqual(true);
      expect(core.setOutput.calledWith('pr_created', 'true')).toEqual(true);
    });

    it('does not open a PR for changes if it exists', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(createPullRequestEndpoint.callCount).toEqual(0);
      expect(requestReviewersEndpoint.callCount).toEqual(0);

      // expect pr information set in output
      expect(core.setOutput.calledWith('pr_url', licensesPullRequest.html_url)).toEqual(true);
      expect(core.setOutput.calledWith('pr_number', licensesPullRequest.number)).toEqual(true);
      expect(core.setOutput.calledWith('pr_created', 'false')).toEqual(true);
    });

    it('links the created PR to the parent branch', async () => {
      utils.findPullRequest.withArgs(octokit, { head: licensesBranch, base: branch }).resolves(null);
      createPullRequestEndpoint.resolves({ data: licensesPullRequest });

      await expect(workflow()).rejects.toThrow();
      let prBody = createPullRequestEndpoint.getCall(0).args[0].body;
      expect(prBody).toMatch(`[branch](https://github.com/${owner}/${repo}/tree/${branch}`);
    });

    it('links the created PR to the parent PR if it exists', async () => {
      utils.findPullRequest.withArgs(octokit, { head: licensesBranch, base: branch }).resolves(null);
      createPullRequestEndpoint.resolves({ data: licensesPullRequest });

      await expect(workflow()).rejects.toThrow();
      let prBody = createPullRequestEndpoint.getCall(0).args[0].body;
      expect(prBody).toMatch(`[PR](${pullRequest.html_url})`);
    });

    it('adds a comment to the parent PR if it exists', async () => {
      await expect(workflow()).rejects.toThrow();
      const createCommentArgs = createCommentEndpoint.args.find(args =>
        args[0].issue_number == pullRequest.number
      );

      expect(createCommentArgs).toBeDefined();
      expect(createCommentArgs[0].body).toMatch('The `licensed-ci` GitHub Action has updated');
      expect(createCommentArgs[0].body).toMatch(licensesPullRequest.html_url);
      expect(createCommentArgs[0].owner).toEqual(owner);
      expect(createCommentArgs[0].repo).toEqual(repo);
    });

    it('does not add a comment to the parent PR if it does not exist', async () => {
      utils.findPullRequest.withArgs(octokit, { head: branch, "-base": branch }).resolves(null);

      await expect(workflow()).rejects.toThrow();
      expect(createCommentEndpoint.calledWith({ owner, repo, issue_number: pullRequest.number })).toEqual(false);
    });

    it('adds a status comment to the licenses PR', async () => {
      await expect(workflow()).rejects.toThrow();
      const createCommentArgs = createCommentEndpoint.args.find(args =>
        args[0].issue_number == licensesPullRequest.number
      );

      expect(createCommentArgs).toBeDefined();
      expect(createCommentArgs[0].body).toMatch('`licensed status` result');
      expect(createCommentArgs[0].body).toMatch('succeeded');
      expect(createCommentArgs[0].body).toMatch('licenses-success');
      expect(createCommentArgs[0].owner).toEqual(owner);
      expect(createCommentArgs[0].repo).toEqual(repo);
    });
  });
});
