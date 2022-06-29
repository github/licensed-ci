# licensed-ci

![test](https://github.com/jonabc/licensed-ci/workflows/Test/badge.svg)

Runs a [github/licensed](https://github.com/github/licensed) CI workflow.

1. Run a workflow to update cached dependency metadata using `licensed cache` and push updates to GitHub
1. Run `licensed status` to check that license data is available, known, up to date and valid for all dependencies
   - Status check failures will cause the step to fail, allowing examination and further updates to the code (if needed).

## Available Workflows

### Push (`push`)

This is the default workflow and the behavior in v1.1.0.

Update cached dependency metadata on the target branch and push changes to origin.
If `pr_comment` input is set and a pull request is available, a comment is added to the pull request.  This input is deprecated and will be removed in the next major version.

### Branch (`branch`)

Update cached dependency metadata on a branch named `<branch>-licenses` and opens a pull request to merge the changes into the target branch.
If `pr_comment` input is set, it will be added to the body text when creating the pull request.  This input is deprecated and will be removed in the next major version.

Manual adjustments to license data or the github/licensed configuration should happen on the new licenses branch.
Any runs of the action on a `*-licenses` branch will run status checks only - dependency metadata will not be updated.

Notes:

- If the licenses branch already exists, it is rebased onto the target branch before caching metadata.
- If an open pull request for the branch already exists, no further action is taken.

### Push for changes from bots, Branch for changes from users (`push_for_bots`)

This is a hybrid workflow, choosing either the `branch` or `push` workflow depending on the context that triggered `licensed-ci`.  The intended result is that dependency changes made by bots will run the `push` workflow, while dependency changes initiated by humans will run the `branch` workflow.  Choosing the `push` workflow for changes made by bots requires less human interaction overall in reviewing and merging multiple pull requests.

The workflow that is run is chosen based on a few different checks:

1. If the `branch` workflow has already created a `*-licenses` branch, continue to use the `branch` workflow
1. If the action payload's [sender](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#webhook-payload-object-common-properties) field is for a user account, use the `branch` workflow
1. If the above checks don't pass, use the `push` workflow

## Configuration

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
  1. `push_for_bots`
- `cleanup_on_success` - Optional, default: `'false'`.  Only applies to the `branch` workflow.  Set to the string `'true'` to close PRs and delete branches used by the `branch` workflow when `licensed status` succeeds on the parent branch.
- `dependabot_skip` - Optional, default: `'false'`.  Set to the string `'true'` to prepend `[dependabot skip]` to commit messages when licensed-ci is run on a Pull Request or commit authored by Dependabot.  This will signal to Dependabot that it is safe to perform its normal operations even though non-Dependabot commits are present on the Dependabot Pull Request.
- `sources` - Optional.  Set to a string containing a comma-separated list of [github/licensed sources](https://github.com/github/licensed/tree/master/docs/sources) to add `--sources` CLI arguments to cache and status commands.
- `format` - Optional.  Available values: [`yaml`, `json`]. Set to add a `--format` CLI argument to cache and status commands.

## Outputs

- licenses_branch - The branch containing licensed-ci changes.
- user_branch - The branch containing user changes.
- licenses_updated - A boolean string indicating whether license files were updated.
- pr_url - The html url of the pull request for the license updates branch, if available, to enable further actions scripting.
- pr_number - The number of the pull request for the license updates branch, if available, to enable further actions scripting.
- pr_created - True if a pull request was created in a `branch` workflow, false otherwise.

## Usage

*[See a full example below](#full-nodejs-example)*.

### Supported Events

This action supports the `push`, `pull_request`, `workflow_dispatch`, and `scheduled` events.  When using `push`, the action workflow should include `tags-ignore: '**'` to avoid running the action on pushed tags.  New tags point to code but do not represent new or changed code that could include updated dependencies.

```yaml
on:
  # run on pushes to the default branch
  push:
    branches:
      - main
    tags-ignore: '**'
  # run on pull request events with changes to code
  pull_request:
    types:
      - opened
      - reopened
      - synchronize
  # run on demand
  workflow_dispatch:
  # run on a schedule against the repository's default branch
  schedule:
    - cron: '0 8 * * *' # run every day at 8am
```

### Basic Ruby usage using Bundler + Gemfile

```yaml
jobs:
  licensed:
    env: # optionally configure the Gemfile used
      BUNDLE_GEMFILE: ${{ github.workspace }}/licensed.gemfile
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-ruby@v1
        with:
          ruby-version: 2.6
          bundler-cache: true # improve performance on subsequent runs
          cache-version: 1
      - run: xxx # Install project dependencies here.
      - uses: jonabc/licensed-ci@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          command: "bundle exec licensed" # or bin/licensed when using binstubs
```

### Basic non-Ruby usage using [jonabc/setup-licensed](https://github.com/jonabc/setup-licensed)

```yaml
jobs:
  licensed:
    steps:
      - uses: actions/checkout@v2
      - uses: jonabc/setup-licensed@v1
        with:
          version: 3.x
      - run: xxx # Install project dependencies here.
      - uses: jonabc/licensed-ci@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

### Using outputs to make a PR comment

```yaml
jobs:
  licensed:
    steps:
      - # environment setup ...
      - id: licensed # save the id of the step to reference later
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

### Authentication

#### Accessing private repositories during the licensed-ci action

The default `GITHUB_TOKEN` authentication token provided by GitHub Actions does not have read access to any other GitHub repositories.  If running [github/licensed](https://github.com/github/licensed) in your repo requires access to a private GitHub repository, please set the `github_token` workflow input to a PAT from a user with access to necessary private repositories.

#### Using licensed-ci with permission restrictions on GITHUB_TOKEN

If your action workflow [restricts which permissions](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#permissions-for-the-github_token) are granted to `GITHUB_TOKEN`, please ensure that both `contents` and `pull-requests` are set to `write`. As part of an Actions workflow, `licensed-ci` can push license metadata file updates to a repo, comment on existing PRs, and open new PRs.

```yaml
permissions:
  pull-requests: write
  contents: write
```

### Full Node.js example

```yaml
on:
  # run on pushes to the default branch
  push:
    branches:
      - main
  # run on pull request events with changes to code
  pull_request:
    types:
      - opened
      - reopened
      - synchronize
  # run on demand
  workflow_dispatch:

# ensure that the action can push changes to the repo and edit PRs
# when using `secrets.GITHUB_TOKEN`
permissions:
  pull-requests: write
  contents: write

jobs:
  licensed:
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-ruby@v1
        with:
          ruby-version: 2.6
          bundler-cache: true # improve performance on subsequent runs
          cache-version: 1
      - uses: actions/setup-node@v2
        with:
          node-version: 16
          cache: npm # cache dependencies for faster subsequent runs.
      # install your projects dependencies
      - run: npm install --production --ignore-scripts
      - id: licensed
        uses: jonabc/licensed-ci@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          command: bundle exec licensed # or bin/licensed when using binstubs
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

## License

This project is released under the [MIT License](LICENSE)

## Contributions

Contributions are welcome!
