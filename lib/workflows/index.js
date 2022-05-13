const { run: branch } = require('./branch');
const { run: push } = require('./push');
const { run: push_for_bots } = require('./push_for_bots');

module.exports = {
  branch,
  push,
  push_for_bots
};
