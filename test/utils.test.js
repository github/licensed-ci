const github = require('@actions/github');
const { mocks } = require('@jonabc/actions-mocks');
const path = require('path');
const os = require('os');
const utils = require('../lib/utils');

const octokit = new github.GitHub('token');

describe('configureGit', () => {
  let outString;

  beforeEach(() => {
    process.env.INPUT_USER_NAME = 'user';
    process.env.INPUT_USER_EMAIL = 'email';
    process.env.INPUT_GITHUB_TOKEN = 'token';

    outString = '';
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.exec.mock({ command: '', exitCode: 0 })
  })

  afterEach(() => {
    mocks.exec.restore();
  });

  it('raises an error when user_name is not given', async () => {
    delete process.env.INPUT_USER_NAME;

    await expect(utils.configureGit()).rejects.toThrow(
      'Input required and not supplied: user_name'
    );
  });

  it('raises an error when user_email is not given', async () => {
    delete process.env.INPUT_USER_EMAIL;

    await expect(utils.configureGit()).rejects.toThrow(
      'Input required and not supplied: user_email'
    );
  });

  it('raises an error when github_token is not given', async () => {
    delete process.env.INPUT_GITHUB_TOKEN;

    await expect(utils.configureGit()).rejects.toThrow(
      'Input required and not supplied: github_token'
    );
  });

  it('configures the repository with the user name and email input', async () => {
    await utils.configureGit();
    expect(outString).toMatch(`git config user.name ${process.env.INPUT_USER_NAME}`);
    expect(outString).toMatch(`git config user.email ${process.env.INPUT_USER_EMAIL}`);
  });

  it('configures the licensed-ci-origin remote', async () => {
    await utils.configureGit();
    expect(outString).toMatch(
      `git remote add ${utils.getOrigin()} https://x-access-token:${process.env.INPUT_GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}.git`
    );
  });
});

describe('getLicensedInput', () => {
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '.licensed.yml'));

  beforeEach(() => {
    process.env.INPUT_COMMAND = command;
    process.env.INPUT_CONFIG_FILE = configFile;
  });

  it('raises an error when command is not given', async () => {
    delete process.env.INPUT_COMMAND;

    await expect(utils.getLicensedInput()).rejects.toThrow(
      'Input required and not supplied: command'
    );
  });

  it('raises an error when command is not executable', async () => {
    process.env.INPUT_COMMAND = 'non_existent';

    await expect(utils.getLicensedInput()).rejects.toThrow(
      'Unable to locate executable file: non_existent'
    );
  });

  it('raises an error when config_file is not given', async () => {
    delete process.env.INPUT_CONFIG_FILE;

    await expect(utils.getLicensedInput()).rejects.toThrow(
      'Input required and not supplied: config_file'
    );
  });

  it('raises an error when config_file does not exist', async () => {
    process.env.INPUT_CONFIG_FILE = 'non_existent';

    await expect(utils.getLicensedInput()).rejects.toThrow(
      'ENOENT: no such file or directory, access \'non_existent\''
    );
  });

  it('returns the input values for running licensed', async () => {
    const { command, configFilePath } = await utils.getLicensedInput();
    expect(command).toEqual(process.env.INPUT_COMMAND);
    expect(configFilePath).toEqual(process.env.INPUT_CONFIG_FILE);
  });
});

describe('getBranch', () => {
  beforeEach(() => {
    process.env.GITHUB_REF = 'refs/heads/branch';
  });

  it('raises an error when ref is not found', () => {
    delete process.env.GITHUB_REF;

    expect(() => utils.getBranch()).toThrow(
      'Current ref not available'
    );
  });

  it('raises an error when ref is not a branch', () => {
    process.env.GITHUB_REF = 'refs/tags/v1';

    expect(() => utils.getBranch()).toThrow(
      'refs/tags/v1 does not reference a branch'
    );
  });

  it('returns the branch name', () => {
    expect(utils.getBranch()).toEqual('branch');
  });
});

describe('getCachePaths', () => {
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '.licensed.yml'));
  let outString;

  beforeEach(() => {
    outString = '';
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.exec.mock({ command: '', exitCode: 0 })
  })

  afterEach(() => {
    mocks.exec.restore();
  });

  it('calls licensed env', async () => {
    mocks.exec.mock({ command: 'licensed env', exitCode: 1 });

    await utils.getCachePaths(command, configFile);
    expect(outString).toMatch(`licensed env --format json -c ${configFile}`);
  });

  it('returns default paths if licensed env is not available', async () => {
    mocks.exec.mock({ command: 'licensed env', exitCode: 1 });

    const cachePaths = await utils.getCachePaths(command, configFile);
    expect(cachePaths).toEqual(['.']);
  });

  it('returns parsed cache paths from licensed env', async () => {
    const env = {
      apps: [
        { cache_path: 'project/licenses' },
        { cache_path: 'test/licenses' }
      ]
    };
    mocks.exec.mock({ command: 'licensed env', stdout: JSON.stringify(env), exitCode: 0 });

    const cachePaths = await utils.getCachePaths(command, configFile);
    expect(cachePaths).toEqual(['project/licenses', 'test/licenses']);
  });
});

