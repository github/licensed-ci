const github = require('@actions/github');
const { mocks } = require('@jonabc/actions-mocks');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/branch');

const octokit = new github.GitHub('token');

describe('branch workflow', () => {
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
  const processEnv = process.env;

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
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.github.setLog(log => outString += log + os.EOL);

    sinon.stub(console, 'log').callsFake(log => outString += log + os.EOL);
    sinon.stub(process.stdout, 'write').callsFake(log => outString += log);

    mocks.exec.mock([
      { command: 'licensed env', exitCode: 1 },
      { command: 'licensed status', exitCode: 1 },
      { command: '', exitCode: 0 }
    ]);

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
    mocks.exec.restore();
  });

  it('does not cache data if no changes are needed', async () => {
    mocks.exec.mock({ command: 'licensed status', exitCode: 0 })
    await workflow();
    expect(outString).toMatch(`${command} status -c ${configFile}`);
    expect(outString).not.toMatch(`${command} cache -c ${configFile}`);
  });

  it('runs a licensed ci workflow', async () => {
    await expect(workflow()).rejects.toThrow('Cached metadata checks failed');
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toBeGreaterThan(1);
    expect(utils.ensureBranch.withArgs(branch, parent).callCount).toEqual(1);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(outString).toMatch(`${command} env`);
    expect(outString).toMatch('git add -- .');
    expect(outString).toMatch('git diff-index --quiet HEAD -- .');
    expect(outString).toMatch(`git checkout ${parent}`);
  });

  it('does not cache metadata on licenses branch', async () => {
    process.env.GITHUB_REF = `refs/heads/${branch}`;
    await expect(workflow()).rejects.toThrow();
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toEqual(1);
    expect(utils.ensureBranch.callCount).toEqual(0);
    expect(outString).not.toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(0);
    expect(outString).not.toMatch(`${command} env`);
    expect(outString).not.toMatch('git add -- .');
    expect(outString).not.toMatch('git diff-index --quiet HEAD -- .');
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(outString).not.toMatch(`git push licensed-ci-origin ${branch}`)
    });
  });

  describe('with cached file changes', () => {
    const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
    const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
    const createPREndpoint = octokit.pulls.create.endpoint({ owner, repo });
    const createPRUrl = createPREndpoint.url.replace('https://api.github.com', '');
    const createReviewRequestEndpoint = octokit.pulls.createReviewRequest.endpoint({ owner, repo, pull_number: 1347 /* from fixture */ });
    const createReviewRequestUrl = createReviewRequestEndpoint.url.replace('https://api.github.com', '');

    beforeEach(() => {
      mocks.exec.mock({ command: 'git diff-index', exitCode: 1 });
      mocks.github.mock({
        method: 'GET',
        uri: issuesSearchUrl,
        response: require(path.join(__dirname, '..', 'fixtures', 'testSearchResult'))
      });
    });

    it('raises an error when github_token is not given', async () => {
      delete process.env.INPUT_GITHUB_TOKEN;

      await expect(workflow()).rejects.toThrow(
        'Input required and not supplied: github_token'
      );
    });

    it('pushes changes to origin', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(outString).toMatch(`git commit -m ${commitMessage}`);
      expect(outString).toMatch(`git push licensed-ci-origin ${branch}`)
    });

    it('opens a PR for changes', async () => {
      process.env.INPUT_PR_COMMENT = 'pr_comment';
      mocks.exec.mock([
        { command: 'licensed status', exitCode: 1, count: 1 },
        { command: 'licensed status', exitCode: 0, stdout: 'licenses-success' }
      ]);
      mocks.github.mock([
        { method: 'GET', uri: issuesSearchUrl, response: require(path.join(__dirname, '..', 'fixtures', 'emptySearchResult')) },
        { method: 'POST', uri: createPRUrl, response: require(path.join(__dirname, '..', 'fixtures', 'pullRequest')) },
        { method: 'POST', url: createReviewRequestUrl }
      ]);

      await expect(workflow()).rejects.toThrow();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:${branch} base:${parent}`
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);

      let match = outString.match(`POST ${createPRUrl} : (.+)`);
      expect(match).toBeTruthy();
      let body = JSON.parse(match[1]);
      expect(body.head).toEqual(branch);
      expect(body.base).toEqual(parent);

      // minimal expectations about PR body template substitutions
      expect(body.body).toMatch(parent);
      expect(body.body).toMatch(process.env.INPUT_PR_COMMENT);
      expect(body.body).toMatch('succeeded');
      expect(body.body).toMatch('licenses-success');

      match = outString.match(`POST ${createReviewRequestUrl} : (.+)`);
      expect(match).toBeTruthy();
      body = JSON.parse(match[1]);
      expect(body.reviewers).toEqual([process.env.GITHUB_ACTOR]);
    });

    it('does not open a PR for changes if it exists', async () => {
      mocks.github.mock(
        { method: 'GET', uri: issuesSearchUrl, response: require(path.join(__dirname, '..', 'fixtures', 'testSearchResult')) },
      );

      await expect(workflow()).rejects.toThrow();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:${branch} base:${parent}`
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);
      expect(outString).not.toMatch(`POST ${createPRUrl}`);
    });
  });
});
