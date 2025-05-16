const { merge } = require('webpack-merge');
const common = require('./webpack.common.cjs');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  watch: false, // 通过CLI参数--watch控制
  watchOptions: {
    ignored: /node_modules/,
    aggregateTimeout: 500, // 延迟构建，防止过于频繁
    poll: 1000, // 监听间隔
  },
});