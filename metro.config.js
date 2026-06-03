const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    assetExts: [...defaultConfig.resolver.assetExts, 'tflite'],
    blockList: exclusionList([
      /android\/build\/.*/,
      /ios\/build\/.*/,
      /.*\/android\/build\/.*/,
      /.*\/ios\/build\/.*/,
      /node_modules\/.*\/android\/\.cxx\/.*/,
      /node_modules\/.*\/android\/build\/.*/,
    ]),
  },
};

module.exports = mergeConfig(defaultConfig, config);
