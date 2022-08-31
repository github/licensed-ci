class CLIOptions {
  configFilePath = '';
  sources = [];
  format = '';

  constructor(configFilePath, sources=[], format='') {
    this.configFilePath = configFilePath;
    this.sources = sources;
    this.format = format;
  }

  get cacheOptions() {
    const options = ['-c', this.configFilePath];
    if (this.sources) {
      options.push(...this.sources.flatMap(s => ['--sources', s]));
    }
    if (this.format) {
      options.push('--format', this.format)
    }

    return options;
  }

  get statusOptions() {
    return this.cacheOptions;
  }

  get envOptions() {
    const options = ['-c', this.configFilePath];
    if (this.format) {
      options.push('--format', this.format)
    }

    return options;
  }
}

module.exports = { CLIOptions };
