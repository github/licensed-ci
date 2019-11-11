const github = require('@actions/github');
const { mocks } = require('@jonabc/actions-mocks');
const os = require('os');
const path = require('path');
const sinon = require('sinon').createSandbox();
const utils = require('../../lib/utils');
const workflow = require('../../lib/workflows/push');

const octokit = new github.GitHub('token');

describe('push workflow', () => {
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
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.github.setLog(log => outString += log + os.EOL);

    sinon.stub(process.stdout, 'write').callsFake(log => outString += log);

    mocks.exec.mock([
      { command: 'licensed env', exitCode: 1 },
      { command: 'licensed status', exitCode: 1, count: 1 },
      { command: '', exitCode: 0 }
    ]);

    Object.keys(utils).forEach(key => sinon.spy(utils, key));
  });

  afterEach(() => {
    sinon.restore();
    mocks.exec.restore();
  });

  it('does not cache data if no changes are needed', async () => {
    mocks.exec.mock({ command: 'licensed status', exitCode: 0 });
    await workflow();
    expect(outString).toMatch(`${command} status -c ${configFile}`);
    expect(outString).not.toMatch(`${command} cache -c ${configFile}`);
  });

  it('runs a licensed ci workflow', async () => {
    await workflow();
    expect(utils.getBranch.callCount).toEqual(1);
    expect(utils.getLicensedInput.callCount).toBeGreaterThan(1);
    expect(utils.ensureBranch.withArgs(branch, branch).callCount).toEqual(1);
    expect(outString).toMatch(`git checkout ${branch}`);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(utils.getCachePaths.callCount).toEqual(1);
    expect(outString).toMatch(`${command} env`);
    expect(outString).toMatch('git add -- .');
    expect(outString).toMatch('git diff-index --quiet HEAD -- .');
  });

  it('fails if status checks fail after caching data', async () => {
    mocks.exec.mock({ command: 'licensed status', exitCode: 1 });
    await expect(workflow()).rejects.toThrow('Cached metadata checks failed');
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      await workflow();
      expect(outString).not.toMatch(`git push licensed-ci-origin ${branch}`)
    });
  });

  describe('with cached file changes', () => {
    const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
    const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
    const createCommentEndpoint = octokit.issues.createComment.endpoint({ owner, repo, issue_number: 1 });
    const createCommentUrl = createCommentEndpoint.url.replace('https://api.github.com', '');

    beforeEach(() => {
      mocks.exec.mock({ command: 'git diff-index', exitCode: 1 });
    });

    it('raises an error when github_token is not given', async () => {
      delete process.env.INPUT_GITHUB_TOKEN;

      await expect(workflow()).rejects.toThrow(
        'Input required and not supplied: github_token'
      );
    });

    it('pushes changes to origin', async () => {
      await workflow();
      expect(outString).toMatch(`git commit -m ${commitMessage}`);
      expect(outString).toMatch(`git push licensed-ci-origin ${branch}`)
    });

    it('does not comment if comment input is not given', async () => {
      await workflow();
      expect(outString).not.toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('does not comment if PR is not found', async () => {
      process.env.INPUT_PR_COMMENT = 'Auto updated files';

      const searchResultFixture = path.join(__dirname, '..', 'fixtures', 'emptySearchResult');
      mocks.github.mock(
        { method: 'GET', uri: issuesSearchUrl, response: require(searchResultFixture) }
      );

      await workflow();
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('comments if input is given and PR is open', async () => {
      process.env.INPUT_PR_COMMENT = 'Auto updated files';

      const searchResultFixture = path.join(__dirname, '..', 'fixtures', 'testSearchResult');
      mocks.github.mock([
        { method: 'GET', uri: issuesSearchUrl, response: require(searchResultFixture) },
        { method: 'POST', uri: createCommentUrl }
      ]);

      await workflow();
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).toMatch(`POST ${createCommentUrl} : ${JSON.stringify({ body: process.env.INPUT_PR_COMMENT})}`);
    });

    it('sets pr details in step output', async () => {
      const searchResultFixture = require(path.join(__dirname, '..', 'fixtures', 'testSearchResult'));
      mocks.github.mock([
        { method: 'GET', uri: issuesSearchUrl, response: searchResultFixture },
        { method: 'POST', uri: createCommentUrl }
      ]);

      await workflow();
      expect(outString).toMatch(new RegExp(`set-output.*pr_url.*${searchResultFixture.items[0].html_url}`));
      expect(outString).toMatch(new RegExp(`set-output.*pr_number.*${searchResultFixture.items[0].number}`));
    });
  });
});
