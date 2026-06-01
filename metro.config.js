const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite'],
    blockList: exclusionList([
      /node_modules\/.*\/android\/\.cxx\/.*/,
    ]),
  },
};

module.exports = mergeConfig(defaultConfig, config);
