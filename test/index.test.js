const core = require('@actions/core');
const path = require('path');
const { run } = require('@jonabc/actions-mocks');

const action = path.normalize(path.join(__dirname, '..', 'lib', 'index'));

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

  let options;

  beforeEach(() => {
    options = {
      env: {
        ...process.env,
        INPUT_GITHUB_TOKEN: token,
        INPUT_COMMIT_MESSAGE: commitMessage,
        INPUT_USER_NAME: userName,
        INPUT_USER_EMAIL: userEmail,
        INPUT_COMMAND: command,
        INPUT_CONFIG_FILE: configFile,
        INPUT_WORKFLOW: 'push',
        GITHUB_REF: `refs/heads/${branch}`,
        GITHUB_REPOSITORY: `${owner}/${repo}`
      },
      mocks: {
        exec: [
          { command: '', exitCode: 0 }
        ]
      }
    };
  });

  it('raises an error a workflow is not provided', async () => {
    delete options.env.INPUT_WORKFLOW;
    const { out, status } = await run(action, options);
    expect(status).toEqual(core.ExitCode.Failure);
    expect(out).toMatch('Input required and not supplied: workflow');
  });

  it('raises an error if workflow input is not valid', async () => {
    options.env.INPUT_WORKFLOW = 'invalid';

    const { out, status } = await run(action, options);
    expect(status).toEqual(core.ExitCode.Failure);
    expect(out).toMatch(
      `Workflow input value "invalid" must be one of: branch, push`
    );
  });

  it('runs a licensed ci workflow', async () => {
    options.mocks.exec.unshift({ command: 'licensed status', exitCode: 1, count: 1 });

    const { out, status } = await run(action, options);
    expect(status).toEqual(core.ExitCode.Success);
    expect(out).toMatch(`${command} status -c ${configFile}`);
    expect(out).toMatch(`git checkout ${branch}`);
    expect(out).toMatch(`${command} env --format json -c ${configFile}`);
    expect(out).toMatch(`${command} cache -c ${configFile}`);
    expect(out).toMatch('git add');
    expect(out).toMatch('git diff-index --quiet HEAD');
  });
});
