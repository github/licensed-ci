const exec = require('@actions/exec');
const os = require('os');
const sinon = require('sinon').createSandbox();

const mocks = [];
let logMethod = console.log;

function getOutputString(value) {
  if (!value) {
    return null;
  } else if (Array.isArray(value)) {
    return value.map(arg => JSON.stringify(arg)).join(os.EOL);
  } else {
    return JSON.stringify(value);
  }
}

sinon.stub(exec, 'exec').callsFake(async (command, args = [], options = {}) => {
  const optionsArray = Object.keys(options || {}).map(key => `${key}:${JSON.stringify(options[key])}`);
  const fullCommand = [command, ...args, ...optionsArray].join(' ');
  logMethod(fullCommand);

  let exitCode = 1;

  const mock = mocks.find(mock => !!fullCommand.match(mock.command));
  if (mock) {
    const stdout = getOutputString(mock.stdout);
    if (stdout) {
      // echo the mocked stdout using the passed in options
      await exec.exec.wrappedMethod(`echo ${stdout}`, [], options);
    }

    const stderr = getOutputString(mock.stderr);
    if (stderr) {
      // echo the mocked stderr using the passed in options
      await exec.exec.wrappedMethod(`echo ${stderr} >&2`, [], options);
    }

    if (mock.exitCode || mock.exitCode === 0) {
      exitCode = mock.exitCode;
    }

    if (mock.count > 0) {
      mock.count -= 1;
      if (mock.count === 0) {
        const index = mocks.indexOf(mock);
        mocks.splice(index, 1);
      }
    }
  }

  if (exitCode !== 0 && !options.ignoreReturnCode) {
    return Promise.reject(exitCode);
  }

  return Promise.resolve(exitCode);
});

function mock(mocksToAdd) {
  if (Array.isArray(mocksToAdd)) {
    mocks.unshift(...mocksToAdd)
  } else {
    mocks.unshift(mocksToAdd);
  }
}

function clear() {
  mocks.length = 0;
}

function restore() {
  clear();
  setLog(console.log);

  // by default, add all mocks from the process environment
  mock(JSON.parse(process.env.EXEC_MOCKS || '[]'));
}

function setLog(method) {
  logMethod = method;
}

restore();

module.exports = {
  mock,
  clear,
  restore,
  setLog
};