describe('ensureBranch', () => {
  let branch = 'branch';
  let parent = 'parent';

  let outString;

  beforeEach(() => {
    outString = '';
    mocks.exec.setLog(log => outString += log + os.EOL);
    mocks.exec.mock({ command: '', exitCode: 0 });
  })

  afterEach(() => {
    mocks.exec.restore();
  });

  it('checks out a branch if it exists', async () => {
    await utils.ensureBranch(branch, branch);
    expect(outString).toMatch(`git checkout ${branch}`);
  });

  describe('when branch !== parent', () => {
    it('creates a branch if it doesn\'t exist', async () => {
      mocks.exec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

      await utils.ensureBranch(branch, parent);
      expect(outString).toMatch(`git checkout ${parent}`);
      expect(outString).toMatch(`git checkout -b ${branch}`);
    });

    it('raises an error if checkout and create fail', async () => {
      mocks.exec.mock({ command: `git checkout ${branch}`, exitCode: 1 });
      mocks.exec.mock({ command: `git checkout -b ${branch}`, exitCode: 1 });

      await expect(utils.ensureBranch(branch, parent)).rejects.toThrow(
        `Unable to find or create the ${branch} branch`
      );
    });

    it('rebases branch on parent', async () => {
      await utils.ensureBranch(branch, parent);
      expect(outString).toMatch(`git rebase ${parent} ${branch}`);
    });

    it('raises an error if rebasing failed', async () => {
      mocks.exec.mock({ command: `git rebase ${parent} ${branch}`, exitCode: 1 });

      await expect(utils.ensureBranch(branch, parent)).rejects.toThrow(
        `Unable to get ${branch} up to date with ${parent}`
      );
    });
  });

  describe('when branch === parent', () => {
    it('does not create branch if it doesn\t exist', async () => {
      mocks.exec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

      await utils.ensureBranch(branch, branch).catch(() => {});
      expect(outString).not.toMatch(`git checkout -b ${branch} ${branch}`);
    });

    it('raises an error if checkout fails', async () => {
      mocks.exec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

      await expect(utils.ensureBranch(branch, branch)).rejects.toThrow(
        `Unable to find or create the ${branch} branch`
      );
    });

    it('does not perform a rebase', async () => {
      await utils.ensureBranch(branch, branch);
      expect(outString).not.toMatch(`git rebase ${branch} ${branch}`);
    });
  });
});

describe('findPullRequest', () => {
  const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
  const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
  const searchResultFixture = require(path.join(__dirname, 'fixtures', 'testSearchResult'));
  const head = 'head';
  const base = 'base';

  let outString;

  beforeEach(() => {
    outString = '';
    mocks.github.setLog(log => outString += log + os.EOL);
    mocks.github.mock(
      { method: 'GET', uri: issuesSearchUrl, response: searchResultFixture }
    );
  })

  afterEach(() => {
    mocks.github.restore();
  });

  it('finds a pull request for a head and base branch', async () => {
    const pullRequest = await utils.findPullRequest(octokit, head, base);
    expect(pullRequest).toEqual(searchResultFixture.items[0]);
    const query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${head}" base:"${base}"`;
    expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);
  });

  it('finds a pull request for a head branch', async () => {
    const pullRequest = await utils.findPullRequest(octokit, head);
    expect(pullRequest).toEqual(searchResultFixture.items[0]);
    let query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${head}"`;
    expect(outString).toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);

    query = `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${head}" base:"${base}"`;
    expect(outString).not.toMatch(`GET ${issuesSearchUrl}?q=${encodeURIComponent(query)}`);
  });
});

describe('closePullRequest', () => {
  const pullRequest = require(path.join(__dirname, 'fixtures', 'pullRequest'));
  const closedPullRequest = { ...pullRequest, state: 'closed' };

  // to match the response from the pullRequest.json fixture
  const owner = 'octocat';
  const repo = 'Hellow-World';

  const updatePullsEndpoint = octokit.pulls.update.endpoint({ owner, repo, pull_number: pullRequest.number });
  const updatePullsUrl = updatePullsEndpoint.url.replace('https://api.github.com', '');

  const processEnv = process.env;
  let outString;

  beforeEach(() => {
    process.env = {
      ...process.env,
      GITHUB_REPOSITORY: `${owner}/${repo}`
    };

    outString = '';
    mocks.github.setLog(log => outString += log + os.EOL);
    mocks.github.mock(
      { method: 'PATCH', uri: updatePullsUrl, response: closedPullRequest }
    );
  })

  afterEach(() => {
    mocks.github.restore();
    process.env = processEnv;
  });

  it('closes an open pull request', async () => {
    const response = await utils.closePullRequest(octokit, pullRequest);
    expect(response).toEqual(closedPullRequest);
    expect(outString).toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
  });

  it('does not close an already closed pull request', async () => {
    const response = await utils.closePullRequest(octokit, closedPullRequest);
    expect(response).toEqual(closedPullRequest);
    expect(outString).not.toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
  });

  it('handles a null pull request input', async () => {
    const response = await utils.closePullRequest(octokit, null);
    expect(response).toBeNull();
    expect(outString).not.toMatch(`PATCH ${updatePullsUrl} : ${JSON.stringify({ state: 'closed' })}`);
  });
});

describe('deleteBranch', () => {
  const branch = 'branch';
  let outString;

  beforeEach(() => {
    outString = '';
    mocks.exec.setLog(log => outString += log + os.EOL);
    // console.log = log => outString += log;
    mocks.exec.mock({ command: '', exitCode: 0 });
  })

  afterEach(() => {
    mocks.exec.restore();
  });

  it('deletes a git branch', async () => {
    await utils.deleteBranch(branch);
    expect(outString).toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });

  it('does not try to delete a branch that doesn\'t exist', async () => {
    mocks.exec.mock({ command: 'git ls-remote', exitCode: 2 });
    await utils.deleteBranch(branch);
    expect(outString).toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).not.toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });

  it('raises an error if branch delete fails', async () => {
    mocks.exec.mock({ command: 'git push', exitCode: 2 });
    await expect(utils.deleteBranch(branch)).rejects.toThrow();
    expect(outString).toMatch(`git ls-remote --exit-code ${utils.getOrigin()} ${branch}`);
    expect(outString).toMatch(`git push ${utils.getOrigin()} --delete ${branch}`);
  });
});
