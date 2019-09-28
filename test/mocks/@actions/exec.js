const exec = require('@actions/exec');
const os = require('os');
const sinon = require('sinon');

function getOutputString(value) {
  if (!value) {
    return null;
  } else if (Array.isArray(value)) {
    return value.map(arg => JSON.stringify(arg)).join(os.EOL);
  } else {
    return JSON.stringify(value);
  }
}

const actionExec = exec.exec;
const execMocks = JSON.parse(process.env.EXEC_MOCKS || '[]');
sinon.stub(exec, 'exec').callsFake(async (command, args, options) => {
  const optionsArray = Object.keys(options || {}).map(key => `${key}:${JSON.stringify(options[key])}`);
  const fullCommand = [command, ...args, ...optionsArray].join(' ');
  console.log(fullCommand);

  let exitCode = 1;
  const mock = execMocks.find(mock => !!fullCommand.match(mock.command));
  if (mock) {
    const stdout = getOutputString(mock.stdout);
    if (stdout) {
      // echo the mocked stdout using the passed in options
      await actionExec(`echo ${stdout}`, [], options);
    }

    const stderr = getOutputString(mock.stderr);
    if (mock.stderr) {
      // echo the mocked stderr using the passed in options
      await actionExec(`echo ${stderr}`, [], options);
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
