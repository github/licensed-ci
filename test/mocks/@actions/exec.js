const exec = require('@actions/exec');
const sinon = require('sinon');

const actionExec = exec.exec;
const execMocks = JSON.parse(process.env.EXEC_MOCKS || '[]');
sinon.stub(exec, 'exec').callsFake(async (command, args, options) => {
  const optionsArray = Object.keys(options || {}).map(key => `${key}:${JSON.stringify(options[key])}`);
  const fullCommand = [command, ...args, ...optionsArray].join(' ');
  console.log(fullCommand);

  let exitCode = 1;
  const mock = execMocks.find(mock => !!fullCommand.match(mock.command));
  if (mock) {
    if (mock.stdout) {
      // echo the mocked stdout using the passed in options
      await actionExec(`echo ${JSON.stringify(mock.stdout)}`, [], options);
    }

    if (mock.stderr) {
      // echo the mocked stderr using the passed in options
      await actionExec(`echo ${JSON.stringify(mock.stderr)} >&2`, [], options);
    }

    if (mock.exitCode || mock.exitCode === 0) {
      exitCode = mock.exitCode;
    }
  }

  if (exitCode !== 0 && !options.ignoreReturnCode) {
    return Promise.reject(exitCode);
  }

  return Promise.resolve(exitCode);
});
