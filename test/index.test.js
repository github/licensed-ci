const core = require('@actions/core');
const { exec } = require('@actions/exec');
const path = require('path');
const stream = require('stream');

// arguments to call with `node` in a child process
const nodeArgs = [
  // multi-file loader to help loading the rest of the files in a single `node` call
  path.join(__dirname, 'helpers', 'loader'),
  // load mocks for @actions/exec
  path.join(__dirname, 'mocks', '@actions', 'exec'),
  // load mocks for @actions/github
  path.join(__dirname, 'mocks', '@actions', 'github'),
  // load and run the app
  path.normalize(path.join(__dirname, '..', 'lib', 'index'))
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
      outStream: new stream.Writable({ write: () => {} })
    };
  });

  it('raises an error a workflow is not provided', async () => {
    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch('Input required and not supplied: workflow');
  });

  it('raises an error if workflow input is not valid', async () => {
    options.env.INPUT_WORKFLOW = 'invalid';

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Failure);
    expect(outString).toMatch(
      `Workflow input value "invalid" must be one of: branch, push`
    );
  });

  it('runs a licensed ci workflow', async () => {
    options.env.INPUT_WORKFLOW = 'push';

    const exitCode = await exec('node', nodeArgs, options);
    expect(exitCode).toEqual(core.ExitCode.Success);
    expect(outString).toMatch(`git checkout ${branch}`);
    expect(outString).toMatch(`${command} env --format json -c ${configFile}`);
    expect(outString).toMatch(`${command} cache -c ${configFile}`);
    expect(outString).toMatch('git add');
    expect(outString).toMatch('git diff-index --quiet HEAD');
    expect(outString).toMatch(`${command} status -c ${configFile}`);
  });
});
