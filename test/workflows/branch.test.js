const github = require('@actions/github');
const { mocks } = require('@jonabc/actions-mocks');
const os = require('os');
const path = require('path');
const sinon = require('sinon');
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/branch');

const octokit = github.getOctokit('token');

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
  const repo = 'setup-licensed';

  let outString;
  const processEnv = process.env;

  const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
  const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
  const searchResultFixture = require(path.join(__dirname, '..', 'fixtures', 'testSearchResult'));

  const pullRequest = searchResultFixture.items[0];
  const closedPullRequest = { ...pullRequest, state: 'closed' };
  const updatePullsEndpoint = octokit.pulls.update.endpoint({ owner, repo, pull_number: pullRequest.number });
  const updatePullsUrl = updatePullsEndpoint.url.replace('https://api.github.com', '');

  const contextPayload = github.context.payload;

  beforeEach(() => {
    process.env = {
      ...process.env,
      INPUT_GITHUB_TOKEN: token,
      INPUT_COMMIT_MESSAGE: commitMessage,
      INPUT_USER_NAME: userName,
      INPUT_USER_EMAIL: userEmail,
      INPUT_COMMAND: command,
      INPUT_CONFIG_FILE: configFile,
      INPUT_CLEANUP_ON_SUCCESS: 'false',
      GITHUB_REPOSITORY: `${owner}/${repo}`,
      GITHUB_ACTOR: 'actor'
    };

    outString = '';
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.github.setLog(log => outString += log + os.EOL);

    sinon.stub(process.stdout, 'write').callsFake(log => outString += log);
    github.context.payload = { ref: `refs/heads/${parent}` };

    mocks.exec.mock([
      { command: 'licensed env', exitCode: 1 },
      { command: 'licensed status', exitCode: 1 },
      { command: '', exitCode: 0 }
    ]);

    mocks.github.mock([
      { method: 'GET', uri: issuesSearchUrl, response: searchResultFixture },
      { method: 'PATCH', uri: updatePullsUrl, response: closedPullRequest }
    ]);

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
    mocks.exec.restore();
    mocks.github.restore();

    github.context.payload = contextPayload;
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
    expect(outString).toMatch(`git merge -s recursive -Xtheirs origin/${parent}`);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(outString).toMatch(`${command} env`);
    expect(outString).toMatch('git add -- .');
    expect(outString).toMatch('git diff-index --quiet HEAD -- .');
    expect(outString).toMatch(`git checkout ${parent}`);

    // expect branch information set in output
    expect(outString).toMatch(new RegExp(`set-output.*user_branch.*${parent}`));
    expect(outString).toMatch(new RegExp(`set-output.*licenses_branch.*${branch}`));
  });

  it('does not cache metadata on licenses branch', async () => {
    github.context.payload.ref = `refs/heads/${branch}`;
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

  it('cleans pull request and branch if status checks succeed on parent', async () => {
    process.env.INPUT_CLEANUP_ON_SUCCESS = 'true';
    mocks.exec.mock([
      { command: 'licensed status', exitCode: 0 },
      { command: 'git ls-remote', exitCode: 0 },
      { command: 'git push', exitCode: 0 }
    ]);

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(1);
    expect(outString).toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
    expect(utils.deleteBranch.callCount).toEqual(1);
    expect(outString).toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });

  it('does not cleanup if flag input is not true', async () => {
    mocks.exec.mock({ command: 'licensed status', exitCode: 0 });

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(0);
    expect(outString).not.toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
    expect(utils.deleteBranch.callCount).toEqual(0);
    expect(outString).not.toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).not.toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });

  it('does not clean pull request and branch if status check succeeds on licenses branch', async () => {
    github.context.payload.ref = `refs/heads/${branch}`;
    process.env.INPUT_CLEANUP_ON_SUCCESS = 'true';
    mocks.exec.mock({ command: 'licensed status', exitCode: 0 });

    await workflow();

    expect(utils.closePullRequest.callCount).toEqual(0);
    expect(outString).not.toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
    expect(utils.deleteBranch.callCount).toEqual(0);
    expect(outString).not.toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).not.toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await expect(workflow()).rejects.toThrow();
      expect(outString).not.toMatch(`git push ${utils.getOrigin()} ${branch}`);
      expect(outString).toMatch(new RegExp(`set-output.*licenses_updated.*false`));
    });
  });

  describe('with cached file changes', () => {
    const licensesPullRequest = require(path.join(__dirname, '..', 'fixtures', 'pullRequest'));

    const createPREndpoint = octokit.pulls.create.endpoint({ owner, repo });
    const createPRUrl = createPREndpoint.url.replace('https://api.github.com', '');
    const createReviewRequestEndpoint = octokit.pulls.requestReviewers.endpoint({ owner, repo, pull_number: licensesPullRequest.number });
    const createReviewRequestUrl = createReviewRequestEndpoint.url.replace('https://api.github.com', '');

    const createLicensesPRCommentEndpoint = octokit.issues.createComment.endpoint({ owner, repo, issue_number: licensesPullRequest.number });
    const createLicensesPRCommentUrl = createLicensesPRCommentEndpoint.url.replace('https://api.github.com', '');

    const createUserPRCommentEndpoint = octokit.issues.createComment.endpoint({ owner, repo, issue_number: pullRequest.number });
    const createUserPRCommentUrl = createUserPRCommentEndpoint.url.replace('https://api.github.com', '');

    const emptySearchResult = require(path.join(__dirname, '..', 'fixtures', 'emptySearchResult'));

    beforeEach(() => {
      mocks.exec.mock([
        { command: 'licensed status', exitCode: 1, count: 1 },
        { command: 'licensed status', exitCode: 0, stdout: 'licenses-success' },
        { command: 'git diff-index', exitCode: 1 }
      ]);
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${branch}%22`, response: { items: [licensesPullRequest] } },
        { method: 'POST', uri: createLicensesPRCommentUrl },
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${parent}%22`, response: emptySearchResult },
        { method: 'POST', uri: createUserPRCommentUrl }
      ]);
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
      expect(outString).toMatch(`git push ${utils.getOrigin()} ${branch}`);
      expect(outString).toMatch(new RegExp(`set-output.*licenses_updated.*true`));
    });

    it('opens a PR for changes', async () => {
      process.env.INPUT_PR_COMMENT = 'pr_comment';
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${branch}%22`, response: emptySearchResult },
        { method: 'POST', uri: createPRUrl, response: licensesPullRequest },
        { method: 'POST', url: createReviewRequestUrl }
      ]);

      await expect(workflow()).rejects.toThrow();
      let query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${branch}" base:"${parent}"`;
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);

      let match = outString.match(`POST ${createPRUrl} : (.+)`);
      expect(match).toBeTruthy();
      let body = JSON.parse(match[1]);
      expect(body.head).toEqual(branch);
      expect(body.base).toEqual(parent);
      // minimal expectations about PR body template substitutions
      expect(body.body).toMatch(parent);

      match = outString.match(`POST ${createReviewRequestUrl} : (.+)`);
      expect(match).toBeTruthy();
      body = JSON.parse(match[1]);
      expect(body.reviewers).toEqual([process.env.GITHUB_ACTOR]);

      // expect pr information set in output
      expect(outString).toMatch(new RegExp(`set-output.*pr_url.*${licensesPullRequest.html_url}`));
      expect(outString).toMatch(new RegExp(`set-output.*pr_number.*${licensesPullRequest.number}`));
      expect(outString).toMatch(new RegExp('set-output.*pr_created.*true'));
    });

    it('does not open a PR for changes if it exists', async () => {
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${branch}%22`, response: { items: [licensesPullRequest] } }
      ]);

      await expect(workflow()).rejects.toThrow();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${branch}" base:"${parent}"`
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);
      expect(outString).not.toMatch(`POST ${createPRUrl}`);

      // expect pr information set in output
      expect(outString).toMatch(new RegExp(`set-output.*pr_url.*${licensesPullRequest.html_url}`));
      expect(outString).toMatch(new RegExp(`set-output.*pr_number.*${licensesPullRequest.number}`));
      expect(outString).toMatch(new RegExp('set-output.*pr_created.*false'));
    });

    it('links the created PR to the parent branch', async () => {
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${branch}%22`, response: emptySearchResult },
        { method: 'POST', uri: createPRUrl, response: licensesPullRequest },
        { method: 'POST', url: createReviewRequestUrl }
      ]);

      await expect(workflow()).rejects.toThrow();

      let match = outString.match(`POST ${createPRUrl} : (.+)`);
      expect(match).toBeTruthy();
      let body = JSON.parse(match[1]);
      expect(body.body).toMatch(`[branch](https://github.com/${owner}/${repo}/tree/${parent})`);
    });

    it('links the created PR to the parent PR if it exists', async () => {
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${branch}%22`, response: emptySearchResult },
        { method: 'POST', uri: createPRUrl, response: licensesPullRequest },
        { method: 'POST', url: createReviewRequestUrl },
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${parent}%22`, response: { items: [pullRequest] } }
      ]);

      await expect(workflow()).rejects.toThrow();

      let match = outString.match(`POST ${createPRUrl} : (.+)`);
      expect(match).toBeTruthy();
      let body = JSON.parse(match[1]);
      expect(body.body).toMatch(`[PR](${pullRequest.html_url})`);
    });

    it('adds a comment to the parent PR if it exists', async () => {
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${parent}%22`, response: { items: [pullRequest] } }
      ]);

      await expect(workflow()).rejects.toThrow();
      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${parent}" -base:"${parent}"`;
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)} :`);

      const match = outString.match(`POST ${createUserPRCommentUrl} : (.+)`);
      expect(match).toBeTruthy();
      const body = JSON.parse(match[1]);
      expect(body.body).toMatch('The `licensed-ci` GitHub Action has updated');
      expect(body.body).toMatch(licensesPullRequest.html_url);
    });

    it('does not add a comment to the parent PR if it does not exist', async () => {
      mocks.github.mock([
        { method: 'GET', uri: `${issuesSearchUrl}.*head%3A%22${parent}%22`, response: { items: [] } }
      ]);

      await expect(workflow()).rejects.toThrow();

      const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${parent}"`;
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);

      expect(outString).not.toMatch(`POST ${createUserPRCommentUrl} : (.+)`);
    });

    it('adds a status comment to the licenses PR', async () => {
      await expect(workflow()).rejects.toThrow();

      const match = outString.match(`POST ${createLicensesPRCommentUrl} : (.+)`);
      expect(match).toBeTruthy();
      const body = JSON.parse(match[1]);
      expect(body.body).toMatch('`licensed status` result')
      expect(body.body).toMatch('succeeded');
      expect(body.body).toMatch('licenses-success');
    });
  });
});
