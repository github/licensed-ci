/** @type {import('jest').Config} */
const config = {
    // We need to use babel to transform ES modules in Octokit
    transformIgnorePatterns: ["\\.pnp\\.[^\\\/]+$"],
};

module.exports = config;
