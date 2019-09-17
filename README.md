# licensed-ci

Runs a [github/licensed](https://github.com/github/licensed) CI workflow.
1. Run `licensed cache` to update locally cached metadata.
1. Commit any changes back to the branch
1. Run `licensed status` to check that license data is available, known, up to date and valid for all dependencies
   - Status check failures will cause the step to fail, allowing examination and further updates to the code (if needed).

### Configuration

- `github_token` - Required.  The access token used to push changes to the branch on GitHub.
- `command` - Optional, default: `licensed`. The command used to call licensed.
- `config_file` - Optional, default: `.licensed.yml`.  The configuration file path within the workspace.
- `user_name` - Optional, default: `licensed-ci`.  The name used when committing any cached file changes.
- `user_email` - Optional, default: `licensed-ci@users.noreply.github.com`.  The email address used when committing any cached file changes.
- `commit_message` - Optional, default: `Auto-update license files`.  Message to use when committing any cached file changes.

### Usage

Basic usage with a licensed release package using [jonabc/setup-licensed](https://github.com/jonabc/setup-licensed)
```yaml
steps:
- uses: actions/checkout@master
- uses: jonabc/setup-licensed@v1
  with:
    version: 2.x
- run: npm install # install your projects dependencies in local environment
- uses: jonabc/licensed-ci@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

Basic usage with bundled licensed gem
```yaml
steps:
- uses: actions/checkout@master
- uses: actions/setup-ruby@v1
  with:
    ruby-version: 2.6.x
- run: bundle install
- uses: jonabc/licensed-ci@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    command: 'bundle exec licensed' # or bin/licensed when using binstubs
```

# License

This project is released under the [MIT License](LICENSE)

# Contributions

Contributions are welcome!
