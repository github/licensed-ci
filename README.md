# licensed-ci

![test](https://github.com/jonabc/licensed-ci/workflows/Test/badge.svg)

Runs a [github/licensed](https://github.com/github/licensed) CI workflow.
1. Run a workflow to update cached dependency metadata using `licensed cache` and push updates to GitHub
1. Run `licensed status` to check that license data is available, known, up to date and valid for all dependencies
   - Status check failures will cause the step to fail, allowing examination and further updates to the code (if needed).

### Available Workflows

#### Push (`push`)

This is the default workflow and the behavior in v1.1.0.

Update cached dependency metadata on the target branch and push changes to origin.
If `pr_comment` input is set and a pull request is available, a comment is added to the pull request.  This input is deprecated and will be removed in the next major version.

#### Branch (`branch`)

Update cached dependency metadata on a branch named `<branch>-licenses` and opens a pull request to merge the changes into the target branch.
If `pr_comment` input is set, it will be added to the body text when creating the pull request.  This input is deprecated and will be removed in the next major version.

Manual adjustments to license data or the github/licensed configuration should happen on the new licenses branch.
Any runs of the action on a `*-licenses` branch will run status checks only - dependency metadata will not be updated.

Notes:
- If the licenses branch already exists, it is rebased onto the target branch before caching metadata.
- If an open pull request for the branch already exists, no further action is taken.

### Configuration

- `github_token` - Required.  The access token used to push changes to the branch on GitHub.
- `command` - Optional, default: `licensed`. The command used to call licensed.
- `config_file` - Optional, default: `.licensed.yml`.  The configuration file path within the workspace.
- `user_name` - Optional, default: `licensed-ci`.  The name used when committing cached file changes.
- `user_email` - Optional, default: `licensed-ci@users.noreply.github.com`.  The email address used when committing cached file changes.
- `commit_message` - Optional, default: `Auto-update license files`.  Message to use when committing cached file changes.
- `pr_comment` - Optional (deprecated).  Markdown content to add to an available pull request.
   - this option is deprecated.  Please use the available `pr_url` and `pr_number` to script additional actions in your workflow
- `workflow` - Optional, default: `push`.  Specifies the workflow that is run when metadata updates are found:
  1. `push`
  1. `branch`
- `cleanup_on_success` - Optional, default: `'false'`.  Only applies to the `branch` workflow.  Set to the string `'true'` to close PRs and delete branches used by the `branch` workflow when `licensed status` succeeds on the parent branch.

### Outputs

- licenses_branch - The branch containing licensed-ci changes.
- user_branch - The branch containing user changes.
- licenses_updated - A boolean string indicating whether license files were updated.
- pr_url - The html url of the pull request for the license updates branch, if available, to enable further actions scripting.
- pr_number - The number of the pull request for the license updates branch, if available, to enable further actions scripting.
- pr_created - True if a pull request was created in a `branch` workflow, false otherwise.

### Usage

Basic usage with a licensed release package using [jonabc/setup-licensed](https://github.com/jonabc/setup-licensed)
```yaml
steps:
- uses: actions/checkout@master
- uses: jonabc/setup-licensed@v1
  with:
    version: 2.x
- run: npm install # install your projects dependencies in local environment
- id: licensed
  uses: jonabc/licensed-ci@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
- uses: actions/github-script@0.2.0
  if: always() && steps.licensed.outputs.pr_number
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    script: |
      github.issues.createComment({
        ...context.repo,
        issue_number: ${{ steps.licensed.outputs.pr_number }}
        body: 'My custom PR message'
      })
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
