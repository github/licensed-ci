const github = require('@actions/github');
const nock = require('nock');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/branch');

const mockExec = require('../mocks/@actions/exec');
const mockGitHub = require('../mocks/@actions/github');

const octokit = new github.GitHub('token');

describe('cache', () => {
  const token = 'token';
  const userName = 'user';
  const userEmail = 'user@example.com';
  const commitMessage = 'commit message';
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '..', '.licensed.yml'));

  const branch = 'branch-licenses';
  const parent = 'branch';

  // to match the response from the testSearchResult.json fixture
  const owner = 'jonabc';
  const repo = 'repo';

  let outString;
  let consoleLog;

  beforeEach(() => {
    process.env = {
      ...process.env,
      INPUT_GITHUB_TOKEN: token,
      INPUT_COMMIT_MESSAGE: commitMessage,
      INPUT_USER_NAME: userName,
      INPUT_USER_EMAIL: userEmail,
      INPUT_COMMAND: command,
      INPUT_CONFIG_FILE: configFile,
      GITHUB_REF: `refs/heads/${parent}`,
      GITHUB_REPOSITORY: `${owner}/${repo}`,
      GITHUB_ACTOR: 'actor'
    };

    outString = '';
    mockExec.setLog(log => outString += log + os.EOL);
    mockGitHub.setLog(log => outString += log + os.EOL);
    consoleLog = console.log;
    console.log = log => outString += log + os.EOL;

    mockExec.mock([
      { command: 'licensed env', exitCode: 1 },
      { command: '', exitCode: 0 }
    ]);

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    sinon.restore();
    mockExec.restore();
    console.log = consoleLog;
  });

  it('runs a licensed ci workflow', async () => {
    await workflow.cache();
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toEqual(1);
    expect(utils.ensureBranch.withArgs(branch, parent).callCount).toEqual(1);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(outString).toMatch(`${command} env`);
    expect(outString).toMatch('git add -- .');
    expect(outString).toMatch('git diff-index --quiet HEAD -- .');
    expect(outString).toMatch(`git checkout ${parent}`);
  });

  it('does not run full ci workflow on licenses branch', async () => {
    process.env.GITHUB_REF = `refs/heads/${branch}`;
    await workflow.cache();
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toEqual(0);
    expect(utils.ensureBranch.callCount).toEqual(0);
    expect(outString).not.toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(0);
    expect(outString).not.toMatch(`${command} env`);
    expect(outString).not.toMatch('git add -- .');
    expect(outString).not.toMatch('git diff-index --quiet HEAD -- .');
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await workflow.cache();
      expect(outString).not.toMatch(`git push licensed-ci-origin ${branch}`)
    });
  });

  describe('with cached file changes', () => {
    const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
    const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
    const createPREndpoint = octokit.pulls.create.endpoint({ owner, repo });
    const createPRUrl = createPREndpoint.url.replace('https://api.github.com', '');

    beforeEach(() => {
      mockExec.mock({ command: 'git diff-index', exitCode: 1 });
      mockGitHub.mock({
        method: 'GET',
        uri: issuesSearchUrl,
        responseFixture: path.join(__dirname, '..', 'fixtures', 'testSearchResult')
      });
    });

    it('raises an error when github_token is not given', async () => {
      delete process.env.INPUT_GITHUB_TOKEN;

      await expect(workflow.cache()).rejects.toThrow(
        'Input required and not supplied: github_token'
      );
    });

    it('pushes changes to origin', async () => {
      await workflow.cache();
      expect(outString).toMatch(`git remote add licensed-ci-origin https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`);
      expect(outString).toMatch(`git commit -m ${commitMessage}`);
      expect(outString).toMatch(`git push licensed-ci-origin ${branch}`)
    });

    it('opens a PR for changes', async () => {
      mockGitHub.mock([
        { method: 'GET', uri: issuesSearchUrl, responseFixture: path.join(__dirname, '..', 'fixtures', 'emptySearchResult') },
        { method: 'POST', uri: createPRUrl }
      ]);

      await workflow.cache();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:${branch} base:${parent}`
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);

      const match = outString.match(`POST ${createPRUrl} : (.+)`);
      expect(match).toBeTruthy();
      const body = JSON.parse(match[1]);
      expect(body.head).toEqual(branch);
      expect(body.base).toEqual(parent);
      expect(body.body).toMatch(`/cc @${process.env.GITHUB_ACTOR}`);
    });

    it('does not open a PR for changes if it exists', async () => {
      mockGitHub.mock(
        { method: 'GET', uri: issuesSearchUrl, responseFixture: path.join(__dirname, '..', 'fixtures', 'testSearchResult') },
      );

      await workflow.cache();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:${branch} base:${parent}`
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);
      expect(outString).not.toMatch(`POST ${createPRUrl}`);
    });
  });
});

describe('status', () => {
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '..', '.licensed.yml'));

  const branch = 'branch-licenses';
  const parent = 'branch';

  let outString;
  let consoleLog;

  beforeEach(() => {
    process.env = {
      ...process.env,
      INPUT_COMMAND: command,
      INPUT_CONFIG_FILE: configFile,
      GITHUB_REF: `refs/heads/${parent}`,
    };

    outString = '';
    mockExec.setLog(log => outString += log + os.EOL);
    mockExec.mock([
      { command: '', exitCode: 0 }
    ]);

    consoleLog = console.log;
    console.log = log => outString += log + os.EOL;

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    sinon.restore();
    mockExec.restore();
    console.log = consoleLog;
  });

  it('runs licensed status', async () => {
    await workflow.status();
    expect(outString).toMatch(`${command} status -c ${configFile}`);
    expect(utils.getLicensedInput.callCount).toEqual(1);
    expect(utils.getBranch.callCount).toEqual(1);
  });

  it('gives an error message on status failures on licenses branch', async () => {
    mockExec.mock({ command: 'licensed status', exitCode: 1 });
    await expect(workflow.status()).rejects.toThrow(
      'License updates failed status checks.  Please review the updated metadata to continue'
    );
  });

  it('gives an error message on status failures only on parent branch', async () => {
    mockExec.mock([
      { command: 'licensed status', exitCode: 1, persist: false },
      { command: 'licensed status', exitCode: 0 }
    ]);
    await expect(workflow.status()).rejects.toThrow(
      `Please merge license updates from ${branch}`
    );
  });
});
