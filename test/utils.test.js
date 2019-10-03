const path = require('path');
const os = require('os');
const utils = require('../lib/utils');

const mockExec = require('./mocks/@actions/exec');

describe('configureGitUser', () => {
  let outString;

  beforeEach(() => {
    process.env.INPUT_USER_NAME = 'user';
    process.env.INPUT_USER_EMAIL = 'email';

    outString = '';
    mockExec.setLog(log => outString += log + os.EOL);
    mockExec.mock({ command: '', exitCode: 0 })
  })

  afterEach(() => {
    mockExec.restore();
  });

  it('raises an error when user_name is not given', async () => {
    delete process.env.INPUT_USER_NAME;

    await expect(utils.configureGitUser()).rejects.toThrow(
      'Input required and not supplied: user_name'
    );
  });

  it('raises an error when user_email is not given', async () => {
    delete process.env.INPUT_USER_EMAIL;

    await expect(utils.configureGitUser()).rejects.toThrow(
      'Input required and not supplied: user_email'
    );
  });

  it('configures the repository with the user name and email input', async () => {
    await utils.configureGitUser();
    expect(outString).toMatch(`git config user.name ${process.env.INPUT_USER_NAME}`);
    expect(outString).toMatch(`git config user.email ${process.env.INPUT_USER_EMAIL}`);
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
    mockExec.setLog(log => outString += log + os.EOL);
    mockExec.mock({ command: '', exitCode: 0 })
  })

  afterEach(() => {
    mockExec.restore();
  });

  it('calls licensed env', async () => {
    mockExec.mock({ command: 'licensed env', exitCode: 1 });

    await utils.getCachePaths(command, configFile);
    expect(outString).toMatch(`licensed env --format json -c ${configFile}`);
  });

  it('returns default paths if licensed env is not available', async () => {
    mockExec.mock({ command: 'licensed env', exitCode: 1 });

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
    mockExec.mock({ command: 'licensed env', stdout: JSON.stringify(env), exitCode: 0 });

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
    mockExec.setLog(log => outString += log);
    mockExec.mock({ command: '', exitCode: 0 });
  })

  afterEach(() => {
    mockExec.restore();
  });

  it('checks out a branch if it exists', async () => {
    await utils.ensureBranch(branch, branch);
    expect(outString).toMatch(`git checkout ${branch}`);
  });

  describe('when branch !== parent', () => {
    it('creates a branch if it doesn\'t exist', async () => {
      mockExec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

      await utils.ensureBranch(branch, parent);
      expect(outString).toMatch(`git checkout ${parent}`);
      expect(outString).toMatch(`git checkout -b ${branch}`);
    });

    it('raises an error if checkout and create fail', async () => {
      mockExec.mock({ command: `git checkout ${branch}`, exitCode: 1 });
      mockExec.mock({ command: `git checkout -b ${branch}`, exitCode: 1 });

      await expect(utils.ensureBranch(branch, parent)).rejects.toThrow(
        `Unable to find or create the ${branch} branch`
      );
    });

    it('rebases branch on parent', async () => {
      await utils.ensureBranch(branch, parent);
      expect(outString).toMatch(`git rebase ${parent} ${branch}`);
    });

    it('raises an error if rebasing failed', async () => {
      mockExec.mock({ command: `git rebase ${parent} ${branch}`, exitCode: 1 });

      await expect(utils.ensureBranch(branch, parent)).rejects.toThrow(
        `Unable to get ${branch} up to date with ${parent}`
      );
    });
  });

  describe('when branch === parent', () => {
    it('does not create branch if it doesn\t exist', async () => {
      mockExec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

      await utils.ensureBranch(branch, branch).catch(() => {});
      expect(outString).not.toMatch(`git checkout -b ${branch} ${branch}`);
    });

    it('raises an error if checkout fails', async () => {
      mockExec.mock({ command: `git checkout ${branch}`, exitCode: 1 });

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
