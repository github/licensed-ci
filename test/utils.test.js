const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const utils = require('../lib/utils');

const processEnv = process.env;

describe('configureGit', () => {
  beforeEach(() => {
    process.env.INPUT_USER_NAME = 'user';
    process.env.INPUT_USER_EMAIL = 'email';
    process.env.INPUT_GITHUB_TOKEN = 'token';
    process.env.GITHUB_REPOSITORY = 'jonabc/licensed-ci';
  })

  afterEach(() => {
    sinon.restore();
    process.env = processEnv;
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

  it('configures the local git repository', async () => {
    sinon.stub(exec, 'exec').resolves();

    await utils.configureGit();
    expect(exec.exec.callCount).toEqual(3);
    expect(exec.exec.getCall(0).args).toEqual(['git', ['config', 'user.name', process.env.INPUT_USER_NAME]]);
    expect(exec.exec.getCall(1).args).toEqual(['git', ['config', 'user.email', process.env.INPUT_USER_EMAIL]]);
    expect(exec.exec.getCall(2).args).toEqual(['git', ['remote', 'add', utils.getOrigin(), `https://${process.env.INPUT_GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPOSITORY}`]]);
  });
});

describe('extraHeaderConfigWithoutAuthorization', () => {
  beforeEach(() => {
    sinon.stub(exec, 'exec').callsFake((command, args, options) => {
      if (command.includes('http.extraheader')) {
        options.listeners.stdout(Buffer.from('AUTHORIZATION: basic 123\r\nFOO: bar', 'utf-8'));
      } else {
        options.listeners.stdout(Buffer.from('AUTHORIZATION: basic 456\r\nFOO: bar', 'utf-8'));
      }

      return Promise.resolve(0);
    });
  });

  afterEach(() => {
    sinon.restore();
    process.env = processEnv;
  });

  it('overwrites and filters authorization headers', async () => {
    const expectedConfigValues = [];
    expectedConfigValues.push('-c', 'http.extraheader=');
    expectedConfigValues.push('-c', 'http.extraheader=FOO: bar');
    expectedConfigValues.push('-c', 'http.https://github.com/.extraheader=');
    expectedConfigValues.push('-c', 'http.https://github.com/.extraheader=FOO: bar');

    const configValues = await utils.extraHeaderConfigWithoutAuthorization();
    expect(configValues).toEqual(expectedConfigValues);

    expect(exec.exec.callCount).toEqual(2);
    expect(exec.exec.getCall(0).args).toEqual(expect.arrayContaining([
      'git',
      ['config', '--get-all', 'http.extraheader']
    ]));
    expect(exec.exec.getCall(1).args).toEqual(expect.arrayContaining([
      'git',
      ['config', '--get-all', 'http.https://github.com/.extraheader']
    ]));
  });

  it('uses process.env[GITHUB_SERVER_URL] instead of the default GitHub url when set', async () => {
    process.env['GITHUB_SERVER_URL'] = 'https://example.com';
    const expectedConfigValues = [];
    expectedConfigValues.push('-c', 'http.extraheader=');
    expectedConfigValues.push('-c', 'http.extraheader=FOO: bar');
    expectedConfigValues.push('-c', 'http.https://example.com/.extraheader=');
    expectedConfigValues.push('-c', 'http.https://example.com/.extraheader=FOO: bar');

    const configValues = await utils.extraHeaderConfigWithoutAuthorization();
    expect(configValues).toEqual(expectedConfigValues);

    expect(exec.exec.callCount).toEqual(2);
    expect(exec.exec.getCall(0).args).toEqual(expect.arrayContaining([
      'git',
      ['config', '--get-all', 'http.extraheader']
    ]));
    expect(exec.exec.getCall(1).args).toEqual(expect.arrayContaining([
      'git',
      ['config', '--get-all', 'http.https://example.com/.extraheader']
    ]));
  });
});

describe('getLicensedInput', () => {
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '.licensed.yml'));

  beforeEach(() => {
    process.env.INPUT_COMMAND = command;
    process.env.INPUT_CONFIG_FILE = configFile;
  });

  afterEach(() => {
    process.env = processEnv;
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

describe('checkStatus', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('runs a license status command and returns the results', async () => {
    sinon.stub(exec, 'exec').callsFake((command, args, options) => {
      options.listeners.stdout('output to log');
      return Promise.resolve(0);
    });

    const { success, log } = await utils.checkStatus('test', '.licensed.test.yml');
    expect(success).toEqual(true);
    expect(log).toEqual('output to log');
    expect(exec.exec.callCount).toEqual(1);
    expect(exec.exec.getCall(0).args).toEqual(
      expect.arrayContaining([
        'test',
        ['status', '-c', '.licensed.test.yml']
      ])
    );
  });
});

describe('getBranch', () => {
  it('raises an error when ref is not found', () => {
    expect(() => utils.getBranch({})).toThrow(
      'Unable to determine a HEAD branch reference for undefined event type'
    );
  });

  it('raises an error when ref is not a branch', () => {
    const context = { payload: { ref: 'refs/tags/v1' }};
    expect(() => utils.getBranch(context)).toThrow(
      'refs/tags/v1 does not reference a branch'
    );
  });

  it('returns the branch name from payload.ref', () => {
    const context = { payload: { ref: 'refs/heads/branch' }};

    expect(utils.getBranch(context)).toEqual('branch');
  });

  it('returns the branch name from a pull request payload', () => {
    const context = { payload: { ref: 'refs/pulls/123/merge', pull_request: { head: { ref: 'branch' }}}};

    expect(utils.getBranch(context)).toEqual('branch');
  });
});

describe('getCachePaths', () => {
  const command = 'licensed';
  const configFile = path.resolve(__dirname, '..', '.licensed.yml');
  const env = {
    apps: [
      { cache_path: 'project/licenses' },
      { cache_path: 'test/licenses' }
    ]
  };

  beforeEach(() => {
    sinon.stub(exec, 'exec').callsFake((command, args, options) => {
      options.listeners.stdout(JSON.stringify(env));
      return Promise.resolve(0);
    });
  });

  afterEach(() => {
    sinon.restore()
  });

  it('calls licensed env', async () => {
    exec.exec.resolves(1);

    await utils.getCachePaths(command, configFile);
    expect(exec.exec.callCount).toEqual(1);
    expect(exec.exec.getCall(0).args).toEqual(
      expect.arrayContaining(
        ['licensed', ['env', '--format', 'json', '-c', configFile]]
      )
    );
  });

  it('returns default paths if licensed env is not available', async () => {
    exec.exec.resolves(1);

    const cachePaths = await utils.getCachePaths(command, configFile);
    expect(cachePaths).toEqual(['.']);
  });

  it('returns parsed cache paths from licensed env', async () => {
    const cachePaths = await utils.getCachePaths(command, configFile);
    expect(cachePaths).toEqual(['project/licenses', 'test/licenses']);
  });
});

describe('filterCachePaths', () => {
  const cachePaths = ['project/licenses', 'test/licenses'];
  beforeEach(() => {
    sinon.stub(fs.promises, 'access').resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('filters out non-existant cache paths', async () => {
    fs.promises.access.withArgs(cachePaths[0], fs.constants.R_OK).rejects();
    const filteredPaths = await utils.filterCachePaths(cachePaths);
    expect(filteredPaths).toEqual(cachePaths.slice(1));
  });
});

describe('ensureBranch', () => {
  let branch = 'branch';
  let parent = 'parent';

  afterEach(() => {
    sinon.restore();
  });

  it('checks out a branch if it exists', async () => {
    sinon.stub(exec, 'exec').resolves(0);

    await utils.ensureBranch(branch, branch);
    expect(exec.exec.callCount).toEqual(2);
    expect(exec.exec.getCall(0).args).toEqual([
      'git',
      ['fetch', utils.getOrigin(), branch],
      { ignoreReturnCode: true }
    ]);
    expect(exec.exec.getCall(1).args).toEqual([
      'git',
      ['checkout', '--track', `${utils.getOrigin()}/${branch}`],
      { ignoreReturnCode: true }
    ]);
  });

  describe('when branch !== parent', () => {
    it('creates a branch if it doesn\'t exist', async () => {
      sinon.stub(exec, 'exec')
        .withArgs('git', ['fetch', utils.getOrigin(), branch]).resolves(1)
        .withArgs('git', ['fetch', utils.getOrigin(), parent]).resolves(0)
        .withArgs('git', ['checkout', '--track', `${utils.getOrigin()}/${branch}`]).resolves(1)
        .withArgs('git', ['checkout', '--track', `${utils.getOrigin()}/${parent}`]).resolves(0)
        .withArgs('git', ['checkout', '--track', '-b', branch]).resolves(0);

      await utils.ensureBranch(branch, parent);
      expect(exec.exec.callCount).toEqual(5);
      expect(exec.exec.getCall(0).args).toEqual([
        'git',
        ['fetch', utils.getOrigin(), branch],
        { ignoreReturnCode: true }
      ]);
      expect(exec.exec.getCall(1).args).toEqual([
        'git',
        ['fetch', utils.getOrigin(), parent],
        { ignoreReturnCode: true }
      ]);
      expect(exec.exec.getCall(2).args).toEqual([
        'git',
        ['checkout', '--track', `${utils.getOrigin()}/${branch}`],
        { ignoreReturnCode: true }
      ]);
      expect(exec.exec.getCall(3).args).toEqual([
        'git',
        ['checkout', '--track', `${utils.getOrigin()}/${parent}`]
      ]);
      expect(exec.exec.getCall(4).args).toEqual([
        'git',
        ['checkout', '--track', '-b', branch],
        { ignoreReturnCode: true }
      ]);
    });

    it('raises an error if checkout and create fail', async () => {
      sinon.stub(exec, 'exec')
        .withArgs('git', ['fetch', utils.getOrigin(), branch]).resolves(1)
        .withArgs('git', ['fetch', utils.getOrigin(), parent]).resolves(0)
        .withArgs('git', ['checkout', '--track', `${utils.getOrigin()}/${branch}`]).resolves(1)
        .withArgs('git', ['checkout', '--track', `${utils.getOrigin()}/${parent}`]).resolves(0)
        .withArgs('git', ['checkout', '-b', '--track', branch]).resolves(1);

      await expect(utils.ensureBranch(branch, parent)).rejects.toThrow(
        `Unable to find or create the ${branch} branch`
      );
    });
  });

  describe('when branch === parent', () => {
    it('raises an error if checkout fails', async () => {
      sinon.stub(exec, 'exec').resolves(1);

      await expect(utils.ensureBranch(branch, branch)).rejects.toThrow(
        `Unable to find or create the ${branch} branch`
      );
      expect(exec.exec.callCount).toEqual(2);
      expect(exec.exec.getCall(0).args).toEqual([
        'git',
        ['fetch', utils.getOrigin(), branch],
        { ignoreReturnCode: true }
      ]);
      expect(exec.exec.getCall(1).args).toEqual([
        'git',
        ['checkout', '--track', `${utils.getOrigin()}/${branch}`],
        { ignoreReturnCode: true }
      ]);
    });
  });
});

describe('findPullRequest', () => {
  const searchResultFixture = require(path.join(__dirname, 'fixtures', 'testSearchResult'));
  const head = 'head';
  const base = 'base';

  let octokit;
  let endpoint;

  beforeEach(() => {
    process.env.GITHUB_REPOSITORY = 'jonabc/licensed-ci';
    endpoint = sinon.stub().resolves({ data: searchResultFixture });
    octokit = {
      rest: {
        search: {
          issuesAndPullRequests: endpoint
        }
      }
    };
  })

  afterEach(() => {
    process.env = processEnv;
    sinon.restore();
  });

  it('finds a pull request for a head and base branch', async () => {
    const pullRequest = await utils.findPullRequest(octokit, { head, base });
    expect(pullRequest).toEqual(searchResultFixture.items[0]);
    expect(endpoint.callCount).toEqual(1);
    expect(endpoint.getCall(0).args).toEqual([{
      q: `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${head}" base:"${base}"`
    }]);
  });

  it('finds a pull request for a head branch', async () => {
    const pullRequest = await utils.findPullRequest(octokit, { head });
    expect(pullRequest).toEqual(searchResultFixture.items[0]);
    expect(endpoint.callCount).toEqual(1);
    expect(endpoint.getCall(0).args).toEqual([{
      q: `is:pr is:open repo:${process.env.GITHUB_REPOSITORY} head:"${head}"`
    }]);
  });

  it("returns null if a PR isn't found", async () => {
    endpoint.resolves({ data: { items: [] } });
    const pullRequest = await utils.findPullRequest(octokit, { head, base });
    expect(pullRequest).toBeNull();
  });
});

describe('closePullRequest', () => {
  const pullRequest = require(path.join(__dirname, 'fixtures', 'pullRequest'));
  const closedPullRequest = { ...pullRequest, state: 'closed' };

  // to match the response from the pullRequest.json fixture
  const owner = 'octocat';
  const repo = 'Hellow-World';

  let octokit;
  let endpoint;

  beforeEach(() => {
    process.env = {
      ...process.env,
      GITHUB_REPOSITORY: `${owner}/${repo}`
    };

    endpoint = sinon.stub().resolves({ data: closedPullRequest });
    octokit = { rest: { pulls: { update: endpoint } } };
  })

  afterEach(() => {
    sinon.restore();
    process.env = processEnv;
  });

  it('closes an open pull request', async () => {
    const response = await utils.closePullRequest(octokit, pullRequest);
    expect(response).toEqual(closedPullRequest);
    expect(endpoint.callCount).toEqual(1);
    expect(endpoint.getCall(0).args).toEqual([{
      owner,
      repo,
      pull_number: pullRequest.number,
      state: 'closed'
    }]);
  });

  it('does not close an already closed pull request', async () => {
    const response = await utils.closePullRequest(octokit, closedPullRequest);
    expect(response).toEqual(closedPullRequest);
    expect(endpoint.callCount).toEqual(0);
  });

  it('handles a null pull request input', async () => {
    const response = await utils.closePullRequest(octokit, null);
    expect(response).toBeNull();
    expect(endpoint.callCount).toEqual(0);
  });
});

describe('deleteBranch', () => {
  const branch = 'branch';

  afterEach(() => {
    sinon.restore();
  });

  it('deletes a git branch', async () => {
    sinon.stub(exec, 'exec').resolves(0);
    await utils.deleteBranch(branch);
    expect(exec.exec.callCount).toEqual(2);
    expect(exec.exec.getCall(0).args).toEqual([
      'git',
      ['ls-remote', '--exit-code', utils.getOrigin(), branch],
      { ignoreReturnCode: true }
    ]);
    expect(exec.exec.getCall(1).args).toEqual(['git', ['push', utils.getOrigin(), '--delete', branch]]);
  });

  it('does not try to delete a branch that doesn\'t exist', async () => {
    sinon.stub(exec, 'exec').resolves(1);
    await utils.deleteBranch(branch);
    expect(exec.exec.callCount).toEqual(1);
  });

  it('raises an error if branch delete fails', async () => {
    sinon.stub(exec, 'exec')
      .withArgs('git', ['ls-remote', '--exit-code', utils.getOrigin(), branch]).resolves(0)
      .withArgs('git', ['push', utils.getOrigin(), '--delete', branch]).rejects();
    await expect(utils.deleteBranch(branch)).rejects.toThrow();
  });
});
