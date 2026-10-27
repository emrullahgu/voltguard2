module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [require.resolve('./src/portal/scopedNetworkPlugin.cjs')],
  };
};
