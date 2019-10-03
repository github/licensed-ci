const github = require('@actions/github');
const nock = require('nock');
const os = require('os');
const path = require('path');
const sinon = require('sinon').createSandbox();
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/push');

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

  const branch = 'branch';

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
      GITHUB_REF: `refs/heads/${branch}`,
      GITHUB_REPOSITORY: `${owner}/${repo}`,
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
    expect(utils.ensureBranch.withArgs(branch, branch).callCount).toEqual(1);
    expect(outString).toMatch(`git checkout ${branch}`);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(outString).toMatch(`${command} env`);
    expect(outString).toMatch('git add -- .');
    expect(outString).toMatch('git diff-index --quiet HEAD -- .');
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
    const createCommentEndpoint = octokit.issues.createComment.endpoint({ owner, repo, issue_number: 1 });
    const createCommentUrl = createCommentEndpoint.url.replace('https://api.github.com', '');

    beforeEach(() => {
      mockExec.mock({ command: 'git diff-index', exitCode: 1 });
    });

    it('raises an error when github_token is not given', async () => {
      delete process.env.INPUT_GITHUB_TOKEN;

      await expect(workflow.cache()).rejects.toThrow(
        'Input required and not supplied: github_token'
      );
    });

    it('pushes changes to origin', async () => {
      await workflow.cache();
      expect(utils.getCommitInput.callCount).toEqual(1);
      expect(outString).toMatch(`git remote add licensed-ci-origin https://x-access-token:${token}@github.com/${process.env.GITHUB_REPOSITORY}.git`);
      expect(outString).toMatch(`git -c user.name=${userName} -c user.email=${userEmail} commit -m ${commitMessage}`);
      expect(outString).toMatch(`git push licensed-ci-origin ${branch}`)
    });

    it('does not comment if comment input is not given', async () => {
      await workflow.cache();
      expect(outString).not.toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('does not comment if PR is not found', async () => {
      process.env.INPUT_PR_COMMENT = 'Auto updated files';

      mockGitHub.mock({ method: 'GET', uci: issuesSearchUrl, responseFixture: path.join(__dirname, '..', 'fixtures', 'emptySearchResult') });

      await workflow.cache();
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('comments if input is given and PR is open', async () => {
      process.env.INPUT_PR_COMMENT = 'Auto updated files';

      mockGitHub.mock([
        { method: 'GET', uri: issuesSearchUrl, responseFixture: path.join(__dirname, '..', 'fixtures', 'testSearchResult') },
        { method: 'POST', uri: createCommentUrl }
      ]);

      await workflow.cache();
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).toMatch(`POST ${createCommentUrl} : ${JSON.stringify({ body: process.env.INPUT_PR_COMMENT})}`);
    });
  });
});

describe('status', () => {
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '..', '.licensed.yml'));

  const branch = 'branch-licenses';
  const parent = 'branch';

  let outString;

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

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    sinon.restore();
    mockExec.restore();
  });

  it('runs licensed status', async () => {
    await workflow.status();
    expect(outString).toMatch(`${command} status -c ${configFile}`);
    expect(utils.getLicensedInput.callCount).toEqual(1);
  });

  it('gives an error message on status failures', async () => {
    mockExec.mock({ command: `${command} status`, exitCode: 1 });
    await expect(workflow.status()).rejects.toEqual(1);
  });
});
