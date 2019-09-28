const core = require('@actions/core');
const { exec } = require('@actions/exec');
const github = require('@actions/github');
const path = require('path');
const stream = require('stream');

const octokit = new github.GitHub('token');

// arguments to call with `node` in a child process
const nodeArgs = [
  // multi-file loader to help loading the rest of the files in a single `node` call
  path.join(__dirname, 'helpers', 'loader'),
  // load mocks for @actions/exec
  path.join(__dirname, 'mocks', '@actions', 'exec'),
  // load mocks for @actions/github
  path.join(__dirname, 'mocks', '@actions', 'github'),
  // load and run the app
  path.normalize(path.join(__dirname, '..', 'index'))
];

describe('licensed-ci', () => {
  const token = 'token';
  const userName = 'user';
  const userEmail = 'user@example.com';
  const commitMessage = 'commit message';
  const command = 'licensed';
  const configFile = path.normalize(path.join(__dirname, '..', '.licensed.yml'));

  const branch = 'branch';

  // to match the response from the testSearchResult.json fixture
  const owner = 'jonabc';
  const repo = 'repo';

  let outString;
  let options;

  beforeEach(() => {
    outString = '';
    options = {
      env: {
        ...process.env,
        INPUT_GITHUB_TOKEN: token,
        INPUT_COMMIT_MESSAGE: commitMessage,
        INPUT_USER_NAME: userName,
        INPUT_USER_EMAIL: userEmail,
        INPUT_COMMAND: command,
        INPUT_CONFIG_FILE: configFile,
        GITHUB_REF: `refs/heads/${branch}`,
        GITHUB_REPOSITORY: `${owner}/${repo}`,
        EXEC_MOCKS: JSON.stringify([
          { command: '', exitCode: 0 }
        ])
      },
      ignoreReturnCode: true,
      listeners: {
        stdout: data => outString += data.toString()
      },
      outStream: new stream.Writable({ write: () => { } })
    };
  });

  it('raises an error when github_token is not given', async () => {
    delete options.env.INPUT_GITHUB_TOKEN;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: github_token');
  });

  it('raises an error when commit_message is not given', async () => {
    delete options.env.INPUT_COMMIT_MESSAGE;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: commit_message');
  });

  it('raises an error when user_name is not given', async () => {
    delete options.env.INPUT_USER_NAME;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: user_name');
  });

  it('raises an error when user_email is not given', async () => {
    delete options.env.INPUT_USER_EMAIL;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: user_email');
  });

  it('raises an error when config_file is not given', async () => {
    delete options.env.INPUT_CONFIG_FILE;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: config_file');
  });

  it('raises an error when command is not given', async () => {
    delete options.env.INPUT_COMMAND;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: command');
  });

  it('raises an error when ref is not found', async () => {
    delete options.env.GITHUB_REF;

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Current ref not available');
  });

  it('raises an error when ref is not a branch', async () => {
    options.env.GITHUB_REF = '/refs/tags/v1';

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('/refs/tags/v1 does not reference a branch');
  });

  it('runs a licensed ci workflow', async () => {
    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Success);
    expect(outString).toMatch(`git checkout ${branch}`);
    expect(outString).toMatch(`${command} env --format json -c ${configFile}`);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(outString).toMatch('git add');
    expect(outString).toMatch('git diff-index --quiet HEAD');
    expect(outString).toMatch(`${command} status -c ${configFile}`);
  });

  describe('without licensed env', () => {
    beforeEach(() => {
      options.env.EXEC_MOCKS = JSON.stringify([
        { command: 'licensed env', exitCode: 1 },
        { command: '', exitCode: 0 }
      ]);
    });

    it('adds and checks all files in the repository', async () => {
      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).toMatch('git add .');
      expect(outString).not.toMatch('git diff-index --quiet HEAD --');
    });
  });

  describe('with licensed env', () => {
    const env = { apps: [{ cache_path: 'project/licenses' }, { cache_path: 'test/licenses' }] };
    beforeEach(() => {
      options.env.EXEC_MOCKS = JSON.stringify([
        { command: 'licensed env', stdout: JSON.stringify(env), exitCode: 0 },
        { command: '', exitCode: 0 }
      ]);
    });

    it('adds and checks licensed cache_paths', async () => {
      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).toMatch('git add project/licenses test/licenses');
      expect(outString).toMatch('git diff-index --quiet HEAD -- project/licenses test/licenses');
    });
  });

  it('raises an error if licensed status fails', async () => {
    options.env.EXEC_MOCKS = JSON.stringify([
      { command: `${command} status`, exitCode: 1 },
      { command: '', exitCode: 0 }
    ]);

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
  });

  describe('with no cached file changes', () => {
    it('does not push changes to origin', async () => {
      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).not.toMatch(`git push licensed-ci-origin ${branch}`)
    });
  });

  describe('with cached file changes', () => {
    const issuesSearchEndpoint = octokit.search.issuesAndPullRequests.endpoint();
    const issuesSearchUrl = issuesSearchEndpoint.url.replace('https://api.github.com', '');
    const createCommentEndpoint = octokit.issues.createComment.endpoint({ owner, repo, issue_number: 1 });
    const createCommentUrl = createCommentEndpoint.url.replace('https://api.github.com', '');

    beforeEach(async () => {
      options.env.EXEC_MOCKS = JSON.stringify([
        { command: 'git diff-index', exitCode: 1 },
        { command: '', exitCode: 0 }
      ]);
    });

    it('pushes changes to origin', async () => {
      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).toMatch(`git remote add licensed-ci-origin https://x-access-token:${token}@github.com/${options.env.GITHUB_REPOSITORY}.git`);
      expect(outString).toMatch(`git -c user.name=${userName} -c user.email=${userEmail} commit -m ${commitMessage}`);
      expect(outString).toMatch(`git push licensed-ci-origin ${branch}`)
    });

    it('does not comment if comment input is not given', async () => {
      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).not.toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('does not comment if PR is not found', async () => {
      options.env.INPUT_PR_COMMENT = 'Auto updated files';
      options.env.GITHUB_MOCKS = JSON.stringify([
        { method: 'GET', uri: issuesSearchUrl, responseFixture: path.join(__dirname, 'fixtures', 'emptySearchResult') }
      ]);

      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).not.toMatch(`POST ${createCommentUrl}`);
    });

    it('comments if input is given and PR is open', async () => {
      options.env.INPUT_PR_COMMENT = 'Auto updated files';
      options.env.GITHUB_MOCKS = JSON.stringify([
        { method: 'GET', uri: issuesSearchUrl, responseFixture: path.join(__dirname, 'fixtures', 'testSearchResult') },
        { method: 'POST', uri: createCommentUrl }
      ]);

      const exitCode = await exec('node', nodeArgs, options);
      expect(exitCode).toEqual(core.ExitCode.Success);
      expect(outString).toMatch(`GET ${issuesSearchUrl}?q=is%3Apr%20repo%3A${owner}%2F${repo}%20head%3A${branch}`);
      expect(outString).toMatch(`POST ${createCommentUrl} : ${JSON.stringify({ body: options.env.INPUT_PR_COMMENT})}`);
    });
  });
});
